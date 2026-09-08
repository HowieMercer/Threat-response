/* Answer-key integrity.
 *
 * This is the file that matters most. The score is the whole diagnostic,
 * and a score a security professional can beat by pattern-matching stage
 * position is a score they stop trusting — which was the finding that
 * forced the v11 rebuild. These tests fail loudly if the pool ever drifts
 * back toward a deducible answer key.
 */

import { describe, it, expect } from 'vitest';
import { DATA } from '../src/data/index.js';
import { PILLARS } from '../src/engine/pillars.js';
import { rightBackupFor, outcomeFor } from '../src/engine/resolve.js';

const stages = DATA.scenarios.stages;
const allVariants = stages.flatMap((s) => s.variants.map((v) => ({ ...v, stageId: s.id })));

describe('scenario pool shape', () => {
  it('has five stages', () => {
    expect(stages).toHaveLength(5);
  });

  it('has four variants per stage, giving 1,024 unique runs', () => {
    for (const s of stages) expect(s.variants, s.id).toHaveLength(4);
    expect(stages.reduce((a, s) => a * s.variants.length, 1)).toBe(1024);
  });

  it('ranks exactly one best, one partial and one weak per variant', () => {
    for (const v of allVariants) {
      const ranks = PILLARS.map((p) => v.rank[p]).sort();
      expect(ranks, `${v.tech} ${v.name}`).toEqual(['best', 'partial', 'weak']);
    }
  });

  it('gives every variant an action and a feedback line for all three pillars', () => {
    for (const v of allVariants) {
      for (const p of PILLARS) {
        expect(v.act[p], `${v.tech} act.${p}`).toBeTruthy();
        expect(v.fb[p], `${v.tech} fb.${p}`).toBeTruthy();
      }
    }
  });

  it('targets a system that exists on the estate map', () => {
    const ids = DATA.estate.systems.map((s) => s.id);
    for (const v of allVariants) expect(ids, `${v.tech}`).toContain(v.target);
  });

  it('uses real-looking ATT&CK technique IDs and no duplicates within a stage', () => {
    for (const v of allVariants) expect(v.tech).toMatch(/^T\d{4}(\.\d{3})?$/);
    for (const s of stages) {
      const ids = s.variants.map((v) => v.tech);
      expect(new Set(ids).size, s.id).toBe(ids.length);
    }
  });
});

describe('answer key cannot be solved by stage position', () => {
  it('lets every pillar be the best answer at every stage position', () => {
    for (const s of stages) {
      const best = s.variants.map((v) => PILLARS.find((p) => v.rank[p] === 'best'));
      for (const p of PILLARS) {
        expect(best, `${p} is never best at stage ${s.id}`).toContain(p);
      }
    }
  });

  it('never makes one pillar weak in all four variants of a stage', () => {
    for (const s of stages) {
      for (const p of PILLARS) {
        const weakCount = s.variants.filter((v) => v.rank[p] === 'weak').length;
        expect(weakCount, `${p} weak in all of ${s.id}`).toBeLessThan(4);
      }
    }
  });

  it('never makes one pillar best in more than half a stage', () => {
    for (const s of stages) {
      for (const p of PILLARS) {
        const bestCount = s.variants.filter((v) => v.rank[p] === 'best').length;
        expect(bestCount, `${p} best too often at ${s.id}`).toBeLessThanOrEqual(2);
      }
    }
  });

  it('keeps no pillar strictly dominant across the whole pool', () => {
    /* "Always pick X" must not beat "always pick Y" by so much that the
     * game has only one real opening. */
    const bestRate = Object.fromEntries(
      PILLARS.map((p) => [p, allVariants.filter((v) => v.rank[p] === 'best').length / allVariants.length])
    );
    for (const p of PILLARS) {
      expect(bestRate[p], `${p} best rate ${bestRate[p]}`).toBeGreaterThan(0.2);
      expect(bestRate[p], `${p} best rate ${bestRate[p]}`).toBeLessThan(0.45);
    }
  });

  it('does not teach recovery as a stage-five rescue', () => {
    /* The credibility bug from an early build: Recover correct in every
     * stage-five variant made the climax a free win and taught the exact
     * opposite of the sales argument. */
    const finale = stages[4].variants;
    const recoverBest = finale.filter((v) => v.rank.recover === 'best').length;
    expect(recoverBest).toBeGreaterThan(0);
    expect(recoverBest).toBeLessThanOrEqual(1);
  });
});

