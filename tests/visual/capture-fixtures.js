/**
 * capture-fixtures.js
 *
 * One-time helper: drives the running app against the REAL backend and
 * records every /api/* response into tests/visual/fixtures/ so the visual
 * regression suite can replay them deterministically (no backend, no
 * network, no live data drift).
 *
 * Run with the app served on http://localhost:3000:
 *   node tests/visual/capture-fixtures.js
 *
 * SECURITY: /api/settings/admin returns real service URLs, and older builds
 * returned integration credentials from /api/settings too (Home
 * Assistant long-lived token, Jellyfin API key, Proxmox token secret) and
 * internal LAN URLs. Those are REDACTED here before anything touches disk —
 * fixtures are git-tracked, backend/data/ is not. Redacted values keep the
 * same shape/length so the UI renders identically (the token inputs are
 * type=password and render as dots regardless).
 */

'use strict';

var fs   = require('fs');
var path = require('path');

var BASE     = 'http://localhost:3000';
var FIX_DIR  = path.join(__dirname, 'fixtures');
var PIN      = '1234'; /* matches .env.example SETTINGS_PIN */

/* Keys whose values must never be written to a git-tracked file. Replaced
   with same-length placeholders so nothing about the layout changes. */
var REDACT = {
  ha_token:   'REDACTED-ha-token-' + new Array(166).join('x'),
  jf_token:   'REDACTED-jf-key' + new Array(18).join('x'),
  px_token:   'REDACTED-px-secret-0000-0000-000000',
  px_tokenid: 'root@pam!fake',
  ha_url:     'http://homeassistant.local:8123',
  jf_url:     'http://jellyfin.local:8096',
  px_url:     'https://proxmox.local:8006'
};

function redact(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redact);
  var out = {};
  Object.keys(value).forEach(function (k) {
    out[k] = Object.prototype.hasOwnProperty.call(REDACT, k) ? REDACT[k] : redact(value[k]);
  });
  return out;
}

/* Belt-and-braces. A generic "looks like a hash" regex is useless here —
   Jellyfin uses 32-hex for every item id and image tag — so instead assert
   precisely: none of the REAL secret values on this machine may appear in
   any fixture. That has no false positives and catches a secret leaking
   through a response we didn't anticipate. */
var LIVE_SECRETS = (function () {
  var out = [];
  try {
    var s = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', '..', 'data', 'settings.json'), 'utf8'));
    ['ha_token', 'jf_token', 'px_token', 'px_tokenid', 'ha_url', 'jf_url', 'px_url']
      .forEach(function (k) {
        if (typeof s[k] === 'string' && s[k].length >= 8) out.push(s[k]);
      });
  } catch (e) { /* no settings file — nothing to leak */ }
  return out;
})();

function assertClean(name, text) {
  for (var i = 0; i < LIVE_SECRETS.length; i++) {
    if (text.indexOf(LIVE_SECRETS[i]) !== -1) {
      throw new Error(
        'Refusing to write fixture "' + name + '": it contains a real ' +
        'credential from data/settings.json. Add its key to REDACT.'
      );
    }
  }
  if (/\beyJ[A-Za-z0-9_-]{20,}\./.test(text)) {
    throw new Error('Refusing to write fixture "' + name + '": contains a JWT.');
  }
}

/* The Jellyfin user id is an account identifier that would otherwise end up
   in fixture bodies AND filenames. Normalise it to a fixed placeholder so
   fixtures are machine-independent and carry no account data. Discovered at
   runtime from /api/jf/userid. */
var FAKE_USER_ID = '00000000000000000000000000000001';
var realUserId = null;
function normaliseIds(text) {
  return realUserId ? text.split(realUserId).join(FAKE_USER_ID) : text;
}

/* /api/px/... and /api/jf/image/... are parameterised; key fixtures by a
   filesystem-safe form of the full path+query so replay can match exactly. */
