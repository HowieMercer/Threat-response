/* Engine behavior and scoring maths. No DOM anywhere in here — if one of
 * these tests ever needs jsdom, something has leaked out of src/engine/.
 */

import { describe, it, expect } from 'vitest';
import { DATA } from '../src/data/index.js';
import {
  createGame, PHASE, businessOutcome, HOLD_PUSHBACK,
  SCAN_COST, HOLD_COST, SCAN_DEPTH_COST, CAPACITY_START,
} from '../src/engine/game.js';
import { PILLARS } from '../src/engine/pillars.js';
import { rightBackupFor } from '../src/engine/resolve.js';
import {
  resilienceIndex, defensePoints, rankFor, resolveZone, RANKS,
  DEFENSE_CAP, phaseScores, weakestPhase, gapDiagnosis,
} from '../src/engine/scoring.js';

const FULL = { endpoints: 2, fileserver: 2, identity: 2, cloud: 2, databases: 2, backups: 2 };
const rounds = (outcomes) =>
  outcomes.map((outcome, i) => ({ outcome, stage: i + 1, depthAtCommit: 40, streak: 0, lead: 'manage', rank: {} }));

/* Play a whole run headlessly with a strategy function. This is the
 * harness the answer key gets validated with, and the reason the engine
 * has no DOM references. */
export function play(strategy, { seed = 1, mode = 'learn', posture = [] } = {}) {
  const g = createGame({ data: DATA, seed, mode });
  for (const id of posture) g.togglePosture(id);
  g.begin();
  for (let stage = 0; stage < 5; stage++) {
    if (g.state.phase === PHASE.CLIMAX) g.climaxGo();
    const lead = strategy(g, 'lead');
    g.choose(lead);
    /* The guard that hangs a naive harness: the backup must differ from
     * the lead, so ask the strategy again and then force a legal answer. */
    let backup = strategy(g, 'backup');
    if (backup === lead) backup = PILLARS.find((p) => p !== lead);
    g.choose(backup);
    expect(g.state.phase).toBe(PHASE.RESOLVE);
    g.nextStage();
  }
  expect(g.state.phase).toBe(PHASE.RESULT);
  return g.summary();
}

describe('index maths', () => {
  it('weights the weakest phase at 40 per cent', () => {
    const p = phaseScores(rounds(['perfect', 'perfect', 'perfect', 'perfect', 'breached']));
    expect(p.before).toBe(100);
    expect(p.during).toBe(100);
    expect(p.after).toBe(3);
    /* mean 67.67 * 0.6 + 3 * 0.4 = 41.8 -> 42, no finale bonus */
    expect(resilienceIndex(rounds(['perfect', 'perfect', 'perfect', 'perfect', 'breached']))).toBe(42);
  });

  it('floors at 3 and caps at 100, and both ends are reachable', () => {
    expect(resilienceIndex(rounds(['breached', 'breached', 'breached', 'breached', 'breached']))).toBe(3);
    expect(resilienceIndex(rounds(['perfect', 'perfect', 'perfect', 'perfect', 'perfect']))).toBe(100);
  });

  it('adds the finale bonus only for a contained last stage', () => {
    const base = rounds(['contained', 'contained', 'contained', 'contained', 'mitigated']);
    const withFinale = rounds(['contained', 'contained', 'contained', 'contained', 'contained']);
    expect(resilienceIndex(withFinale) - 6).toBeGreaterThan(resilienceIndex(base) - 6);
    expect(resilienceIndex(withFinale)).toBe(92);
  });

  it('names the weakest phase, breaking ties toward the earlier one', () => {
    expect(weakestPhase(rounds(['breached', 'breached', 'perfect', 'perfect', 'perfect']))).toBe('before');
    expect(weakestPhase(rounds(['perfect', 'perfect', 'breached', 'breached', 'perfect']))).toBe('during');
    expect(weakestPhase(rounds(['perfect', 'perfect', 'perfect', 'perfect', 'breached']))).toBe('after');
    expect(weakestPhase(rounds(['breached', 'breached', 'perfect', 'perfect', 'breached']))).toBe('before');
  });
});

