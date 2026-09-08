/* Inline SVG paths. Inline because an icon font or a sprite file is
 * another request, and the file has to work with none. */

import { h } from './dom.js';

const PATHS = {
  endpoints: 'M3 5h18v11H3z M8 20h8 M12 16v4',
  fileserver: 'M4 4h16v6H4z M4 14h16v6H4z M7.5 7h.01 M7.5 17h.01',
  identity: 'M12 3l8 4v5c0 4.4-3.2 7.9-8 9-4.8-1.1-8-4.6-8-9V7z M9.5 12l1.8 1.8L15 10',
  cloud: 'M6.5 18h11a3.5 3.5 0 000-7 5.5 5.5 0 00-10.6-1.4A3.8 3.8 0 006.5 18z',
  databases: 'M12 3c4.4 0 8 1.1 8 2.5S16.4 8 12 8 4 6.9 4 5.5 7.6 3 12 3z M4 5.5v13C4 19.9 7.6 21 12 21s8-1.1 8-2.5v-13 M4 12c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5',
  backups: 'M12 4a8 8 0 108 8 M12 4v4l3-2 M4 12h4 M20 12h-4 M12 20v-4 M9.5 12.5l2 2 3.5-4',

  sound: 'M4 9h3l4-4v14l-4-4H4z M15.5 8.5a5 5 0 010 7 M18.5 6a8.5 8.5 0 010 12',
  mute: 'M4 9h3l4-4v14l-4-4H4z M15 9l6 6 M21 9l-6 6',
  help: 'M12 3a9 9 0 100 18 9 9 0 000-18z M9.6 9.2A2.5 2.5 0 0114.5 10c0 1.7-2.5 2-2.5 3.5 M12 17h.01',
  chart: 'M4 20h16 M7 20V11 M12 20V5 M17 20v-7',
  restart: 'M20 12a8 8 0 11-2.6-5.9 M20 4v4h-4',
};

export function icon(name, cls = 'sys-ico') {
  const d = PATHS[name];
  if (!d) return null;
  const paths = d.split(' M').map((seg, i) => (i === 0 ? seg : 'M' + seg));
  return h('svg', { class: cls, viewBox: '0 0 24 24', 'aria-hidden': 'true' }, ...paths.map((p) => h('path', { d: p })));
}
