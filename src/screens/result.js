/* The result screen.
 *
 * Three things have to come off this screen: the score, the gap, and
 * something the player can take away. The gap is the one that matters
 * commercially — it turns a number into an opener that needs no script
 * training, and it now names the technique the player actually lost to
 * rather than a category.
 *
 * The confirmation copy after a lead is submitted says only what the code
 * does. Earlier builds said the scorecard was "on its way to your inbox"
 * while no mail path existed anywhere in the file, which is the one bug a
 * prospect experiences personally.
 */

import { h, mount, announce } from '../ui/dom.js';
import { qrSvg } from '../ui/qr.js';
import { icon } from '../ui/icons.js';
import { CONFIG, VERSION } from '../config.js';
import { Store, validEmail, normalizeEmail, post } from '../store.js';
import { DEF } from '../engine/pillars.js';
import { OUTCOME_LABEL, OUTCOME_TONE, DEFENSE_CAP, ZONES } from '../engine/scoring.js';
import { countTo } from '../render/fx.js';

const ZONE_TONE = { Resilient: 'green', Prepared: 'blue', Exposed: 'amber', Fragile: 'red' };
const TONE = { manage: 'blue', secure: 'violet', recover: 'green' };

/* The dial's bands, derived from the engine's own thresholds rather than
 * restated here. ZONES is ordered highest-first, so this reverses it and
 * pairs each floor with the next one up. Restating the numbers would have
 * been three lines shorter and one edit away from a dial that disagrees
 * with the verdict printed next to it. */
const ZONE_BANDS = [...ZONES].reverse().map((z, i, all) => ({
  zone: z.zone,
  from: z.min,
  to: all[i + 1]?.min ?? 100,
  tone: ZONE_TONE[z.zone] || 'brand',
}));