describe('rank ladder', () => {
  it('makes every rank band attainable', () => {
    const seen = new Set();
    for (let p = 0; p <= DEFENSE_CAP; p++) seen.add(rankFor(p).name);
    expect(seen.size).toBe(RANKS.length);
  });

  it('reaches the cap from five contained stages with no estate damage', () => {
    const pts = defensePoints(rounds(['contained', 'contained', 'contained', 'contained', 'contained']), 0);
    expect(pts).toBe(DEFENSE_CAP);
    expect(rankFor(pts).name).toBe('Resilience Champion');
  });

  it('docks a point for every two systems lost', () => {
    const five = rounds(['contained', 'contained', 'contained', 'contained', 'contained']);
    expect(defensePoints(five, 0)).toBe(10);
    expect(defensePoints(five, 2)).toBe(9);
    expect(defensePoints(five, 5)).toBe(8);
  });

  it('never goes negative', () => {
    expect(defensePoints(rounds(['breached', 'breached', 'breached', 'breached', 'breached']), 6)).toBe(0);
  });
});

describe('zone consistency — the v9 contradiction guard', () => {
  it('never prints continuity maintained with no restore path', () => {
    const z = resolveZone(88, { ...FULL, backups: 0 });
    expect(z.zone).not.toBe('Resilient');
    expect(z.cappedBy).toBeTruthy();
  });

  it('never prints continuity maintained with three systems gone', () => {
    const z = resolveZone(95, { ...FULL, endpoints: 0, fileserver: 0, cloud: 0 });
    expect(z.zone).toBe('Prepared');
    expect(z.cappedBy).toBeTruthy();
  });

  it('leaves an intact estate uncapped', () => {
    const z = resolveZone(88, FULL);
    expect(z.zone).toBe('Resilient');
    expect(z.cappedBy).toBeNull();
  });

  it('agrees with the business outcome it sits beside', () => {
    expect(businessOutcome(95, FULL)).toBe('continuity');
    expect(businessOutcome(95, { ...FULL, backups: 0 })).not.toBe('continuity');
    expect(businessOutcome(10, FULL)).toBe('closed');
  });

  it('converts a closure into a wounded survival when the vault is immutable', () => {
    /* The one thing in the game that reaches businessOutcome. It does not
     * touch the index, the defense points or the rank — the answer key is
     * untouched — it changes whether the business opens on Monday. And it
     * converts a closure into a wounded survival, never into a good
     * outcome: immutable backups mean you reopen, not that nothing
     * happened. The cost is that a player who buys it never sees the best
     * beat in the asset, which is the right trade because the beat stays
     * reachable for everyone who did not. */
    const dead = { endpoints: 0, identity: 0, fileserver: 0, databases: 0, cloud: 0, backups: 0 };
    expect(businessOutcome(3, dead)).toBe('closed');
    expect(businessOutcome(3, dead, { vaultImmutable: true })).toBe('wounded');
    expect(businessOutcome(3, dead, { vaultImmutable: true })).not.toBe('continuity');
  });
});

