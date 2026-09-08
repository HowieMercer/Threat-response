/* Help and stats. Both are modal, both trap focus and both close on
 * Escape, because a modal you cannot leave from the keyboard is a modal
 * that ends the run for anyone not using a mouse.
 */

import { h } from '../ui/dom.js';
import { Store } from '../store.js';
import { CONFIG, VERSION } from '../config.js';
import { DATA } from '../data/index.js';
import { SCAN_COST, HOLD_COST } from '../engine/game.js';
import { RANKS, DEFENSE_CAP } from '../engine/scoring.js';

function modal(title, body, { wide = false, app = null } = {}) {
  const close = h('button', { class: 'btn ghost sm', type: 'button', 'aria-label': 'Close' }, 'Close');
  const panel = h('div', {
    class: 'sheet' + (wide ? ' wide' : ''),
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': title,
  },
    h('div', { class: 'sheet-head' }, h('h2', null, title), close),
    h('div', { class: 'sheet-body' }, body)
  );
  const back = h('div', { class: 'scrim' }, panel);

  const prevFocus = document.activeElement;

  /* Reading the rules must not cost you the stage. The intrusion track is
   * real time, so anything that covers the board stops the clock. The app
   * counts nesting, so closing one modal while another is open does not
   * start it again. */
  let shutOnce = false;
  if (app) app.pushModal();

  function shut() {
    if (shutOnce) return;
    shutOnce = true;
    back.remove();
    document.removeEventListener('keydown', onKey);
    if (app) app.popModal();
    if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true });
  }
  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      shut();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusables = panel.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  close.addEventListener('click', shut);
  back.addEventListener('click', (e) => {
    if (e.target === back) shut();
  });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(back);
  close.focus({ preventScroll: true });
  return { shut };
}

export function openHelp(app) {
  const row = (k, v) => h('div', { class: 'kv' }, h('span', { class: 'kv-k' }, k), h('span', { class: 'kv-v' }, v));

  return modal('How it works',
    h('div', null,
      h('p', { class: 'sheet-lead' },
        'Five stages. Each one is a real MITRE ATT&CK technique against a real-shaped small business. At every stage you lead with one layer and back it with a second, and the backup has to be a different pillar.'),

      h('h3', null, 'The two picks'),
      row('Lead right', 'The stage is contained. The attacker loses ground.'),
      row('Lead partially right', 'Mitigated. Slowed, not stopped, and a system degrades.'),
      row('Lead wrong, or run out of time', 'Breached. The targeted system is lost permanently.'),
      row('Both picks right', 'Perfect stack. A system you already lost comes back.'),

      h('h3', null, 'During a stage'),
      row(`Scan — ${SCAN_COST} capacity`, 'Reveals the weakest layer for this technique. Never the strongest, unless you bought a complete asset inventory. Costs ground as well as capacity.'),
      row(`Isolate — ${HOLD_COST} capacity`, 'Pushes the attacker back down the track and buys you seconds.'),
      row('Live injects', 'One tap, a few seconds. Missing one costs ground, never the run.'),

      h('h3', null, 'The clock'),
      h('p', null,
        /* Read off the scenario data rather than a second copy of the
         * numbers, so tuning a stage cannot leave the rules panel lying. */
        `The intrusion track crosses the board in ${DATA.scenarios.stages.map((s) => s.seconds).join(', ')} seconds across the five stages. Ground the attacker already holds shortens the next stage, so a bad stage makes the following one harder — it never makes it unplayable.`),
      h('p', null, 'Learn mode removes the clock entirely. The decisions and the answer key are identical.'),

      h('h3', null, 'The rank ladder'),
      h('p', null, `Contained stages are worth 2 defense points, mitigated 1, and you lose 1 for every two systems gone. Capped at ${DEFENSE_CAP}.`),
      h('div', { class: 'ranks' }, ...RANKS.map((r) =>
        h('div', { class: 'kv' },
          h('span', { class: 'kv-k' }, `${r.min}+`),
          h('span', { class: 'kv-v' }, h('b', null, r.name), ' — ', r.blurb)))),

      h('h3', null, 'Keyboard'),
      h('div', { class: 'keys' },
        ...[['1 2 3', 'Pick a layer'], ['S', 'Scan'], ['H', 'Isolate'], ['Space', 'Answer an inject'],
            ['Enter', 'Primary action'], ['R', 'Play again'], ['M', 'Sound'], ['?', 'This panel']]
          .map(([k, v]) => h('div', { class: 'kv' }, h('span', { class: 'kv-k' }, h('span', { class: 'kbd' }, k)), h('span', { class: 'kv-v' }, v)))
      ),

      h('p', { class: 'sheet-foot' },
        `Threat Response ${VERSION}. Technique IDs and tactic names are MITRE ATT&CK as published. No figure anywhere in this game is estimated or invented.`)
    ),
    { wide: true, app }
  );
}

