/**
 * static-server.js
 *
 * Minimal static file server for frontend/, used only by the visual
 * regression suite. Deliberately dependency-free (no express) so the visual
 * harness never affects the runtime dependency tree.
 *
 * All /api/* requests are intentionally NOT handled here — the Playwright
 * suite intercepts them and replays tests/visual/fixtures/, which is what
 * makes the screenshots deterministic.
 *
 * The one thing it does do to a file on the way out is stamp the app version
 * into index.html, the way backend/lib/indexHtml.js does in production. It is
 * pinned to a fake constant for the same reason Date is frozen in the spec:
 * the Settings tab prints the running version, so using the real package.json
 * value would invalidate that baseline on every release. The fixture for
 * /api/config carries the same string, so the shot shows the up-to-date
 * state rather than a permanent "update available".
 */

'use strict';

var http = require('http');
var fs   = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..', '..', 'frontend');
var PORT = Number(process.env.VISUAL_PORT || 3100);

/* Must match "version" in tests/visual/fixtures/config.json. */
var PINNED_VERSION = '0.0.0-test';

var TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.json': 'application/json'
};

http.createServer(function (req, res) {
  var urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';

  /* Contain path traversal: resolve, then require the result stays in ROOT. */
  var full = path.resolve(path.join(ROOT, urlPath));
  if (full !== ROOT && full.indexOf(ROOT + path.sep) !== 0) {
    res.writeHead(403); res.end('forbidden'); return;
  }

  fs.readFile(full, function (err, buf) {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    var body = path.extname(full) === '.html'
      ? Buffer.from(buf.toString('utf8').replace(/__APP_VERSION__/g, PINNED_VERSION), 'utf8')
      : buf;
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(full)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(body);
  });
}).listen(PORT, function () {
  console.log('visual static server on http://localhost:' + PORT);
});
