/* Attract screen. The thing on the tablet when nobody is playing, and
 * the first thing a prospect sees on a link.
 *
 * It has three jobs: make someone want to start, tell a passer-by what
 * this is without anyone having to explain it, and give the people who
 * will not play something to take away.
 */

import { h, mount } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { qrSvg } from '../ui/qr.js';
import { CONFIG, VERSION } from '../config.js';
import { Store } from '../store.js';

export function renderAttract(app) {
  const { data, game } = app;
  const settings = Store.settings;
  let mode = settings.mode === 'learn' ? 'learn' : 'timed';
  let clientId = game.state.client.id;

  const ticker = data.foe.ticker;
  /* The row is duplicated so the marquee can translate -50% and loop with
   * no visible seam. */
  const tickerRow = h('div', { class: 'ticker-row' },
    ...[...ticker, ...ticker].map((t) =>
      h('span', { class: 'ticker-item' }, h('b', null, t.tech), t.text)
    )
  );

  const board = Store.leaderboard;
  const metrics = Store.metrics;

  const clientCards = data.clients.clients.map((c) =>
    h('button', {
      class: 'client-card',
      type: 'button',
      'aria-pressed': String(c.id === clientId),
      onclick(ev) {
        clientId = c.id;
        game.setClient(c.id);
        app.audio.tap();
        for (const el of ev.currentTarget.parentElement.children) el.setAttribute('aria-pressed', 'false');
        ev.currentTarget.setAttribute('aria-pressed', 'true');
      },
    },
      h('div', { class: 'cc-name' }, c.name),
      h('div', { class: 'cc-years' }, `${c.years} YEARS TRADING`),
      h('div', { class: 'cc-profile' }, c.profile)
    )
  );

  /* Two states, said out loud. The earlier version showed the current mode
   * on a button, which reads as the thing the button will do. */
  const modeLabel = () => [
    h('span', { class: 'label', style: { letterSpacing: '0.1em' } }, 'MODE'),
    mode === 'timed' ? 'Timed' : 'Learn — no clock',
    h('span', { class: 'kbd' }, 'L'),
  ];
  const modeBtn = h('button', {
    class: 'btn ghost',
    type: 'button',
    'aria-pressed': String(mode === 'learn'),
    title: 'Learn mode removes the clock. The decisions are identical.',
    onclick(ev) {
      mode = mode === 'timed' ? 'learn' : 'timed';
      game.setMode(mode);
      Store.saveSettings({ mode });
      app.audio.tap();
      ev.currentTarget.setAttribute('aria-pressed', String(mode === 'learn'));
      ev.currentTarget.replaceChildren(...modeLabel());
    },
  });
  modeBtn.replaceChildren(...modeLabel());

  const start = h('button', {
    class: 'btn primary',
    type: 'button',
    'data-autofocus': '',
    onclick() {
      app.audio.unlock();
      app.audio.tap();
      game.setMode(mode);
      game.setClient(clientId);
      app.start();
    },
  }, 'Start the incident', h('span', { class: 'kbd' }, '↵'));

  /* Type in a run code and play the identical five stages.
   *
   * Runs have always been seeded and reproducible, and the code has always
   * been printed on the result screen — but there was nowhere to type one
   * in, so the feature existed only for someone willing to hand-edit a URL
   * fragment. It is the cheapest competitive mechanic a stand has (give two
   * people the same run and the comparison is honest) and the only way a
   * reported bug is reproducible. */
  const seedInput = h('input', {
    type: 'text', id: 'seed-code', maxlength: '6', autocapitalize: 'characters',
    spellcheck: 'false', autocomplete: 'off', placeholder: 'ABCDE',
    'aria-describedby': 'seed-help',
    oninput(ev) {
      const el = ev.currentTarget;
      el.value = el.value.toUpperCase().replace(/[^0-9A-Z]/g, '');
      seedErr.textContent = '';
    },
    onkeydown(ev) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        ev.stopPropagation();
        goSeed();
      }
    },
  });
  const seedErr = h('span', { class: 'seed-err', role: 'alert' }, '');
  function goSeed() {
    const code = seedInput.value.trim();
    if (!code) {
      seedErr.textContent = 'Enter the five-character code from a result screen.';
      seedInput.focus();
      return;
    }
    app.audio.unlock();
    app.audio.tap();
    game.setMode(mode);
    game.setClient(clientId);
    if (!app.playSeed(code)) {
      seedErr.textContent = `${code} is not a run code.`;
      seedInput.focus();
    }
  }
  const seedRow = h('div', { class: 'seed-row' },
    h('label', { for: 'seed-code' }, 'Run code'),
    seedInput,
    h('button', { class: 'btn sm ghost', type: 'button', onclick: goSeed }, 'Play it'),
    h('span', { class: 'seed-help', id: 'seed-help' }, 'Plays the identical five stages.'),
    seedErr
  );

  const node = h('main', { class: 'screen attract center' },
    h('div', { style: { maxWidth: '900px', margin: '0 auto' } },
      h('span', { class: 'label', style: { display: 'block', marginBottom: '10px' } },
        CONFIG.eventName && CONFIG.eventName !== 'the event' ? CONFIG.eventName.toUpperCase() : 'RANSOMWARE DECISION SIMULATOR'),
      h('h1', null, 'Two minutes. ', h('em', null, 'One business.')),
      h('p', { class: 'tag' },
        'BlackVault is already inside. Five stages, real ATT&CK techniques, and one question at each: which layer do you lead with, and what backs it up?'),
      h('div', { class: 'attract-cta' }, start, modeBtn),
      seedRow,
      CONFIG.prize ? h('p', { class: 'label', style: { marginBottom: '18px' } }, CONFIG.prize.toUpperCase()) : null
    ),

    h('div', { class: 'ticker', 'aria-hidden': 'true' }, tickerRow),

    h('div', { style: { width: '100%', maxWidth: '900px', margin: '0 auto' } },
      h('span', { class: 'label', style: { display: 'block', marginBottom: '9px', textAlign: 'left' } },
        'Who are you defending?'),
      h('div', { class: 'clients' }, ...clientCards)
    ),

    h('div', { class: 'attract-grid' },
      h('div', { class: 'mini' },
        h('h3', null, 'HOW IT WORKS'),
        h('ol', { style: { paddingLeft: '17px', fontSize: '13px', color: 'var(--dim)', lineHeight: '1.65' } },
          h('li', null, 'Spend a readiness budget before the attack starts.'),
          h('li', null, 'At each stage, lead with one layer and back it with another.'),
          h('li', null, 'Your backup has to be a different pillar. One product never carries a stage.'),
          h('li', null, 'Finish with a Business Resilience Index and the phase you are weakest in.')
        )
      ),
      h('div', { class: 'mini' },
        h('h3', null, 'THIS DEVICE'),
        board.length
          ? h('ol', { class: 'lb' }, ...board.slice(0, 5).map((e, i) =>
              h('li', null,
                h('span', { class: 'pos' }, `0${i + 1}`.slice(-2)),
                h('span', { class: 'who' }, e.name || 'Anonymous'),
                h('span', { class: 'pts' }, e.score.toLocaleString())
              )))
          : h('p', { class: 'lb-empty' }, 'No runs on this device yet. The leaderboard is per device — two tablets at the same stand keep separate boards.'),
        metrics.plays > 0
          ? h('p', { class: 'label', style: { marginTop: '10px' } }, `${metrics.plays} PLAYS · ${metrics.completions} COMPLETED`)
          : null
      ),
      h('div', { class: 'mini', style: { textAlign: 'center' } },
        h('h3', { style: { textAlign: 'left' } }, 'NOT PLAYING?'),
        qrBlock(CONFIG.landingUrl),
        h('p', { style: { fontSize: '12px', color: 'var(--dim)', marginTop: '8px' } },
          'Scan to read how the three pillars work together.')
      )
    ),

    h('div', { class: 'foot' },
      h('span', null, `THREAT RESPONSE ${VERSION.toUpperCase()}`),
      h('button', {
        class: 'btn sm ghost', type: 'button',
        onclick: () => app.openStats(),
      }, icon('chart', ''), 'Stats'),
      h('span', null, 'MITRE ATT&CK technique IDs and tactic names are used as published.')
    )
  );

  mount(node);
  return node;
}

/* The QR is generated in-file. If a payload ever gets long enough to
 * exceed the encoder, say so on screen rather than rendering nothing —
 * silence at a stand looks like a broken tablet. */
function qrBlock(url) {
  try {
    const svg = qrSvg(url, { size: 132 });
    svg.setAttribute('aria-label', 'QR code linking to n-able.com');
    return h('div', { class: 'qr-box' }, svg, h('div', { class: 'qr-cap' }, 'N-ABLE.COM'));
  } catch {
    return h('p', { style: { fontSize: '12px', color: 'var(--amber-b)' } }, url);
  }
}