export function renderResult(app, summary) {
  const s = summary;
  const zoneTone = ZONE_TONE[s.zone.zone] || 'brand';

  /* ------------------------------------------------------------ the dial
   *
   * The strongest single visual in the build, and the only animated number
   * in it. What makes it a diagnostic rather than a progress bar is the
   * band ring outside the value: 62 on its own is a number, 62 sitting
   * two points inside Prepared with Resilient starting at 78 is a finding.
   * The band the run landed in is drawn at full strength and the other
   * three at a quarter, so the answer to "how did I do" survives being
   * read across a stand, printed in greyscale, or shrunk into a deck.
   */

  const C = 130;          // centre, in viewBox units
  const R = 104;          // value ring
  const RB = 122;         // band ring, outside the value
  const CIRC = 2 * Math.PI * R;
  /* Fractions run clockwise from 12 o'clock because the whole svg is
   * rotated -90deg, which is also what lets the value ring use the
   * dasharray trick and animate with one property. */
  const pointAt = (frac, r) => {
    const t = frac * 2 * Math.PI;
    return [C + r * Math.cos(t), C + r * Math.sin(t)];
  };
  const arc = (from, to, r) => {
    const [x0, y0] = pointAt(from / 100, r);
    const [x1, y1] = pointAt(to / 100, r);
    return `M ${x0} ${y0} A ${r} ${r} 0 ${to - from > 50 ? 1 : 0} 1 ${x1} ${y1}`;
  };

  const bands = ZONE_BANDS.map((b) =>
    h('path', {
      class: `band t-${b.tone}${b.zone === s.zone.zone ? ' on' : ''}`,
      /* A hair of padding at each end so four bands read as four and not
       * as one ring with colour changes. */
      d: arc(b.from + 0.6, b.to - 0.6, RB),
    })
  );
  const ticks = ZONE_BANDS.slice(1).map((b) => {
    const [x0, y0] = pointAt(b.from / 100, R + 8);
    const [x1, y1] = pointAt(b.from / 100, RB + 7);
    return h('line', { class: 'tick', x1: x0, y1: y0, x2: x1, y2: y1 });
  });

  const ring = h('circle', {
    class: 'ring-fg', cx: C, cy: C, r: R,
    'stroke-dasharray': CIRC, 'stroke-dashoffset': CIRC,
  });
  const num = h('div', { class: 'dial-num mono' }, '0');
  const dial = h('div', { class: `dial t-${zoneTone}` },
    h('svg', { viewBox: '0 0 260 260', 'aria-hidden': 'true' },
      ...bands,
      ...ticks,
      h('circle', { class: 'ring-bg', cx: C, cy: C, r: R }),
      ring
    ),
    h('div', { class: 'dial-mid' },
      num,
      h('div', { class: 'dial-zone' }, s.zone.zone),
      h('div', { class: 'dial-cap' }, 'Business resilience index')
    )
  );

  /* The scale, spelled out under the dial. The bands say which quarter;
   * this says where the lines are, which is the question anyone two points
   * off a better verdict is about to ask. */
  const scale = h('div', { class: 'dial-scale' },
    ...ZONE_BANDS.map((b) =>
      h('span', { class: `ds t-${b.tone}${b.zone === s.zone.zone ? ' on' : ''}` },
        h('b', { class: 'mono' }, String(b.from)), b.zone)
    )
  );

  /* --------------------------------------------------------- rank + gap */

  const toNext = s.next
    ? `You are ${s.next.gap} defense point${s.next.gap === 1 ? '' : 's'} off ${s.next.name}.`
    : 'Nothing above this. Five stages held and the estate intact.';

  /* The rank is a strip, not a headline.
   *
   * It led this screen through v13, and it is the least diagnostic thing
   * on it: it is one integer between 0 and 10 with a name attached, and a
   * name is the one part of a result nobody can act on. What the player
   * came for is the index and what they got wrong, so those go first and
   * this sits under them as the leaderboard line it actually is. */
  const rankStrip = h('section', { class: 'rank-strip' },
    h('div', { class: 'rs-id' },
      h('span', { class: 'label' }, 'RANK'),
      h('h2', null, s.rank.name),
      h('p', { class: 'rank-blurb' }, s.rank.blurb)
    ),
    h('div', { class: 'rs-nums' },
      h('div', { class: 'rank-row' },
        h('span', { class: 'chip t-brand' }, `${s.score.toLocaleString()} PTS`),
        h('span', { class: `chip t-${zoneTone}` }, `${s.defense}/${DEFENSE_CAP} DEFENSE POINTS`),
        s.mode === 'learn' ? h('span', { class: 'chip t-amber' }, 'LEARN MODE') : null
      ),
      h('div', { class: 'rank-prog' },
        h('div', { class: 'bar' }, h('i', { style: { width: `${(s.defense / DEFENSE_CAP) * 100}%` } })),
        h('p', { class: 'note' }, toNext)
      )
    )
  );

  const businessLine =
    s.business === 'closed' ? s.client.closed
    : s.business === 'wounded' ? `${s.client.name} is still trading. It is not the same business it was on Monday.`
    : s.client.survived;

  const verdict = h('section', { class: `verdict t-${zoneTone}` },
    h('div', { class: 'v-zone' }, `${s.zone.zone} · ${s.client.name}`),
    h('div', { class: 'v-line' }, s.zone.verdict),
    h('p', { class: 'v-business' }, businessLine),
    s.zone.cappedBy ? h('p', { class: 'v-capped' }, s.zone.cappedBy) : null
  );

  /* The gap, and it is the point of the screen.
   *
   * Everything else here is a number the player already watched happen.
   * This is the only part that says something they did not know, and it
   * is the only part booth staff can open on without a script — so it is
   * the second thing on the page rather than a panel below the rank, and
   * it names the phase it is talking about instead of leaving the reader
   * to infer it. */
  const gap = h('section', { class: 'gap' },
    h('div', { class: 'g-top' },
      h('span', { class: 'label' }, 'WHERE IT WENT WRONG'),
      h('span', { class: 'chip t-brand' },
        s.gap.key === 'clean' ? 'NOTHING GOT THROUGH' : `WEAKEST PHASE · ${String(s.gap.label).toUpperCase()}`)
    ),
    h('h2', null, s.gap.title),
    h('p', { class: 'g-body' }, s.gap.body),
    h('p', { class: 'g-detail' }, s.gap.detail),
    h('div', { class: 'g-opener' },
      h('span', { class: 'label' }, 'ASK US'),
      h('span', null, s.gap.opener)
    )
  );

  /* --------------------------------------------------------- stage recap */

  const recap = h('section', { class: 'recap' },
    ...s.rounds.map((r) =>
      h('div', { class: `rc t-${OUTCOME_TONE[r.outcome]}` },
        h('div', { class: 'rc-n mono' }, String(r.stage)),
        h('div', { class: 'rc-mid' },
          h('div', { class: 'rc-tech' }, `${r.tech} · ${r.ta}`),
          h('div', { class: 'rc-name' }, r.name),
          h('div', { class: 'rc-picks' },
            r.lead
              ? `${DEF[r.lead].name} → ${r.backup ? DEF[r.backup].name : 'no backup'}${r.backupRight ? ' ✓' : ''}`
              : 'no decision')
        ),
        h('div', { class: 'rc-out' }, r.outcome === 'perfect' ? 'PERFECT STACK' : OUTCOME_LABEL[r.outcome])
      )
    )
  );

  /* ------------------------------------------- what you built, and lost */

  const built = h('div', { class: 'card' },
    h('h3', null, 'WHAT YOU BUILT BEFORE THE ATTACK'),
    s.posture.length
      ? h('ul', { class: 'built' }, ...s.posture.map((c) =>
          h('li', { class: `t-${TONE[c.pillar]}` }, h('b', null, `${c.name} · ${c.product}`), c.recap)))
      : h('p', { class: 'built-empty' },
          'Nothing. You went into this with three unspent readiness points, which means every layer you reached for during the attack was the first one that existed.'),
    s.pillarsUsed.length === 1
      ? h('p', { class: 'built-empty', style: { marginTop: '10px' } },
          `Everything you invested went into ${DEF[s.pillarsUsed[0]].name}. That is the shape of estate BlackVault looks for.`)
      : null
  );

  const finalEstate = h('div', { class: 'card' },
    h('h3', null, 'THE ESTATE, THIS MORNING'),
    h('div', { class: 'final-estate' },
      ...app.data.estate.systems.map((sys) => {
        const v = s.estate[sys.id];
        const cls = v === 2 ? 'ok' : v === 1 ? 'degraded' : 'lost';
        return h('div', { class: `fe ${cls}` },
          h('div', null,
            h('span', { class: 'fe-n' }, sys.name),
            v === 0 ? h('span', { class: 'fe-loss' }, sys.loss) : null
          ),
          h('span', { class: 'fe-s' }, v === 2 ? 'OK' : v === 1 ? 'DEGRADED' : 'LOST')
        );
      })
    )
  );

  /* ---------------------------------------------------------- scorecard */

  const scoreUrl = buildScoreUrl(s);
  const scorecard = h('section', { class: 'scorecard' },
    h('div', null,
      h('span', { class: 'label', style: { display: 'block', marginBottom: '7px' } }, 'YOUR SCORECARD'),
      h('p', { style: { fontSize: '14px', color: 'var(--dim)', marginBottom: '10px' } },
        'Scan to keep this result, or note the run code and someone else can play the identical five stages.'),
      h('div', { class: 'run-share' },
        h('span', { class: 'label' }, 'RUN CODE'),
        h('span', { class: 'seed-code' }, s.seedCode),
        h('button', {
          class: 'btn sm ghost', type: 'button',
          onclick(ev) {
            app.audio.tap();
            copyText(runLink(s), ev.currentTarget, 'Copy link');
          },
        }, 'Copy link'),
        h('p', { class: 'run-share-note' },
          'Anyone who types that code on the start screen plays the identical five stages.')
      ),
      leadForm(app, s)
    ),
    qrBlock(scoreUrl, s.seedCode)
  );

  /* --------------------------------------------------------- sticky bar */

  /* Two buttons, one row, and the note is NOT in the bar.
   *
   * With the note inside the flex row it became a third item, wrapped to
   * its own line, and at 375px the two buttons then stacked full-width —
   * a 150px sticky bar covering the verdict on a 667px screen. The note
   * is footer text, so it lives in the footer. */
  const sticky = h('div', { class: 'sticky' },
    h('button', {
      class: 'btn primary', type: 'button',
      onclick() {
        app.audio.tap();
        app.replay();
      },
    }, icon('restart', ''), 'Play again', h('span', { class: 'kbd' }, 'R')),
    h('button', {
      class: 'btn ghost', type: 'button',
      onclick(ev) {
        app.audio.tap();
        copyReport(s, ev.currentTarget);
      },
    }, 'Copy ', h('span', { class: 'wide-only' }, 'incident '), 'report')
  );

  const runNote = h('p', { class: 'cta-note' },
    `THREAT RESPONSE ${VERSION.toUpperCase()} · RUN ${s.seedCode} · MITRE ATT&CK IDS AS PUBLISHED`);

  const node = h('main', { class: 'screen' },
    h('div', { class: 'result-hero' },
      h('div', { class: 'hero-dial' }, dial, scale),
      verdict
    ),
    gap,
    rankStrip,
    h('span', { class: 'label', style: { display: 'block', margin: '4px 0 9px' } }, 'STAGE BY STAGE'),
    recap,
    h('div', { class: 'two-col' }, built, finalEstate),
    scorecard,
    runNote,
    sticky
  );

  mount(node);

  /* Animate the one number the whole run was building toward. */
  requestAnimationFrame(() => {
    ring.style.strokeDashoffset = String(CIRC * (1 - s.index / 100));
    countTo(num, s.index, { ms: 1200 });
  });
  app.audio.reveal();
  announce(`${s.rank.name}. Business Resilience Index ${s.index}, ${s.zone.zone}. ${s.zone.verdict}. ${s.gap.title}. ${businessLine}`);

  return node;
}

