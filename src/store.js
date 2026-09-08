/* localStorage wrapper: settings, leaderboard, funnel metrics, leads.
 *
 * The key is nable_tr_v8 and it does not move. See config.js for why —
 * bumping it orphans every leaderboard entry and captured lead already
 * sitting on an event tablet.
 *
 * Every read and write is wrapped. Storage throws outright in private
 * browsing on some versions of Safari, and a booth tablet that crashes on
 * load because it could not save a volume preference is a worse outcome
 * than losing the preference.
 */

import { STORE_KEY, CONFIG, VERSION } from './config.js';

const EMPTY = {
  settings: { mode: 'timed', muted: false, volume: 0.7, client: null },
  leaderboard: [],
  leads: [],
  metrics: { plays: 0, completions: 0, abandons: 0, formOpens: 0, leads: 0, scans: 0 },
};

function read() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return structuredClone(EMPTY);
    const parsed = JSON.parse(raw);
    return {
      settings: { ...EMPTY.settings, ...(parsed.settings || {}) },
      leaderboard: Array.isArray(parsed.leaderboard) ? parsed.leaderboard : [],
      leads: Array.isArray(parsed.leads) ? parsed.leads : [],
      metrics: { ...EMPTY.metrics, ...(parsed.metrics || {}) },
    };
  } catch {
    return structuredClone(EMPTY);
  }
}

function write(data) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

let cache = read();

export const Store = {
  get settings() {
    return { ...cache.settings };
  },
  saveSettings(patch) {
    cache.settings = { ...cache.settings, ...patch };
    write(cache);
  },

  get leaderboard() {
    return [...cache.leaderboard];
  },
  /* Top ten, by score. Kept per device on purpose: a shared cross-event
   * leaderboard needs a backend and is explicitly a later phase. Two
   * tablets at the same stand keep separate boards, and booth staff need
   * to know that. */
  addScore(entry) {
    cache.leaderboard.push({ ...entry, at: Date.now(), v: VERSION });
    cache.leaderboard.sort((a, b) => b.score - a.score);
    cache.leaderboard = cache.leaderboard.slice(0, 10);
    write(cache);
    return cache.leaderboard;
  },

  get metrics() {
    return { ...cache.metrics };
  },
  bump(key, by = 1) {
    cache.metrics[key] = (cache.metrics[key] || 0) + by;
    write(cache);
  },

  get leads() {
    return [...cache.leads];
  },
  /* Duplicate merging: the same email at the same stand playing three
   * times is one lead with the best score, not three records for sales to
   * de-duplicate by hand. */
  addLead(lead) {
    const email = normalizeEmail(lead.email);
    const existing = cache.leads.findIndex((l) => normalizeEmail(l.email) === email);
    const record = {
      ...lead,
      email,
      kiosk: CONFIG.kioskId || '',
      event: CONFIG.eventName || '',
      v: VERSION,
      at: new Date().toISOString(),
    };
    if (existing >= 0) {
      const prev = cache.leads[existing];
      cache.leads[existing] = { ...prev, ...record, plays: (prev.plays || 1) + 1, score: Math.max(prev.score || 0, record.score) };
    } else {
      cache.leads.push({ ...record, plays: 1 });
    }
    write(cache);
    return record;
  },

  csv() {
    const cols = ['name', 'email', 'role', 'client', 'gap', 'score', 'resilience', 'zone', 'rank', 'seed', 'plays', 'kiosk', 'event', 'consent', 'v', 'at'];
    const esc = (v) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [cols.join(','), ...cache.leads.map((l) => cols.map((c) => esc(l[c])).join(','))].join('\n');
  },

  reset() {
    cache = structuredClone(EMPTY);
    write(cache);
  },
};

/* Typo repair on the domain only. Deliberately conservative: silently
 * "correcting" a local part is how you lose a real lead, and a wrong
 * domain on a work email is nearly always one of these five. */
const DOMAIN_FIXES = {
  'gmial.com': 'gmail.com',
  'gmai.com': 'gmail.com',
  'gmail.co': 'gmail.com',
  'hotmial.com': 'hotmail.com',
  'outlok.com': 'outlook.com',
  'yahooo.com': 'yahoo.com',
  'n-able.co': 'n-able.com',
};

export function normalizeEmail(raw) {
  const e = String(raw || '').trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 0) return e;
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  return `${local}@${DOMAIN_FIXES[domain] || domain}`;
}

export function validEmail(raw) {
  return /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/.test(normalizeEmail(raw));
}

/* Fire-and-forget metrics post. Never awaited, never blocking, and only
 * ever fired when an endpoint is actually configured — an event tablet on
 * venue wifi must not hang on a network call between stages. */
export function post(kind, payload) {
  if (!CONFIG.metricsEndpoint) return;
  try {
    const body = JSON.stringify({ kind, v: VERSION, kiosk: CONFIG.kioskId, event: CONFIG.eventName, at: new Date().toISOString(), ...payload });
    if (navigator.sendBeacon) {
      navigator.sendBeacon(CONFIG.metricsEndpoint, new Blob([body], { type: 'application/json' }));
    } else {
      fetch(CONFIG.metricsEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
    }
  } catch {}
}
