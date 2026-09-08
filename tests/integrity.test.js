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
