/* Scoring. No DOM, no imports from anything that touches one.
 *
 * Two numbers come out of a run and they measure different things:
 *
 *   Business Resilience Index (3-100) — the diagnostic. Weighted so the
 *   weakest phase carries 40% of it, because a chain fails at its weakest
 *   link and that is the layered-defense argument expressed as arithmetic.
 *
 *   Score — the leaderboard number. Speed and reflexes count here and
 *   nowhere else, so a booth competition never rewards being fast at the
 *   expense of being right.
 *
 * Defense points are the third quantity and they drive the rank ladder.
 * v9 could print "Major breach" beside "Resilient" because the ladder
 * counted contained stages and ignored partial saves and estate damage
 * entirely. resolveZone() below is the guard against that class of bug.
 */

import { DEF, PHASE_MAP, PILLAR_PHASE, PILLARS } from './pillars.js';

/* Per-stage contribution to the index. A run of five perfect stacks reaches
 * 100; a run of five breaches floors at 3. Both ends are reachable, which
 * is the property worth protecting — an unreachable top rank is a rank the
 * player correctly stops believing in. */
export const STAGE_VALUE = {
  perfect: 100,
  contained: 86,
  mitigated_backed: 58,
  mitigated: 44,
  breached: 3,
};

export const OUTCOME_LABEL = {
  perfect: 'Perfect stack',
  contained: 'Contained',
  mitigated_backed: 'Mitigated',
  mitigated: 'Mitigated',
  breached: 'Breached',
};

export const OUTCOME_TONE = {
  perfect: 'green',
  contained: 'green',
  mitigated_backed: 'amber',
  mitigated: 'amber',
  breached: 'red',
};

export function isContained(outcome) {
  return outcome === 'perfect' || outcome === 'contained';
}
export function isMitigated(outcome) {
  return outcome === 'mitigated' || outcome === 'mitigated_backed';
}

/* ---------------------------------------------------------------- index */

export function phaseScores(rounds) {
  const v = rounds.map((r) => STAGE_VALUE[r.outcome] ?? 3);
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return {
    before: mean([v[0], v[1]]),
    during: mean([v[2], v[3]]),
    after: v[4],
  };
}

export function resilienceIndex(rounds) {
  const p = phaseScores(rounds);
  const vals = [p.before, p.during, p.after];
  const avg = vals.reduce((a, b) => a + b, 0) / 3;
  const weakest = Math.min(...vals);
  let index = Math.round(avg * 0.6 + weakest * 0.4);
  /* The finale bonus. Getting the last stage right is worth something on
   * its own, because it is the stage where the business either opens the
   * next morning or does not. */
  if (isContained(rounds[4]?.outcome)) index += 6;
  return Math.max(3, Math.min(100, index));
}

export function weakestPhase(rounds) {
  const p = phaseScores(rounds);
  const order = ['before', 'during', 'after'];
  /* Ties break toward the earlier phase on purpose. If Before and After are
   * equally bad, the honest advice is to fix Before — everything downstream
   * of it gets cheaper. */
  return order.reduce((worst, k) => (p[k] < p[worst] ? k : worst), 'before');
}

/* ------------------------------------------------------- defense points */

export const DEFENSE_CAP = 10;

export function defensePoints(rounds, systemsLost) {
  let pts = 0;
  for (const r of rounds) {
    if (isContained(r.outcome)) pts += 2;
    else if (isMitigated(r.outcome)) pts += 1;
  }
  pts -= Math.floor(systemsLost / 2);
  return Math.max(0, Math.min(DEFENSE_CAP, pts));
}

/* Five stages at 2 points each is exactly the cap, so Resilience Champion
 * requires containing all five and losing no more than one system. It is
 * reachable and it is meant to be rare. */
export const RANKS = [
  { min: 10, name: 'Resilience Champion', blurb: 'Five stages held. The business never stopped trading.' },
  { min: 7, name: 'Threat Hunter', blurb: 'You caught it moving and took ground back.' },
  { min: 4, name: 'First Responder', blurb: 'You slowed it down and kept the business open.' },
  { min: 1, name: 'Breach Survivor', blurb: 'It got through. You are still here.' },
  { min: 0, name: 'The Phoenix', blurb: 'Everything burned. Start from the ashes.' },
];

export function rankFor(points) {
  return RANKS.find((r) => points >= r.min) ?? RANKS[RANKS.length - 1];
}

export function pointsToNextRank(points) {
  const higher = RANKS.filter((r) => r.min > points).sort((a, b) => a.min - b.min)[0];
  if (!higher) return null;
  return { name: higher.name, gap: higher.min - points };
}

/* ----------------------------------------------------------------- zone */

const ZONES = [
  { min: 78, zone: 'Resilient', verdict: 'Business continuity maintained' },
  { min: 55, zone: 'Prepared', verdict: 'Takes the hit and stays standing' },
  { min: 30, zone: 'Exposed', verdict: 'Survives, at serious cost' },
  { min: 0, zone: 'Fragile', verdict: "Most businesses don't reopen" },
];

/* The consistency guard.
 *
 * The index can only see stage outcomes. The estate map can be in a state
 * the index knows nothing about — you can mitigate your way to a decent
 * average while losing the backups, and printing "Business continuity
 * maintained" next to a dead vault is the exact contradiction that cost v9
 * its credibility. So the estate caps the zone, and when it caps it we say
 * out loud why. */