/* ---------------------------------------------------------------- pieces */

function qrBlock(url, seed) {
  try {
    const svg = qrSvg(url, { size: 168 });
    svg.setAttribute('aria-label', `QR code for run ${seed}`);
    return h('div', { class: 'qr-box' }, svg, h('div', { class: 'qr-cap' }, `RUN ${seed}`));
  } catch {
    /* The encoder tops out at 213 bytes. Say so rather than rendering an
     * empty box that looks like a broken tablet. */
    return h('div', { class: 'qr-box' },
      h('p', { style: { fontSize: '12px', color: 'var(--amber-b)', maxWidth: '160px' } },
        'Scorecard link too long to encode. Note the run code instead.'));
  }
}

/* The QR payload. Short on purpose: it has to survive being scanned off a
 * tablet at an angle, and a shorter payload is a lower QR version with
 * bigger modules. */
function buildScoreUrl(s) {
  const p = new URLSearchParams({
    tr: VERSION,
    s: s.seedCode,
    i: String(s.index),
    d: String(s.defense),
    z: s.zone.zone,
    r: s.rank.name,
    c: s.client.id,
    g: s.gap.key,
  });
  if (CONFIG.kioskId) p.set('k', CONFIG.kioskId);
  const base = CONFIG.landingUrl.replace(/\/+$/, '');
  return `${base}?${p.toString()}`;
}

