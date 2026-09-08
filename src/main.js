/* Entry point. Wires the engine to the screens and owns nothing else.
 *
 * Anything resembling a game rule that appears in this file is a bug —
 * it belongs in src/engine/, where it can be played to completion in Node
 * with no browser and no DOM.
 */

import './styles/tokens.css';
import './styles/base.css';
import './styles/hud.css';
import './styles/stage.css';
import './styles/screens.css';
import './styles/result.css';

import { DATA } from './data/index.js';
import { createGame, PHASE } from './engine/game.js';
import { decodeSeed, randomSeed, encodeSeed } from './engine/rng.js';
import { rightBackupFor } from './engine/resolve.js';
import { createField } from './render/canvas.js';
import { createAudio } from './render/audio.js';
import { initFx, vignette } from './render/fx.js';
import { Theme, Escalation } from './render/theme.js';
import { Store, post } from './store.js';
import { h, mount, qs } from './ui/dom.js';
import { VERSION } from './config.js';

import { renderAttract } from './screens/attract.js';
import { renderBrief } from './screens/brief.js';
import { renderPosture } from './screens/posture.js';
import { createStageScreen } from './screens/stage.js';
import { renderClimax, renderImpact } from './screens/climax.js';
import { renderResult, incidentReport } from './screens/result.js';
import { openHelp, openStats } from './screens/overlays.js';

/* Theme before anything paints, so there is no flash of the wrong ground. */
Theme.init();
initFx();

const field = createField(qs('#bg'));
Theme.onChange(() => field.refresh());
const audio = createAudio();

/* A run is reproducible from its code, so #ABCDE plays the identical five
 * stages. Cheapest possible competitive feature for a stand: two people
 * can be given the same run and compared honestly. */
