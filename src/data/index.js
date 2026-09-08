/* Content bundle.
 *
 * Imported at build time, never fetched. A fetch() of a local JSON file
 * fails outright when the page is opened from disk with a file:// URL,
 * which is the primary distribution model for this asset — emailed,
 * carried on a USB stick, opened on a locked-down machine. Import means
 * the bundler inlines it and there is no request to fail.
 */

import scenarios from './scenarios.json';
import clients from './clients.json';
import foe from './foe.json';
import postures from './postures.json';
import estate from './estate.json';

export const DATA = { scenarios, clients, foe, postures, estate };
export default DATA;
