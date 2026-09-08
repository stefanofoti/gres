/**
 * lib/indexHtml.js
 *
 * Serves frontend/index.html with the running version stamped into it.
 *
 * Why this exists: the frontend is a single page with no build step and no
 * router, so once it has loaded, index.html is never requested again. On the
 * wall-mounted iPad (a Home-screen web app under Guided Access) that means a
 * newly published release simply never reaches the device — the only event
 * that refetches the page is quitting and reopening the app.
 *
 * Fixing that needs the page to know which version it is *running*, which
 * cannot come from an API call: /api/config reports the version of the
 * server, and the whole point is to detect the case where the two disagree.
 * So the version is substituted into the HTML at serve time, and the client
 * compares its own stamp against /api/config (see the UPDATE module in
 * js/app.js). No build step is involved: the placeholder lives in the
 * checked-in HTML and is replaced on the way out.
 *
 * The file is re-read per request rather than cached in memory. Requests for
 * it are rare (one per app launch or reload), and re-reading keeps `npm run
 * dev` honest — nodemon does not watch .html, so a memoised copy would serve
 * markup that is out of date with the file on disk.
 */

'use strict';

var fs      = require('fs');
var path    = require('path');
var VERSION = require('./appVersion');

var INDEX_PATH  = path.join(__dirname, '..', '..', 'frontend', 'index.html');
var PLACEHOLDER = /__APP_VERSION__/g;

/**
 * Express handler: renders index.html with __APP_VERSION__ replaced.
 *
 * Sent as no-cache so the entry point is always revalidated. Everything
 * else under frontend/ is served by express.static with max-age=0 + ETag,
 * which already forces a conditional request on reload; the HTML is the one
 * response that must never be answered from cache, because a stale copy
 * carries a stale version stamp and would make the app report itself
 * up to date forever.
 */
function serveIndex(req, res, next) {
  fs.readFile(INDEX_PATH, 'utf8', function (err, src) {
    if (err) return next(err);
    res.set('Cache-Control', 'no-cache');
    res.type('html').send(src.replace(PLACEHOLDER, VERSION));
  });
}

module.exports = { serveIndex: serveIndex, version: VERSION };
