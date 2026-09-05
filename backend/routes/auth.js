/**
 * routes/auth.js
 *
 * Lightweight numeric-PIN gate, generalised across multiple "scopes":
 *
 *   - 'settings' — protects landing on the Settings tab.
 *     PIN comes from the SETTINGS_PIN environment variable.
 *   - 'devices'  — protects interacting with smart devices that have been
 *     flagged as locked in Settings → "Protezione dispositivi".
 *     PIN comes from the DEVICES_PIN environment variable (independent
 *     from SETTINGS_PIN, so it can be the same or a different code).
 *
 * Either PIN lives only in the environment and is never sent to the
 * browser: the frontend posts a candidate PIN for a given scope and the
 * backend replies with a boolean. If a scope's PIN env var is not set,
 * that scope's protection is considered disabled.
 *
 * The PIN *length* (digit count, not the value) is exposed so the
 * frontend can auto-submit as soon as the expected number of digits has
 * been typed, without ever knowing the PIN itself.
 *
 * A small in-memory rate limiter throttles brute-force attempts per
 * IP + scope.
 *
 * Endpoints:
 *   GET  /api/auth/pin-status?scope=settings|devices
 *        -> { required: boolean, length: number }
 *   POST /api/auth/verify-pin   Body: { scope, pin } -> { ok: boolean }
 */

'use strict';

var express = require('express');
var router  = express.Router();
var crypto  = require('crypto');
var session = require('../middleware/session');

var MAX_ATTEMPTS = 5;
var LOCKOUT_MS   = 5 * 60 * 1000; /* 5 minutes */

/* Scope -> environment variable mapping lives with the session middleware,
   which is what actually enforces a scope; this route only grants one. */
var SCOPE_ENV = session.SCOPE_ENV;

/* In-memory attempt tracker: { "ip|scope": { count, firstAt } } */
var attempts = {};

/**
 * Normalise an incoming scope value to one of the supported keys.
 * Defaults to 'settings' for backward compatibility.
 *
 * @param {*} raw
 * @returns {string}
 */
function normalizeScope(raw) {
  return Object.prototype.hasOwnProperty.call(SCOPE_ENV, raw) ? raw : 'settings';
}

/**
 * Current configured PIN for a scope, read live from the environment so
 * it can be changed (e.g. by editing .env + restarting) without touching
 * code.
 *
 * @param {string} scope
 * @returns {string} the PIN, or '' if not configured.
 */
function getConfiguredPin(scope) {
  return session.getConfiguredPin(normalizeScope(scope));
}

/**
 * Constant-time string comparison (avoids leaking PIN length/content via
 * timing). Falls back to false on any length mismatch handling error.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function safeEqual(a, b) {
  var bufA = Buffer.from(String(a));
  var bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    /* Still run a comparison of equal-length buffers to keep timing
       roughly constant, then return false regardless. */
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * @param {import('express').Request} req
 * @returns {string}
 */
function clientIp(req) {
  return req.ip || (req.connection && req.connection.remoteAddress) || 'unknown';
}

/**
 * Drop every attempts entry whose lockout window has already expired.
 * Without this, an entry only ever gets deleted when its own key is
 * looked up again — a distinct IP that never comes back leaves its record
 * behind forever. Called from isLockedOut, which runs on every PIN
 * attempt, so the map never grows past attackers active in the current
 * window.
 */
function sweepExpiredAttempts() {
  var now = Date.now();
  for (var key in attempts) {
    if (Object.prototype.hasOwnProperty.call(attempts, key) &&
        now - attempts[key].firstAt > LOCKOUT_MS) {
      delete attempts[key];
    }
  }
}

/**
 * True when the given IP+scope has exceeded MAX_ATTEMPTS within the
 * lockout window.
 *
 * @param {string} key
 * @returns {boolean}
 */
function isLockedOut(key) {
  sweepExpiredAttempts();
  var rec = attempts[key];
  if (!rec) return false;
  return rec.count >= MAX_ATTEMPTS;
}

/**
 * Record a failed attempt for the given key.
 *
 * @param {string} key
 */
function recordFailure(key) {
  var rec = attempts[key];
  var now = Date.now();
  if (!rec || now - rec.firstAt > LOCKOUT_MS) {
    rec = { count: 0, firstAt: now };
    attempts[key] = rec;
  }
  rec.count++;
}

/**
 * Clear any failure record for the given key (on success).
 *
 * @param {string} key
 */
function clearFailures(key) {
  delete attempts[key];
}

/* ── Routes ─────────────────────────────────────────────── */

/**
 * GET /api/auth/pin-status?scope=settings|devices
 * Tells the frontend whether a given scope is PIN-protected, and how
 * many digits the PIN has (so the UI can auto-submit), without ever
 * revealing the PIN itself.
 */
router.get('/pin-status', function (req, res) {
  var scope = normalizeScope(req.query.scope);
  var configured = getConfiguredPin(scope);
  res.json({ required: configured.length > 0, length: configured.length });
});

/**
 * POST /api/auth/verify-pin
 * Body: { scope: 'settings'|'devices', pin: string }
 */
router.post('/verify-pin', function (req, res) {
  var scope      = normalizeScope(req.body && req.body.scope);
  var configured = getConfiguredPin(scope);

  /* No PIN configured for this scope -> nothing to verify, always allow.
     No cookie either: requireScope() lets an unprotected scope straight
     through, so there is nothing for a session to carry. */
  if (!configured) {
    return res.json({ ok: true });
  }

  var ip  = clientIp(req);
  var key = ip + '|' + scope;
  if (isLockedOut(key)) {
    req.log.warn({ ip: ip, scope: scope }, 'PIN locked out: too many attempts');
    return res.status(429).json({ ok: false, error: 'Too many attempts. Try again later.' });
  }

  var candidate = (req.body && req.body.pin != null) ? String(req.body.pin) : '';
  var ok = candidate.length > 0 && safeEqual(candidate, configured);

  if (ok) {
    clearFailures(key);
    /* Turn the verified PIN into something later requests can present.
       Without this the gate is advisory and the API stays open to anyone
       who skips the UI. */
    session.grantScope(req, res, scope);
    req.log.info({ scope: scope }, 'PIN verified, scope granted');
    return res.json({ ok: true });
  }

  recordFailure(key);
  req.log.warn({ ip: ip, scope: scope }, 'PIN verification failed');
  res.json({ ok: false });
});

module.exports = router;
/* Test-only introspection of the rate-limit map — mirrors how settings.js
   exports its key lists alongside the router. */
module.exports._attempts = attempts;
