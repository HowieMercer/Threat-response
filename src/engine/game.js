/* The game. A linear state machine with a real-time pressure term.
 *
 * Hard rule for this directory: no DOM. Everything in through method
 * arguments, everything out through return values, state reads and the
 * event queue. That is what lets the whole thing be played to completion
 * in Node with no browser, which is how the answer key gets validated.
 *
 * Screens call methods and then read `g.state`. Anything worth animating
 * is pushed onto `g.events` as `{ type, ... }` and drained by the caller,
 * so the engine never has an opinion about how a consequence looks.
 */

import { mulberry32, randomSeed, encodeSeed, pick } from './rng.js';
import { PILLARS, DEF } from './pillars.js';
import { resolveStage, rightBackupFor, carryDepth } from './resolve.js';
import {
  resilienceIndex, defensePoints, rankFor, pointsToNextRank, resolveZone,
  gapDiagnosis, stagePoints, totalScore, isContained,
} from './scoring.js';

export const PHASE = {
  ATTRACT: 'attract',
  BRIEF: 'brief',
  POSTURE: 'posture',
  STAGE: 'stage',
  RESOLVE: 'resolve',
  CLIMAX: 'climax',
  RESULT: 'result',
};

/* Response capacity. The budget that makes knowing more and buying time
 * compete with each other, which is the trade a real responder is actually
 * making at 03:00.
 *
 * Scan costs two and hold costs one on purpose. An earlier pass had scan
 * at one, and a 12,000-run balance report showed a player who scanned
 * every stage and then guessed between the two remaining pillars reaching
 * Threat Hunter 80% of the time with no security knowledge at all. That
 * makes the rank a measure of whether you pressed the button, not of what
 * you know. At two, a run affords two or three scans, so a scan is a
 * decision about which stage matters most. */
export const CAPACITY_START = 2;
export const CAPACITY_MAX = 4;
export const SCAN_COST = 2;
export const HOLD_COST = 1;
export const HOLD_PUSHBACK = 18;

/* And a scan costs ground as well as capacity. Running the query takes
 * time you do not have, so the attacker moves while you do it. Without
 * this, scanning is free in every sense that matters and the only reason
 * not to scan is having no capacity left. */
export const SCAN_DEPTH_COST = 8;

/* 24/7 monitored response also slows the attacker down before you have
 * committed to anything, because somebody was already engaging while you
 * were still reading. This is the half of the card that does not depend on
 * the player knowing any security — see the note on scan() below for why
 * that matters, and postures.json for what the card claims. */
export const WATCH_SLOWDOWN = 0.7;

/* Free scans granted by 24/7 monitored response.
 *
 * v13 gave one free scan every stage, which measured at +33.0 index —
 * roughly three times the next strongest card — and removed the only
 * interesting part of holding a free scan, which is deciding which stage to
 * spend it on. Three across a five-stage run keeps it the strongest single
 * investment, which is commercially correct for MDR, without making the
 * other five cards decoration. */
export const SOC_FREE_SCANS = 3;

/* Committing a lead does not stop the clock. It slows it, because you have
 * started responding. Deliberately the same slowdown whether the lead was
 * right or wrong: a track that speeds up on a bad pick would leak the
 * answer before the player had finished deciding. */
export const LEAD_SLOWDOWN = 0.62;

/* How much of the stage clock the attacker's carried-over position eats.
 *
 * The alternative — advancing the track at a fixed rate from wherever it
 * carried in — meant a stage-four breach could leave stage five with four
 * seconds on it, which reads as the game cheating rather than as
 * consequence. This way you always get most of the stage's time, escalation
 * is carried by the shrinking stage clock, and losing ground costs you a
 * real but survivable slice of the next decision. */
export const CARRY_TIME_PENALTY = 300;

