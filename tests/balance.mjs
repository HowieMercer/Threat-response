/* Monte Carlo balance report.
 *
 *   node tests/balance.mjs [runs]
 *
 * Answers three questions that decide whether the score is a diagnostic or
 * a decoration:
 *
 *   1. Can a player with no security knowledge reach a high rank? If a
 *      coin-flip gets to Threat Hunter most of the time, the rank means
 *      nothing.
 *   2. Is any single pillar dominant? If "always pick Secure" beats
 *      thinking, the game is not simulating a decision.
 *   3. Does stage position leak the answer? This is the v9 failure — the
 *      pool had a positional pattern and the whole thing was solvable
 *      without knowing what an ATT&CK technique was.
 *
 * Run it after any change to scenarios.json. A drift of a few points is
 * noise; a strategy jumping ten points is a rebuilt answer key.
 */

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

/* Node cannot import .json from ESM without an attribute, and the game
 * imports it plainly so the bundler can inline it. Small loader hook
 * rather than a second copy of the data. */
register(
  'data:text/javascript,' +
    encodeURIComponent(`
  export async function resolve(spec, ctx, next) {
    const r = await next(spec, ctx);
    if (r.url.endsWith('.json')) return { ...r, format: 'json', importAttributes: { type: 'json' } };
    return r;
  }
`),
  pathToFileURL('./')
);

const { DATA } = await import('../src/data/index.js');
const { createGame, PHASE } = await import('../src/engine/game.js');
const { PILLARS } = await import('../src/engine/pillars.js');
const { rightBackupFor } = await import('../src/engine/resolve.js');
const { isContained, RANKS } = await import('../src/engine/scoring.js');

const RUNS = Number(process.argv[2] || 40000);

const rnd = (n) => Math.floor(Math.random() * n);
const jitter = (base, spread) => base + (Math.random() * 2 - 1) * spread;

/* A simulated player, not an instant one.
 *
 * The first version of this harness ran in learn mode, where the clock
 * does not move, and reported that scanning every stage got a player to
 * Threat Hunter 80% of the time. That number was an artefact: in a real
 * run a scan costs ground, reading the card costs seconds, and the stage
 * can end before the second pick lands. Anything measured about pacing has
 * to be measured against a player who takes time to do things.
 *
 * READ_MS is deliberately generous — a first-time player at a trade show
 * stand, reading a technique name they have never seen. If the pool ever
 * gets tuned so that this player cannot finish a stage, the report says so
 * through the timeout rate rather than through a complaint at the stand.
 */
const READ_MS = 3400;        // before committing a lead
const READ_SPREAD = 1300;
const BACKUP_MS = 1200;      // lead to backup
const SCAN_MS = 700;         // decide to scan, early
const INJECT_HIT_RATE = 0.72;
const INJECT_REACT_MS = 900;
const TICK = 50;

function runOnce(strategy, seed, { posture = [], mode = 'timed', wantsScan = false, readMs = READ_MS } = {}) {
  const g = createGame({ data: DATA, seed, mode });
  for (const id of posture) g.togglePosture(id);
  g.begin();

  for (let stage = 0; stage < 5; stage++) {
    if (g.state.phase === PHASE.CLIMAX) g.climaxGo();

    if (mode === 'learn') {
      if (wantsScan) g.scan();
      const lead = strategy(g.state, 'lead', null);
      g.choose(lead);
      let backup = strategy(g.state, 'backup', lead);
      if (backup === lead) backup = PILLARS.find((p) => p !== lead);
      g.choose(backup);
    } else {
      let t = 0;
      const leadAt = Math.max(600, jitter(readMs, READ_SPREAD));
      let scanned = !wantsScan;
      let leadPick = null;
      let injectDeadline = null;
      let injectWillHit = false;

      /* Guard the loop rather than trusting it to terminate: the engine
       * ends a stage on timeout, but a bug in the rate maths would hang
       * the whole report. */
      for (let i = 0; i < 4000 && g.state.phase === PHASE.STAGE; i++) {
        if (g.state.inject && injectDeadline === null) {
          injectWillHit = Math.random() < INJECT_HIT_RATE;
          injectDeadline = t + (injectWillHit ? jitter(INJECT_REACT_MS, 300) : 99999);
        }
        if (g.state.inject && injectDeadline !== null && t >= injectDeadline) {
          g.resolveInject(injectWillHit);
          injectDeadline = null;
        }
        if (!scanned && t >= SCAN_MS) {
          scanned = true;
          g.scan();
        }
        if (!leadPick && t >= leadAt) {
          leadPick = strategy(g.state, 'lead', null);
          g.choose(leadPick);
        } else if (leadPick && !g.state.backup && t >= leadAt + BACKUP_MS) {
          let b = strategy(g.state, 'backup', leadPick);
          if (b === leadPick) b = PILLARS.find((p) => p !== leadPick);
          g.choose(b);
        }
        g.tick(TICK);
        t += TICK;
      }
      /* If it is still running, the engine failed to resolve. Surface it. */
      if (g.state.phase === PHASE.STAGE) throw new Error('stage did not resolve — check the rate maths');
    }
    g.nextStage();
  }
  return g.summary();
}