describe('full playthroughs', () => {
  it('completes with a perfect strategy and reaches the top rank', () => {
    const s = play((g, slot) => {
      const v = g.state.variant;
      const best = PILLARS.find((p) => v.rank[p] === 'best');
      return slot === 'lead' ? best : rightBackupFor(v, best);
    });
    expect(s.rounds.every((r) => r.outcome === 'perfect')).toBe(true);
    expect(s.index).toBe(100);
    expect(s.rank.name).toBe('Resilience Champion');
    expect(s.zone.zone).toBe('Resilient');
    expect(s.business).toBe('continuity');
  });

  it('completes with a worst-case strategy and still produces a coherent result', () => {
    const s = play((g, slot) => {
      const v = g.state.variant;
      const weak = PILLARS.find((p) => v.rank[p] === 'weak');
      return slot === 'lead' ? weak : PILLARS.find((p) => p !== weak && v.rank[p] === 'weak') ?? PILLARS.find((p) => p !== weak);
    });
    expect(s.rounds.every((r) => r.outcome === 'breached')).toBe(true);
    expect(s.index).toBe(3);
    expect(s.business).toBe('closed');
    expect(s.gap.opener).toBeTruthy();
    expect(s.gap.detail).toBeTruthy();
  });

  it('completes with a single-pillar strategy for all four clients', () => {
    for (const client of DATA.clients.clients) {
      for (const pillar of PILLARS) {
        const g = createGame({ data: DATA, seed: 42, mode: 'learn' });
        g.setClient(client.id);
        g.begin();
        for (let i = 0; i < 5; i++) {
          if (g.state.phase === PHASE.CLIMAX) g.climaxGo();
          g.choose(pillar);
          g.choose(PILLARS.find((p) => p !== pillar));
          g.nextStage();
        }
        const s = g.summary();
        expect(s.index, `${client.id}/${pillar}`).toBeGreaterThanOrEqual(3);
        expect(s.index, `${client.id}/${pillar}`).toBeLessThanOrEqual(100);
        expect(s.rank.name).toBeTruthy();
      }
    }
  });

  it('is deterministic for a given seed', () => {
    const strat = (g, slot) => {
      const v = g.state.variant;
      const best = PILLARS.find((p) => v.rank[p] === 'best');
      return slot === 'lead' ? best : rightBackupFor(v, best);
    };
    const a = play(strat, { seed: 777 });
    const b = play(strat, { seed: 777 });
    expect(a.rounds.map((r) => r.tech)).toEqual(b.rounds.map((r) => r.tech));
    expect(a.seedCode).toBe(b.seedCode);
  });
});

