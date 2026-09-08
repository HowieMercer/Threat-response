/* The stage screen. Built once, updated per stage.
 *
 * Rebuilding this on every stage would throw away the estate map's
 * transition state, which is the thing that makes a system falling feel
 * like a loss rather than a re-render. So the screen is constructed when
 * the attack begins and then only ever updated.
 *
 * Order of feedback on resolution is deliberate and is the main reason
 * this reads as a game: the estate updates, then delta chips fire, then
 * the attacker says something, and only then does the prose explaining
 * why appear. Consequence first, explanation second. The other order is a
 * quiz with animation on it.
 */

import { h, mount, announce } from '../ui/dom.js';
import { createHud, createTrack, createEstate, createComms, createPillars, toneFor } from '../ui/board.js';
import { DEF } from '../engine/pillars.js';
import { rightBackupFor } from '../engine/resolve.js';
import { OUTCOME_LABEL } from '../engine/scoring.js';
import { SCAN_COST, HOLD_COST, CAPACITY_MAX, PHASE } from '../engine/game.js';
import { shake, flash, vignette, burst, deltaChips, type } from '../render/fx.js';

export function createStageScreen(app) {
  const { game, data } = app;

  const hud = createHud({
    client: game.state.client,
    muted: app.audio.settings.muted,
    onSound: () => app.toggleSound(),
    onHelp: () => app.openHelp(),
  });
  const track = createTrack();
  const estate = createEstate(data.estate.systems);
  const comms = createComms(game.state.client.name);
  const pillars = createPillars({ onPick: (key) => pick(key) });

  /* ---------------------------------------------------------- threat card */

  const techChip = h('span', { class: 'chip t-red' }, '');
  const tacticChip = h('span', { class: 'chip t-brand' }, '');
  const stageChip = h('span', { class: 'chip t-violet' }, '');
  /* Rendered in both the HUD and the threat card; CSS shows exactly one.
   * Cheaper than listening for resizes to move a node between parents. */
  const threatChip = h('span', { class: 'threat-level t-amber' }, '');
  const threatTitle = h('h2', null, '');
  const threatDesc = h('p', null, '');
  const threatCard = h('section', { class: 'threat' },
    h('div', { class: 'threat-top' }, stageChip, techChip, tacticChip, threatChip),
    threatTitle,
    threatDesc
  );

  /* ------------------------------------------------------------- ops row */

  const capPips = h('div', { class: 'cap-pips' }, ...Array.from({ length: CAPACITY_MAX }, () => h('i')));
  const scanBtn = h('button', {
    class: 'ops-btn', type: 'button', title: 'Reveal the weakest layer (S)',
    onclick: () => doScan(),
  }, 'Scan', h('span', { class: 'cost' }, `${SCAN_COST}`));
  const holdBtn = h('button', {
    class: 'ops-btn', type: 'button', title: 'Isolate a segment and take ground back (H)',
    onclick: () => doHold(),
  }, 'Isolate', h('span', { class: 'cost' }, `${HOLD_COST}`));

  const opsRow = h('div', { class: 'ops' },
    h('div', { class: 'cap' },
      h('span', { class: 'label' }, h('span', { class: 'wide-only' }, 'Response '), 'capacity'),
      capPips),
    scanBtn,
    holdBtn
  );

  /* --------------------------------------------------------- picks + slots */

  const slotDots = h('div', { class: 'slot-dots' }, h('i'), h('i'));
  const picksLabel = h('div', { class: 'picks-label' },
    h('span', { class: 'label' }, 'Lead defense'),
    slotDots
  );

  const pickArea = h('section', { class: 'pick-area' }, picksLabel, pillars.el);
  const resolveArea = h('section', { class: 'resolve', hidden: true });

  /* Flat grid children with named areas rather than nested wrappers.
   *
   * The layout has to reorder, not just reflow. On a 375x667 phone the
   * three pillar cards have to sit above the fold — the intrusion track is
   * advancing while the player scrolls — so the optional scan/isolate row
   * moves below them. On a landscape phone the threat and the cards go
   * side by side instead. Neither is expressible by reflowing a nested
   * flex column, and both are two lines of grid-template-areas. */
  const board = h('div', { class: 'board' }, threatCard, opsRow, pickArea, resolveArea, comms.el);

  const node = h('main', { class: 'screen' },
    hud.el,
    track.el,
    estate.el,
    board
  );

  /* --------------------------------------------------------------- state */

  let injectEl = null;
  let injectBar = null;
  let raf = null;
  let lastFrame = 0;
  let commsTimer = null;
  let resolving = false;

  /* ----------------------------------------------------------- the loop */

  function loop(t) {
    /* Clamped, and reset to zero while paused. Without the clamp a
     * backgrounded tab returns with a multi-second delta and the attacker
     * teleports across the track; without the pause, opening the rules
     * mid-stage costs you the stage. */
    const dt = app.paused ? 0 : Math.min(50, t - lastFrame || 16);
    lastFrame = t;

    if (game.state.phase === PHASE.STAGE) game.tick(dt);
    drain();

    const s = game.state;
    if (s.phase === PHASE.STAGE || s.phase === PHASE.RESOLVE) {
      const remaining = s.mode === 'learn' ? 0 : ((100 - s.depth) / Math.max(0.0001, s.rate));
      track.update(s.depth, remaining, s.mode);
      app.field.setDepth(s.depth);
      app.audio.setDepth(s.depth);
      const band = game.threatBand();
      vignette(band);
      app.field.setMood(band === 'calm' ? 'calm' : band === 'alert' ? 'alert' : 'crit');
      if (injectBar && s.inject) {
        injectBar.style.transform = `scaleX(${Math.max(0, s.inject.remaining / s.inject.total)})`;
      }
    }

    raf = requestAnimationFrame(loop);
  }

  /* Engine events are drained here and nowhere else, so every animation
   * has one trigger point and the engine never needs to know one exists. */
  function drain() {
    for (const ev of game.drain()) {
      switch (ev.type) {
        case 'stage':
          break;
        case 'scan':
          pillars.reveal({ weak: ev.weak, best: ev.best });
          app.audio.scan();
          announce(ev.best
            ? `Scan complete. Weakest layer is ${DEF[ev.weak].name}. Strongest is ${DEF[ev.best].name}.`
            : `Scan complete. Weakest layer is ${DEF[ev.weak].name}.`);
          refreshOps();
          break;
        case 'hold':
          app.audio.hold();
          announce('Segment isolated. Ground taken back.');
          refreshOps();
          break;
        case 'blocked':
          announce(ev.reason);
          app.audio.injectMiss();
          break;
        case 'lead':
          app.audio.lead();
          picksLabel.firstChild.textContent = 'Backup layer — different pillar';
          slotDots.children[0].classList.add('on');
          pillars.setSlots(game.state.lead, null);
          announce(`${DEF[ev.key].name} set as lead. Now choose a backup from a different pillar.`);
          break;
        case 'backup':
          app.audio.backup();
          slotDots.children[1].classList.add('on');
          break;
        case 'inject':
          showInject(ev.inject);
          break;
        case 'injectResult':
          closeInject();
          app.audio[ev.hit ? 'injectHit' : 'injectMiss']();
          comms.push({ from: 'Response', text: ev.text, band: ev.hit ? 'rising' : 'critical' });
          if (!ev.hit) shake();
          announce(ev.text);
          break;
        case 'resolved':
          showResolve(ev.round);
          break;
        default:
          break;
      }
    }
  }

  /* -------------------------------------------------------------- actions */

  function pick(key) {
    if (resolving) return;
    game.choose(key);
    drain();
  }
  function doScan() {
    if (resolving) return;
    game.scan();
    drain();
  }
  function doHold() {
    if (resolving) return;
    game.hold();
    drain();
  }

  function refreshOps() {
    const s = game.state;
    [...capPips.children].forEach((p, i) => p.classList.toggle('spent', i >= s.capacity));
    capPips.parentElement.setAttribute('aria-label', `${s.capacity} response capacity remaining`);

    const freeScan = s.posture.has('soc-watch') && !s.freeScanUsed;
    scanBtn.classList.toggle('free', freeScan);
    scanBtn.querySelector('.cost').textContent = freeScan ? 'FREE' : String(SCAN_COST);
    scanBtn.disabled = s.revealed.weak || (!freeScan && s.capacity < SCAN_COST);
    holdBtn.disabled = s.capacity < HOLD_COST || s.mode === 'learn';
    holdBtn.title = s.mode === 'learn' ? 'No timer in learn mode — nothing to take back' : 'Isolate a segment and take ground back (H)';
  }

  /* --------------------------------------------------------------- inject
   *
   * The one moment the game asks for a reflex rather than a decision. It
   * exists to break the pick-pick rhythm — five identical turns is a
   * questionnaire however good the writing is. Kept rare, always fair,
   * always survivable if missed.
   */
  function showInject(inject) {
    closeInject();
    app.audio.alarm();
    injectBar = h('i');
    const act = h('button', {
      class: 'btn', type: 'button', 'data-autofocus': '',
      onclick() {
        game.resolveInject(true);
        drain();
      },
    }, inject.action, h('span', { class: 'kbd' }, 'SPACE'));

    injectEl = h('div', { class: 'inject', role: 'alertdialog', 'aria-label': 'Live inject' },
      h('div', { class: 'inject-label' }, h('strong', null, 'LIVE — '), inject.label),
      h('div', { class: 'inject-row' }, act),
      game.state.mode === 'learn' ? null : h('div', { class: 'inject-bar' }, injectBar)
    );
    document.body.appendChild(injectEl);
    act.focus({ preventScroll: true });
    announce(`Live inject. ${inject.label}. ${inject.action}.`);
  }

  function closeInject() {
    if (injectEl) injectEl.remove();
    injectEl = null;
    injectBar = null;
  }

  /* --------------------------------------------------------- stage entry */

  function enterStage() {
    resolving = false;
    closeInject();
    const s = game.state;
    const v = s.variant;

    hud.setStage(s.stageIndex, s.rounds, v.threat);
    threatChip.textContent = v.threat.toUpperCase();
    threatChip.className = `threat-level ${
      v.threat === 'Severe' || v.threat === 'Critical' ? 't-red' : 't-amber'
    }`;
    stageChip.textContent = `STAGE ${s.stageIndex + 1}/5 · ${v.stageName.toUpperCase()}`;
    techChip.textContent = v.tech;
    tacticChip.textContent = v.ta;
    threatTitle.textContent = v.name;
    threatDesc.textContent = v.desc;
    threatCard.classList.remove('enter');
    void threatCard.offsetWidth;
    threatCard.classList.add('enter');

    pillars.setActions(v);
    pillars.setSlots(null, null);
    picksLabel.firstChild.textContent = 'Lead defense';
    slotDots.children[0].classList.remove('on');
    slotDots.children[1].classList.remove('on');
    pickArea.hidden = false;
    resolveArea.hidden = true;
    resolveArea.replaceChildren();
    board.classList.remove('resolving');

    estate.update(s.estate, v.target);
    refreshOps();

    /* One inbound message per stage, on a delay, so it arrives while the
     * player is deciding rather than as part of the page. */
    clearTimeout(commsTimer);
    commsTimer = setTimeout(() => {
      if (game.state.phase === PHASE.STAGE) comms.push(game.nextComms());
    }, 1500);

    announce(`Stage ${s.stageIndex + 1} of 5. ${v.tech}, ${v.ta}. ${v.name}. ${v.desc}`);
  }

  /* ------------------------------------------------------------ resolve */

  async function showResolve(round) {
    resolving = true;
    clearTimeout(commsTimer);
    closeInject();
    pillars.lock();

    const tone = toneFor(round.outcome);

    // 1. The estate moves first. The consequence is the thing you see.
    estate.update(round.estate, null);
    for (const c of round.changes) {
      const cell = estate.cellFor(c.system);
      if (c.kind === 'restore') {
        estate.mark(c.system, 'saved');
        burst(cell, 'green', 12);
      } else {
        estate.mark(c.system, 'hit');
        burst(cell, c.kind === 'loss' ? 'red' : 'amber', c.kind === 'loss' ? 18 : 10);
      }
    }

    // 2. Sound and screen react.
    if (round.outcome === 'perfect') {
      app.audio.perfect();
      flash('green');
      app.field.setMood('won');
    } else if (round.outcome === 'contained') {
      app.audio.contained();
      flash('green');
    } else if (round.outcome === 'breached') {
      app.audio.breach();
      flash('red');
      shake(true);
    } else {
      app.audio.mitigated();
      shake();
    }

    // 3. Delta chips.
    pickArea.hidden = true;
    resolveArea.hidden = false;
    board.classList.add('resolving');
    const deltas = h('div', { class: 'deltas' });
    resolveArea.replaceChildren(deltas);
    deltaChips(deltas, chipsFor(round));

    const label = OUTCOME_LABEL[round.outcome];
    announce(`${label}. ${round.fb || 'No decision was made in time.'}`);

    // 4. The attacker, typed out.
    const foeSaid = h('span', { class: 'said' });
    const foe = h('div', { class: 'foe-line' }, h('span', { class: 'who' }, 'BLACKVAULT'), foeSaid);

    const nextBtn = h('button', {
      class: 'btn primary', type: 'button', 'data-autofocus': '',
      onclick() {
        app.audio.tap();
        app.advance();
      },
    }, game.state.stageIndex >= 4 ? 'See the damage' : 'Next stage', h('span', { class: 'kbd' }, '↵'));

    const outcome = h('div', { class: `outcome t-${tone}` },
      h('div', { class: 'outcome-top' },
        h('h3', null, label),
        h('span', { class: 'chip t-red' }, round.tech),
        round.savedBy ? h('span', { class: 'chip t-violet' }, 'AUTOMATED ISOLATION HELD') : null,
        round.injectHit ? h('span', { class: 'chip t-green' }, 'INJECT CAUGHT') : null,
        round.timedOut && !round.lead ? h('span', { class: 'chip t-amber' }, 'NO DECISION') : null
      ),
      h('p', { class: 'why' }, round.fb || 'Nothing was committed before the attacker reached the estate. Indecision resolves as a breach.'),
      stackLine(round)
    );

    resolveArea.append(outcome, foe, h('div', { class: 'resolve-foot' }, nextBtn));

    // Chips land, then the taunt types, then the button is worth pressing.
    setTimeout(async () => {
      await type(foeSaid, round.foe, { cps: 46 });
      nextBtn.focus({ preventScroll: true });
    }, 420);
  }

  /* What the player actually built, and what the correct stack was.
   *
   * Naming the layer they should have backed with is the whole teaching
   * moment of the second pick — without it, a contained-but-not-perfect
   * stage is indistinguishable from a perfect one to anyone who is not
   * counting points. */
  function stackLine(round) {
    if (!round.lead) {
      return h('div', { class: 'stack' },
        h('span', { class: 'miss' }, 'No lead, no backup. The stage resolved without you.'));
    }
    const right = round.backupRight;
    const shouldHave = rightBackupFor({ rank: round.rank }, round.lead);
    return h('div', { class: 'stack' },
      h('span', null, `LED WITH ${DEF[round.lead].name.toUpperCase()}`),
      h('span', null, '·'),
      round.backup
        ? h('span', { class: right ? '' : 'miss' },
            `BACKED WITH ${DEF[round.backup].name.toUpperCase()}${right ? ' — CORRECT STACK' : ''}`)
        : h('span', { class: 'miss' }, 'NO BACKUP COMMITTED IN TIME'),
      !right && round.outcome !== 'breached'
        ? h('span', { class: 'miss' }, `· ${DEF[shouldHave].name.toUpperCase()} WAS THE STRONGER SECOND LAYER`)
        : null
    );
  }

  /* The chips. Points first because it is the fastest thing to read, then
   * what it cost, then what came back. */
  function chipsFor(round) {
    const chips = [];
    chips.push({
      value: round.points > 0 ? `+${round.points.toLocaleString()}` : '0',
      label: 'points',
      tone: round.points > 0 ? 'green' : 'red',
    });
    if (round.outcome !== 'breached') {
      const speed = Math.max(0, 100 - round.depthAtCommit);
      chips.push({ value: `${speed}%`, label: 'ground held', tone: speed > 55 ? 'green' : 'amber' });
    }
    for (const c of round.changes) {
      const name = data.estate.systems.find((s) => s.id === c.system)?.name ?? c.system;
      if (c.kind === 'restore') chips.push({ value: '↑', label: `${name} recovered`, tone: 'green' });
      else if (c.after <= 0) chips.push({ value: '✕', label: `${name} lost`, tone: 'red' });
      else if (c.delta < 0) chips.push({ value: '↓', label: `${name} degraded`, tone: 'amber' });
      else chips.push({ value: '■', label: `${name} held at the floor`, tone: 'amber' });
    }
    if (round.outcome === 'perfect' && !round.changes.some((c) => c.kind === 'restore')) {
      chips.push({ value: '✓', label: 'estate already intact — nothing to recover', tone: 'green' });
    }
    if (round.streak > 1) chips.push({ value: `×${round.streak}`, label: 'stages held in a row', tone: 'violet' });
    if (round.injectHit) chips.push({ value: '+', label: 'inject caught', tone: 'green' });
    return chips;
  }

  /* -------------------------------------------------------------- keys */

  function onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    if (game.state.inject && (e.key === ' ' || e.key === 'Enter')) {
      e.preventDefault();
      game.resolveInject(true);
      drain();
      return;
    }
    if (resolving) return;

    const map = { 1: 'manage', 2: 'secure', 3: 'recover' };
    if (map[e.key]) {
      e.preventDefault();
      pick(map[e.key]);
    } else if (e.key.toLowerCase() === 's') {
      e.preventDefault();
      doScan();
    } else if (e.key.toLowerCase() === 'h') {
      e.preventDefault();
      doHold();
    }
  }

  return {
    el: node,
    show() {
      mount(node, { focus: false });
      window.addEventListener('keydown', onKey);
      lastFrame = performance.now();
      if (!raf) raf = requestAnimationFrame(loop);
    },
    enterStage,
    pushFoe(text) {
      comms.push({ from: 'BLACKVAULT', text, band: 'critical', foe: true });
    },
    setMuted(m) {
      hud.setMuted(m);
    },
    stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      clearTimeout(commsTimer);
      closeInject();
      window.removeEventListener('keydown', onKey);
    },
  };
}
