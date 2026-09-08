/* Engine behaviour and scoring maths. No DOM anywhere in here — if one of
 * these tests ever needs jsdom, something has leaked out of src/engine/.
 */

import { describe, it, expect } from 'vitest';
import { DATA } from '../src/data/index.js';
import { createGame, PHASE, businessOutcome, HOLD_PUSHBACK } from '../src/engine/game.js';
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
    g.tick(4000);
    const before = g.state.depth;
    const cap = g.state.capacity;
    expect(g.hold()).toBe(true);
    expect(g.state.capacity).toBe(cap - 1);
    expect(before - g.state.depth).toBeCloseTo(HOLD_PUSHBACK, 5);
    expect(g.scan()).toBe(true);
    expect(g.state.revealed.weak).toBe(true);
    expect(g.state.capacity).toBe(cap - 2);
    expect(g.scan()).toBe(false);
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

  it('honours the readiness cards it advertises', () => {
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
