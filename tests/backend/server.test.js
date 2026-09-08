'use strict';

/*
 * Full-stack integration test: spawns the real backend/server.js as a child
 * process (so app.listen(), static serving, the SPA fallback and the global
 * error handler are all exercised as they run in production) against a
 * temp cwd, then drives it over real HTTP with supertest.
 */

var request = require('supertest');
var http = require('http');
var net = require('net');
var fs = require('fs');
var os = require('os');
var path = require('path');
var childProcess = require('child_process');

var REPO_ROOT = path.join(__dirname, '../..');
var SERVER_ENTRY = path.join(REPO_ROOT, 'backend/server.js');

var child;
var tmpDir;
var baseUrl;

function findFreePort() {
  return new Promise(function (resolve, reject) {
    var srv = net.createServer();
    srv.listen(0, '127.0.0.1', function () {
      var port = srv.address().port;
      srv.close(function (err) { if (err) reject(err); else resolve(port); });
    });
    srv.on('error', reject);
  });
}

function waitForServer(url, deadline) {
  return new Promise(function (resolve, reject) {
    (function poll() {
      http.get(url, function (res) {
        res.resume();
        resolve();
      }).on('error', function () {
        if (Date.now() > deadline) return reject(new Error('server did not start in time'));
        setTimeout(poll, 100);
      });
    })();
  });
}

beforeAll(function () {
  jest.setTimeout(20000);
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gres-server-test-'));
  return findFreePort().then(function (port) {
    baseUrl = 'http://127.0.0.1:' + port;
    child = childProcess.spawn(process.execPath, [SERVER_ENTRY], {
      cwd: tmpDir,
      env: Object.assign({}, process.env, { PORT: String(port), LOG_LEVEL: 'silent' }),
      stdio: 'ignore'
    });
    return waitForServer(baseUrl + '/api/config', Date.now() + 10000);
  });
});

afterAll(function () {
  if (child) child.kill();
  if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('GET / serves the frontend index.html', function () {
  return request(baseUrl).get('/').expect(200).expect('Content-Type', /html/).then(function (res) {
    expect(res.text).toContain('<html');
  });
});

/* The version stamp is what lets a long-lived page notice it is running
   older code than the server. Serving the raw file — which express.static
   would happily do for '/' if the render handler were ever registered after
   it — leaks the placeholder, and the client then disables its own check. */
test('GET / stamps the running version into the HTML', function () {
  var pkg = require('../../package.json');
  return request(baseUrl).get('/').expect(200).then(function (res) {
    expect(res.text).not.toContain('__APP_VERSION__');
    expect(res.text).toContain('<meta name="app-version" content="' + pkg.version + '">');
    expect(res.headers['cache-control']).toMatch(/no-cache/);
  });
});

test('GET /index.html is rendered too, not served raw by express.static', function () {
  return request(baseUrl).get('/index.html').expect(200).then(function (res) {
    expect(res.text).not.toContain('__APP_VERSION__');
  });
});

test('GET /js/app.js serves the ES5 frontend bundle', function () {
  return request(baseUrl).get('/js/app.js').expect(200).then(function (res) {
    expect(res.text).toContain('HomeApp');
  });
});

test('GET /css/main.css serves the stylesheet', function () {
  return request(baseUrl).get('/css/main.css').expect(200).expect('Content-Type', /css/);
});

test('unknown non-API paths fall back to index.html for client-side routing', function () {
  return request(baseUrl).get('/some/deep/spa/route').expect(200).expect('Content-Type', /html/).then(function (res) {
    expect(res.text).toContain('<html');
  });
});

test('API routes are reachable and return JSON', function () {
  return request(baseUrl).get('/api/settings').expect(200).expect('Content-Type', /json/).then(function (res) {
    expect(res.body).toEqual({});
  });
});

test('no CORS headers are sent, so another origin cannot read the API', function () {
  /* The wildcard this used to send let any page open in any browser on the
     network drive the whole API cross-origin and read the responses. */
  return request(baseUrl)
    .get('/api/settings')
    .set('Origin', 'http://evil.example')
    .expect(200)
    .then(function (res) {
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    });
});

test('unmatched /api paths return a JSON 404, not the app shell', function () {
  /* Falling through to index.html returned HTML with HTTP 200; the client's
     JSON.parse then failed and surfaced "Invalid response", which reads as a
     backend fault rather than a wrong URL. */
  return request(baseUrl)
    .get('/api/does-not-exist')
    .expect(404)
    .expect('Content-Type', /json/)
    .then(function (res) {
      expect(res.body).toHaveProperty('error');
    });
});

test('an unknown method on a real API prefix also 404s as JSON', function () {
  return request(baseUrl)
    .post('/api/config/nope')
    .send({})
    .expect(404)
    .expect('Content-Type', /json/);
});

test('the global error handler returns structured JSON for a malformed JSON body', function () {
  return request(baseUrl)
    .post('/api/settings')
    .set('Content-Type', 'application/json')
    .send('{not valid json')
    .expect(500)
    .then(function (res) {
      expect(res.body).toHaveProperty('error');
    });
});
