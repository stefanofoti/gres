/**
 * lib/settingsStore.js
 *
 * The raw read/write of data/settings.json, shared by every router that
 * touches it (homeassistant, jellyfin, proxmox, weather, markets, settings).
 * Each of those previously carried its own byte-identical copy of this
 * ensure-dir + read + atomic-write logic; this is the one place it lives
 * now. Routers keep their own higher-level shaping on top (getHAConfig,
 * adminView, etc.) — this module only knows how to get the file on and
 * off disk safely.
 */

'use strict';

var fs   = require('fs');
var path = require('path');

var DATA_FILE = path.join(process.cwd(), 'data/settings.json');

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
 * Serialise and write a settings map to disk atomically.
 * Writes to a temp file first, then renames to avoid corruption
 * if the process is killed mid-write.
 *
 * @param {Object} data — settings to persist.
 */
function writeSettings(data) {
  ensureDataDir();
  var tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

module.exports = {
  DATA_FILE:     DATA_FILE,
  readSettings:  readSettings,
  writeSettings: writeSettings
};