const random = (s, slot, lead) => {
  const opts = slot === 'lead' ? PILLARS : PILLARS.filter((p) => p !== lead);
  return opts[rnd(opts.length)];
};

/* Avoid the weak layer, guess between the other two. Only honest if the
 * player actually scanned, which is why the strategy carries wantsScan. */
const avoidWeak = (s, slot, lead) => {
  if (!s.revealed.weak) return random(s, slot, lead);
  const weak = PILLARS.find((p) => s.variant.rank[p] === 'weak');
  const opts = (slot === 'lead' ? PILLARS : PILLARS.filter((p) => p !== lead)).filter((p) => p !== weak);
  const from = opts.length ? opts : PILLARS.filter((p) => p !== lead);
  return from[rnd(from.length)];
};

const STRATEGIES = [
  /* No knowledge at all. The floor the rank ladder has to sit above. */
  { name: 'blind — uniform random', fn: random },

  /* One product, every stage. Must not be competitive — that is the
   * commercial argument, and it has to be true in the numbers rather than
   * asserted in the copy. */
  { name: 'always Manage', fn: (s, slot) => (slot === 'lead' ? 'manage' : 'secure') },
  { name: 'always Secure', fn: (s, slot) => (slot === 'lead' ? 'secure' : 'recover') },
  { name: 'always Recover', fn: (s, slot) => (slot === 'lead' ? 'recover' : 'manage') },

  /* The v9 exploit: patch early, restore late, no knowledge required. If
   * this beats random by much, the positional pattern is back. */
  {
    name: 'positional heuristic',
    fn: (s, slot, lead) => {
      const early = s.stageIndex <= 1;
      if (slot === 'lead') return early ? 'manage' : 'recover';
      return early ? 'secure' : lead === 'recover' ? 'secure' : 'recover';
    },
  },

  /* Presses scan whenever it can, then guesses between the two remaining
   * pillars. This is the strategy that has to NOT be a winning one, or the
   * rank measures button-pressing instead of knowledge. */
  { name: 'scan then guess', fn: avoidWeak, wantsScan: true },
  { name: 'scan + 24/7 SOC', fn: avoidWeak, wantsScan: true, posture: ['soc-watch', 'immutable-vault'] },

  /* A first-time player at a stand who reads every word before touching
   * anything. The stage clocks have to leave room for this person, or the
   * game punishes carefulness and the booth staff hear about it. */
  { name: 'slow reader (8s/card)', fn: random, readMs: 8000 },
  { name: 'slow reader + scan', fn: avoidWeak, wantsScan: true, readMs: 8000 },

  /* Knows the answer key. The ceiling, and it has to be reachable or the
   * top rank is a rank players correctly stop believing in. */
  {
    name: 'expert — perfect stack',
    fn: (s, slot) => {
      const best = PILLARS.find((p) => s.variant.rank[p] === 'best');
      return slot === 'lead' ? best : rightBackupFor(s.variant, best);
    },
  },
];