export function resolveZone(index, estate) {
  const lost = Object.values(estate).filter((v) => v <= 0).length;
  const base = ZONES.find((z) => index >= z.min);
  let capIndex = ZONES.indexOf(base);
  let cappedBy = null;

  if (estate.backups <= 0) {
    /* No restore path is not compatible with continuity, whatever the
     * average says. */
    const floor = ZONES.findIndex((z) => z.zone === 'Exposed');
    if (capIndex < floor) {
      capIndex = floor;
      cappedBy = 'You finished with no restore path. Continuity was not maintained, whatever the average says.';
    }
  } else if (lost >= 3) {
    const floor = ZONES.findIndex((z) => z.zone === 'Prepared');
    if (capIndex < floor) {
      capIndex = floor;
      cappedBy = 'Three or more systems were lost permanently. The business stayed open, but not intact.';
    }
  }
  return { ...ZONES[capIndex], cappedBy, systemsLost: lost };
}

/* ------------------------------------------------------------- the gap */

/* P2 item 11: make the weakest-phase output specific to what the player
 * actually did, so booth staff open on the player's own decision rather
 * than on a category. */
export function gapDiagnosis(rounds) {
  /* A run that held every stage has no weakest phase — all three tie at
   * the ceiling, and naming one of them arbitrarily makes the diagnosis
   * look broken to the one player most likely to scrutinise it. What is
   * genuinely diagnostic about a clean run is the layer they never once
   * reached for. */
  if (rounds.length === 5 && rounds.every((r) => isContained(r.outcome))) {
    const counts = { manage: 0, secure: 0, recover: 0 };
    for (const r of rounds) if (r.lead) counts[r.lead]++;
    const least = [...PILLARS].sort((a, b) => counts[a] - counts[b])[0];
    const phase = PHASE_MAP[PILLAR_PHASE[least]];
    const never = counts[least] === 0;
    return {
      key: 'clean',
      label: 'None',
      stages: [],
      pillar: least,
      favorite: [...PILLARS].sort((a, b) => counts[b] - counts[a])[0],
      title: 'Nothing got through',
      body: 'Five stages held. That is rare, and it is the run worth talking about — not because of the score, but because every stage you contained was contained by a layer that had to exist before the attack started.',
      detail: never
        ? `You never once led with ${DEF[least].name}. It was the right lead at least once in this pool, so the next run will find it.`
        : `You leaned on ${DEF[least].name} least — ${counts[least]} of five stages. That is the layer most estates are thinnest in.`,
      opener: phase.opener,
    };
  }

  const key = weakestPhase(rounds);
  const phase = PHASE_MAP[key];
  const inPhase = phase.stages.map((i) => rounds[i]).filter(Boolean);

  /* Which pillar did they reach for in the phase they lost, and was it the
   * one the scenarios actually rewarded? */
  const leadCounts = {};
  for (const r of inPhase) if (r.lead) leadCounts[r.lead] = (leadCounts[r.lead] || 0) + 1;
  const favorite = Object.keys(leadCounts).sort((a, b) => leadCounts[b] - leadCounts[a])[0] || null;

  const worst = inPhase
    .filter((r) => r.outcome === 'breached')
    .sort((a, b) => STAGE_VALUE[a.outcome] - STAGE_VALUE[b.outcome])[0] || null;

  const missedBackup = inPhase.filter((r) => isContained(r.outcome) && !r.backupRight).length;

  let detail;
  if (worst && favorite && worst.rank?.[favorite] === 'weak') {
    detail = `You led with ${DEF[favorite].name} on ${worst.tech} ${worst.name}, and it was the weakest layer available for that technique.`;
  } else if (worst) {
    detail = `${worst.tech} ${worst.name} got through. That is the specific technique to talk about.`;
  } else if (missedBackup > 0) {
    detail = `You led correctly in this phase but backed it with the wrong second layer ${missedBackup === 1 ? 'once' : `${missedBackup} times`}. The lead stopped it; the stack would have taken ground back.`;
  } else {
    detail = 'This phase held, but by the smallest margin of the three.';
  }

  return { ...phase, detail, favorite };
}

/* --------------------------------------------------------------- score */

export const POINTS = {
  perfect: 1400,
  contained: 1000,
  mitigated_backed: 520,
  mitigated: 400,
  breached: 0,
  injectHit: 250,
  /* Speed is worth up to this much per stage, scaled by how much of the
   * intrusion track was still ahead of the attacker when you committed. */
  speedMax: 600,
  streakStep: 200,
};

export function stagePoints(round) {
  let pts = POINTS[round.outcome] ?? 0;
  if (round.outcome !== 'breached') {
    pts += Math.round(POINTS.speedMax * Math.max(0, 1 - round.depthAtCommit / 100));
  }
  if (round.injectHit) pts += POINTS.injectHit;
  if (round.streak > 1) pts += POINTS.streakStep * (round.streak - 1);
  return pts;
}

export function totalScore(rounds) {
  return rounds.reduce((a, r) => a + (r.points ?? stagePoints(r)), 0);
}