function leadForm(app, s) {
  const name = h('input', { type: 'text', id: 'ld-name', autocomplete: 'name', maxlength: '80' });
  const email = h('input', { type: 'email', id: 'ld-email', autocomplete: 'email', inputmode: 'email', maxlength: '120' });
  const err = h('div', { class: 'err', role: 'alert' }, '');
  const consent = h('input', { type: 'checkbox', id: 'ld-consent' });
  let role = null;

  const roleBtns = [
    ['msp', 'My clients (MSP)'],
    ['internal', 'Internal IT'],
  ].map(([key, label]) =>
    h('button', {
      class: '', type: 'button', 'aria-pressed': 'false',
      onclick(ev) {
        role = key;
        app.audio.tap();
        for (const b of ev.currentTarget.parentElement.children) b.setAttribute('aria-pressed', 'false');
        ev.currentTarget.setAttribute('aria-pressed', 'true');
      },
    }, label)
  );

  const wrap = h('div', null);

  const submit = h('button', {
    class: 'btn primary', type: 'submit',
  }, 'Save my scorecard');

  const form = h('form', {
    onsubmit(ev) {
      ev.preventDefault();
      if (!name.value.trim()) {
        err.textContent = 'A name, so booth staff know who to talk to.';
        name.focus();
        return;
      }
      if (!validEmail(email.value)) {
        err.textContent = 'That email address does not look complete.';
        email.focus();
        return;
      }
      if (!consent.checked) {
        err.textContent = 'Nothing is captured without consent.';
        consent.focus();
        return;
      }
      err.textContent = '';

      const fixed = normalizeEmail(email.value);
      const record = Store.addLead({
        name: name.value.trim(),
        email: fixed,
        role: role || 'unspecified',
        client: s.client.id,
        gap: s.gap.key,
        score: s.score,
        resilience: s.index,
        zone: s.zone.zone,
        rank: s.rank.name,
        seed: s.seedCode,
        consent: true,
      });
      Store.bump('leads');
      Store.nameScore(s.seedCode, name.value);
      post('lead', record);
      app.audio.contained();

      /* Says only what the code does. CONFIG.emailFulfillment is false
       * until an endpoint actually sends something, and the copy switches
       * with it rather than being edited by hand. */
      wrap.replaceChildren(
        h('div', { class: 'sent' },
          CONFIG.emailFulfillment
            ? h('span', null, 'On its way to ', h('b', null, fixed), '.')
            : h('span', null,
                'Saved on this device against ', h('b', null, fixed),
                '. Booth staff will export it and follow up — nothing has been emailed to you yet.'),
          fixed !== email.value.trim().toLowerCase()
            ? h('p', { style: { marginTop: '7px', fontSize: '12.5px', color: 'var(--dim)' } },
                `Corrected from ${email.value.trim()}. Tell us if that is wrong.`)
            : null
        )
      );
      announce('Scorecard saved on this device.');
    },
  },
    h('span', { class: 'label', style: { display: 'block', marginBottom: '9px' } }, 'KEEP YOUR RESULT'),
    h('div', { class: 'field' }, h('label', { for: 'ld-name' }, 'Name'), name),
    h('div', { class: 'field' }, h('label', { for: 'ld-email' }, 'Work email'), email),
    h('span', { class: 'label', style: { display: 'block', marginBottom: '7px' } }, 'WHO DO YOU LOOK AFTER?'),
    h('div', { class: 'role-row' }, ...roleBtns),
    h('label', { class: 'consent', for: 'ld-consent' },
      consent,
      h('span', null,
        'N-able can contact me about this result and about business resilience. ',
        h('a', { href: CONFIG.privacyUrl, target: '_blank', rel: 'noopener noreferrer' }, 'Privacy notice'),
        '.')
    ),
    err,
    submit
  );

  wrap.append(form);
  form.addEventListener('focusin', () => Store.bump('formOpens'), { once: true });
  return wrap;
}

