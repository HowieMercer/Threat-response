/* The parts of the stage screen that update every frame or every stage:
 * the HUD, the intrusion track, the estate map and the comms feed.
 *
 * Each returns an object with the element and an update() so the stage
 * screen can build once and then only push numbers. Rebuilding the DOM
 * sixty times a second is how a game like this starts dropping frames on
 * the phone it is actually being played on.
 */

import { h, clamp, announce } from './dom.js';
import { icon } from './icons.js';
import { DEF } from '../engine/pillars.js';
import { OUTCOME_TONE, isContained, isMitigated } from '../engine/scoring.js';

const THREAT_TONE = { Elevated: 'amber', High: 'amber', Severe: 'red', Critical: 'red' };

/* ------------------------------------------------------------------ HUD */

export function createHud({ client, onSound, onHelp, muted }) {
  const pips = h('div', { class: 'stage-pips', role: 'img', 'aria-label': 'Stage progress' },
    ...Array.from({ length: 5 }, () => h('i')));
  const threat = h('div', { class: 'threat-level t-amber' }, 'ELEVATED');
  const clientName = h('div', { class: 'cl-name' }, client.name);
  const clientSub = h('div', { class: 'cl-sub' }, `${client.years} YRS · ${client.sector.toUpperCase()}`);

  const soundBtn = h('button', {
    class: 'icon-btn',
    type: 'button',
    'aria-pressed': String(!muted),
    'aria-label': 'Sound',
    title: 'Sound (M)',
    onclick: onSound,
  }, icon(muted ? 'mute' : 'sound', ''));

  const el = h('header', { class: 'hud' },
    h('div', { class: 'hud-left' },
      h('div', { class: 'brand' },
        h('span', { class: 'dot' }),
        h('span', { class: 'name' }, 'N-able ', h('em', null, 'Threat Response'))
      ),
      h('div', { class: 'hud-client' },
        h('div', { class: 'cl-meta' }, clientName, clientSub)
      )
    ),
    h('div', { class: 'hud-right' },
      pips,
      threat,
      soundBtn,
      onHelp && h('button', {
        class: 'icon-btn', type: 'button', 'aria-label': 'How it works', title: 'How it works (?)', onclick: onHelp,
      }, icon('help', ''))
    )
  );

  return {
    el,
    setClient(c) {
      clientName.textContent = c.name;
      clientSub.textContent = `${c.years} YRS · ${c.sector.toUpperCase()}`;
    },
    setStage(index, rounds, threatWord) {
      [...pips.children].forEach((pip, i) => {
        pip.className = '';
        const r = rounds[i];
        if (r) pip.classList.add(isContained(r.outcome) ? 'ok' : isMitigated(r.outcome) ? 'part' : 'bad');
        else if (i === index) pip.classList.add('now');
      });
      pips.setAttribute('aria-label', `Stage ${index + 1} of 5`);
      threat.textContent = threatWord.toUpperCase();
      threat.className = `threat-level t-${THREAT_TONE[threatWord] || 'amber'}`;
    },
    setMuted(m) {
      soundBtn.setAttribute('aria-pressed', String(!m));
      soundBtn.replaceChildren(icon(m ? 'mute' : 'sound', ''));
    },
  };
}

/* -------------------------------------------------------- intrusion track
 *
 * The countdown this replaced was a number getting smaller. This is
 * ground being taken: the attacker is a thing with a position, moving
 * toward systems the player can see. Same information, and it is the
 * difference between watching a timer and being chased.
 */
export function createTrack() {
  const taken = h('div', { class: 'track-taken' });
  const marker = h('div', { class: 'track-marker' }, 'BLACKVAULT');
  const clock = h('div', { class: 'track-clock mono' }, '');
  const rail = h('div', {
    class: 'track-rail',
    role: 'progressbar',
    'aria-label': 'Intrusion depth',
    'aria-valuemin': '0',
    'aria-valuemax': '100',
    'aria-valuenow': '0',
  },
    h('div', { class: 'track-ticks' }, ...Array.from({ length: 10 }, () => h('i'))),
    taken,
    h('div', { class: 'track-goal' }, 'Your estate'),
    marker
  );

  const el = h('section', { class: 'track' },
    h('div', { class: 'track-head' },
      h('span', { class: 'label' }, 'Intrusion depth'),
      clock
    ),
    rail
  );

  let lastAnnounced = -1;
  return {
    el,
    update(depth, remainingMs, mode) {
      const pct = clamp(depth, 0, 100);
      taken.style.width = `${pct}%`;
      marker.style.left = `${pct}%`;
      /* Centered on its position, so at 0 and at 100 half the marker would
       * sit outside the rail. Shift it from left-aligned to right-aligned
       * across the run instead of always centring. */
      marker.style.transform = `translate(${-pct}%, -50%)`;
      rail.setAttribute('aria-valuenow', String(Math.round(pct)));

      if (mode === 'learn') {
        clock.textContent = 'LEARN MODE · NO TIMER';
        clock.classList.remove('urgent');
      } else {
        const s = Math.max(0, remainingMs / 1000);
        clock.textContent = `${s.toFixed(1)}s TO IMPACT`;
        clock.classList.toggle('urgent', s <= 4);
      }

      /* Announce in bands rather than continuously — a live region
       * repeating a number sixty times a second is unusable. */
      const band = pct >= 80 ? 3 : pct >= 55 ? 2 : pct >= 30 ? 1 : 0;
      if (band !== lastAnnounced && band > 0) {
        lastAnnounced = band;
        announce(['', 'Intrusion at 30 percent', 'Intrusion at 55 percent', 'Intrusion at 80 percent'][band]);
      }
      if (band === 0) lastAnnounced = 0;
    },
  };
}

