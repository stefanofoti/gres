'use strict';

/**
 * Playwright config — visual regression suite only (tests/visual/).
 *
 * Unit tests stay on jest (tests/backend, tests/frontend); jest matches
 * *.test.js and this suite uses *.spec.js, so the two never collide.
 *
 *   npx playwright test                      # compare against baseline
 *   npx playwright test --update-snapshots   # re-baseline after an intended change
 */

var { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/visual',
  testMatch: '**/*.spec.js',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? 'line' : [['list']],

  /* Screenshots are the assertion here, so both knobs are tightened well
     below Playwright's defaults.
       threshold          per-pixel YIQ distance before a pixel counts as
                          changed. The 0.2 default is far too permissive for
                          this refactor: a 42/255 colour change on 11px label
                          text went undetected. 0.04 catches it while still
                          absorbing font antialiasing jitter.
       maxDiffPixelRatio  how many changed pixels are tolerated overall. */
  expect: {
    toHaveScreenshot: {
      threshold: 0.04,
      maxDiffPixelRatio: 0.001,
      animations: 'disabled',
      caret: 'hide'
    }
  },

  use: {
    baseURL: 'http://localhost:' + (process.env.VISUAL_PORT || 3100),
    launchOptions: { args: ['--no-sandbox'] },
    /* Force a stable rendering surface across machines. */
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    timezoneId: 'Europe/Rome',
    locale: 'en-US'
  },

  webServer: {
    command: 'node tests/visual/static-server.js',
    url: 'http://localhost:' + (process.env.VISUAL_PORT || 3100),
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore'
  }
});
