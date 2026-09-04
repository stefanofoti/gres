/**
 * middleware/session.js
 *
 * Scope-based access control for the API.
 *
 * The PIN gates used to be advisory: `verify-pin` answered a boolean and the
 * frontend decided what to do with it, which meant the API itself was open to
 * anyone who skipped the UI. This module turns a verified PIN into something
 * the server can check on a later request.
 *
 * On success `verify-pin` issues an HMAC-signed cookie naming the scopes the
 * caller has unlocked. A cookie rather than a bearer token specifically
 * because of the target device: the browser attaches it automatically, so the
 * frontend's single XHR helper needs no plumbing at all, and HttpOnly puts it
 * out of reach of any script on the page.
 *
 *   Set-Cookie: gres_sess=<payload>.<hmac>; HttpOnly; SameSite=Lax; Path=/
 *   payload = { "scopes": ["settings"], "exp": 1788000000000 }
 *
 * The payload is signed, not encrypted — it carries scope names and an expiry,
 * never a secret. The signing key comes from SESSION_SECRET, or is generated
 * on first boot and persisted next to the settings file so that a container
 * restart doesn't sign the wall panel out.
 *
 * Two deliberate choices:
 *
 *   - SameSite=Lax is safe on the iOS 9.3 target. The attribute postdates
 *     that engine, and RFC 6265 requires unknown cookie attributes to be
 *     ignored, so iOS 9 stores the cookie normally while modern browsers get
 *     the CSRF protection. Don't remove it defensively.
 *
 *   - No Secure flag. gres is normally served over plain HTTP on a LAN, and
 *     Secure would stop the cookie being stored at all. Anyone terminating
 *     TLS in front of gres should set it at the proxy.
 *
 * A scope with no PIN configured is not protected — the same rule the PIN
 * gates have always followed, and what keeps the zero-configuration install
 * working. Setting the matching environment variable is what turns a scope on.
 */

'use strict';

var crypto = require('crypto');
var fs     = require('fs');
var path   = require('path');

var COOKIE_NAME = 'gres_sess';

/* Long-lived on purpose: this is a wall panel that nobody signs into twice. */
var TTL_MS = 30 * 24 * 60 * 60 * 1000;

/* Supported scopes -> the environment variable that configures each one. */
var SCOPE_ENV = {
  settings: 'SETTINGS_PIN',
  devices:  'DEVICES_PIN',
  server:   'SERVER_PIN'
};

/* Memoised per data directory. Tests chdir into a temp workdir, so the path
   is resolved on every call rather than closed over at require time. */
var _secretCache = {};

/* ── Signing key ────────────────────────────────────────── */

function secretPath() {
  return path.join(process.cwd(), 'data/.session-secret');
}

/**
 * The HMAC key. SESSION_SECRET wins; otherwise a key is generated once and
 * written to the data volume so cookies survive a restart or an image update.
 * If the file cannot be written we still return a key — sessions then last
 * only until the process exits, which is degraded but not broken.
 *
 * @returns {string}
 */
function getSecret() {
  if (process.env.SESSION_SECRET) return String(process.env.SESSION_SECRET);

  var file = secretPath();
  if (_secretCache[file]) return _secretCache[file];

  try {
    if (fs.existsSync(file)) {
      var stored = fs.readFileSync(file, 'utf8').trim();
      if (stored) {
        _secretCache[file] = stored;
        return stored;
      }
    }
  } catch (e) { /* fall through and generate */ }

  var generated = crypto.randomBytes(32).toString('hex');
  try {
    var dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, generated, { mode: 0o600 });
  } catch (e) { /* in-memory only for this process */ }

  _secretCache[file] = generated;
  return generated;
}

/* ── Token encoding ─────────────────────────────────────── */

function b64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(input) {
  var t = String(input).replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  return Buffer.from(t, 'base64').toString('utf8');
}

function hmac(data) {
  return b64url(crypto.createHmac('sha256', getSecret()).update(data).digest());
}

/**
 * @param {{scopes: Array<string>, exp: number}} payload
 * @returns {string}
 */
function sign(payload) {
  var body = b64url(JSON.stringify(payload));
  return body + '.' + hmac(body);
}

/**
 * Verify a token's signature and expiry.
 *
 * @param {string} token
 * @returns {Object|null} the payload, or null if forged, malformed or expired.
 */