describe('rules that carry the sales argument', () => {
  it('refuses a backup that is the same pillar as the lead', () => {
    const g = createGame({ data: DATA, seed: 3, mode: 'learn' });
    g.begin();
    expect(g.choose('manage')).toBe(true);
    expect(g.choose('manage')).toBe(false);
    expect(g.state.backup).toBeNull();
    expect(g.choose('secure')).toBe(true);
  });

  it('caps the readiness board so one product cannot carry the estate', () => {
    const g = createGame({ data: DATA, seed: 3 });
    const manageCards = DATA.postures.cards.filter((c) => c.pillar === 'manage').map((c) => c.id);
    expect(manageCards.length).toBeGreaterThan(DATA.postures.maxPerPillar - 1);
    for (const id of manageCards) g.togglePosture(id);
    expect(g.state.posture.spent).toBe(DATA.postures.maxPerPillar);
    expect(g.state.posture.remaining).toBeGreaterThan(0);
  });

  it('keeps the backups standing before stage four unless the vault is not immutable', () => {
    const g = createGame({ data: DATA, seed: 1, mode: 'learn' });
    g.begin();
    for (let i = 0; i < 3; i++) {
      if (g.state.phase === PHASE.CLIMAX) g.climaxGo();
      const weak = PILLARS.find((p) => g.state.variant.rank[p] === 'weak');
      g.choose(weak);
      g.choose(PILLARS.find((p) => p !== weak));
      expect(g.state.estate.backups, `stage ${i + 1}`).toBeGreaterThan(0);
      g.nextStage();
    }
  });

  it('spends capacity on scan and hold, and hold buys ground back', () => {
    const g = createGame({ data: DATA, seed: 9, mode: 'timed' });
    g.begin();
    /* Stage entry tops capacity up by one, so a run with no readiness
     * cards starts stage one able to afford exactly one scan or three
     * isolates. That trade is the whole point of the resource. */
    expect(g.state.capacity).toBe(CAPACITY_START + 1);

    g.tick(4000);
    const before = g.state.depth;
    const cap = g.state.capacity;

    expect(g.hold()).toBe(true);
    expect(g.state.capacity).toBe(cap - HOLD_COST);
    expect(before - g.state.depth).toBeCloseTo(HOLD_PUSHBACK, 5);

    const beforeScan = g.state.depth;
    expect(g.scan()).toBe(true);
    expect(g.state.revealed.partial).toBe(true);
    expect(g.state.capacity).toBe(cap - HOLD_COST - SCAN_COST);
    /* A scan costs ground as well as capacity, or there is no reason not
     * to scan every stage. */
    expect(g.state.depth - beforeScan).toBeCloseTo(SCAN_DEPTH_COST, 5);
    expect(g.scan()).toBe(false);
  });

  it('does not charge ground for a scan in learn mode, where there is no clock', () => {
    const g = createGame({ data: DATA, seed: 9, mode: 'learn' });
    g.begin();
    const depth = g.state.depth;
    expect(g.scan()).toBe(true);
    expect(g.state.depth).toBe(depth);
  });

  it('reports no weakest phase for a run that held every stage', () => {
    const s = play((g, slot) => {
      const v = g.state.variant;
      const best = PILLARS.find((p) => v.rank[p] === 'best');
      return slot === 'lead' ? best : rightBackupFor(v, best);
    });
    expect(s.gap.key).toBe('clean');
    expect(s.gap.title).toBe('Nothing got through');
    /* Still has to produce an opener — the gap is the commercial output
     * and a perfect run is the one most likely to be shown to someone. */
    expect(s.gap.opener).toBeTruthy();
    expect(s.gap.detail).toBeTruthy();
  });

  it('breaches a stage the player never answers', () => {
    const g = createGame({ data: DATA, seed: 11, mode: 'timed' });
    g.begin();
    for (let i = 0; i < 400 && g.state.phase === PHASE.STAGE; i++) {
      if (g.state.inject) g.resolveInject(false);
      g.tick(100);
    }
    expect(g.state.phase).toBe(PHASE.RESOLVE);
    const r = g.state.rounds[0];
    expect(r.outcome).toBe('breached');
    expect(r.timedOut).toBe(true);
  });

  it('resolves a timed-out stage that had a lead committed on the lead alone', () => {
    const g = createGame({ data: DATA, seed: 5, mode: 'timed' });
    g.begin();
    const best = PILLARS.find((p) => g.state.variant.rank[p] === 'best');
    g.choose(best);
    for (let i = 0; i < 800 && g.state.phase === PHASE.STAGE; i++) {
      if (g.state.inject) g.resolveInject(true);
      g.tick(100);
    }
    const r = g.state.rounds[0];
    expect(r.outcome).toBe('contained');
    expect(r.backup).toBeNull();
  });

  it('honors the readiness cards it advertises', () => {
    /* auto-isolate downgrades the first breach only */
    const g = createGame({ data: DATA, seed: 21, mode: 'learn' });
    g.togglePosture('auto-isolate');
    g.begin();
    const weak1 = PILLARS.find((p) => g.state.variant.rank[p] === 'weak');
    g.choose(weak1);
    g.choose(PILLARS.find((p) => p !== weak1));
    expect(g.state.rounds[0].outcome).toBe('mitigated');
    expect(g.state.rounds[0].savedBy).toBe('auto-isolate');
    g.nextStage();
    const weak2 = PILLARS.find((p) => g.state.variant.rank[p] === 'weak');
    g.choose(weak2);
    g.choose(PILLARS.find((p) => p !== weak2));
    expect(g.state.rounds[1].outcome).toBe('breached');
  });

  it('halves the blast radius of a breach under an enforced patch window', () => {
    const run = (posture) => {
      const g = createGame({ data: DATA, seed: 21, mode: 'learn' });
      for (const id of posture) g.togglePosture(id);
      g.begin();
      const weak = PILLARS.find((p) => g.state.variant.rank[p] === 'weak');
      g.choose(weak);
      g.choose(PILLARS.find((p) => p !== weak));
      const r = g.state.rounds[0];
      return r.estate[r.target];
    };
    /* Endpoints start at 2. A breach takes two points, or one if the
     * estate was patched on a schedule. */
    expect(run([])).toBe(0);
    expect(run(['patch-cadence'])).toBe(1);
  });

  it('costs the estate nothing on a mitigated stage under a complete inventory', () => {
    const run = (posture) => {
      const g = createGame({ data: DATA, seed: 21, mode: 'learn' });
      for (const id of posture) g.togglePosture(id);
      g.begin();
      const v = g.state.variant;
      const partial = PILLARS.find((p) => v.rank[p] === 'partial');
      g.choose(partial);
      g.choose(PILLARS.find((p) => p !== partial));
      const r = g.state.rounds[0];
      expect(r.outcome).toMatch(/^mitigated/);
      return { health: r.estate[r.target], changes: r.changes.length };
    };
    expect(run([]).health).toBe(1);
    const held = run(['asset-inventory']);
    expect(held.health).toBe(2);
    /* And nothing is animated as damage, because nothing was damaged. */
    expect(held.changes).toBe(0);
  });

  it('brings a system all the way back on any stage that was not a breach, once drilled', () => {
    const g = createGame({ data: DATA, seed: 21, mode: 'learn' });
    g.togglePosture('restore-drill');
    g.begin();
    /* Stage one: breach, to put damage on the board to repair. */
    const weak = PILLARS.find((p) => g.state.variant.rank[p] === 'weak');
    g.choose(weak);
    g.choose(PILLARS.find((p) => p !== weak));
    const hit = g.state.rounds[0].target;
    expect(g.state.estate[hit]).toBe(0);
    g.nextStage();
    /* Stage two: only mitigated, which without the runbook restores
     * nothing at all. */
    const partial = PILLARS.find((p) => g.state.variant.rank[p] === 'partial');
    g.choose(partial);
    g.choose(PILLARS.find((p) => p !== partial));
    const r = g.state.rounds[1];
    const restored = r.changes.filter((c) => c.kind === 'restore');
    expect(restored.length).toBe(1);
    /* All the way back, not part way — that is the whole difference
     * between having backups and having rehearsed using them. */
    expect(restored[0].after).toBe(2);
  });

  it('keeps the vault alive at stage five when it is immutable', () => {
    const g = createGame({ data: DATA, seed: 31, mode: 'learn' });
    g.togglePosture('immutable-vault');
    g.begin();
    for (let i = 0; i < 5; i++) {
      if (g.state.phase === PHASE.CLIMAX) g.climaxGo();
      const weak = PILLARS.find((p) => g.state.variant.rank[p] === 'weak');
      g.choose(weak);
      g.choose(PILLARS.find((p) => p !== weak));
      g.nextStage();
    }
    expect(g.state.estate.backups).toBeGreaterThan(0);
  });

  it('gives a gap diagnosis that names what the player actually did', () => {
    const s = play((g, slot) => {
      const v = g.state.variant;
      const weak = PILLARS.find((p) => v.rank[p] === 'weak');
      return slot === 'lead' ? weak : PILLARS.find((p) => p !== weak);
    });
    expect(s.gap.detail).toMatch(/T\d{4}/);
    expect(s.gap.pillar).toBeTruthy();
  });
});

