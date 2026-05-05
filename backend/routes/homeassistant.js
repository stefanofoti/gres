/**
 * routes/homeassistant.js
 *
 * Proxies requests to a local Home Assistant instance so that:
 *   - The HA long-lived access token never reaches the browser.
 *   - CORS restrictions on the HA API are bypassed server-side.
 *
 * All HA connection details (URL + token) are read from the shared
 * settings file on every request, so credential changes take effect
 * without a server restart.
 *
 * Endpoints:
 *   GET  /api/ha/status               — test connectivity to HA
 *   GET  /api/ha/entities[?domain=]   — list smart-home entities
 *   GET  /api/ha/entity/:entity_id    — fetch a single entity state
 *   POST /api/ha/service              — call a HA service (e.g. light.turn_on)
 */

'use strict';

var express = require('express');
var router  = express.Router();
var fetch   = require('node-fetch');
var fs      = require('fs');
var path    = require('path');

var DATA_FILE = path.join(process.cwd(), 'data/settings.json');
/**
 * Domains exposed to the frontend Smart-Home tab.
 * Adding a domain here makes it visible without touching the frontend.
 */
var RELEVANT_DOMAINS = [
  'light', 'switch', 'input_boolean',
  'cover', 'fan', 'climate', 'media_player'
];

/* ── Config helpers ─────────────────────────────────────── */

/**
 * Read HA connection config from the settings file.
 * Returns empty strings if the file is missing or malformed.
 *
 * @returns {{ url: string, token: string }}
 */
function getHAConfig() {
  try {
    var s = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return { url: s.ha_url || '', token: s.ha_token || '' };
  } catch (e) {
    return { url: '', token: '' };
  }
}

/**
 * Build the HTTP headers required by the HA REST API.
 *
 * @param {string} token — long-lived access token
 * @returns {Object}
 */
function haHeaders(token) {
  return {
    'Authorization': 'Bearer ' + token,
    'Content-Type':  'application/json'
  };
}

/* ── Routes ─────────────────────────────────────────────── */

/**
 * GET /api/ha/status
 * Ping the HA API root and return a connection status object.
 * Used by the frontend status bar dot and the Settings test button.
 */
router.get('/status', function (req, res) {
  var config = getHAConfig();
  if (!config.url || !config.token) {
    req.log.warn('HA not configured');
    return res.json({ connected: false, error: 'No HA configuration found' });
  }
  req.log.debug({ haUrl: config.url }, 'checking HA status');
  fetch(config.url + '/api/', { headers: haHeaders(config.token), timeout: 5000 })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      req.log.info('HA connection OK');
      res.json({ connected: true, message: data.message || 'OK' });
    })
    .catch(function (err) {
      req.log.warn({ err: err.message }, 'HA connection failed');
      res.json({ connected: false, error: err.message });
    });
});

/**
 * GET /api/ha/entities[?domain=light]
 * Returns all entities belonging to RELEVANT_DOMAINS (or the requested
 * domain if the `domain` query param is supplied).
 */
router.get('/entities', function (req, res) {
  var config = getHAConfig();
  if (!config.url || !config.token) {
    return res.status(400).json({ error: 'HA not configured' });
  }

  var domain = req.query.domain || null;
  req.log.debug({ domain: domain }, 'fetching HA entities');

  fetch(config.url + '/api/states', { headers: haHeaders(config.token), timeout: 8000 })
    .then(function (r) { return r.json(); })
    .then(function (entities) {
      if (!Array.isArray(entities)) throw new Error('Invalid response from HA');

      /* Filter to a specific domain if requested */
      if (domain) {
        entities = entities.filter(function (e) {
          return e.entity_id && e.entity_id.startsWith(domain + '.');
        });
      } else {
        /* Otherwise restrict to the domains the UI knows how to render */
        entities = entities.filter(function (e) {
          var d = e.entity_id.split('.')[0];
          return RELEVANT_DOMAINS.indexOf(d) !== -1;
        });
      }

      req.log.info({ count: entities.length }, 'entities returned');
      res.json(entities);
    })
    .catch(function (err) {
      req.log.error({ err: err.message }, 'error fetching HA entities');
      res.status(500).json({ error: err.message });
    });
});

/**
 * GET /api/ha/entity/:entity_id
 * Fetch the current state of a single HA entity.
 */
router.get('/entity/:entity_id', function (req, res) {
  var config = getHAConfig();
  if (!config.url || !config.token) {
    return res.status(400).json({ error: 'HA not configured' });
  }
  req.log.debug({ entityId: req.params.entity_id }, 'fetching single entity');
  fetch(config.url + '/api/states/' + req.params.entity_id, {
    headers: haHeaders(config.token), timeout: 5000
  })
    .then(function (r) { return r.json(); })
    .then(function (data) { res.json(data); })
    .catch(function (err) {
      req.log.error({ err: err.message }, 'error fetching entity');
      res.status(500).json({ error: err.message });
    });
});

/**
 * POST /api/ha/service
 * Call a HA service (e.g. light.turn_on, switch.turn_off).
 *
 * Body: { domain, service, service_data }
 */
router.post('/service', function (req, res) {
  var config = getHAConfig();
  if (!config.url || !config.token) {
    return res.status(400).json({ error: 'HA not configured' });
  }

  var domain      = req.body.domain;
  var service     = req.body.service;
  var serviceData = req.body.service_data || {};

  if (!domain || !service) {
    return res.status(400).json({ error: 'domain and service are required' });
  }

  req.log.info({ domain: domain, service: service, entityId: serviceData.entity_id },
    'calling HA service');

  fetch(config.url + '/api/services/' + domain + '/' + service, {
    method:  'POST',
    headers: haHeaders(config.token),
    body:    JSON.stringify(serviceData),
    timeout: 8000
  })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      req.log.debug({ domain: domain, service: service }, 'HA service call succeeded');
      res.json({ success: true, result: data });
    })
    .catch(function (err) {
      req.log.error({ err: err.message }, 'HA service call failed');
      res.status(500).json({ error: err.message });
    });
});

module.exports = router;
