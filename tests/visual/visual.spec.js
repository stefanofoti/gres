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

/**
 * @param {import('@playwright/test').Page} page
 * @param {Object} [overrides] — pathname -> function(parsedBody) returning the
 *   body to serve instead. Used where a state the UI must render does not
 *   exist in the captured data. It lives here rather than in the fixture
 *   because capture-fixtures.js rewrites those files wholesale, so anything
 *   hand-added to one is silently dropped the next time they are recaptured.
 */
async function installFixtures(page, overrides) {
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
    /* An override runs before the not-captured fallback, so it can supply a
       response the fixtures never recorded as well as transform one they
       did — it receives {} in that case. */
    if (overrides && overrides[u.pathname]) {
      body = JSON.stringify(overrides[u.pathname](JSON.parse(body === null ? '{}' : body)));
    } else if (body === null) {
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
  await installFixtures(page, opts.fixtures);
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

  /* The forecast rows are a day picker, so the browsed state is a real
     view — and the only one the tab-level shots never reach. Both themes,
     because the day bar, the back button and the selected-row treatment
     are all new CSS with no other coverage. */
  ['dark', 'light'].forEach(function (theme) {
    test('weather day detail @ ' + theme, async function ({ page }) {
      await gotoApp(page, { theme: theme, fontSize: 'normal' });
      await openTab(page, 'meteo');
      var day = page.locator('#wx-days .wx-day').nth(3);
      if (await day.count()) {
        await day.click();
        await page.waitForTimeout(600);
        await expect(page).toHaveScreenshot('overlay-weather-day-' + theme + '.png');
      }
    });
  });

  /* The light sheet is the only route to brightness, colour temperature and
     colour, and no shot reached it before — the tab shots stop at the tile.
     Two lights are needed because the sheet shows different controls for
     each: the fixture's only reachable light is colour-temperature-only,
     which covers the bar, the chips and the no-segmented layout; a
     colour-capable one has to be turned on through an override to reach the
     White/Colour switch and the swatches. */
  function colourLightOn(payload) {
    for (var i = 0; i < payload.entities.length; i++) {
      var e = payload.entities[i];
      if (e.entity_id !== 'light.yeelight') continue;
      e.state = 'on';
      e.attributes.color_mode = 'hs';
      e.attributes.brightness = 178;
      e.attributes.hs_color = [280, 85];
      e.attributes.rgb_color = [214, 38, 255];
    }
    return payload;
  }

  async function openSheet(page, index) {
    await openTab(page, 'smarthome');
    /* Scoped to the tab: the Home widget renders the same tiles and comes
       first in the DOM, so an unscoped locator picks a hidden one. */
    await page.locator('#page-smarthome .light-detail-open').nth(index).click();
    await page.waitForTimeout(600);
  }

  ['dark', 'light'].forEach(function (theme) {
    test('light sheet @ ' + theme, async function ({ page }) {
      await gotoApp(page, { theme: theme, fontSize: 'normal' });
      await openSheet(page, 0);
      await expect(page).toHaveScreenshot('overlay-light-sheet-' + theme + '.png');
    });
  });

  test('light sheet colour', async function ({ page }) {
    await gotoApp(page, {
      theme: 'dark', fontSize: 'normal',
      fixtures: { '/api/ha/devices': colourLightOn }
    });
    await openSheet(page, 1);
    await expect(page).toHaveScreenshot('overlay-light-sheet-colour.png');
  });

  test('light sheet colour wheel', async function ({ page }) {
    await gotoApp(page, {
      theme: 'dark', fontSize: 'normal',
      fixtures: { '/api/ha/devices': colourLightOn }
    });
    await openSheet(page, 1);
    await page.click('#btn-color-wheel');
    await page.waitForTimeout(400);
    await page.locator('#ctrl-color-wheel').scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await expect(page).toHaveScreenshot('overlay-light-sheet-wheel.png');
  });

  /* The Proxmox VM action row had no shot at all, and that is precisely how
     a Shutdown button which rendered as nothing on the device survived: its
     glyph was U+23FB, Unicode 9.0, newer than iOS 9.3. It is now the densest
     row of drawn icons in the app, so it is worth a baseline. A running QEMU
     guest is chosen deliberately — that is the state in which every button
     in the row appears at once. Wider viewport because the Server tab is a
     master/detail split and is exempt from the content cap at every width. */
  test('server vm actions', async function ({ page }) {
    await page.setViewportSize({ width: 1024, height: 768 });
    await gotoApp(page, {
      theme: 'dark', fontSize: 'normal',
      /* The captured set has no per-VM status at all — that request was
         never exercised, which is part of why this row went unchecked for
         so long. Without it the detail renders the stopped action set and
         the buttons worth covering never appear. */
      fixtures: {
        '/api/px/nodes/proxmox/qemu/101/status': function () {
          return {
            status: 'running', name: 'ubuntu-server', cpu: 0.0724, cpus: 4,
            mem: 9824870400, maxmem: 10737418240, uptime: 444959,
            diskread: 0, diskwrite: 0, netin: 47082755449, netout: 14648556352
          };
        }
      }
    });
    await openTab(page, 'server');
    await page.locator('.px-tree-item.px-vm').first().click();
    await page.waitForTimeout(800);
    await expect(page).toHaveScreenshot('overlay-server-vm-actions.png');
  });

  /* Two lists of drawn icons that no tab shot reaches: the Settings widget
     picker sits inside a collapsed accordion, and the missing-poster mark
     only appears for an item Jellyfin has no image for. Both were carrying
     typographic glyphs until recently, and neither had any coverage — which
     is exactly how a glyph the device cannot render survives. */
  test('settings widget picker', async function ({ page }) {
    await gotoApp(page, { theme: 'dark', fontSize: 'normal' });
    await openTab(page, 'settings');
    await page.click('#feat-hdr-smarthome');
    await page.waitForTimeout(500);
    await page.locator('#feat-list-smarthome').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot('overlay-settings-widget-picker.png');
  });

  test('jellyfin missing poster', async function ({ page }) {
    await gotoApp(page, {
      theme: 'dark', fontSize: 'normal',
      fixtures: {
        '/api/jf/items': function (payload) {
          /* Strip the image tag from the first two so the placeholder sits
             beside real posters and any size or colour drift shows up. */
          for (var i = 0; i < 2 && i < payload.items.length; i++) {
            delete payload.items[i].ImageTags;
          }
          return payload;
        }
      }
    });
    await openTab(page, 'jelly');
    await page.waitForTimeout(600);
    await expect(page).toHaveScreenshot('overlay-jellyfin-no-poster.png');
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
