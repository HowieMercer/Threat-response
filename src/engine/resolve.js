/* Stage resolution. Pure functions — given a stage and a state, work out
 * what happened. No DOM, no timers, no randomness.
 *
 * Everything the result screen and the delta chips need comes out of
 * resolveStage() as data, so the UI never re-derives a rule and the two
 * can never disagree.
 */

import { PILLARS } from './pillars.js';

const RANK_ORDER = { best: 3, partial: 2, weak: 1 };

/* The correct second layer is the strongest pillar you did not lead with.
 *
 * This is what makes the two-pick mechanic teach something. Leading right
 * stops the attack; stacking right is what takes ground back. And because
 * the backup must be a different pillar, no single product can carry a
 * stage — which is the commercial argument, enforced by the rules rather
 * than asserted in the copy. */
export function rightBackupFor(variant, lead) {
  return PILLARS.filter((p) => p !== lead).sort(
    (a, b) => RANK_ORDER[variant.rank[b]] - RANK_ORDER[variant.rank[a]]
  )[0];
}

export function outcomeFor(variant, lead, backup) {
  if (!lead) return 'breached';
  const leadRank = variant.rank[lead];
  const backupRight = !!backup && backup === rightBackupFor(variant, lead);
  if (leadRank === 'best') return backupRight ? 'perfect' : 'contained';
  if (leadRank === 'partial') return backupRight ? 'mitigated_backed' : 'mitigated';
  return 'breached';
}

/* Estate rules.
 *
 * Backups cannot be lost before stage four. That is a pacing decision, not
 * a security claim: losing the vault is the run's worst moment and it has
 * to land at the climax, not as an anticlimax in stage one. Before stage
 * four the vault degrades instead, which is visible, worrying, and
 * survivable.
 */
export const BACKUPS_CAN_FALL_FROM_STAGE = 4; // 1-indexed

/* How far down a system can be pushed by one stage. Only the vault has a
 * floor of its own: immutable copies cannot be deleted, and before stage
 * four the vault degrades rather than falls so that losing it lands at the
 * climax instead of as an anticlimax in stage one. */
export function estateFloor(system, stageNumber, posture) {
  if (system !== 'backups') return 0;
  if (posture.has('immutable-vault')) return 1;
  return stageNumber >= BACKUPS_CAN_FALL_FROM_STAGE ? 0 : 1;
}

function damage(estate, system, amount, stageNumber, posture) {
  const floor = estateFloor(system, stageNumber, posture);
  const before = estate[system];
  const after = Math.max(floor, before - amount);
  return { system, before, after, delta: after - before, held: after === floor && before === floor };
}

/* Recovery brings back the most damaged system, preferring the one that
 * hurts most to be without. Backups first: a business with no restore path
 * has no next move. */
const RECOVERY_PRIORITY = ['backups', 'databases', 'identity', 'fileserver', 'cloud', 'endpoints'];

/* A restore without a rehearsed runbook gets a system part of the way
 * back. A tested one gets it back to service, which is the whole
 * difference between having backups and being able to restore from them
 * and is the only claim the drill card needs to make. Measured, it is also
 * the difference between the card mattering and not: at +1 it moved
 * systems lost by 0.23 over 1,333 runs, which on a board of six cards is
 * indistinguishable from a dead choice. */
function restore(estate, count, full) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const candidates = RECOVERY_PRIORITY.filter((k) => estate[k] < 2 && !out.some((o) => o.system === k));
    if (!candidates.length) break;
    const system = candidates.sort((a, b) => estate[a] - estate[b])[0];
    const after = full ? 2 : estate[system] + 1;
    out.push({ system, before: estate[system], after, delta: after - estate[system] });
  }
  return out;
}

/* One call, everything about the stage. Returns the round record plus the
 * ordered list of consequences the UI animates before it shows any prose —
 * consequence first, explanation second. */