export function openStats(app) {
  const m = Store.metrics;
  const leads = Store.leads;
  const board = Store.leaderboard;

  const funnel = [
    ['Plays', m.plays],
    ['Completed', m.completions],
    ['Abandoned', m.abandons],
    ['Form opened', m.formOpens],
    ['Leads captured', m.leads],
  ];

  const csvBtn = h('button', {
    class: 'btn sm', type: 'button',
    onclick(ev) {
      const csv = Store.csv();
      try {
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
        const a = h('a', { href: url, download: `threat-response-leads-${new Date().toISOString().slice(0, 10)}.csv` });
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        ev.currentTarget.replaceChildren('Downloaded');
      } catch {
        navigator.clipboard?.writeText(csv);
        ev.currentTarget.replaceChildren('Copied to clipboard');
      }
    },
  }, `Export ${leads.length} lead${leads.length === 1 ? '' : 's'} as CSV`);

  return modal('This device',
    h('div', null,
      h('p', { class: 'sheet-lead' },
        'Everything below is stored on this device only. Two tablets at the same stand keep separate boards and separate lead lists — a shared leaderboard needs a backend and is not built.'),

      h('h3', null, 'Funnel'),
      h('div', { class: 'keys' }, ...funnel.map(([k, v]) =>
        h('div', { class: 'kv' }, h('span', { class: 'kv-k' }, k), h('span', { class: 'kv-v mono' }, String(v))))),
      m.plays > 0
        ? h('p', { class: 'sheet-foot' },
            `Play-to-lead ${((m.leads / m.plays) * 100).toFixed(0)}%. Completion ${((m.completions / m.plays) * 100).toFixed(0)}%.`)
        : null,

      h('h3', null, 'Top runs'),
      board.length
        ? h('ol', { class: 'lb' }, ...board.map((e, i) =>
            h('li', null,
              h('span', { class: 'pos' }, `0${i + 1}`.slice(-2)),
              h('span', { class: 'who' }, `${e.rank} · ${e.client} · ${e.seed}`),
              h('span', { class: 'pts' }, e.score.toLocaleString()))))
        : h('p', { class: 'lb-empty' }, 'No runs recorded yet.'),

      h('h3', null, 'Leads'),
      leads.length
        ? h('div', null,
            csvBtn,
            h('p', { class: 'sheet-foot' },
              'Columns: name, email, role, client, gap, score, resilience, zone, rank, seed, plays, kiosk, event, consent, version, timestamp.'))
        : h('p', { class: 'lb-empty' }, 'No leads captured on this device.'),

      h('h3', null, 'Deployment'),
      h('div', { class: 'keys' },
        h('div', { class: 'kv' }, h('span', { class: 'kv-k' }, 'Version'), h('span', { class: 'kv-v mono' }, VERSION)),
        h('div', { class: 'kv' }, h('span', { class: 'kv-k' }, 'Event'), h('span', { class: 'kv-v mono' }, CONFIG.eventName || '—')),
        h('div', { class: 'kv' }, h('span', { class: 'kv-k' }, 'Kiosk'), h('span', { class: 'kv-v mono' }, CONFIG.kioskId || 'unset')),
        h('div', { class: 'kv' }, h('span', { class: 'kv-k' }, 'Metrics endpoint'), h('span', { class: 'kv-v mono' }, CONFIG.metricsEndpoint || 'local only')),
        h('div', { class: 'kv' }, h('span', { class: 'kv-k' }, 'Scorecard email'), h('span', { class: 'kv-v mono' }, CONFIG.emailFulfillment ? 'enabled' : 'not built')),
        h('div', { class: 'kv' }, h('span', { class: 'kv-k' }, 'Storage key'), h('span', { class: 'kv-v mono' }, 'nable_tr_v8'))
      ),
      h('p', { class: 'sheet-foot' },
        'The storage key has not moved since v8 on purpose. Changing it orphans every leaderboard entry and captured lead on every device already in the field.')
    ),
    { wide: true, app }
  );
}