function keyFor(urlPath) {
  return normaliseIds(urlPath).replace(/^\/api\//, '').replace(/[^a-zA-Z0-9._-]/g, '_');
}

(async function main() {
  var pw = require('@playwright/test');
  var browser = await pw.chromium.launch({ args: ['--no-sandbox'] });
  var page = await browser.newPage({ viewport: { width: 1024, height: 900 } });

  var captured = {};

  page.on('response', async function (res) {
    var u = new URL(res.url());
    if (u.origin !== BASE || u.pathname.indexOf('/api/') !== 0) return;
    if (u.pathname.indexOf('/api/jf/image/') === 0) return; /* binary, handled separately */
    var ct = res.headers()['content-type'] || '';
    if (ct.indexOf('application/json') === -1) return;
    try {
      var body = await res.json();
      if (u.pathname === '/api/jf/userid' && body && body.userId) realUserId = body.userId;
      var clean = redact(body);
      /* The Settings tab prints the running version, and the visual static
         server stamps a pinned fake one into index.html (see PINNED_VERSION
         there). Recording this machine's real package.json version instead
         would make the Settings baselines show "update available" and break
         them again on every release. Pinned here rather than in REDACT
         because that map is keyed by field name, and 'version' also carries
         the genuine Proxmox VE version the Server tab renders. */
      if (u.pathname === '/api/config' && clean && clean.version) clean.version = '0.0.0-test';
      captured[keyFor(u.pathname + u.search)] = {
        path: u.pathname, search: u.search, status: res.status(), body: clean
      };
    } catch (e) { /* non-JSON or already consumed — skip */ }
  });

  async function unlockSettings() {
    await page.click('button[data-page="settings"]');
    await page.waitForTimeout(400);
    var locked = await page.locator('#pin-overlay').isVisible().catch(function () { return false; });
    if (locked) {
      for (var i = 0; i < PIN.length; i++) {
        await page.click('.pin-key[data-digit="' + PIN[i] + '"]');
        await page.waitForTimeout(120);
      }
      await page.waitForTimeout(500);
    }
  }

  console.log('navigating...');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('#tab-bar');
  await page.waitForTimeout(1500);

  var tabs = ['smarthome', 'jelly', 'meteo', 'markets', 'server'];
  for (var t = 0; t < tabs.length; t++) {
    console.log('  visiting', tabs[t]);
    await page.click('button[data-page="' + tabs[t] + '"]');
    await page.waitForTimeout(2500);
  }

  /* Proxmox detail panes are lazy — click the first tree item to capture them */
  await page.click('button[data-page="server"]');
  await page.waitForTimeout(1500);
  var firstNode = page.locator('.px-tree-item').first();
  if (await firstNode.count()) { await firstNode.click(); await page.waitForTimeout(2000); }

  console.log('  visiting settings');
  await unlockSettings();
  await page.waitForTimeout(1500);

  await page.click('button[data-page="home"]');
  await page.waitForTimeout(2000);

  if (!fs.existsSync(FIX_DIR)) fs.mkdirSync(FIX_DIR, { recursive: true });

  var names = Object.keys(captured).sort();
  var manifest = [];
  names.forEach(function (name) {
    var rec = captured[name];
    var text = normaliseIds(JSON.stringify(rec.body, null, 2));
    assertClean(name, text);
    fs.writeFileSync(path.join(FIX_DIR, name + '.json'), text + '\n');
    manifest.push({
      file: name + '.json',
      path: normaliseIds(rec.path),
      search: normaliseIds(rec.search),
      status: rec.status
    });
  });
  fs.writeFileSync(path.join(FIX_DIR, '_manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  console.log('\ncaptured ' + names.length + ' fixtures into tests/visual/fixtures/');
  names.forEach(function (n) { console.log('  ' + n + '.json'); });

  await browser.close();
})().catch(function (e) { console.error(e); process.exit(1); });