class Posture {
  constructor(budget, maxPerPillar) {
    this.budget = budget;
    this.maxPerPillar = maxPerPillar;
    this.picked = [];
    this.usedAutoIsolate = false;
    this.cards = new Map();
  }
  register(cards) {
    for (const c of cards) this.cards.set(c.id, c);
  }
  has(id) {
    return this.picked.includes(id);
  }
  get spent() {
    return this.picked.length;
  }
  get remaining() {
    return this.budget - this.spent;
  }
  countIn(pillar) {
    return this.picked.filter((id) => this.cards.get(id)?.pillar === pillar).length;
  }
  /* Returns null if the pick is legal, or the reason it is not. The cap per
   * pillar is set below the budget on purpose: a single-product build is
   * not expressible, so the player runs into the layering argument by
   * trying to ignore it. */
  blocker(id) {
    if (this.has(id)) return null;
    if (this.remaining <= 0) return 'No readiness budget left.';
    const pillar = this.cards.get(id)?.pillar;
    if (this.countIn(pillar) >= this.maxPerPillar) {
      return `${DEF[pillar].name} is at its limit. One product cannot carry a whole estate.`;
    }
    return null;
  }
  toggle(id) {
    if (this.has(id)) {
      this.picked = this.picked.filter((p) => p !== id);
      return { ok: true, on: false };
    }
    const blocked = this.blocker(id);
    if (blocked) return { ok: false, reason: blocked };
    this.picked.push(id);
    return { ok: true, on: true };
  }
  list() {
    return this.picked.map((id) => this.cards.get(id)).filter(Boolean);
  }
  pillarsUsed() {
    return [...new Set(this.list().map((c) => c.pillar))];
  }
}

