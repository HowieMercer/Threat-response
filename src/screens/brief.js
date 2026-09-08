/* Briefing. Six seconds of the three pillars, skippable.
 *
 * Its real job is to make the two-pick rule legible before the first
 * timer starts, because a player who does not understand the rule reads
 * their first breach as the game being unfair rather than as a decision
 * they got wrong.
 */

import { h, mount } from '../ui/dom.js';
import { DEF, PILLARS } from '../engine/pillars.js';

export function renderBrief(app) {
  const { game } = app;

  const go = () => {
    app.audio.tap();
    game.goPosture();
    app.render();
  };

  const node = h('main', { class: 'screen center' },
    h('span', { class: 'label', style: { marginBottom: '10px' } }, 'THREE LAYERS · ONE ESTATE'),
    h('h2', { style: { fontSize: 'clamp(24px,5vw,38px)', marginBottom: '8px' } }, 'What you have to work with'),
    h('p', { class: 'tag', style: { marginBottom: '20px' } },
      `${game.state.client.name} — ${game.state.client.profile}. They cannot operate without ${game.state.client.stake}.`),

    h('div', { class: 'brief-pillars' },
      ...PILLARS.map((key) => {
        const d = DEF[key];
        return h('div', { class: `bp t-${d.tone}` },
          h('h3', null, d.name),
          h('div', { class: 'prod' }, d.product),
          h('div', { class: 'cap' }, d.capability),
          h('div', { class: 'hint' }, d.hint)
        );
      })
    ),

    h('div', { class: 'brief-rule' },
      h('p', null, h('b', null, 'Two picks per stage.'), ' Lead with the layer that stops this technique. Then back it with a second layer — and the backup has to be a different pillar from the lead.'),
      h('p', null, 'Getting the lead right contains the stage. Getting both right is a perfect stack, and it takes ground back. ', h('b', null, 'No single product can carry a stage'), ' — that is the rule, not a hint.'),
      h('p', { style: { color: 'var(--faint)' } }, 'Every technique on screen is a real MITRE ATT&CK entry. There is no invented statistic anywhere in this.')
    ),

    h('button', { class: 'btn primary', type: 'button', 'data-autofocus': '', onclick: go },
      'Set your readiness', h('span', { class: 'kbd' }, '↵'))
  );

  mount(node);
  return node;
}