function seedFromUrl() {
  const raw = (location.hash || '').replace(/^#/, '').trim();
  return raw ? decodeSeed(raw) : null;
}

const settings = Store.settings;
let game = createGame({
  data: DATA,
  seed: seedFromUrl() ?? randomSeed(),
  mode: settings.mode === 'learn' ? 'learn' : 'timed',
});
if (settings.client) game.setClient(settings.client);
audio.setMuted(settings.muted);
audio.setVolume(settings.volume ?? 0.7);

let stageScreen = null;
let completed = false;
let started = false;

/* Two independent reasons the clock should not be running. Tracked
 * separately because either one clearing the other is a bug you only see
 * as "the timer kept going while I was reading the rules". */
let tabHidden = false;
let modalDepth = 0;

const app = {
  data: DATA,
  audio,
  field,

  /* Read by the stage loop every frame. */
  get paused() {
    return tabHidden || modalDepth > 0;
  },
  pushModal() {
    modalDepth += 1;
  },
  popModal() {
    modalDepth = Math.max(0, modalDepth - 1);
  },
  get game() {
    return game;
  },

  render() {
    switch (game.state.phase) {
      case PHASE.ATTRACT:
        Escalation.clear();
        vignette('calm');
        field.setMood('calm');
        field.setDepth(0);
        audio.setDepth(0);
        renderAttract(app);
        break;
      case PHASE.BRIEF:
        Escalation.clear();
        renderBrief(app);
        break;
      case PHASE.POSTURE:
        Escalation.clear();
        renderPosture(app);
        break;
      case PHASE.RESULT:
        /* The result screen is the artifact that gets screenshotted into a
         * deck. It sits at the calm end of the drift regardless of how the
         * run went — the score says what happened, the page does not need
         * to still be flushed red.
         *
         * All four have to be reset, not just the stage attribute. The
         * vignette, the particle field and the drone are driven from the
         * stage loop frame by frame and keep whatever state the loop left
         * them in when it stopped, so a run that ended at depth 96 handed
         * the result screen a red wash over every panel on it. Invisible
         * on v13's near-black ground and impossible to miss on this one. */
        Escalation.clear();
        vignette('calm');
        field.setMood('calm');
        field.setDepth(0);
        audio.setDepth(0);
        renderResult(app, game.summary());
        break;
      default:
        if (stageScreen) stageScreen.show();
        break;
    }
  },

  /* ------------------------------------------------------------- flow */

  start() {
    Store.saveSettings({ client: game.state.client.id, mode: game.state.mode });
    Store.bump('plays');
    post('play', { client: game.state.client.id, mode: game.state.mode, seed: game.state.seedCode });
    started = true;
    completed = false;
    audio.startBed();
    game.goBrief();
    app.render();
  },

  beginAttack() {
    game.begin();
    stageScreen = createStageScreen(app);
    stageScreen.show();
    stageScreen.enterStage();
    stageScreen.pushFoe(game.state.opener);
  },

  /* Called from the resolve panel's continue button. Stage five hands off
   * to the impact beat rather than straight to the numbers. */
  advance() {
    if (game.state.stageIndex >= 4) {
      finishRun();
      return;
    }
    game.nextStage();
    game.drain();
    if (game.state.phase === PHASE.CLIMAX) {
      renderClimax(app);
    } else {
      stageScreen.enterStage();
    }
  },

  enterClimaxStage() {
    game.climaxGo();
    game.drain();
    stageScreen.enterStage();
  },

  replay() {
    /* A fresh seed and a fresh readiness board, straight back to the
     * board rather than through the briefing — a second run is about
     * trying a different posture, and making someone watch the pillars
     * again is how you lose them. */
    teardown();
    const mode = game.state.mode;
    const client = game.state.client.id;
    history.replaceState(null, '', location.pathname + location.search);
    game = createGame({ data: DATA, seed: randomSeed(), mode });
    game.setClient(client);
    Store.bump('plays');
    post('play', { client, mode, seed: game.state.seedCode, replay: true });
    completed = false;
    started = true;
    game.goPosture();
    app.render();
  },

  /* Play a named run. The seed has always been reproducible and printed on
   * the result screen, and there has never been anywhere to type one in —
   * so the one feature that makes a stand competitive, and makes a
   * reported bug reproducible, was reachable only by hand-editing the URL.
   * Returns false on a code the decoder rejects so the caller can say so
   * rather than silently starting a different run. */
  playSeed(code) {
    const seed = decodeSeed(String(code || '').trim());
    if (seed === null || !Number.isFinite(seed)) return false;
    teardown();
    const mode = game.state.mode;
    const client = game.state.client.id;
    game = createGame({ data: DATA, seed, mode });
    game.setClient(client);
    /* So the address bar matches the run, which is what makes it shareable
     * when the file is served rather than opened from disk. Guarded because
     * some browsers refuse history writes on file:// and the whole point of
     * this build is that it runs from disk. */
    try {
      history.replaceState(null, '', `${location.pathname}${location.search}#${game.state.seedCode}`);
    } catch { /* file:// — the run is identical, only the URL is not. */ }
    Store.bump('plays');
    post('play', { client, mode, seed: game.state.seedCode, seeded: true });
    completed = false;
    started = true;
    game.goPosture();
    app.render();
    return true;
  },

  toAttract() {
    teardown();
    const mode = game.state.mode;
    game = createGame({ data: DATA, seed: randomSeed(), mode });
    started = false;
    app.render();
  },

  /* ---------------------------------------------------------- chrome */

  toggleTheme() {
    const next = Theme.toggle();
    app.render();
    return next;
  },
  get theme() {
    return Theme.current;
  },

  toggleSound() {
    const m = !audio.settings.muted;
    audio.setMuted(m);
    Store.saveSettings({ muted: m });
    if (stageScreen) stageScreen.setMuted(m);
    if (!m) audio.startBed();
  },
  openHelp: () => openHelp(app),
  openStats: () => openStats(app),
};

function teardown() {
  if (stageScreen) stageScreen.stop();
  stageScreen = null;
  vignette('calm');
}

function finishRun() {
  const summary = game.summary();
  game.nextStage();
  game.drain();
  teardown();
  completed = true;

  Store.bump('completions');
  Store.addScore({
    name: null,
    score: summary.score,
    index: summary.index,
    rank: summary.rank.name,
    client: summary.client.id,
    seed: summary.seedCode,
  });
  post('complete', {
    seed: summary.seedCode,
    client: summary.client.id,
    mode: summary.mode,
    index: summary.index,
    defense: summary.defense,
    zone: summary.zone.zone,
    rank: summary.rank.name,
    gap: summary.gap.key,
    score: summary.score,
    posture: summary.posture.map((p) => p.id),
    /* The single most interesting thing this game knows: which layer
     * people reach for first, per stage. Earlier builds threw it away. */
    leads: summary.rounds.map((r) => r.lead),
    outcomes: summary.rounds.map((r) => r.outcome),
  });

  renderImpact(app, summary, () => {
    game.state.phase = PHASE.RESULT;
    renderResult(app, summary);
  });
}

/* --------------------------------------------------------- global keys */

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;

  const k = e.key.toLowerCase();

  if (k === 'm') {
    e.preventDefault();
    app.toggleSound();
    return;
  }
  if (k === 't') {
    e.preventDefault();
    app.toggleTheme();
    return;
  }
  if (k === '?' || (k === '/' && e.shiftKey)) {
    e.preventDefault();
    openHelp(app);
    return;
  }
  if (game.state.phase === PHASE.ATTRACT && k === 'l') {
    e.preventDefault();
    game.setMode(game.state.mode === 'timed' ? 'learn' : 'timed');
    Store.saveSettings({ mode: game.state.mode });
    app.render();
    return;
  }
  if (game.state.phase === PHASE.RESULT && k === 'r') {
    e.preventDefault();
    app.replay();
    return;
  }
  if (e.key === 'Enter') {
    /* Enter presses the primary action on whatever screen is up, so the
     * whole game is completable without a mouse. */
    const btn = qs('.wrap .btn.primary') || document.querySelector('.climax .btn');
    if (btn) {
      e.preventDefault();
      btn.click();
    }
  }
});

