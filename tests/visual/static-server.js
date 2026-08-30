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
 */

'use strict';

var http = require('http');
var fs   = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..', '..', 'frontend');
var PORT = Number(process.env.VISUAL_PORT || 3100);

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
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(full)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(buf);
  });
}).listen(PORT, function () {
  console.log('visual static server on http://localhost:' + PORT);
});
