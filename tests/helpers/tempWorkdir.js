'use strict';

/**
 * Backend routes resolve their data file as path.join(process.cwd(), 'data/settings.json')
 * at module-require time. To keep tests from ever touching the real repo-root
 * data/settings.json, each test chdirs into a fresh temp directory and re-requires
 * the route module so the new cwd is baked in.
 *
 * Note: plain `delete require.cache[...]` does NOT bust Jest's own module
 * registry (Jest intercepts `require` per test file; the native
 * `require.cache` object it exposes isn't authoritative), so a module
 * "deleted" that way keeps coming back from Jest's cache with its original
 * closed-over DATA_FILE — silently leaking state between tests. Only
 * jest.resetModules() actually clears Jest's registry.
 *
 * Because resetModules() clears EVERYTHING, any test file that mocks a
 * module the route pulls in via require() must re-require it *after*
 * useTempWorkdir() runs, in the same beforeEach, to pick up the fresh mock
 * instance the freshly-required route will actually call. (Routes that
 * call the global `fetch` instead of require()-ing it are unaffected —
 * see homeassistant/jellyfin/weather tests, which stub global.fetch.)
 */

var fs = require('fs');
var os = require('os');
var path = require('path');

var originalCwd = null;
var currentTmpDir = null;

function useTempWorkdir() {
  originalCwd = process.cwd();
  currentTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gres-test-'));
  process.chdir(currentTmpDir);
  jest.resetModules();
  return currentTmpDir;
}

function restoreWorkdir() {
  if (originalCwd) process.chdir(originalCwd);
  if (currentTmpDir && fs.existsSync(currentTmpDir)) {
    fs.rmSync(currentTmpDir, { recursive: true, force: true });
  }
  originalCwd = null;
  currentTmpDir = null;
}

/** Require a module fresh. `absolutePath` must be absolute (path.join(__dirname, ...)). */
function requireFresh(absolutePath) {
  return require(absolutePath);
}

/** No-op req.log stub (mirrors the shape attached by middleware/requestLogger) */
function noopLog() {
  return { debug: function () {}, info: function () {}, warn: function () {}, error: function () {} };
}

function attachNoopLog(req, res, next) {
  req.log = noopLog();
  next();
}

module.exports = {
  useTempWorkdir: useTempWorkdir,
  restoreWorkdir: restoreWorkdir,
  requireFresh: requireFresh,
  attachNoopLog: attachNoopLog
};