/* An abandoned run is a real signal — where people drop out is the only
 * thing that tells you whether a stage is too hard or too slow.
 *
 * Only pagehide reports one. An earlier version also reported on the tab
 * going to the background, which was wrong twice over: it counted every
 * glance at a notification as an abandonment, and because it latched
 * `completed` it then suppressed the completion event for a run the player
 * came back and finished. Backgrounding pauses instead. */
function reportAbandon() {
  if (!started || completed) return;
  completed = true;
  Store.bump('abandons');
  post('abandon', {
    seed: game.state.seedCode,
    phase: game.state.phase,
    stage: game.state.stageIndex + 1,
    client: game.state.client.id,
    mode: game.state.mode,
  });
}
window.addEventListener('pagehide', reportAbandon);

/* A phone in a pocket is not a player making a decision. requestAnimationFrame
 * already stops while a tab is hidden, so this mostly guards the frame on
 * the way back — but it also covers the case where the browser keeps
 * ticking a background tab. */
document.addEventListener('visibilitychange', () => {
  tabHidden = document.visibilityState === 'hidden';
});

/* Automation hooks.
 *
 * Exposed for headless playthroughs, which is how the answer key gets
 * validated. The gotcha that has cost time before: choose() enforces
 * `key === S.lead` and returns, so the backup must be a different pillar
 * from the lead. A harness that ignores that never advances.
 */
window.TR = {
  VERSION,
  get S() {
    return game.state;
  },
  get game() {
    return game;
  },
  choose: (k) => game.choose(k),
  scan: () => game.scan(),
  hold: () => game.hold(),
  rightBackupFor,
  startGame: () => app.start(),
  playSeed: (code) => app.playSeed(code),
  briefGo: () => {
    game.goPosture();
    app.render();
  },
  beginAttack: () => app.beginAttack(),
  advance: () => app.advance(),
  summary: () => game.summary(),
  report: () => incidentReport(game.summary()),
  openStats: () => openStats(app),
  seedCode: () => game.state.seedCode,
  encodeSeed,
  theme: (v) => (v ? Theme.set(v) : Theme.current),
  fieldStats: () => field.stats(),
};

app.render();
