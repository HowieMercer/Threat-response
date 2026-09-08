/* Entry point.
 *
 * This is a stub. The real wiring comes from splitting v12-original.html —
 * see START-HERE.md.
 *
 * Once populated, this file should do very little: import styles, load
 * scenario data, construct the engine, mount the first screen, and hand
 * off. Anything resembling game logic here belongs in src/engine/.
 */

import './styles/tokens.css';

const wrap = document.querySelector('.wrap');
wrap.innerHTML = `
  <p style="font-family:system-ui;color:var(--dim);padding:40px 0">
    Scaffold is running. Drop <code>v12-original.html</code> into the project
    root and follow START-HERE.md to split it into this structure.
  </p>
`;
