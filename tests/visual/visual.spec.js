'use strict';

/**
 * visual.spec.js — visual regression baseline for the UI refactor.
 *
 * Every screenshot here is a contract: the token/primitive refactor stages
 * are supposed to change the CSS *architecture* without changing rendered
 * output, so an unexpected diff is a genuine regression.
 *
 * Determinism comes from three places:
 *   1. /api/* is served from tests/visual/fixtures (no backend, no live data)
 *   2. Date is frozen, so the clock and the time-of-day greeting never drift
 *   3. theme + text size are seeded into localStorage before first paint
 *
 * Re-baseline after an INTENDED visual change:
 *   npx playwright test --update-snapshots
 */

var fs   = require('fs');
var path = require('path');
var { test, expect } = require('@playwright/test');

var FIX_DIR  = path.join(__dirname, 'fixtures');
var MANIFEST = JSON.parse(fs.readFileSync(path.join(FIX_DIR, '_manifest.json'), 'utf8'));

/* Frozen instant: a Sunday at 10:20, which lands in the "Good morning"
   greeting branch and gives a stable clock readout. */
var FROZEN_MS = Date.UTC(2026, 0, 11, 9, 20, 0);

/* ── fixture replay ─────────────────────────────────────── */

function bodyFor(pathname, search) {
  var exact = MANIFEST.find(function (m) { return m.path === pathname && m.search === search; });
  var loose = exact || MANIFEST.find(function (m) { return m.path === pathname; });
  if (!loose) return null;
  return fs.readFileSync(path.join(FIX_DIR, loose.file), 'utf8');
}

async function installFixtures(page) {
  await page.route('**/api/**', async function (route) {
    var u = new URL(route.request().url());

    /* Poster images: 1x1 transparent PNG keeps layout identical without
       depending on a Jellyfin server or shipping binary fixtures. */
    if (u.pathname.indexOf('/api/jf/image/') === 0) {
      return route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
          'base64')
      });
    }

    /* Writes (service calls, settings POSTs) must never reach a real device. */
    if (route.request().method() !== 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    }

    var body = bodyFor(u.pathname, u.search);
    if (body === null) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: body });
  });
}

/* ── determinism shims ──────────────────────────────────── */

async function freezeEnvironment(page, opts) {
  await page.addInitScript(function (args) {
    /* Freeze time: the status-bar clock ticks every second and the Home
       greeting is time-of-day dependent. */
    var FIXED = args.frozenMs;
    var RealDate = Date;
    function FrozenDate() {
      if (arguments.length === 0) return new RealDate(FIXED);
      return new (Function.prototype.bind.apply(RealDate, [null].concat([].slice.call(arguments))))();
    }
    FrozenDate.prototype = RealDate.prototype;
    FrozenDate.now = function () { return FIXED; };
    FrozenDate.parse = RealDate.parse;
    FrozenDate.UTC = RealDate.UTC;
    window.Date = FrozenDate;

    /* Seed appearance prefs before the app's init reads them. */
    try {
      localStorage.setItem('gres_theme', args.theme);
      localStorage.setItem('gres_fontsize', args.fontSize);
      localStorage.setItem('gres_statusbar', 'visible');
    } catch (e) { /* private mode — app already tolerates this */ }
  }, { frozenMs: FROZEN_MS, theme: opts.theme, fontSize: opts.fontSize });
}

async function gotoApp(page, opts) {
  await installFixtures(page);
  await freezeEnvironment(page, opts);
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForSelector('#tab-bar');
  /* Webfonts change metrics; wait so shots aren't raced against FOUT. */
  await page.evaluate(function () {
    return document.fonts && document.fonts.ready ? document.fonts.ready : null;
  }).catch(function () {});
  await page.waitForTimeout(700);
}

async function openTab(page, tab) {
  await page.click('button[data-page="' + tab + '"]');
  await page.waitForTimeout(600);
  if (tab === 'settings') {
    var locked = await page.locator('#pin-overlay').isVisible().catch(function () { return false; });
    if (locked) {
      for (var i = 0; i < 4; i++) {
        await page.click('.pin-key[data-digit="' + '1234'[i] + '"]');
        await page.waitForTimeout(90);
      }
      await page.waitForTimeout(500);
    }
  }
}

/* ── matrix ─────────────────────────────────────────────── */

var TABS = ['home', 'smarthome', 'jelly', 'meteo', 'markets', 'server', 'settings'];

var VIEWPORTS = [
  { name: 'phone-portrait',   width: 375,  height: 812 },
  { name: 'phone-landscape',  width: 844,  height: 390 },
  { name: 'tablet-portrait',  width: 768,  height: 1024 },
  { name: 'tablet-landscape', width: 1024, height: 768 },
  /* iPad Pro 12.9" landscape — the widest wall-mountable panel, and the
     case the 1400px full-bleed threshold exists to cover. Must stay
     edge-to-edge; desktop must not. */
  { name: 'ipad-pro-landscape', width: 1366, height: 1024 },
  { name: 'desktop',          width: 1440, height: 900 }
];

/* Responsive axis: every tab at every width (dark, normal text). */
VIEWPORTS.forEach(function (vp) {
  test.describe('responsive @ ' + vp.name, function () {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    TABS.forEach(function (tab) {
      test(tab, async function ({ page }) {
        await gotoApp(page, { theme: 'dark', fontSize: 'normal' });
        await openTab(page, tab);
        await expect(page).toHaveScreenshot(vp.name + '-' + tab + '.png', { fullPage: false });
      });
    });
  });
});

/* Theme axis: every tab in light theme at one representative width. */
test.describe('theme @ light', function () {
  test.use({ viewport: { width: 375, height: 812 } });

  TABS.forEach(function (tab) {
    test(tab, async function ({ page }) {
      await gotoApp(page, { theme: 'light', fontSize: 'normal' });
      await openTab(page, tab);
      await expect(page).toHaveScreenshot('light-' + tab + '.png');
    });
  });
});

/* Text-size axis: every tab at each enlarged setting. */
['large', 'xl'].forEach(function (size) {
  test.describe('text-size @ ' + size, function () {
    test.use({ viewport: { width: 375, height: 812 } });

    TABS.forEach(function (tab) {
      test(tab, async function ({ page }) {
        await gotoApp(page, { theme: 'dark', fontSize: size });
        await openTab(page, tab);
        await expect(page).toHaveScreenshot('fs-' + size + '-' + tab + '.png');
      });
    });
  });
});

/* Overlays and sheets, which no tab screenshot reaches. */
test.describe('overlays', function () {
  test.use({ viewport: { width: 375, height: 812 } });

  test('pin overlay', async function ({ page }) {
    await gotoApp(page, { theme: 'dark', fontSize: 'normal' });
    await page.click('button[data-page="settings"]');
    await page.waitForTimeout(600);
    await expect(page).toHaveScreenshot('overlay-pin.png');
  });

  test('jellyfin detail', async function ({ page }) {
    await gotoApp(page, { theme: 'dark', fontSize: 'normal' });
    await openTab(page, 'jelly');
    var card = page.locator('.jelly-card').first();
    if (await card.count()) {
      await card.click();
      await page.waitForTimeout(900);
      await expect(page).toHaveScreenshot('overlay-jelly-detail.png');
    }
  });
});