/* The takeaway. Nothing left the screen in earlier builds — this is the
 * artifact a prospect keeps, and it is plain text on purpose so it
 * survives being pasted into a ticket, an email or a CRM note. */
export function incidentReport(s) {
  const line = (k, v) => `${k.padEnd(22)}${v}`;
  const out = [
    'N-ABLE THREAT RESPONSE — INCIDENT REPORT',
    '='.repeat(52),
    '',
    line('Business', `${s.client.name} — ${s.client.profile}`),
    line('Years trading', String(s.client.years)),
    line('Run code', s.seedCode),
    line('Mode', s.mode === 'learn' ? 'Learn (no timer)' : 'Timed'),
    '',
    line('Resilience index', `${s.index}/100 — ${s.zone.zone}`),
    line('Verdict', s.zone.verdict),
    line('Rank', `${s.rank.name} (${s.defense}/${DEFENSE_CAP} defense points)`),
    line('Score', s.score.toLocaleString()),
    '',
    'BUILT BEFORE THE ATTACK',
    '-'.repeat(52),
    ...(s.posture.length
      ? s.posture.map((c) => `  ${c.name} — ${c.product}`)
      : ['  Nothing. Three readiness points went unspent.']),
    '',
    'STAGE BY STAGE',
    '-'.repeat(52),
    ...s.rounds.map((r) =>
      `  ${r.stage}. ${r.tech} ${r.name}\n     ${r.ta}\n     ${r.lead ? `${DEF[r.lead].name} → ${r.backup ? DEF[r.backup].name : 'no backup'}` : 'no decision'} — ${r.outcome === 'perfect' ? 'PERFECT STACK' : OUTCOME_LABEL[r.outcome].toUpperCase()}`),
    '',
    'THE ESTATE',
    '-'.repeat(52),
    ...Object.entries(s.estate).map(([k, v]) => `  ${k.padEnd(12)}${v === 2 ? 'operational' : v === 1 ? 'degraded' : 'LOST'}`),
    '',
    'THE GAP',
    '-'.repeat(52),
    `  ${s.gap.title}`,
    `  ${s.gap.detail}`,
    `  ${s.gap.opener}`,
    '',
    `  ${s.business === 'closed' ? s.client.closed : s.business === 'wounded' ? `${s.client.name} is still trading, at cost.` : s.client.survived}`,
    '',
    '-'.repeat(52),
    `Threat Response ${VERSION}. MITRE ATT&CK technique IDs and tactic`,
    'names are used as published. No figure in this report is estimated.',
  ];
  return out.join('\n');
}