describe('the copy carries no answer', () => {
  /* v13 shipped a pool where the `act` string a player reads at the moment
   * of choosing gave the answer away typographically: `best` averaged 61
   * characters with exactly one comma, `partial` and `weak` averaged 51
   * with none. "Pick the longest" was correct 85% of the time and "pick the
   * one with a comma" was correct 10 times out of 10 where it was a unique
   * signal — no security knowledge required, and visible at a glance in the
   * two seconds a player at a stand actually has.
   *
   * This is the same class of failure as v9's positional pattern, arriving
   * through the copy instead of the ranks, so it gets the same treatment:
   * a test rather than a note. */
  const actsBy = (rank) =>
    allVariants.flatMap((v) => PILLARS.filter((p) => v.rank[p] === rank).map((p) => v.act[p]));
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

  it('does not make the correct action the longest one', () => {
    const wins = allVariants.filter((v) => {
      const longest = PILLARS.reduce((a, b) => (v.act[b].length > v.act[a].length ? b : a));
      return v.rank[longest] === 'best';
    }).length;
    /* 1/3 of 20 is 6.7. Allow up to 11 (55%) — enough headroom that adding
     * one variant cannot fail the build on noise, tight enough that the
     * 85% v13 shipped would. */
    expect(wins, `longest-action heuristic wins ${wins}/20`).toBeLessThanOrEqual(11);
  });

  it('keeps action length uncorrelated with correctness', () => {
    const b = mean(actsBy('best').map((a) => a.length));
    const rest = mean([...actsBy('partial'), ...actsBy('weak')].map((a) => a.length));
    expect(Math.abs(b - rest), `best ${b.toFixed(1)} vs rest ${rest.toFixed(1)} chars`).toBeLessThan(4);
  });

  it('gives no rank a punctuation signature', () => {
    /* Any punctuation that could mark one card out, not just commas. */
    const marks = (a) => (a.match(/[,;:—–]/g) || []).length;
    const per = ['best', 'partial', 'weak'].map((r) => mean(actsBy(r).map(marks)));
    const spread = Math.max(...per) - Math.min(...per);
    expect(spread, `punctuation per rank: ${per.map((x) => x.toFixed(2)).join(' / ')}`).toBeLessThan(0.35);
  });

  it('does not let the longest or shortest action favour any rank', () => {
    /* The stronger form of the test above, and the one that caught a
     * +10-point edge the "longest is best" count did not: what matters is
     * not how often the longest action is CORRECT, it is how often it is
     * SAFE. "Pick the longest" was avoiding the weak layer 25% of the
     * time against 33% by chance, and avoiding the answer that breaches
     * is worth more than finding the answer that is best. Both extremes
     * have to be flat, not just the top one. */
    const tally = (worse) => {
      const c = { best: 0, partial: 0, weak: 0 };
      for (const v of allVariants) {
        /* Same tie-break as scripts/monte-carlo.mjs: first pillar wins. */
        const pick = PILLARS.reduce((a, b) => (worse(v.act[b].length, v.act[a].length) ? b : a));
        c[v.rank[pick]]++;
      }
      return c;
    };
    for (const [label, c] of [
      ['longest', tally((b, a) => b > a)],
      ['shortest', tally((b, a) => b < a)],
    ]) {
      const spread = Math.max(...Object.values(c)) - Math.min(...Object.values(c));
      expect(spread, `${label} action by rank: ${JSON.stringify(c)}`).toBeLessThanOrEqual(4);
    }
  });

  it('keeps every action short enough to read under time pressure', () => {
    for (const v of allVariants) {
      for (const p of PILLARS) {
        expect(v.act[p].length, `${v.tech}/${p}`).toBeLessThanOrEqual(56);
      }
    }
  });
});

describe('the two-pick mechanic', () => {
  it('always resolves a backup that is a different pillar from the lead', () => {
    for (const v of allVariants) {
      for (const lead of PILLARS) {
        const b = rightBackupFor(v, lead);
        expect(b, `${v.tech} lead=${lead}`).not.toBe(lead);
        expect(PILLARS).toContain(b);
      }
    }
  });

  it('makes a perfect stack require both the right lead and the right backup', () => {
    for (const v of allVariants) {
      const best = PILLARS.find((p) => v.rank[p] === 'best');
      const right = rightBackupFor(v, best);
      const wrong = PILLARS.find((p) => p !== best && p !== right);
      expect(outcomeFor(v, best, right)).toBe('perfect');
      expect(outcomeFor(v, best, wrong)).toBe('contained');
    }
  });

  it('cannot reach a perfect stack from a weak lead', () => {
    for (const v of allVariants) {
      const weak = PILLARS.find((p) => v.rank[p] === 'weak');
      for (const b of PILLARS.filter((p) => p !== weak)) {
        expect(outcomeFor(v, weak, b)).toBe('breached');
      }
    }
  });
});