function report(strat, runs, mode) {
  let hunterPlus = 0, champion = 0, contained = 0, indexSum = 0, closed = 0, timedOut = 0, stages = 0;
  const rankCount = {};
  const leadOutcome = { best: 0, partial: 0, weak: 0, none: 0 };

  for (let i = 0; i < runs; i++) {
    const s = runOnce(strat.fn, (Math.random() * 4294967296) >>> 0, {
      mode,
      posture: strat.posture || [],
      wantsScan: !!strat.wantsScan,
      readMs: strat.readMs || READ_MS,
    });
    const pts = s.defense;
    if (pts >= 7) hunterPlus++;
    if (pts >= 10) champion++;
    contained += s.rounds.filter((r) => isContained(r.outcome)).length;
    indexSum += s.index;
    if (s.business === 'closed') closed++;
    rankCount[s.rank.name] = (rankCount[s.rank.name] || 0) + 1;
    for (const r of s.rounds) {
      stages++;
      if (r.timedOut && !r.lead) timedOut++;
      leadOutcome[r.lead ? r.rank[r.lead] : 'none']++;
    }
  }

  return {
    name: strat.name,
    hunterPlus: (hunterPlus / runs) * 100,
    champion: (champion / runs) * 100,
    contained: contained / runs,
    index: indexSum / runs,
    closed: (closed / runs) * 100,
    unanswered: (timedOut / stages) * 100,
    rankCount,
    leadOutcome,
  };
}

const pad = (s, n) => String(s).padEnd(n);
const num = (v, n, d = 1) => v.toFixed(d).padStart(n);
const per = Math.max(400, Math.floor(RUNS / STRATEGIES.length));

console.log(`\nThreat Response — balance report`);
console.log(`${per.toLocaleString()} runs per strategy, ${(per * STRATEGIES.length).toLocaleString()} total`);
console.log(`Timed mode, with a simulated player who takes ${(READ_MS / 1000).toFixed(1)}s +/- ${(READ_SPREAD / 1000).toFixed(1)}s to read a card.\n`);

console.log(pad('strategy', 26), 'Hunter+', '  Champ', ' contained', '  index', '  closed', ' no-answer');
console.log('-'.repeat(86));
const rows = [];
for (const strat of STRATEGIES) {
  const r = report(strat, per, 'timed');
  rows.push(r);
  console.log(
    pad(r.name, 26),
    num(r.hunterPlus, 6) + '%',
    num(r.champion, 6) + '%',
    num(r.contained, 8, 2) + '/5',
    num(r.index, 7),
    num(r.closed, 7) + '%',
    num(r.unanswered, 9) + '%'
  );
}

console.log('\nLead-pick quality — is any single pillar quietly correct?');
console.log('-'.repeat(86));
for (const r of rows.filter((x) => x.name.startsWith('always') || x.name.startsWith('positional'))) {
  const t = r.leadOutcome.best + r.leadOutcome.partial + r.leadOutcome.weak;
  console.log(
    pad(r.name, 26),
    `best ${num((r.leadOutcome.best / t) * 100, 5)}%`,
    `partial ${num((r.leadOutcome.partial / t) * 100, 5)}%`,
    `weak ${num((r.leadOutcome.weak / t) * 100, 5)}%`
  );
}

console.log('\nRank reachability under blind play');
console.log('-'.repeat(86));
const blind = rows[0];
for (const rank of RANKS) {
  const n = blind.rankCount[rank.name] || 0;
  console.log(pad(rank.name, 26), num((n / per) * 100, 6) + '%', n === 0 ? '  <- NEVER REACHED' : '');
}

const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
const singles = rows.filter((r) => r.name.startsWith('always'));
const expert = byName['expert — perfect stack'];

console.log('\nChecks');
console.log('-'.repeat(86));
const checks = [
  ['blind play stays under 50% to Threat Hunter', blind.hunterPlus < 50],
  ['blind Champion stays rare (under 5%)', blind.champion < 5],
  ['expert play reaches Champion reliably', expert.champion > 90],
  ['no single pillar beats random by more than 10 points', Math.max(...singles.map((r) => r.hunterPlus)) - blind.hunterPlus < 10],
  ['positional heuristic beats random by under 10 points', byName['positional heuristic'].hunterPlus - blind.hunterPlus < 10],
  ['scan-and-guess is not a winning strategy', byName['scan then guess'].hunterPlus < 55],
  ['readiness investment does not hand out the top rank', byName['scan + 24/7 SOC'].champion < 15],
  ['a slow, careful reader still finishes every stage', byName['slow reader (8s/card)'].unanswered < 10],
  ['a slow reader is not scored below a random one', byName['slow reader (8s/card)'].index > blind.index - 8],
  ['every rank is reachable blind', RANKS.every((r) => (blind.rankCount[r.name] || 0) > 0)],
  ['a reading player is not timed out of stages', blind.unanswered < 6],
];
let failed = 0;
for (const [label, ok] of checks) {
  console.log(ok ? '  pass  ' : '  FAIL  ', label);
  if (!ok) failed++;
}
console.log('');
process.exit(failed ? 1 : 0);