export function createGame({ data, seed, mode = 'timed' }) {
  const usedSeed = (seed ?? randomSeed()) >>> 0;
  const rand = mulberry32(usedSeed);

  const posture = new Posture(data.postures.budget, data.postures.maxPerPillar);
  posture.register(data.postures.cards);

  const state = {
    phase: PHASE.ATTRACT,
    mode,
    seed: usedSeed,
    seedCode: encodeSeed(usedSeed),
    client: data.clients.clients.find((c) => c.id === data.clients.default),
    posture,
    rounds: [],
    stageIndex: 0,
    variant: null,
    depth: 0,
    stageElapsed: 0,
    capacity: CAPACITY_START,
    freeScans: 0,
    lead: null,
    backup: null,
    revealed: { partial: false },
    estate: Object.fromEntries(data.estate.systems.map((s) => [s.id, 2])),
    streak: 0,
    inject: null,
    opener: null,
    startedAt: null,
    finishedAt: null,
  };

  const events = [];
  const emit = (type, payload) => events.push({ type, ...payload });

  /* Draw one variant per stage. Seeded, so the whole run is reproducible
   * from the five characters printed on the result screen. */
  function drawRounds() {
    return data.scenarios.stages.map((stage) => {
      const v = pick(rand, stage.variants);
      return { ...v, stageId: stage.id, stageName: stage.name, threat: stage.threat, seconds: stage.seconds };
    });
  }
  let deck = drawRounds();

  const api = {
    state,
    events,
    data,

    /* ------------------------------------------------------ setup phase */

    setClient(id) {
      const c = data.clients.clients.find((x) => x.id === id);
      if (c) state.client = c;
      return state.client;
    },
    randomClient() {
      state.client = pick(rand, data.clients.clients);
      return state.client;
    },
    setMode(m) {
      state.mode = m === 'learn' ? 'learn' : 'timed';
    },
    goBrief() {
      state.phase = PHASE.BRIEF;
      emit('phase', { phase: state.phase });
    },
    goPosture() {
      state.phase = PHASE.POSTURE;
      emit('phase', { phase: state.phase });
    },
    togglePosture(id) {
      const r = posture.toggle(id);
      if (!r.ok) emit('blocked', { reason: r.reason });
      else emit('posture', { id, on: r.on, remaining: posture.remaining });
      return r;
    },

    /* ------------------------------------------------------- the attack */

    begin() {
      state.phase = PHASE.STAGE;
      state.stageIndex = 0;
      state.rounds = [];
      state.estate = Object.fromEntries(data.estate.systems.map((s) => [s.id, 2]));
      state.streak = 0;
      state.capacity = CAPACITY_START + (posture.has('patch-cadence') ? 1 : 0);
      state.freeScans = posture.has('soc-watch') ? SOC_FREE_SCANS : 0;
      state.opener = pick(rand, data.foe.openers);
      state.startedAt = Date.now();
      enterStage();
      emit('phase', { phase: state.phase });
      emit('begin', { opener: state.opener });
    },

    /* Time. Called with elapsed milliseconds. In learn mode the attacker
     * does not advance and the stage never times out, which is the entire
     * difference between the modes — the decisions and the answer key are
     * identical.
     *
     * The stage clock still runs in learn mode. It has to: injects are
     * scheduled against time in the stage rather than ground lost, so
     * before this a learn-mode player never saw one at all. */
    tick(dtMs) {
      if (state.phase !== PHASE.STAGE) return events.splice(0);
      state.stageElapsed += dtMs;

      if (state.mode !== 'learn') {
        state.depth = Math.min(100, state.depth + liveRate() * dtMs);
      }

      if (state.inject) tickInject(dtMs);
      else maybeFireInject();

      if (state.mode !== 'learn' && state.depth >= 100) {
        /* Out of ground. A committed lead still resolves — you decided,
         * you just did not finish the stack. Nothing committed is a
         * breach, because indecision is a decision at this speed. */
        commit({ timedOut: true });
      }
      return events.splice(0);
    },

    /* ---------------------------------------------------------- actions */

    /* Reveal which layer is a partial fit. Never the strongest and never
     * the weakest, by anybody, for any price.
     *
     * This is the most consequential rule in the game and it took three
     * measurements to get right, so the reasoning is here rather than in a
     * commit message.
     *
     * v13 revealed the WEAKEST layer. That eliminates the one pick that
     * breaches, so a player who presses S and then flips a coin between
     * the two survivors expects 1.5 defense points a stage against 1.0 for
     * a coin flip across all three. Measured over 40,000 runs that is
     * Threat Hunter 74% of the time with no security knowledge at all —
     * against 38% blind. An earlier pass tried to fix it by pricing scan
     * at two capacity so a run affords three rather than five; that moved
     * it from 80% to 74%, because the problem was never the frequency.
     * The problem is that eliminating the worst option is worth a lot and
     * costs no knowledge.
     *
     * Revealing the PARTIAL layer is worth exactly nothing to the same
     * player, and the arithmetic is the point: avoid it and you are
     * choosing between best and weak, 0.5 x 2 + 0.5 x 0 = 1.0; take it and
     * you get a mitigated stage, 1.0. Either way 1.0, the same as a blind
     * flip. It is worth a great deal to someone who can reason about the
     * technique — knowing that detection is only a partial fit for T1490
     * tells you the shape of the problem, and the shape is the answer.
     *
     * So the scan is skill-multiplying rather than skill-substituting,
     * which is also the honest claim for the product it represents:
     * telemetry makes a good team better and does not replace one. The
     * cost is that a purely knowledge-free player gains nothing from it,
     * and the readiness card that grants free scans had to stop being a
     * pure information card as a result. It gained the clause about
     * analysts already engaging, which is the other half of what an MDR
     * service actually sells. */
    scan() {
      if (state.phase !== PHASE.STAGE) return false;
      if (state.revealed.partial) return false;
      const free = posture.has('soc-watch') && state.freeScans > 0;
      if (!free && state.capacity < SCAN_COST) {
        emit('blocked', { reason: 'No response capacity left this stage.' });
        return false;
      }
      if (free) state.freeScans -= 1;
      else state.capacity -= SCAN_COST;

      state.revealed.partial = true;
      /* A free scan costs no ground either. An analyst who is already
       * watching has already run the query — you are reading a result, not
       * waiting for one. Without this the card was measurably WORSE than
       * not buying it for a player who cannot act on what it says: three
       * extra scans at eight points of ground each, for information they
       * could not use. A readiness card that punishes the player who
       * bought it is worse than a dead one. */
      if (state.mode !== 'learn' && !free) state.depth = Math.min(100, state.depth + SCAN_DEPTH_COST);
      emit('scan', {
        partial: PILLARS.find((p) => state.variant.rank[p] === 'partial'),
        free,
      });
      return true;
    },

    /* Buy ground back. Containment is time, and time is the only thing
     * this stage is actually made of.
     *
     * No readiness card discounts this any more. An earlier pass made the
     * first isolate of each stage free under a complete asset inventory,
     * and measured it at +0.2 index — because ground is worth very little
     * to a player who decides in four seconds on a thirteen-second clock,
     * and every card that bought ground measured the same way. Three of
     * six cards were buying a currency the game barely spends. The
     * inventory card now acts on the estate instead, where the consequence
     * actually lands. */
    hold() {
      if (state.phase !== PHASE.STAGE) return false;
      if (state.capacity < HOLD_COST) {
        emit('blocked', { reason: 'No response capacity left this stage.' });
        return false;
      }
      state.capacity -= HOLD_COST;
      const before = state.depth;
      state.depth = Math.max(0, state.depth - HOLD_PUSHBACK);
      emit('hold', { from: before, to: state.depth });
      return true;
    },

    /* The two-pick mechanic. The guard on the second line is load-bearing
     * and is the thing that hangs a naive test harness: the backup has to
     * be a different pillar from the lead, so a loop that keeps choosing
     * the same key never advances. */
    choose(key) {
      if (state.phase !== PHASE.STAGE) return false;
      if (!PILLARS.includes(key)) return false;
      if (key === state.lead) return false;

      if (!state.lead) {
        state.lead = key;
        emit('lead', { key });
        return true;
      }
      state.backup = key;
      emit('backup', { key });
      commit({});
      return true;
    },

    resolveInject(hit) {
      if (!state.inject) return false;
      const inj = state.inject;
      state.inject = null;
      if (hit) {
        state.depth = Math.max(0, state.depth - 12);
        state.injectHit = true;
        emit('injectResult', { hit: true, text: inj.ok });
      } else {
        state.depth = Math.min(100, state.depth + 14);
        state.injectHit = false;
        emit('injectResult', { hit: false, text: inj.miss });
      }
      return true;
    },

    nextStage() {
      if (state.stageIndex >= 4) {
        finish();
        return;
      }
      state.stageIndex += 1;
      state.phase = state.stageIndex === 4 ? PHASE.CLIMAX : PHASE.STAGE;
      enterStage();
      emit('phase', { phase: state.phase });
    },

    /* The climax is a presentation state, not a rule change. The stage
     * underneath it plays by exactly the same rules, which matters: a
     * finale that scores differently is a finale players stop trusting. */
    climaxGo() {
      if (state.phase !== PHASE.CLIMAX) return;
      state.phase = PHASE.STAGE;
      emit('phase', { phase: state.phase });
    },

    climaxTaunt() {
      const pool = state.estate.backups <= 0 ? data.foe.climaxHoldsBackups : data.foe.climaxNoBackups;
      return pick(rand, pool);
    },

    /* --------------------------------------------------------- readouts */

    rightBackup() {
      return state.lead ? rightBackupFor(state.variant, state.lead) : null;
    },

    threatBand() {
      if (state.depth >= 78) return 'crit';
      if (state.depth >= 46) return 'alert';
      return 'calm';
    },

    /* Which comms band the client is talking in. Driven by real damage as
     * well as by depth, so the messages match what the player can see on
     * the estate map. */
    commsBand() {
      const lost = Object.values(state.estate).filter((v) => v <= 0).length;
      if (lost >= 2 || state.depth >= 76) return 'critical';
      if (lost >= 1 || state.depth >= 44 || state.stageIndex >= 2) return 'rising';
      return 'calm';
    },

    nextComms() {
      const band = api.commsBand();
      const pool = state.client.comms[band];
      return { ...pick(rand, pool), band };
    },

    summary,
    drain: () => events.splice(0),
    reset(nextSeed) {
      const s = createGame({ data, seed: nextSeed, mode: state.mode });
      return s;
    },
  };

  /* ------------------------------------------------------------ internals */

  function enterStage() {
    state.variant = deck[state.stageIndex];
    state.lead = null;
    state.backup = null;
    state.injectHit = undefined;
    state.revealed = { partial: false };
    state.inject = null;
    state.stageElapsed = 0;
    state.capacity = Math.min(CAPACITY_MAX, state.capacity + 1);

    const prev = state.rounds[state.rounds.length - 1];
    state.depth = prev ? carryDepth(prev.outcome, posture) : posture.has('patch-cadence') ? 0 : 8;

    /* The stage clock. `seconds` from the data is the budget at a standing
     * start; ground already lost shortens it. */
    state.stageMs = state.variant.seconds * 1000 * Math.max(0.7, 1 - state.depth / CARRY_TIME_PENALTY);
    state.rate = (100 - state.depth) / state.stageMs;

    emit('stage', {
      index: state.stageIndex,
      variant: state.variant,
      depth: state.depth,
      stageMs: state.stageMs,
    });
  }

  /* When the inject is allowed to fire.
   *
   * v13 scheduled these on intrusion depth, and depth is the wrong unit
   * for the job. The five stages run on 20/18/16/14/13-second clocks and
   * each one starts from wherever the last one left the attacker, so the
   * same depth number is a different moment in every stage: depth 45 is
   * nine seconds into stage one and under three seconds into stage five.
   * The published values landed at depth 45-62, which for a timed player
   * is the second or two either side of committing a lead — so the one
   * moment in the game that asks for a reflex arrived on top of the one
   * moment that asks for a decision, and the player got neither.
   *
   * Scheduled on time in the stage it lands in its own beat, just after
   * the threat card has been read and before the lead is picked, on every
   * stage and in learn mode too. It also makes the mechanic matter more
   * rather than less: the 12 points of ground a hit buys back used to be
   * spent two seconds before the stage resolved, where it changed almost
   * nothing. Now it shapes the rest of the stage.
   *
   * Three guards, and each defers rather than drops, so an inject fires at
   * the first legal moment instead of being lost. */
  /* The attacker's current speed. Committing a lead slows them because you
   * have started responding; monitored response slows them before that
   * because somebody else already had. Deliberately the same slowdown
   * whether the lead was right or wrong — a track that speeds up on a bad
   * pick would leak the answer before the player had finished deciding. */
  function liveRate() {
    let r = state.rate;
    if (state.lead) r *= LEAD_SLOWDOWN;
    else if (posture.has('soc-watch')) r *= WATCH_SLOWDOWN;
    return r;
  }

  function maybeFireInject() {
    const inj = state.variant.inject;
    if (!inj || state.injectHit !== undefined) return;
    if (state.stageElapsed < inj.after * 1000) return;

    /* 1. Never into a half-built stack. A lead committed with no backup
     *    yet is the most expensive interruption in the game — the player
     *    is holding a partial decision and cannot put it down. */
    if (state.lead && !state.backup) return;

    /* 2. Never a window the stage clock will cut off. An inject that
     *    expires because the stage ended is an alarm with no answer, and
     *    it reads as the game cheating. */
    const window = state.mode === 'learn' ? Infinity : inj.seconds * 1000;
    if (state.mode !== 'learn' && state.depth + liveRate() * window >= 100) return;

    /* Learn mode gets a window that does not punish a slow hand. The
     * decision is the same; only the stopwatch changes. */
    state.inject = { ...inj, remaining: window, total: window };
    emit('inject', { inject: state.inject });
  }

  function tickInject(dtMs) {
    if (state.mode === 'learn') return;
    state.inject.remaining -= dtMs;
    if (state.inject.remaining <= 0) api.resolveInject(false);
  }

  function commit({ timedOut }) {
    const depthAtCommit = Math.round(state.depth);
    const round = resolveStage({
      variant: state.variant,
      stageNumber: state.stageIndex + 1,
      lead: state.lead,
      backup: state.backup,
      estate: state.estate,
      depthAtCommit,
      injectHit: state.injectHit,
      streak: 0,
      posture,
      timedOut,
    });

    state.streak = isContained(round.outcome) ? state.streak + 1 : 0;
    round.streak = state.streak;
    round.points = stagePoints(round);
    round.foe = pick(
      rand,
      round.outcome === 'breached' ? data.foe.taunt : isContained(round.outcome) ? data.foe.foiled : data.foe.slowed
    );

    state.estate = round.estate;
    state.rounds.push(round);
    state.inject = null;
    state.phase = PHASE.RESOLVE;
    emit('resolved', { round });
    emit('phase', { phase: state.phase });
  }

  function finish() {
    state.phase = PHASE.RESULT;
    state.finishedAt = Date.now();
    emit('phase', { phase: state.phase });
  }

  function summary() {
    const rounds = state.rounds;
    const index = resilienceIndex(rounds);
    const zone = resolveZone(index, state.estate);
    const points = defensePoints(rounds, zone.systemsLost);
    const rank = rankFor(points);
    return {
      seedCode: state.seedCode,
      mode: state.mode,
      client: state.client,
      rounds,
      estate: state.estate,
      index,
      zone,
      defense: points,
      rank,
      next: pointsToNextRank(points),
      gap: gapDiagnosis(rounds),
      score: totalScore(rounds),
      posture: posture.list(),
      pillarsUsed: posture.pillarsUsed(),
      elapsed: state.finishedAt && state.startedAt ? state.finishedAt - state.startedAt : null,
      /* The vault is the one readiness card that changes the narrative
       * outcome rather than the score — see businessOutcome. */
      business: businessOutcome(index, state.estate, { vaultImmutable: posture.has('immutable-vault') }),
    };
  }

  return api;
}

