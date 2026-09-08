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

initFx();

const field = createField(qs('#bg'));
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

const app = {
  data: DATA,
  audio,
  field,
  get game() {
    return game;
  },

  render() {
    switch (game.state.phase) {
      case PHASE.ATTRACT:
        vignette('calm');
        field.setMood('calm');
        field.setDepth(0);
        audio.setDepth(0);
        renderAttract(app);
        break;
      case PHASE.BRIEF:
        renderBrief(app);
        break;
      case PHASE.POSTURE:
        renderPosture(app);
        break;
      case PHASE.RESULT:
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

  toAttract() {
    teardown();
    const mode = game.state.mode;
    game = createGame({ data: DATA, seed: randomSeed(), mode });
    started = false;
    app.render();
  },

  /* ---------------------------------------------------------- chrome */

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
 * thing that tells you whether a stage is too hard or too slow. */
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
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') reportAbandon();
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
};

app.render();