export function resolveStage({ variant, stageNumber, lead, backup, estate, depthAtCommit, injectHit, streak, posture, timedOut }) {
  let outcome = outcomeFor(variant, lead, backup);
  let savedBy = null;

  /* Automated host isolation. Once per run, and it says so on the card, so
   * a player who bought it knows they have one mistake in hand. */
  if (outcome === 'breached' && posture.has('auto-isolate') && !posture.usedAutoIsolate) {
    outcome = 'mitigated';
    savedBy = 'auto-isolate';
    posture.usedAutoIsolate = true;
  }

  const next = { ...estate };
  const changes = [];

  if (outcome === 'breached') {
    /* An enforced patch window does not stop a wrong call, but it decides
     * how much a wrong call costs. An unpatched box that gets hit is owned;
     * a patched one that gets hit is disrupted. Two points against one. */
    const blast = posture.has('patch-cadence') ? 1 : 2;
    const d = damage(next, variant.target, blast, stageNumber, posture);
    next[d.system] = d.after;
    if (d.delta !== 0 || d.held) changes.push({ ...d, kind: 'loss' });
  } else if (outcome === 'mitigated' || outcome === 'mitigated_backed') {
    /* A complete asset inventory does not stop an attack. It decides
     * whether a stage you only slowed down costs you anything at all:
     * you know what the box is, what runs on it and what depends on it,
     * so you keep it in service instead of taking it down to find out.
     *
     * Paired with the patch window this is the Manage pillar's whole
     * argument split into its two halves — patching decides how much a
     * mistake costs, inventory decides how often a near-miss costs
     * anything — and neither is a version of the other. */
    if (!posture.has('asset-inventory')) {
      const d = damage(next, variant.target, 1, stageNumber, posture);
      next[d.system] = d.after;
      if (d.delta !== 0 || d.held) changes.push({ ...d, kind: 'degrade' });
    }
  }

  /* Recovery.
   *
   * A perfect stack always brings a system back. The tested-runbook card
   * extends that to any stage the attacker did not get through, and makes
   * a perfect stack worth two.
   *
   * v13 gated the card on a perfect stack only, and a perfect stack with
   * damage available to repair is rare enough that 3,000 measured runs put
   * the card's value at +0.6 index — statistically nothing. Widening it to
   * contained stages measured -0.26 systems lost, still the weakest card
   * on the board. A rehearsed restore is a thing you do while the incident
   * is running, on every hour you are not actively losing, so the honest
   * rule is any stage that was not a breach. */
  const drilled = posture.has('restore-drill');
  const restores = outcome === 'perfect' ? (drilled ? 2 : 1) : (drilled && outcome !== 'breached' ? 1 : 0);
  if (restores > 0) {
    const gained = restore(next, restores, drilled);
    for (const g of gained) {
      next[g.system] = g.after;
      changes.push({ ...g, kind: 'restore' });
    }
  }

  const backupRight = !!backup && backup === rightBackupFor(variant, lead);

  return {
    stage: stageNumber,
    id: variant.stageId,
    tech: variant.tech,
    ta: variant.ta,
    name: variant.name,
    target: variant.target,
    rank: variant.rank,
    lead,
    backup,
    backupRight,
    outcome,
    savedBy,
    timedOut: !!timedOut,
    depthAtCommit,
    injectHit: injectHit === true,
    injectMissed: injectHit === false,
    streak,
    estate: next,
    changes,
    fb: lead ? variant.fb[lead] : null,
  };
}

/* Where the intrusion track restarts the next stage. Holding the line
 * gives you ground; breaching gives it away. This is what makes stage five
 * feel like the consequence of stages one to four rather than a fresh
 * question. */
export const CARRY_DEPTH = {
  perfect: 10,
  contained: 18,
  mitigated_backed: 34,
  mitigated: 40,
  breached: 62,
};

export function carryDepth(outcome, posture) {
  const base = CARRY_DEPTH[outcome] ?? 40;
  return Math.max(0, base - (posture.has('patch-cadence') ? 12 : 0));
}