/* Whether the business opens the next morning. Deliberately not a number:
 * every cost figure this game could print would be invented, and an
 * invented figure in front of a security professional costs more
 * credibility than it buys drama. The client's own words do the work.
 *
 * `vaultImmutable` is the immutable-vault readiness card, and it is the
 * only thing in the game that reaches this function. It does not touch the
 * index, the defense points or the rank — the answer key is untouched — it
 * changes whether the business closes. That is the literal product claim:
 * a restore path a stolen credential cannot delete is what stands between
 * a bad week and a closure. It converts a closure into a wounded survival,
 * not into a good outcome; immutable backups mean you reopen, they do not
 * mean nothing happened.
 *
 * The cost is that a player who buys the vault never sees "Harbour Dental
 * closed after 32 years", which is the best beat in the asset. That is the
 * right trade: the beat stays reachable for everyone who did not buy it,
 * and the game now teaches the lesson by the contrast between two runs
 * rather than by asserting it in copy. */
export function businessOutcome(index, estate, { vaultImmutable = false } = {}) {
  const lost = Object.values(estate).filter((v) => v <= 0).length;
  if (!vaultImmutable) {
    if (estate.backups <= 0 && index < 45) return 'closed';
    if (index < 30) return 'closed';
  }
  if (index < 55 || lost >= 2) return 'wounded';
  if (index >= 78 && lost === 0) return 'continuity';
  return 'open';
}