function verify(token) {
  if (!token || typeof token !== 'string') return null;

  var dot = token.lastIndexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;

  var body = token.slice(0, dot);
  var sig  = token.slice(dot + 1);

  var expected = hmac(body);
  var a = Buffer.from(sig);
  var b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;

  var payload;
  try { payload = JSON.parse(unb64url(body)); } catch (e) { return null; }

  if (!payload || typeof payload !== 'object') return null;
  if (!Array.isArray(payload.scopes)) return null;
  if (typeof payload.exp !== 'number' || Date.now() > payload.exp) return null;

  return payload;
}

/* ── Request helpers ────────────────────────────────────── */

/**
 * Read one cookie off the raw header. Avoids a cookie-parser dependency for
 * the single cookie this app has.
 *
 * @param {import('express').Request} req
 * @param {string} name
 * @returns {string}
 */
function readCookie(req, name) {
  var header = req.headers && req.headers.cookie;
  if (!header) return '';
  var parts = String(header).split(';');
  for (var i = 0; i < parts.length; i++) {
    var p  = parts[i].trim();
    var eq = p.indexOf('=');
    if (eq === -1) continue;
    if (p.slice(0, eq) === name) {
      try { return decodeURIComponent(p.slice(eq + 1)); }
      catch (e) { return p.slice(eq + 1); }
    }
  }
  return '';
}

/**
 * Scopes this request has unlocked. Reads the cookie directly rather than
 * relying on attachSession having run, so it is safe to call from anywhere.
 *
 * @param {import('express').Request} req
 * @returns {Array<string>}
 */
function scopesOf(req) {
  if (req && req._gresScopes) return req._gresScopes;
  var payload = verify(readCookie(req, COOKIE_NAME));
  var scopes  = payload ? payload.scopes : [];
  if (req) req._gresScopes = scopes;
  return scopes;
}

/**
 * @param {import('express').Request} req
 * @param {string} scope
 * @returns {boolean}
 */
function hasScope(req, scope) {
  return scopesOf(req).indexOf(scope) !== -1;
}

/**
 * The PIN configured for a scope, read live from the environment so it can be
 * changed without touching code.
 *
 * @param {string} scope
 * @returns {string} the PIN, or '' when the scope is not protected.
 */
function getConfiguredPin(scope) {
  var envName = SCOPE_ENV[scope];
  if (!envName) return '';
  var raw = process.env[envName];
  if (raw === undefined || raw === null) return '';
  return String(raw).trim();
}

/**
 * True when a scope has a PIN configured and therefore gates anything.
 *
 * @param {string} scope
 * @returns {boolean}
 */
function isScopeRequired(scope) {
  return getConfiguredPin(scope).length > 0;
}

/**
 * Add a scope to the caller's session and re-issue the cookie. Existing
 * scopes are preserved, so unlocking devices does not sign you out of
 * settings.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {string} scope
 */
function grantScope(req, res, scope) {
  var current = scopesOf(req).slice();
  if (current.indexOf(scope) === -1) current.push(scope);

  var token = sign({ scopes: current, exp: Date.now() + TTL_MS });

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    path:     '/',
    maxAge:   TTL_MS
  });

  /* Later middleware on this same request sees the new scope. */
  req._gresScopes = current;
}

/* ── Middleware ─────────────────────────────────────────── */

/**
 * Populates req.scopes for handlers that need a conditional check rather than
 * a hard gate (the Home Assistant service route, which only requires a scope
 * when the call names a protected entity).
 */
function attachSession(req, res, next) {
  req.scopes = scopesOf(req);
  next();
}

/**
 * Hard gate. Passes through untouched when the scope has no PIN configured,
 * which is what preserves the zero-configuration install.
 *
 * @param {string} scope
 * @returns {Function} express middleware
 */
function requireScope(scope) {
  /* Named so tests/backend/boundary.test.js can walk the router stack and
     recognise a guarded route. Renaming it weakens that check. */
  return function scopeGate(req, res, next) {
    if (!isScopeRequired(scope)) return next();
    if (hasScope(req, scope)) return next();
    if (req.log) req.log.warn({ scope: scope, url: req.originalUrl }, 'scope required');
    res.status(401).json({ error: 'PIN required', scope: scope });
  };
}

module.exports = {
  COOKIE_NAME:      COOKIE_NAME,
  SCOPE_ENV:        SCOPE_ENV,
  TTL_MS:           TTL_MS,
  sign:             sign,
  verify:           verify,
  readCookie:       readCookie,
  scopesOf:         scopesOf,
  hasScope:         hasScope,
  getConfiguredPin: getConfiguredPin,
  isScopeRequired:  isScopeRequired,
  grantScope:       grantScope,
  attachSession:    attachSession,
  requireScope:     requireScope
};