/* A link back to this exact run. On file:// it is the path to the file
 * plus the run code, which works for anyone who has the same file — which
 * at an event is everyone, because the file is what got handed out. */
function runLink(s) {
  return `${location.href.split('#')[0]}#${s.seedCode}`;
}

/* Clipboard, with the fallback that matters here: writeText is blocked on
 * file:// in some browsers, and file:// is exactly where this build is
 * opened. Short strings fall back to a select-and-prompt so something
 * still reaches the player. */
async function copyText(text, btn, label) {
  const restore = label ?? btn.textContent;
  try {
    await navigator.clipboard.writeText(text);
    btn.replaceChildren('Copied');
  } catch {
    btn.replaceChildren(text.length > 60 ? 'Could not copy' : text);
  }
  setTimeout(() => btn.replaceChildren(restore), 2400);
}

async function copyReport(s, btn) {
  const text = incidentReport(s);
  const label = btn.textContent;
  try {
    await navigator.clipboard.writeText(text);
    btn.replaceChildren('Copied to clipboard');
  } catch {
    /* Clipboard is blocked on file:// in some browsers, which is exactly
     * where this file gets opened. Fall back to a download rather than
     * failing silently. */
    try {
      const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
      const a = h('a', { href: url, download: `threat-response-${s.seedCode}.txt` });
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      btn.replaceChildren('Downloaded');
    } catch {
      btn.replaceChildren('Could not copy');
    }
  }
  setTimeout(() => btn.replaceChildren(label), 2200);
}
