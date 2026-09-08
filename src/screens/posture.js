/* The readiness board. Spent before the attack starts.
 *
 * This is the screen that turns the sales argument into a mechanic rather
 * than a claim. Resilience is layered and built in advance — so the
 * player builds it in advance, with a budget too small to cover
 * everything and a per-pillar cap that makes a single-product answer
 * impossible to express. Nobody has to be told you cannot win with one
 * product; they find out here, by trying.
 *
 * It is also the screen that makes the result screen land. "You had no
 * immutable vault" is a fact about a decision the player made, not a
 * product pitch.
 */

import { h, mount } from '../ui/dom.js';
import { DEF } from '../engine/pillars.js';

const TONE = { manage: 'blue', secure: 'violet', recover: 'green' };

export function renderPosture(app) {
  const { game, data } = app;
  const posture = game.state.posture;

  const pips = h('div', { class: 'budget-pips', role: 'img' }, ...Array.from({ length: posture.budget }, () => h('i')));
  const warn = h('p', { class: 'posture-warn', role: 'status' }, '');
  const grid = h('div', { class: 'posture-grid' });
  const startBtn = h('button', {
    class: 'btn primary', type: 'button', 'data-autofocus': '',
    onclick() {
      app.audio.tap();
      app.beginAttack();
    },
  }, '');

  const cards = new Map();

  for (const card of data.postures.cards) {
    const tone = TONE[card.pillar];
    const btn = h('button', {
      class: `pcard t-${tone}`,
      type: 'button',
      'aria-pressed': 'false',
      onclick() {
        const r = game.togglePosture(card.id);
        if (!r.ok) {
          warn.textContent = r.reason;
          app.audio.injectMiss();
        } else {
          warn.textContent = '';
          app.audio[r.on ? 'lead' : 'tap']();
        }
        refresh();
      },
    },
      h('div', { class: 'pc-top' },
        h('span', { class: 'pc-pillar' }, DEF[card.pillar].name),
        h('span', { class: 'pc-prod' }, card.product)
      ),
      h('h3', null, card.name),
      h('p', { class: 'pc-desc' }, card.desc),
      h('div', { class: 'pc-effect' }, card.effect)
    );
    cards.set(card.id, btn);
    grid.append(btn);
  }

  function refresh() {
    [...pips.children].forEach((p, i) => p.classList.toggle('spent', i >= posture.remaining));
    pips.setAttribute('aria-label', `${posture.remaining} of ${posture.budget} readiness points unspent`);

    for (const [id, btn] of cards) {
      const on = posture.has(id);
      btn.setAttribute('aria-pressed', String(on));
      /* Show what is unavailable rather than hiding it. A capability the
       * player cannot afford is information: it is the pillar they chose
       * not to invest in, and it is what the result screen refers back
       * to. */
      const blocked = !on && !!posture.blocker(id);
      btn.classList.toggle('locked', blocked);
    }

    startBtn.replaceChildren(
      posture.remaining > 0
        ? `Start with ${posture.spent} of ${posture.budget} in place`
        : 'BlackVault is already inside',
      h('span', { class: 'kbd' }, '↵')
    );
  }

  const node = h('main', { class: 'screen' },
    h('div', { class: 'posture-head' },
      h('span', { class: 'label', style: { display: 'block', marginBottom: '9px' } }, 'BEFORE THE ATTACK'),
      h('h2', null, 'What did you build in advance?'),
      h('p', null,
        `You have ${data.postures.budget} points and six capabilities. `,
        'Nothing here can be bought once the attack starts — that is the point. Spend at most two in any one pillar.')
    ),
    h('div', { class: 'budget' },
      h('span', { class: 'label' }, 'READINESS BUDGET'),
      pips
    ),
    grid,
    warn,
    h('div', { class: 'posture-foot' },
      h('button', {
        class: 'btn ghost', type: 'button',
        onclick() {
          app.audio.tap();
          game.state.phase = 'brief';
          app.render();
        },
      }, 'Back'),
      startBtn
    ),
    h('p', { class: 'foot' }, 'A run with nothing in place is playable. It is also how most of these end.')
  );

  refresh();
  mount(node);
  return node;
}