/* The reflex channel and the decision channel have to stay separate. v13
 * scheduled injects on intrusion depth, which put them on top of the lead
 * decision on every stage — see maybeFireInject() for why depth cannot
 * express "just after the threat card has been read". These lock the
 * contract the fix depends on. */
describe('live injects', () => {
  const injected = () =>
    DATA.scenarios.stages.flatMap((s) =>
      s.variants.filter((v) => v.inject).map((v) => ({ ...v, stage: s.id, seconds: s.seconds }))
    );

  it('schedules every inject before a timed player would commit a lead', () => {
    /* The player model in scripts/monte-carlo.mjs reads for 3.4s +/- 1.3s
     * before picking. Anything at or after 3s is landing inside that. */
    const all = injected();
    expect(all.length).toBeGreaterThan(0);
    for (const v of all) {
      expect(v.inject.after, `${v.tech} after`).toBeGreaterThan(0);
      expect(v.inject.after, `${v.tech} after`).toBeLessThan(3);
      expect(v.inject.at, `${v.tech} still uses depth`).toBeUndefined();
    }
  });

  it('leaves the whole answer window inside the stage clock', () => {
    for (const v of injected()) {
      expect(v.inject.after + v.inject.seconds, `${v.tech} on the ${v.stage} clock`)
        .toBeLessThan(v.seconds);
    }
  });

  it('fires one on the stage clock, in learn mode as well as timed', () => {
    for (const mode of ['timed', 'learn']) {
      /* Seed 3 draws T1190 at stage one, which carries an inject. */
      const g = createGame({ data: DATA, seed: 3, mode });
      g.begin();
      expect(g.state.variant.inject, `seed 3 stage 1 in ${mode}`).toBeTruthy();
      for (let i = 0; i < 40 && !g.state.inject; i++) g.tick(100);
      expect(g.state.inject, `no inject fired in ${mode}`).toBeTruthy();
      expect(g.state.stageElapsed).toBeGreaterThanOrEqual(g.state.variant.inject.after * 1000);
    }
  });

  it('never fires into a half-built stack', () => {
    const g = createGame({ data: DATA, seed: 3, mode: 'timed' });
    g.begin();
    const v = g.state.variant;
    expect(v.inject).toBeTruthy();
    /* Commit a lead immediately and then run past the inject's moment. A
     * lead with no backup yet is the one state the guard protects. */
    g.choose(PILLARS.find((p) => v.rank[p] === 'best'));
    for (let i = 0; i < 40 && g.state.phase === PHASE.STAGE; i++) {
      g.tick(100);
      expect(g.state.inject, 'inject fired mid-stack').toBeFalsy();
    }
  });

  it('does not open a window the stage clock will cut off', () => {
    /* Hand-built variant whose window cannot complete: the answer window
     * is longer than the stage. It must never fire rather than fire and
     * expire, which reads as the game cheating. */
    const g = createGame({ data: DATA, seed: 3, mode: 'timed' });
    g.begin();
    g.state.variant = {
      ...g.state.variant,
      inject: { ...g.state.variant.inject, after: 0.5, seconds: 999 },
    };
    g.state.stageElapsed = 0;
    for (let i = 0; i < 40 && g.state.phase === PHASE.STAGE; i++) {
      g.tick(100);
      expect(g.state.inject, 'opened a window the clock cannot honour').toBeFalsy();
    }
  });

  it('leaves the events it emits on the queue for the screen to drain', () => {
    /* The bug this replaces was invisible for five versions. tick() ended
     * `return events.splice(0)` and every caller ignores the return, so
     * the two events the engine emits from inside a tick never reached
     * the UI: the inject, which is why no inject had ever appeared on
     * screen in a browser, and the resolved that follows a timeout, which
     * is why an unanswered stage froze instead of breaching. Nothing
     * failed, because every harness treated a missing inject as optional. */
    const g = createGame({ data: DATA, seed: 3, mode: 'timed' });
    g.begin();
    g.drain();
    for (let i = 0; i < 40 && !g.state.inject; i++) g.tick(100);
    expect(g.state.inject, 'no inject fired').toBeTruthy();
    expect(g.drain().map((e) => e.type)).toContain('inject');

    /* And the timeout path. Nothing committed, clock runs out. */
    const t = createGame({ data: DATA, seed: 11, mode: 'timed' });
    t.begin();
    t.drain();
    for (let i = 0; i < 400 && t.state.phase === PHASE.STAGE; i++) {
      if (t.state.inject) t.resolveInject(false);
      t.tick(100);
    }
    expect(t.state.phase).toBe(PHASE.RESOLVE);
    const types = t.drain().map((e) => e.type);
    expect(types).toContain('resolved');
  });

  it('costs ground when missed and buys it back when caught', () => {
    const run = (hit) => {
      const g = createGame({ data: DATA, seed: 3, mode: 'timed' });
      g.begin();
      for (let i = 0; i < 40 && !g.state.inject; i++) g.tick(100);
      const before = g.state.depth;
      g.resolveInject(hit);
      return g.state.depth - before;
    };
    expect(run(true)).toBeLessThan(0);
    expect(run(false)).toBeGreaterThan(0);
  });
});
