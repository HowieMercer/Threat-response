/* Monte Carlo answer-key report.
 *
 *   node scripts/monte-carlo.mjs [runs]        default 40000
 *   node scripts/monte-carlo.mjs 40000 --json  machine-readable, for diffing
 *
 * Answers the question that decides whether the score is a diagnostic or a
 * decoration: can somebody with no security knowledge reach a high rank?
 *
 * Six things it measures, each of which has been wrong at some point:
 *
 *   1. Blind-play rank distribution. If a coin flip reaches Threat Hunter,
 *      the ladder means nothing.
 *   2. Single-pillar strategies. "Always pick Secure" must not be
 *      competitive, because "you cannot win with one product" is the
 *      commercial argument and it has to be true in the numbers.
 *   3. Positional heuristics. v9 shipped a pool where stage position gave
 *      the answer away.
 *   4. TYPOGRAPHIC heuristics. v13 shipped a pool where the correct `act`
 *      string was the longest one 85% of the time and the only one
 *      containing a comma. Worse than a positional tell, because it needs
 *      no knowledge at all and it is visible at a glance.
 *   5. Per-pillar and per-stage-position correctness spread, so a
 *      deducible pattern shows up as a lumpy table rather than as a
 *      complaint at a stand.
 *   6. Readiness card marginal value, measured against an attentive
 *      non-expert. A card worth nothing is a dead choice; a pair that
 *      reaches 100% is a solved game.
 *
 * The player model matters. Runs are played in timed mode by someone who
 * takes 3.4s +/- 1.3s to read a card, because pacing measured against an
 * instant player is not measured at all — that mistake once reported a
 * strategy at 80% that was really at 48%.
 */

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register(
  'data:text/javascript,' + encodeURIComponent(`
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
const { isContained, isMitigated, RANKS } = await import('../src/engine/scoring.js');

const RUNS = Number(process.argv.find((a) => /^\d+$/.test(a)) || 40000);
const asJson = process.argv.includes('--json');

const rnd = (n) => Math.floor(Math.random() * n);
const jitter = (b, s) => b + (Math.random() * 2 - 1) * s;
const READ_MS = 3400, READ_SPREAD = 1300, BACKUP_MS = 1200, SCAN_MS = 700;
const INJECT_HIT = 0.72, TICK = 50;

/* The player model has to USE the mechanics, or a card that acts on one of
 * them measures as worthless and the measurement gets mistaken for the
 * card. That has now happened twice in this project: once measuring scan in
 * learn mode where the clock does not move, and once measuring a card that
 * reveals information with a strategy that ignored it. `wantsHold` exists
 * because the third time was a card that makes isolating free, measured by
 * a player who never isolated. */
function play(strategy, { posture = [], wantsScan = false, wantsHold = false, readMs = READ_MS } = {}) {
  const g = createGame({ data: DATA, seed: (Math.random() * 4294967296) >>> 0, mode: 'timed' });
  for (const id of posture) g.togglePosture(id);
  g.begin();
  for (let stage = 0; stage < 5; stage++) {
    if (g.state.phase === PHASE.CLIMAX) g.climaxGo();
    let t = 0, lead = null, scanned = !wantsScan, injectAt = null, willHit = false, held = !wantsHold;
    for (let i = 0; i < 4000 && g.state.phase === PHASE.STAGE; i++) {
      if (g.state.inject && injectAt === null) {
        willHit = Math.random() < INJECT_HIT;
        injectAt = t + (willHit ? jitter(900, 300) : 1e9);
      }
      if (g.state.inject && injectAt !== null && t >= injectAt) { g.resolveInject(willHit); injectAt = null; }
      if (!scanned && t >= SCAN_MS) { scanned = true; g.scan(); }
      /* Isolate once, after reading, before committing — which is when a
       * player who is behind on the track actually reaches for it. */
      if (!held && t >= readMs - 600) { held = true; g.hold(); }
      if (!lead && t >= readMs) { lead = strategy(g.state, 'lead', null); g.choose(lead); }
      else if (lead && !g.state.backup && t >= readMs + BACKUP_MS) {
        let b = strategy(g.state, 'backup', lead);
        if (b === lead) b = PILLARS.find((p) => p !== lead);
        g.choose(b);
      }
      g.tick(TICK); t += TICK;
    }
    if (g.state.phase === PHASE.STAGE) throw new Error('stage did not resolve');
    g.nextStage();
  }
  return g.summary();
}

/* ─────────────────────────────────────────────────────── strategies ─── */

const random = (s, slot, lead) => {
  const o = slot === 'lead' ? PILLARS : PILLARS.filter((p) => p !== lead);
  return o[rnd(o.length)];
};
/* What a knowledge-free player does with a scan: the game has just told
 * them one layer is a partial fit, so they rule it out and flip between the
 * other two. It should gain them nothing — see the note on scan() in
 * engine/game.js — and `scan then guess` below is the check that it does
 * not. The paired strategy takes the partial instead, which is the other
 * thing a knowledge-free player might reasonably do with the same reveal,
 * and it has to come out at the same number. */
const avoidPartial = (s, slot, lead) => {
  if (!s.revealed.partial) return random(s, slot, lead);
  const partial = PILLARS.find((p) => s.variant.rank[p] === 'partial');
  const o = (slot === 'lead' ? PILLARS : PILLARS.filter((p) => p !== lead)).filter((p) => p !== partial);
  return (o.length ? o : PILLARS.filter((p) => p !== lead))[rnd(o.length || 2)];
};
const takePartial = (s, slot, lead) => {
  if (!s.revealed.partial) return random(s, slot, lead);
  const partial = PILLARS.find((p) => s.variant.rank[p] === 'partial');
  if (slot === 'lead') return partial;
  return partial === lead ? random(s, slot, lead) : partial;
};
/* The typographic exploits. These read the copy, not the ranks — which is
 * exactly what a player at a stand can do in the two seconds they have. */
const longestAct = (s, slot, lead) => {
  const o = slot === 'lead' ? PILLARS : PILLARS.filter((p) => p !== lead);
  return o.reduce((a, b) => (s.variant.act[b].length > s.variant.act[a].length ? b : a));
};
const shortestAct = (s, slot, lead) => {
  const o = slot === 'lead' ? PILLARS : PILLARS.filter((p) => p !== lead);
  return o.reduce((a, b) => (s.variant.act[b].length < s.variant.act[a].length ? b : a));
};
const mostCommas = (s, slot, lead) => {
  const o = slot === 'lead' ? PILLARS : PILLARS.filter((p) => p !== lead);
  const c = (p) => (s.variant.act[p].match(/,/g) || []).length;
  const max = Math.max(...o.map(c));
  const top = o.filter((p) => c(p) === max);
  return top[rnd(top.length)];
};
/* One competence level above knowing nothing, and the only invented
 * parameter in this file is which level: this player cannot rank three
 * layers, but shown that one of them is only a partial fit they can tell
 * the strongest of the remaining two from the weakest. That is a real
 * competence — it is roughly "has worked an incident, has not memorised
 * ATT&CK" — and it is the player the information cards are sold to.
 *
 * It exists because a knowledge-free model structurally cannot measure a
 * knowledge-gated mechanic, and reporting such a mechanic as dead is the
 * same measurement mistake this file has already made three times. */
const semiInformed = (s, slot, lead) => {
  if (!s.revealed.partial) return random(s, slot, lead);
  const best = PILLARS.find((p) => s.variant.rank[p] === 'best');
  if (slot === 'lead') return best;
  return rightBackupFor(s.variant, lead);
};
const expert = (s, slot) => {
  const best = PILLARS.find((p) => s.variant.rank[p] === 'best');
  return slot === 'lead' ? best : rightBackupFor(s.variant, best);
};

const STRATEGIES = [
  { name: 'blind — uniform random', fn: random, blind: true },
  { name: 'always Manage', fn: (s, slot) => (slot === 'lead' ? 'manage' : 'secure') },
  { name: 'always Secure', fn: (s, slot) => (slot === 'lead' ? 'secure' : 'recover') },
  { name: 'always Recover', fn: (s, slot) => (slot === 'lead' ? 'recover' : 'manage') },
  {
    name: 'positional heuristic',
    fn: (s, slot, lead) => {
      const early = s.stageIndex <= 1;
      if (slot === 'lead') return early ? 'manage' : 'recover';
      return early ? 'secure' : lead === 'recover' ? 'secure' : 'recover';
    },
  },
  { name: 'longest act string', fn: longestAct, exploit: true },
  { name: 'shortest act string', fn: shortestAct, exploit: true },
  { name: 'most commas in act', fn: mostCommas, exploit: true },
  /* Closer to a real first-time player than uniform random: reads the
   * card, has no security knowledge, uses the free look the game offers.
   * Reported because the 35-45% invariant sits between this number and the
   * uniform-random one, so which player "blind" means decides the verdict. */
  { name: 'naive reader', fn: avoidPartial, wantsScan: true, wantsHold: true },
  { name: 'scan then guess', fn: avoidPartial, wantsScan: true },
  { name: 'scan then take it', fn: takePartial, wantsScan: true },
  { name: 'semi-informed + scan', fn: semiInformed, wantsScan: true, wantsHold: true },
  { name: 'expert — perfect stack', fn: expert },
];

/* ──────────────────────────────────────────────────────── measure ───── */

/* Collected only for the blind strategy, to build the threshold table. */
const blindDefense = [];

function measure(strat, n) {
  const rankCount = {};
  const leadRank = { best: 0, partial: 0, weak: 0, none: 0 };
  /* Correctness by pillar chosen and by stage position: a deducible
   * pattern shows up here as a lumpy row. */
  const byPillar = Object.fromEntries(PILLARS.map((p) => [p, { picked: 0, best: 0 }]));
  const byStage = Array.from({ length: 5 }, () => ({ picked: 0, best: 0 }));
  let hunter = 0, champ = 0, contained = 0, index = 0, closed = 0, unanswered = 0, stages = 0, score = 0;
  /* Defense points and surviving systems are separate axes from the index.
   * The index is computed from stage outcomes alone, so a readiness card
   * that brings systems back cannot move it — measuring such a card by
   * index reports it as dead when it is not. */
  let defense = 0, systemsLost = 0, health = 0;

  for (let i = 0; i < n; i++) {
    const s = play(strat.fn, strat);
    if (s.defense >= RANKS.find((r) => r.name === 'Threat Hunter').min) hunter++;
    if (s.defense >= 10) champ++;
    contained += s.rounds.filter((r) => isContained(r.outcome)).length;
    index += s.index;
    score += s.score;
    if (s.business === 'closed') closed++;
    defense += s.defense;
    if (strat.blind) blindDefense.push(s.defense);
    systemsLost += Object.values(s.estate).filter((v) => v <= 0).length;
    /* Total estate health out of 12, not just the count of systems at
     * zero. A card that stops a system being degraded is on screen for the
     * whole run and invisible to `lost`, which only counts total losses —
     * and measuring a mechanic on an axis it does not act on is how this
     * file has misreported a card four times now. */
    health += Object.values(s.estate).reduce((a, b) => a + b, 0);
    rankCount[s.rank.name] = (rankCount[s.rank.name] || 0) + 1;
    for (const r of s.rounds) {
      stages++;
      if (!r.lead) { unanswered++; leadRank.none++; continue; }
      const rk = r.rank[r.lead];
      leadRank[rk]++;
      byPillar[r.lead].picked++;
      if (rk === 'best') byPillar[r.lead].best++;
      byStage[r.stage - 1].picked++;
      if (rk === 'best') byStage[r.stage - 1].best++;
    }
  }
  return {
    name: strat.name,
    exploit: !!strat.exploit,
    hunter: (hunter / n) * 100,
    champ: (champ / n) * 100,
    contained: contained / n,
    index: index / n,
    score: Math.round(score / n),
    closed: (closed / n) * 100,
    defense: defense / n,
    systemsLost: systemsLost / n,
    health: health / n,
    unanswered: (unanswered / stages) * 100,
    leadRank,
    byPillar,
    byStage,
    rankCount,
    n,
  };
}

const per = Math.max(300, Math.floor(RUNS / STRATEGIES.length));
const rows = STRATEGIES.map((s) => measure(s, per));
const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
const blind = byName['blind — uniform random'];

/* Readiness cards: marginal value against an attentive non-expert, which
 * is the player who actually buys one. */
const CARD_RUNS = Math.max(200, Math.floor(per / 3));
/* Uniform random rather than a strategy that reads the reveal, because
 * the reveal is deliberately worth nothing without knowledge. This player
 * uses every mechanic — scans, isolates, answers injects — and knows no
 * security, which is the player who actually buys a readiness card. */
const CARD_PLAYER = { fn: random, wantsScan: true, wantsHold: true };
/* And the same board measured by the player one level up, because three of
 * the six cards act on information or on time and both are worth nothing
 * to someone who cannot use them. A card is a live choice if it is live
 * for either player; a card that is dead for both is decoration. */
const CARD_PLAYER_2 = { fn: semiInformed, wantsScan: true, wantsHold: true };
const deltas = (m, base) => ({
  dIndex: m.index - base.index,
  dHunter: m.hunter - base.hunter,
  dClosed: m.closed - base.closed,
  dDefense: m.defense - base.defense,
  dLost: m.systemsLost - base.systemsLost,
  dHealth: m.health - base.health,
});
const live = (d) => d.dIndex >= 3 || Math.abs(d.dClosed) >= 8 || d.dDefense >= 0.4 || d.dLost <= -0.35 || d.dHealth >= 0.8;
const cardBase = measure({ name: 'no cards', ...CARD_PLAYER }, CARD_RUNS);
const cardBase2 = measure({ name: 'no cards', ...CARD_PLAYER_2 }, CARD_RUNS);
const cards = DATA.postures.cards.map((c) => {
  const m = measure({ name: c.id, ...CARD_PLAYER, posture: [c.id] }, CARD_RUNS);
  const m2 = measure({ name: c.id, ...CARD_PLAYER_2, posture: [c.id] }, CARD_RUNS);
  const d = deltas(m, cardBase);
  const d2 = deltas(m2, cardBase2);
  return { id: c.id, pillar: c.pillar, ...m, ...d, informed: d2, liveBlind: live(d), live: live(d) || live(d2) };
});
/* Every legal pair, so a solved combination cannot hide. */
const PAIRS = [];
for (let i = 0; i < DATA.postures.cards.length; i++) {
  for (let j = i + 1; j < DATA.postures.cards.length; j++) {
    const a = DATA.postures.cards[i], b = DATA.postures.cards[j];
    const samePillar = a.pillar === b.pillar;
    if (samePillar && DATA.postures.maxPerPillar < 2) continue;
    const m = measure({ name: `${a.id}+${b.id}`, ...CARD_PLAYER, posture: [a.id, b.id] }, Math.floor(CARD_RUNS / 2));
    PAIRS.push({ pair: `${a.id} + ${b.id}`, hunter: m.hunter, champ: m.champ, index: m.index });
  }
}
PAIRS.sort((a, b) => b.hunter - a.hunter);

/* ───────────────────────────────────────────────────────── report ───── */

if (asJson) {
  console.log(JSON.stringify({ runs: per * STRATEGIES.length, perStrategy: per, rows, cards, pairs: PAIRS.slice(0, 8) }, null, 2));
  process.exit(0);
}

const pad = (s, n) => String(s).padEnd(n);
const num = (v, n, d = 1) => v.toFixed(d).padStart(n);

console.log(`\nThreat Response — Monte Carlo answer-key report`);
console.log(`${(per * STRATEGIES.length).toLocaleString()} runs total, ${per.toLocaleString()} per strategy`);
console.log(`Timed mode, simulated read time ${(READ_MS / 1000).toFixed(1)}s +/- ${(READ_SPREAD / 1000).toFixed(1)}s\n`);

console.log(pad('strategy', 24), 'Hunter+', ' Champ', ' def', 'contained', ' index', ' closed', 'no-answer');
console.log('-'.repeat(90));
for (const r of rows) {
  console.log(
    pad(r.name, 24), num(r.hunter, 6) + '%', num(r.champ, 5) + '%',
    /* Mean defense points out of 10. Printed because half the checks below
     * are measured on it: it is what the rank ladder reads, and unlike
     * Hunter+ it does not amplify variance. */
    num(r.defense, 4, 1), num(r.contained, 8, 2) + '/5', num(r.index, 6),
    num(r.closed, 6) + '%', num(r.unanswered, 8) + '%'
  );
}

console.log('\nlead-pick quality — a strategy that knows nothing should sit at 33/33/33');
console.log('-'.repeat(84));
for (const r of rows) {
  const t = r.leadRank.best + r.leadRank.partial + r.leadRank.weak;
  console.log(
    pad(r.name, 24),
    `best ${num((r.leadRank.best / t) * 100, 5)}%`,
    `partial ${num((r.leadRank.partial / t) * 100, 5)}%`,
    `weak ${num((r.leadRank.weak / t) * 100, 5)}%`
  );
}

console.log('\nblind play: correctness spread — lumpy means deducible');
console.log('-'.repeat(84));
console.log('  by pillar chosen  ', PILLARS.map((p) => `${p} ${num((blind.byPillar[p].best / blind.byPillar[p].picked) * 100, 5)}%`).join('   '));
console.log('  by stage position ', blind.byStage.map((s, i) => `s${i + 1} ${num((s.best / s.picked) * 100, 5)}%`).join('  '));

console.log('\nblind play: rank distribution');
console.log('-'.repeat(84));
for (const rank of RANKS) {
  const n = blind.rankCount[rank.name] || 0;
  console.log('  ' + pad(rank.name, 22) + num((n / blind.n) * 100, 6) + '%' + (n === 0 ? '   <- NEVER REACHED' : ''));
}

/* The 35-45% invariant is a statement about the rank LADDER, not about the
 * answer key, and the two are worth separating. Uniform-random play averages
 * 5 defense points because a coin flip gets `best` a third of the time, so
 * where the Threat Hunter line sits decides the number entirely. This table
 * is the lever: it says what each threshold would produce, so the decision
 * is one edit to RANKS in scoring.js and not a rebalance of the pool. */
console.log(`\nwhere the Threat Hunter line lands blind play (currently ${RANKS.find((r) => r.name === 'Threat Hunter').min})`);
console.log('-'.repeat(84));
console.log('  defense pts  ' + [4, 5, 6, 7, 8].map((t) => 't>=' + t).join('      '));
console.log('  blind at+    ' + [4, 5, 6, 7, 8].map((t) => {
  const share = blindDefense.filter((d) => d >= t).length / blindDefense.length;
  return num(share * 100, 5) + '%';
}).join('    '));

console.log(`\nreadiness cards — marginal value, ${CARD_RUNS.toLocaleString()} runs each, knows no security`);
console.log('-'.repeat(84));
console.log('  ' + pad('baseline, no cards', 25) +
  `index ${num(cardBase.index, 5)}  defense ${num(cardBase.defense, 4, 2)}  lost ${num(cardBase.systemsLost, 4, 2)}  estate ${num(cardBase.health, 5, 2)}/12  closed ${num(cardBase.closed, 5)}%`);
const sign = (v, d = 1) => (v >= 0 ? '+' : '') + v.toFixed(d);
for (const c of [...cards].sort((a, b) => b.dIndex - a.dIndex)) {
  console.log(
    '  ' + pad(c.id, 17) + pad(c.pillar, 8) +
    `index ${num(c.index, 5)} (${pad(sign(c.dIndex), 6)})  ` +
    `defense ${num(c.defense, 4, 2)} (${pad(sign(c.dDefense, 2), 6)})  ` +
    `lost ${num(c.systemsLost, 4, 2)} (${pad(sign(c.dLost, 2), 6)})  ` +
    `estate ${pad(sign(c.dHealth, 2), 6)}  ` +
    `closed ${num(c.closed, 5)}% (${sign(c.dClosed)})`
  );
}

/* The same board for the player one competence level up. A card that only
 * appears here is knowledge-gated, which is a fact about the card and not
 * a fault in it — but it has to be visible, because it decides who the
 * card is worth recommending to. */
console.log(`\nreadiness cards — the same board, semi-informed player`);
console.log('-'.repeat(84));
console.log('  ' + pad('baseline, no cards', 25) +
  `index ${num(cardBase2.index, 5)}  defense ${num(cardBase2.defense, 4, 2)}  lost ${num(cardBase2.systemsLost, 4, 2)}  estate ${num(cardBase2.health, 5, 2)}/12  closed ${num(cardBase2.closed, 5)}%`);
for (const c of [...cards].sort((a, b) => b.informed.dIndex - a.informed.dIndex)) {
  const d = c.informed;
  console.log(
    '  ' + pad(c.id, 17) + pad(c.pillar, 8) +
    `index ${pad(sign(d.dIndex), 7)}  defense ${pad(sign(d.dDefense, 2), 7)}  ` +
    `lost ${pad(sign(d.dLost, 2), 7)}  estate ${pad(sign(d.dHealth, 2), 7)}  closed ${pad(sign(d.dClosed), 7)}  ` +
    (live(d) && !c.liveBlind ? 'knowledge-gated' : '')
  );
}

console.log('\nreadiness pairs — the strongest legal two-card builds');
console.log('-'.repeat(84));
for (const p of PAIRS.slice(0, 5)) {
  console.log('  ' + pad(p.pair, 40) + `Hunter+ ${num(p.hunter, 5)}%  Champ ${num(p.champ, 5)}%  index ${num(p.index, 5)}`);
}

console.log('\nchecks');
console.log('-'.repeat(84));
const singles = rows.filter((r) => r.name.startsWith('always'));
const checks = [
  ['blind play reaches Threat Hunter in the 35-45% band', blind.hunter >= 35 && blind.hunter <= 45,
   `${blind.hunter.toFixed(1)}%`],
  ['blind Champion stays rare (under 5%)', blind.champ < 5, `${blind.champ.toFixed(2)}%`],
  ['expert play reaches Champion reliably', byName['expert — perfect stack'].champ > 90,
   `${byName['expert — perfect stack'].champ.toFixed(1)}%`],
  /* Single-pillar play, on expected points for the same reason the scan
   * checks below are: Hunter+ counts runs crossing a line at 6 defense
   * points, so it amplifies a small change in the mean and carries about
   * +/-1.7 points of sampling error at this sample size. This check
   * straddled a 10-point threshold across repeated runs, +7.8 to +10.5,
   * while the underlying pool never moved at all.
   *
   * The exact, variance-free version of the claim is a unit test now, in
   * tests/integrity.test.js, computed straight from the ranks: always
   * Manage is worth +0.25 defense points a run against a coin flip, always
   * Secure +0.50, always Recover -0.75, against a bound of 1. What is left
   * here is the same thing sampled, plus the ladder reading one-sided at
   * 14 — about two standard deviations above the measured spread, so it
   * catches a real break rather than a sample. */
  /* One-sided, and that is what the claim is. A pillar worth LESS than a
   * coin flip is not dominance — Recover is deliberately a poor default,
   * because "recovery is not a stage-five rescue" is one of the three
   * arguments the mechanics have to carry, and it measures at about -1
   * defense point a run. Both directions are bounded exactly, on the pool
   * rather than on a sample, by the integrity test named above. */
  ['no single pillar gains a defense point over blind',
   Math.max(...singles.map((r) => r.defense - blind.defense)) < 1,
   singles.map((r) => `${r.name.replace('always ', '')[0]}${sign(r.defense - blind.defense, 2)}`).join(' ')],
  ['no single pillar runs away with the rank ladder',
   Math.max(...singles.map((r) => r.hunter)) - blind.hunter < 14,
   sign(Math.max(...singles.map((r) => r.hunter)) - blind.hunter)],
  ['positional heuristic beats blind by under 10 points',
   byName['positional heuristic'].hunter - blind.hunter < 10,
   sign(byName['positional heuristic'].hunter - blind.hunter)],
  ['LONGEST-ACT heuristic beats blind by under 10 points',
   byName['longest act string'].hunter - blind.hunter < 10,
   sign(byName['longest act string'].hunter - blind.hunter)],
  ['SHORTEST-ACT heuristic beats blind by under 10 points',
   byName['shortest act string'].hunter - blind.hunter < 10,
   sign(byName['shortest act string'].hunter - blind.hunter)],
  ['MOST-COMMAS heuristic beats blind by under 10 points',
   byName['most commas in act'].hunter - blind.hunter < 10,
   sign(byName['most commas in act'].hunter - blind.hunter)],
  /* The scan must be worth nothing to a player who cannot reason about the
   * technique, in both directions: ruling the partial out and taking it are
   * both worth exactly 1.0 defense points a stage, the same as a blind flip.
   *
   * Measured on expected defense points, not on Hunter+, and the difference
   * matters. Hunter+ is a threshold count, so it is sensitive to variance as
   * well as to the mean: taking the partial every time scores a flat 5 points
   * a run and therefore never reaches a line drawn at 6, while a blind flip
   * with the same mean sometimes does. That strategy sits about six points of
   * Hunter+ BELOW blind for that reason alone, permanently, and an earlier
   * two-sided check on Hunter+ read the arithmetic being correct as the
   * arithmetic being broken. The claim is about expected value, so the check
   * is too — and the exploit direction is still checked on Hunter+, one-sided,
   * because that is the number the rank ladder actually reads. */
  ['scan gains no expected points, ruling the partial out',
   Math.abs(byName['scan then guess'].defense - blind.defense) < 0.4,
   `${sign(byName['scan then guess'].defense - blind.defense, 2)} defense pts vs blind`],
  ['scan gains no expected points, taking the partial',
   Math.abs(byName['scan then take it'].defense - blind.defense) < 0.4,
   `${sign(byName['scan then take it'].defense - blind.defense, 2)} defense pts vs blind`],
  ['neither use of a scan beats blind on the rank ladder',
   byName['scan then guess'].hunter - blind.hunter < 6 &&
   byName['scan then take it'].hunter - blind.hunter < 6,
   `${sign(byName['scan then guess'].hunter - blind.hunter)} / ${sign(byName['scan then take it'].hunter - blind.hunter)}`],
  /* Reachability is a property of the ladder, not of blind play — blind
   * Champion is meant to be near-impossible, so testing it empirically at
   * this sample size measured noise. Checked across every strategy in the
   * report instead. */
  ['every rank reached by some strategy in this report',
   RANKS.every((r) => rows.some((row) => (row.rankCount[r.name] || 0) > 0)),
   RANKS.filter((r) => !rows.some((row) => (row.rankCount[r.name] || 0) > 0)).map((r) => r.name).join(' ') || 'all'],
  /* Live on ANY axis. Different cards act on different quantities and
   * scoring them all by the index is what reported three of six as dead
   * when two of them were only invisible. */
  ['every readiness card is a live choice for one of the two players',
   cards.every((c) => c.live),
   cards.filter((c) => !c.live).map((c) => c.id).join(' ') || 'all live'],
  ['no two-card build solves the run (Champion under 25%)',
   PAIRS.every((p) => p.champ < 25), `worst ${Math.max(...PAIRS.map((p) => p.champ)).toFixed(1)}%`],
  ['all three pillars correct at some stage position',
   PILLARS.every((p) => DATA.scenarios.stages.some((st) => st.variants.some((v) => v.rank[p] === 'best'))), ''],
  ['a reading player is not timed out of stages', blind.unanswered < 6,
   `${blind.unanswered.toFixed(1)}%`],
];
let failed = 0;
for (const [label, ok, detail] of checks) {
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${pad(label, 62)} ${detail}`);
  if (!ok) failed++;
}
console.log('');
process.exit(failed ? 1 : 0);
