/**
 * routes/settings.js
 *
 * Persistent key-value store backed by a JSON file (data/settings.json).
 * All integration credentials live here so they survive restarts without a
 * database.
 *
 * The store holds three tiers of data, and the routes below exist to keep
 * them apart:
 *
 *   PUBLIC  — UI state the frontend needs on first paint (which widgets are
 *             on the Home grid, which tabs are disabled). Readable by anyone
 *             who can load the page, because the page cannot render without
 *             it.
 *   ADMIN   — service URLs and the Proxmox token id. Readable only with the
 *             'settings' scope; they name internal hosts and belong with the
 *             credentials rather than with the UI state.
 *   SECRET  — the tokens themselves. Never returned by any route. The admin
 *             read reports whether each one is set, and the Settings form
 *             shows a masked placeholder and submits a value only when the
 *             user types a new one.
 *
 * This split is the fix for the central problem the old single GET had: it
 * returned the file whole, unauthenticated, so one request yielded a Home
 * Assistant long-lived token, a Jellyfin API key and a Proxmox token. The
 * public read is an allowlist rather than a denylist so that a key added to
 * the store in future is private by default instead of exposed by default.
 *
 * Endpoints:
 *   GET    /api/settings       — public UI state only
 *   GET    /api/settings/admin — URLs + {key}_set booleans   [scope: settings]
 *   GET    /api/settings/:key  — a single public key
 *   POST   /api/settings       — merge into the store        [scope: settings]
 *   DELETE /api/settings/:key  — remove a key                [scope: settings]
 */

'use strict';

var express = require('express');
var router  = express.Router();
var session = require('../middleware/session');
var store   = require('../lib/settingsStore');

/**
 * Keys the frontend needs before anyone has authenticated. Everything not
 * listed here is withheld from the public read — new keys are private until
 * someone deliberately adds them.
 */
var PUBLIC_KEYS = [
  'home_widgets',
  'features_disabled',
  'weather_default_location',
  'ha_protected_entities'
];

/** Configuration the Settings forms display, behind the settings scope. */
var ADMIN_KEYS = [
  'ha_url',
  'jf_url',
  'px_url',
  'px_tokenid'
];

/** Credentials. Reported as set/unset, never returned. */
var SECRET_KEYS = [
  'ha_token',
  'jf_token',
  'px_token'
];

/* ── Helpers ────────────────────────────────────────────── */

var readSettings  = store.readSettings;
var writeSettings = store.writeSettings;

/* Every key POST /api/settings is allowed to write. Anything else in the
   body is silently dropped rather than merged — the previous unconditional
   Object.assign(current, req.body) would also have accepted a "__proto__"
   key, which Object.assign's normal property-set semantics resolve against
   Object.prototype rather than storing as data. */
var WRITABLE_KEYS = PUBLIC_KEYS.concat(ADMIN_KEYS, SECRET_KEYS);

/**
 * Project the stored settings down to the public allowlist.
 *
 * @param {Object} settings
 * @returns {Object}
 */
function publicView(settings) {
  var out = {};
  for (var i = 0; i < PUBLIC_KEYS.length; i++) {
    var k = PUBLIC_KEYS[i];
    if (settings[k] !== undefined) out[k] = settings[k];
  }
  return out;
}

/**
 * Project the stored settings down to what the Settings forms need: the
 * non-secret configuration verbatim, plus a boolean per credential so the
 * form can show "configured" without ever receiving the value.
 *
 * @param {Object} settings
 * @returns {Object}
 */
function adminView(settings) {
  var out = {};
  var i;
  for (i = 0; i < ADMIN_KEYS.length; i++) {
    var k = ADMIN_KEYS[i];
    if (settings[k] !== undefined) out[k] = settings[k];
  }
  for (i = 0; i < SECRET_KEYS.length; i++) {
    var s = SECRET_KEYS[i];
    out[s + '_set'] = !!(settings[s] && String(settings[s]).length);
  }
  return out;
}

/* ── Routes ─────────────────────────────────────────────── */

/**
 * GET /api/settings/admin
 * Service URLs plus a set/unset flag per credential. Must be declared before
 * GET /:key, or Express matches 'admin' as a key name.
 */
router.get('/admin', session.requireScope('settings'), function (req, res) {
  req.log.debug('reading admin settings');
  res.json(adminView(readSettings()));
});

/** GET /api/settings — public UI state only */
router.get('/', function (req, res) {
  req.log.debug('reading public settings');
  res.json(publicView(readSettings()));
});

/** GET /api/settings/:key — a single public key */
router.get('/:key', function (req, res) {
  var key = req.params.key;

  /* Non-public keys are reported as missing rather than forbidden: this
     route exists for UI state, and saying "exists but denied" would confirm
     which credentials are configured to an unauthenticated caller. */
  if (PUBLIC_KEYS.indexOf(key) === -1) {
    req.log.warn({ key: key }, 'settings key not readable');
    return res.status(404).json({ error: 'Key not found' });
  }

  var value = readSettings()[key];
  if (value === undefined) {
    req.log.warn({ key: key }, 'settings key not found');
    return res.status(404).json({ error: 'Key not found' });
  }
  res.json({ key: key, value: value });
});

/** POST /api/settings — merge known keys from the body into settings and persist */
router.post('/', session.requireScope('settings'), function (req, res) {
  var body = req.body || {};
  var current = readSettings();
  var written = [];

  for (var i = 0; i < WRITABLE_KEYS.length; i++) {
    var key = WRITABLE_KEYS[i];
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      current[key] = body[key];
      written.push(key);
    }
  }

  writeSettings(current);
  req.log.info({ keys: written }, 'settings updated');
  /* Echo the public view only — the old handler returned the whole merged
     store, credentials included, straight back to the browser. */
  res.json({ success: true, settings: publicView(current) });
});

/** DELETE /api/settings/:key — remove a single key from settings */
router.delete('/:key', session.requireScope('settings'), function (req, res) {
  var settings = readSettings();
  delete settings[req.params.key];
  writeSettings(settings);
  req.log.info({ key: req.params.key }, 'setting deleted');
  res.json({ success: true });
});

module.exports = router;
module.exports.PUBLIC_KEYS = PUBLIC_KEYS;
module.exports.ADMIN_KEYS  = ADMIN_KEYS;
module.exports.SECRET_KEYS = SECRET_KEYS;