/* ----------------------------------------------------------- estate map */

export function createEstate(systems) {
  const cells = new Map();
  const el = h('section', { class: 'estate', 'aria-label': 'Estate status' });

  for (const s of systems) {
    const state = h('span', { class: 'sys-state' }, 'OK');
    /* Both names render; CSS picks one by width. Swapping textContent on
     * a resize would mean listening for resizes from six places. */
    const cell = h('div', {
      class: 'sys',
      role: 'group',
      'aria-label': `${s.name}: operational`,
    },
      icon(s.id),
      h('span', { class: 'sys-name' }, s.name),
      h('span', { class: 'sys-name sys-short' }, s.short),
      state
    );
    cells.set(s.id, { cell, state, spec: s });
    el.append(cell);
  }

  const WORD = { 2: 'OK', 1: 'DEGRADED', 0: 'LOST' };
  const CLS = { 2: '', 1: 'degraded', 0: 'lost' };

  return {
    el,
    cellFor(id) {
      return cells.get(id)?.cell;
    },
    update(estate, target) {
      for (const [id, { cell, state, spec }] of cells) {
        const v = estate[id];
        cell.className = `sys ${CLS[v]}${target === id && v > 0 ? ' targeted' : ''}`;
        state.textContent = WORD[v];
        /* Color is never the only carrier: the state word is on screen,
         * and the accessible name says what stops working. */
        cell.setAttribute(
          'aria-label',
          v === 2 ? `${spec.name}: operational` : v === 1 ? `${spec.name}: degraded` : `${spec.name}: lost. ${spec.loss}`
        );
      }
    },
    mark(id, kind) {
      const c = cells.get(id)?.cell;
      if (!c) return;
      c.classList.remove('hit', 'saved');
      void c.offsetWidth;
      c.classList.add(kind);
      setTimeout(() => c.classList.remove(kind), 760);
    },
  };
}

/* ---------------------------------------------------------- comms feed */

export function createComms(clientName) {
  const list = h('div', { class: 'comms-list', 'aria-live': 'polite', 'aria-relevant': 'additions' });
  const el = h('section', { class: 'comms' },
    h('div', { class: 'comms-head' },
      h('span', { class: 'label' }, 'Inbound'),
      h('span', { class: 'label', style: { color: 'var(--brand-b)' } }, clientName)
    ),
    list
  );

  /* Capped at six. The feed is atmosphere and pressure, not a transcript
   * to scroll — and an unbounded list on a phone pushes the pillar cards
   * off screen, which is an actual gameplay problem. */
  const CAP = 6;

  return {
    el,
    push({ from, text, band = 'calm', foe = false }) {
      const msg = h('div', { class: `msg ${band}${foe ? ' foe' : ''}` },
        h('span', { class: 'from' }, from),
        h('span', { class: 'text' }, text)
      );
      list.prepend(msg);
      while (list.children.length > CAP) list.lastElementChild.remove();
    },
    clear() {
      list.replaceChildren();
    },
  };
}

/* --------------------------------------------------------- pillar cards */

export function createPillars({ onPick }) {
  const cards = new Map();
  const el = h('div', { class: 'pillars', role: 'group', 'aria-label': 'Choose a lead defense, then a backup layer' });

  const KEYS = { manage: '1', secure: '2', recover: '3' };

  for (const key of ['manage', 'secure', 'recover']) {
    const def = DEF[key];
    const act = h('div', { class: 'pill-act' }, '');
    const flag = h('span', { class: 'pill-flag' }, '');
    const card = h('button', {
      class: `pill t-${def.tone}`,
      type: 'button',
      dataset: { key },
      onclick: () => onPick(key),
    },
      h('div', { class: 'pill-top' },
        h('span', { class: 'pill-name' }, def.name),
        h('span', { class: 'pill-prod' }, def.product)
      ),
      flag,
      act,
      h('div', { class: 'pill-hint' }, def.hint),
      h('span', { class: 'pill-key' }, KEYS[key])
    );
    cards.set(key, { card, act, flag });
    el.append(card);
  }

  return {
    el,
    setActions(variant) {
      for (const [key, { card, act, flag }] of cards) {
        act.textContent = variant.act[key];
        card.className = `pill t-${DEF[key].tone}`;
        card.disabled = false;
        flag.textContent = '';
        card.setAttribute('aria-label', `${DEF[key].name}, ${DEF[key].product}. ${variant.act[key]}`);
      }
    },
    setSlots(lead, backup) {
      for (const [key, { card }] of cards) {
        card.classList.toggle('lead', key === lead);
        card.classList.toggle('backup', key === backup);
        /* The rule that makes the two-pick mechanic mean something: your
         * backup cannot be the layer you already led with. */
        card.disabled = !!lead && key === lead;
      }
    },
    reveal({ weak, best }) {
      if (weak) {
        const { card, flag } = cards.get(weak);
        card.classList.add('flagged-weak');
        flag.textContent = 'WEAKEST LAYER HERE';
      }
      if (best) {
        const { card, flag } = cards.get(best);
        card.classList.add('flagged-best');
        flag.textContent = 'STRONGEST LAYER HERE';
      }
    },
    lock() {
      for (const [, { card }] of cards) card.disabled = true;
    },
  };
}

export const toneFor = (outcome) => OUTCOME_TONE[outcome] || 'brand';
