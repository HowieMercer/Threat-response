/* Two full-screen beats either side of stage five.
 *
 * The climax is presentation only — the stage underneath plays by exactly
 * the same rules, because a finale that scores differently is a finale
 * players stop trusting. What changes is the room: everything else goes
 * away, the countdown is the only thing on screen, and BlackVault's line
 * depends on whether they already hold the backups.
 *
 * The impact beat afterwards is the emotional peak of the whole asset.
 * Either a ransom note or the next morning, and it lands before any
 * number does.
 */

import { h } from '../ui/dom.js';
import { type } from '../render/fx.js';

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function renderClimax(app) {
  const { game } = app;
  const holdsBackups = game.state.estate.backups <= 0;

  const count = h('div', { class: 'cx-count' }, '3');
  const taunt = h('div', { class: 'cx-taunt' }, '');
  const skip = h('button', {
    class: 'btn ghost', type: 'button', 'data-autofocus': '',
    onclick: () => finish(),
  }, 'Skip');

  /* .on-ink re-points the whole token scope for the subtree — see
   * tokens.css. Without it every signal colour inside here is a light-theme
   * ink measuring 2.0-3.5:1 against the inversion. */
  const overlay = h('div', { class: 'climax on-ink', role: 'dialog', 'aria-label': 'Impact imminent' },
    h('div', { class: 'cx-label' }, holdsBackups ? 'NO RESTORE PATH' : 'IMPACT IMMINENT'),
    count,
    taunt,
    h('div', { class: 'cx-note' }, h('span', null, 'STAGE 5 · IMPACT · CRITICAL')),
    h('div', { style: { marginTop: '18px' } }, skip)
  );

  document.body.appendChild(overlay);
  skip.focus({ preventScroll: true });
  app.field.setMood('crit');

  let done = false;
  let timers = [];
  function finish() {
    if (done) return;
    done = true;
    for (const t of timers) clearTimeout(t);
    overlay.remove();
    app.enterClimaxStage();
  }

  /* Under reduced motion the countdown does not run at all — a
   * full-screen 3-2-1 with a scaling number is exactly the effect the
   * setting exists to suppress. The taunt still shows, because it is
   * content. */
  if (reduced()) {
    count.textContent = '';
    taunt.textContent = game.climaxTaunt();
    skip.replaceChildren('Continue');
    return overlay;
  }

  type(taunt, game.climaxTaunt(), { cps: 34 });

  [3, 2, 1].forEach((n, i) => {
    timers.push(setTimeout(() => {
      count.textContent = String(n);
      count.classList.remove('beat');
      void count.offsetWidth;
      count.classList.add('beat');
      app.audio.countdown(n);
    }, i * 900));
  });
  timers.push(setTimeout(() => {
    app.audio.countdown(0);
    finish();
  }, 2900));

  return overlay;
}

/* ----------------------------------------------------------- the impact */

export function renderImpact(app, summary, onDone) {
  const closed = summary.business === 'closed' || summary.business === 'wounded';
  const noVault = summary.estate.backups <= 0;

  const body = h('div', { class: 'ransom' });
  const skip = h('button', {
    class: 'btn ghost', type: 'button', 'data-autofocus': '',
    onclick: () => finish(),
  }, 'Continue');

  const overlay = h('div', { class: 'climax on-ink', role: 'dialog', 'aria-label': 'Aftermath' },
    h('div', { class: `cx-label${closed ? '' : ' held'}` },
      closed ? '07:40 — THE NEXT MORNING' : '06:12 — THE NEXT MORNING'),
    body,
    h('div', { style: { marginTop: '20px' } }, skip)
  );

  let done = false;
  const timers = [];
  function finish() {
    if (done) return;
    done = true;
    for (const t of timers) clearTimeout(t);
    overlay.remove();
    onDone();
  }

  document.body.appendChild(overlay);
  skip.focus({ preventScroll: true });

  if (closed) {
    app.audio.closed();
    app.field.setMood('crit');
    const line = h('div', null);
    body.append(
      h('div', { class: 'rn-head' }, 'BLACKVAULT // NOTICE'),
      line
    );
    /* No figure, no currency, no countdown clock with a number on it.
     * Every one of those would be invented, and an invented number in
     * front of a security professional costs more than it buys. */
    const text = noVault
      ? `Every restore point you had is gone. We checked before we started.\n\nYour files are encrypted. Your data is on our infrastructure. ${summary.client.name} has one way to open tomorrow and it is us.\n\nDo not contact your insurer first. They will tell you to contact us.`
      : `Your files are encrypted. Your data is on our infrastructure.\n\nYou still have backups. Restoring will take longer than you think, and every hour of it is an hour ${summary.client.name} is not trading.\n\nThe price goes up when you tell someone.`;
    type(line, text, { cps: 70 });
  } else {
    app.audio.reveal();
    app.field.setMood('won');
    body.classList.add('held');
    const line = h('div', null);
    body.append(h('div', { class: 'rn-head' }, 'INCIDENT CLOSED'), line);
    type(line, `${summary.client.survived}\n\nBlackVault moved on to a business with fewer layers.`, { cps: 60 });
  }

  timers.push(setTimeout(() => skip.focus({ preventScroll: true }), 600));
  return overlay;
}
