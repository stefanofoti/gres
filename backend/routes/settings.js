/**
 * routes/settings.js
 *
 * Provides a simple persistent key-value store backed by a JSON file
 * (backend/data/settings.json).  All integration credentials (Home
 * Assistant, Jellyfin, Proxmox) are saved here so they survive restarts
 * without requiring a database.
 *
 * Endpoints:
 *   GET  /api/settings        — return all settings as a JSON object
 *   GET  /api/settings/:key   — return a single value by key
 *   POST /api/settings        — merge the request body into stored settings
 *   DELETE /api/settings/:key — remove a single key
 */

'use strict';

var express = require('express');
var router  = express.Router();
var fs      = require('fs');
var path    = require('path');

/* Path to the persistent settings file */
var DATA_FILE = path.join(process.cwd(), 'data/settings.json');

/* ── Helpers ────────────────────────────────────────────── */

/**
 * Ensure the data directory and file exist.
 * Called before every read/write to guard against first-run scenarios.
 */
function ensureDataDir() {
  var dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir))       fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({}));
}

/**
 * Read and parse the settings file.
 * Returns an empty object on any parse error.
 *
 * @returns {Object} Parsed settings map.
 */
function readSettings() {
  ensureDataDir();
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

/**
 * Serialise and write a settings map to disk.
 *
 * @param {Object} data — settings to persist.
 */
function writeSettings(data) {
  ensureDataDir();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

/* ── Routes ─────────────────────────────────────────────── */

/** GET /api/settings — return all stored key/value pairs */
router.get('/', function (req, res) {
  req.log.debug('reading all settings');
  res.json(readSettings());
});

/** GET /api/settings/:key — return a single setting value */
router.get('/:key', function (req, res) {
  var settings = readSettings();
  var value    = settings[req.params.key];
  if (value === undefined) {
    req.log.warn({ key: req.params.key }, 'settings key not found');
    return res.status(404).json({ error: 'Key not found' });
  }
  req.log.debug({ key: req.params.key }, 'reading single setting');
  res.json({ key: req.params.key, value: value });
});

/** POST /api/settings — merge body into current settings and persist */
router.post('/', function (req, res) {
  var current = readSettings();
  /* Shallow merge: new keys overwrite existing ones */
  var updated = Object.assign(current, req.body);
  writeSettings(updated);
  req.log.info({ keys: Object.keys(req.body) }, 'settings updated');
  res.json({ success: true, settings: updated });
});

/** DELETE /api/settings/:key — remove a single key from settings */
router.delete('/:key', function (req, res) {
  var settings = readSettings();
  delete settings[req.params.key];
  writeSettings(settings);
  req.log.info({ key: req.params.key }, 'setting deleted');
  res.json({ success: true });
});

module.exports = router;
