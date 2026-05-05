/**
 * routes/proxmox.js
 *
 * Proxies requests to a Proxmox VE cluster API so that:
 *   - API tokens never reach the browser.
 *   - Self-signed TLS certificates (default in PVE) are accepted.
 *
 * Authentication uses the PVE API Token scheme:
 *   Authorization: PVEAPIToken=<tokenId>=<secret>
 * where tokenId has the form "user@realm!tokenname"
 * (e.g. "root@pam!homeapp").
 *
 * All connection details are read from the shared settings file on every
 * request; credential changes take effect without a restart.
 *
 * Endpoints:
 *   GET  /api/px/status                          — PVE version / connectivity
 *   GET  /api/px/nodes                           — cluster node list
 *   GET  /api/px/nodes/:node/status              — node hardware stats
 *   POST /api/px/nodes/:node/power               — shutdown | reboot node
 *   GET  /api/px/nodes/:node/vms                 — QEMU + LXC list
 *   GET  /api/px/nodes/:node/:type/:vmid/status  — VM live stats
 *   POST /api/px/nodes/:node/:type/:vmid/action  — start|stop|shutdown|reset|suspend|resume
 *   GET  /api/px/nodes/:node/storage             — storage volumes
 *   GET  /api/px/nodes/:node/rrd                 — node RRD time-series
 *   GET  /api/px/nodes/:node/:type/:vmid/rrd     — VM RRD time-series
 *   GET  /api/px/nodes/:node/:type/:vmid/vnc-url — noVNC console URL
 */

'use strict';

var express = require('express');
var router  = express.Router();
var https   = require('https');
var http    = require('http');
var fs      = require('fs');
var path    = require('path');
var url     = require('url');

var DATA_FILE = path.join(process.cwd(), 'data/settings.json');

/**
 * HTTPS agent that ignores self-signed certificate errors.
 * Proxmox ships with a self-signed cert by default; most home-lab
 * installations never replace it.
 */
var agentHttps = new https.Agent({ rejectUnauthorized: false });

/* ── Config helpers ─────────────────────────────────────── */

/**
 * Read Proxmox connection settings from the shared settings file.
 *
 * @returns {{ url: string, token: string, tokenId: string }}
 */
function getPXConfig() {
  try {
    var s = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return {
      url:     (s.px_url     || '').replace(/\/$/, ''),
      token:    s.px_token   || '',   /* API token secret (UUID) */
      tokenId:  s.px_tokenid || ''    /* API token ID: user@realm!name */
    };
  } catch (e) {
    return { url: '', token: '', tokenId: '' };
  }
}

/**
 * Low-level HTTP/S request to the Proxmox REST API.
 *
 * Proxmox wraps all responses in { "data": … }; this function
 * unwraps that envelope automatically.
 *
 * @param {Object}   cfg     — { url, token, tokenId }
 * @param {string}   method  — HTTP verb ('GET' | 'POST' | 'DELETE' …)
 * @param {string}   apiPath — path appended to /api2/json (e.g. '/nodes')
 * @param {Object|null} body — request body for POST/PUT (will be JSON-encoded)
 * @param {Function} cb      — callback(err: string|null, data: any)
 */
function pxRequest(cfg, method, apiPath, body, cb) {
  if (!cfg.url || !cfg.token) {
    cb('Proxmox non configurato', null);
    return;
  }

  var parsed  = url.parse(cfg.url + '/api2/json' + apiPath);
  var isHttps = parsed.protocol === 'https:';

  /* PVE API token header format */
  var authHeader = cfg.tokenId
    ? 'PVEAPIToken=' + cfg.tokenId + '=' + cfg.token
    : 'PVEAuthCookie=' + cfg.token;

  var bodyStr = body ? JSON.stringify(body) : '';

  var opts = {
    hostname: parsed.hostname,
    port:     parsed.port || (isHttps ? 8006 : 80),
    path:     parsed.path,
    method:   method,
    agent:    isHttps ? agentHttps : undefined,
    headers: {
      'Authorization': authHeader,
      'Content-Type':  'application/json',
      'Accept':        'application/json'
    }
  };
  if (bodyStr) opts.headers['Content-Length'] = Buffer.byteLength(bodyStr);

  var mod = isHttps ? https : http;
  var req = mod.request(opts, function (res) {
    var data = '';
    res.on('data', function (chunk) { data += chunk; });
    res.on('end', function () {
      try {
        var j = JSON.parse(data);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          /* Unwrap the PVE { data: … } envelope */
          cb(null, j.data !== undefined ? j.data : j);
        } else {
          var errMsg = (j.errors ? JSON.stringify(j.errors) : j.message) ||
                       'HTTP ' + res.statusCode;
          cb(errMsg, null);
        }
      } catch (e) {
        cb('Invalid response: ' + data.slice(0, 120), null);
      }
    });
  });

  req.on('error',   function (e) { cb(e.message, null); });
  req.setTimeout(8000, function () { req.abort(); cb('Timeout', null); });
  if (bodyStr) req.write(bodyStr);
  req.end();
}

/* ── Routes ─────────────────────────────────────────────── */

/**
 * GET /api/px/status
 * Returns PVE version information or { connected: false } on error.
 * Used by the Settings test button.
 */
router.get('/status', function (req, res) {
  var cfg = getPXConfig();
  if (!cfg.url || !cfg.token) {
    req.log.warn('Proxmox not configured');
    return res.json({ connected: false, error: 'Non configurato' });
  }
  req.log.debug({ pxUrl: cfg.url }, 'checking Proxmox status');
  pxRequest(cfg, 'GET', '/version', null, function (err, data) {
    if (err) {
      req.log.warn({ err: err }, 'Proxmox connection failed');
      return res.json({ connected: false, error: err });
    }
    req.log.info({ version: data.version }, 'Proxmox connection OK');
    res.json({ connected: true, version: data.version, release: data.release });
  });
});

/**
 * GET /api/px/nodes
 * Returns the list of cluster nodes with their current status.
 */
router.get('/nodes', function (req, res) {
  var cfg = getPXConfig();
  req.log.debug('fetching PVE nodes');
  pxRequest(cfg, 'GET', '/nodes', null, function (err, data) {
    if (err) {
      req.log.error({ err: err }, 'error fetching PVE nodes');
      return res.status(500).json({ error: err });
    }
    req.log.info({ count: Array.isArray(data) ? data.length : 0 }, 'PVE nodes returned');
    res.json(Array.isArray(data) ? data : []);
  });
});

/**
 * GET /api/px/nodes/:node/status
 * Returns detailed hardware metrics for a single node:
 * CPU, memory, swap, root FS, uptime, kernel, CPU info.
 */
router.get('/nodes/:node/status', function (req, res) {
  var cfg  = getPXConfig();
  var node = req.params.node;
  req.log.debug({ node: node }, 'fetching PVE node status');
  pxRequest(cfg, 'GET', '/nodes/' + node + '/status', null, function (err, data) {
    if (err) {
      req.log.error({ err: err, node: node }, 'error fetching node status');
      return res.status(500).json({ error: err });
    }
    res.json(data);
  });
});

/**
 * POST /api/px/nodes/:node/power
 * Send a power command to a node.
 *
 * Body: { command: 'shutdown' | 'reboot' }
 */
router.post('/nodes/:node/power', function (req, res) {
  var cfg     = getPXConfig();
  var node    = req.params.node;
  var command = req.body.command;

  if (!command) {
    return res.status(400).json({ error: 'command richiesto' });
  }

  req.log.warn({ node: node, command: command }, 'node power command requested');

  pxRequest(cfg, 'POST', '/nodes/' + node + '/status', { command: command },
    function (err, data) {
      if (err) {
        req.log.error({ err: err, node: node, command: command }, 'node power command failed');
        return res.status(500).json({ error: err });
      }
      req.log.info({ node: node, command: command }, 'node power command sent');
      res.json({ ok: true, data: data });
    }
  );
});

/**
 * GET /api/px/nodes/:node/vms
 * Returns a merged, vmid-sorted list of QEMU VMs and LXC containers
 * running on the specified node.  Each item is tagged with _type:
 * 'qemu' or 'lxc'.
 */
router.get('/nodes/:node/vms', function (req, res) {
  var cfg  = getPXConfig();
  var node = req.params.node;

  /* We fire two parallel requests (qemu + lxc) and merge results */
  var results = { qemu: null, lxc: null, err: null };

  function done() {
    /* Wait until both sub-requests have completed */
    if (results.qemu === null || results.lxc === null) return;
    if (results.err && !results.qemu.length && !results.lxc.length) {
      return res.status(500).json({ error: results.err });
    }
    var all = results.qemu.concat(results.lxc);
    all.sort(function (a, b) { return (a.vmid || 0) - (b.vmid || 0); });
    req.log.info({ node: node, count: all.length }, 'VMs returned');
    res.json(all);
  }

  req.log.debug({ node: node }, 'fetching QEMU VMs');
  pxRequest(cfg, 'GET', '/nodes/' + node + '/qemu', null, function (err, data) {
    results.qemu = Array.isArray(data)
      ? data.map(function (v) { v._type = 'qemu'; return v; })
      : [];
    if (err) results.err = err;
    done();
  });

  req.log.debug({ node: node }, 'fetching LXC containers');
  pxRequest(cfg, 'GET', '/nodes/' + node + '/lxc', null, function (err, data) {
    results.lxc = Array.isArray(data)
      ? data.map(function (v) { v._type = 'lxc'; return v; })
      : [];
    if (err && !results.err) results.err = err;
    done();
  });
});

/**
 * GET /api/px/nodes/:node/:type/:vmid/status
 * Returns the current live status of a VM or container, including
 * CPU, memory, disk I/O, and network counters.
 *
 * :type — 'qemu' or 'lxc'
 */
router.get('/nodes/:node/:type/:vmid/status', function (req, res) {
  var cfg = getPXConfig();
  var p   = req.params;
  req.log.debug({ node: p.node, type: p.type, vmid: p.vmid }, 'fetching VM status');
  pxRequest(cfg, 'GET',
    '/nodes/' + p.node + '/' + p.type + '/' + p.vmid + '/status/current',
    null,
    function (err, data) {
      if (err) {
        req.log.error({ err: err, vmid: p.vmid }, 'error fetching VM status');
        return res.status(500).json({ error: err });
      }
      res.json(data);
    }
  );
});

/**
 * POST /api/px/nodes/:node/:type/:vmid/action
 * Execute a lifecycle action on a VM or container.
 *
 * Body: { action: 'start'|'stop'|'shutdown'|'reset'|'suspend'|'resume' }
 */
router.post('/nodes/:node/:type/:vmid/action', function (req, res) {
  var cfg    = getPXConfig();
  var p      = req.params;
  var action = req.body.action;
  var valid  = ['start', 'stop', 'shutdown', 'reset', 'suspend', 'resume'];

  if (valid.indexOf(action) === -1) {
    return res.status(400).json({ error: 'Azione non valida: ' + action });
  }

  req.log.warn({ node: p.node, type: p.type, vmid: p.vmid, action: action },
    'VM action requested');

  pxRequest(cfg, 'POST',
    '/nodes/' + p.node + '/' + p.type + '/' + p.vmid + '/status/' + action,
    {},
    function (err, data) {
      if (err) {
        req.log.error({ err: err, vmid: p.vmid, action: action }, 'VM action failed');
        return res.status(500).json({ error: err });
      }
      req.log.info({ vmid: p.vmid, action: action }, 'VM action dispatched');
      res.json({ ok: true, task: data });
    }
  );
});

/**
 * GET /api/px/nodes/:node/storage
 * Lists storage volumes on the node with usage statistics.
 */
router.get('/nodes/:node/storage', function (req, res) {
  var cfg  = getPXConfig();
  var node = req.params.node;
  req.log.debug({ node: node }, 'fetching storage list');
  pxRequest(cfg, 'GET', '/nodes/' + node + '/storage', null, function (err, data) {
    if (err) {
      req.log.error({ err: err, node: node }, 'error fetching storage');
      return res.status(500).json({ error: err });
    }
    res.json(Array.isArray(data) ? data : []);
  });
});

/**
 * GET /api/px/nodes/:node/rrd[?timeframe=hour&cf=AVERAGE]
 * Returns RRD time-series data for a node (CPU, memory, network).
 * Used to populate the Chartist graphs in the frontend.
 *
 * timeframe: hour | day | week | month | year
 * cf:        AVERAGE | MAX
 */
router.get('/nodes/:node/rrd', function (req, res) {
  var cfg       = getPXConfig();
  var node      = req.params.node;
  var timeframe = req.query.timeframe || 'hour';
  var cf        = req.query.cf        || 'AVERAGE';
  req.log.debug({ node: node, timeframe: timeframe }, 'fetching node RRD');
  pxRequest(cfg, 'GET',
    '/nodes/' + node + '/rrddata?timeframe=' + timeframe + '&cf=' + cf,
    null,
    function (err, data) {
      if (err) {
        req.log.warn({ err: err, node: node }, 'node RRD error');
        return res.status(500).json({ error: err });
      }
      res.json(Array.isArray(data) ? data : []);
    }
  );
});

/**
 * GET /api/px/nodes/:node/:type/:vmid/rrd[?timeframe=hour]
 * Returns RRD time-series data for a VM or container.
 */
router.get('/nodes/:node/:type/:vmid/rrd', function (req, res) {
  var cfg       = getPXConfig();
  var p         = req.params;
  var timeframe = req.query.timeframe || 'hour';
  req.log.debug({ vmid: p.vmid, timeframe: timeframe }, 'fetching VM RRD');
  pxRequest(cfg, 'GET',
    '/nodes/' + p.node + '/' + p.type + '/' + p.vmid +
    '/rrddata?timeframe=' + timeframe + '&cf=AVERAGE',
    null,
    function (err, data) {
      if (err) {
        req.log.warn({ err: err, vmid: p.vmid }, 'VM RRD error');
        return res.status(500).json({ error: err });
      }
      res.json(Array.isArray(data) ? data : []);
    }
  );
});

/**
 * GET /api/px/nodes/:node/:type/:vmid/vnc-url
 *
 * Generates and returns the direct noVNC URL for a VM's web console.
 *
 * Proxmox exposes a noVNC console at:
 *   https://<host>:8006/?console=kvm&novnc=1&node=<node>&vmid=<vmid>
 * for QEMU, and:
 *   https://<host>:8006/?console=lxc&novnc=1&node=<node>&vmid=<vmid>
 * for LXC.
 *
 * This endpoint simply constructs and returns that URL; the browser opens
 * it in a new tab/window.  The user must already be authenticated to the
 * Proxmox web UI (or the URL will prompt for credentials).
 *
 * Returns: { vncUrl: string }
 */
router.get('/nodes/:node/:type/:vmid/vnc-url', function (req, res) {
  var cfg  = getPXConfig();
  var p    = req.params;

  if (!cfg.url) {
    return res.status(400).json({ error: 'Proxmox non configurato' });
  }

  /* Derive the base URL (scheme + host:port) from the configured API URL */
  var parsed   = url.parse(cfg.url);
  var baseUrl  = parsed.protocol + '//' + parsed.hostname + ':' + (parsed.port || 8006);

  /* PVE console type: 'kvm' for QEMU, 'lxc' for containers */
  var consoleType = p.type === 'lxc' ? 'lxc' : 'kvm';

  var vncUrl = baseUrl + '/?console=' + consoleType +
               '&novnc=1' +
               '&node='   + encodeURIComponent(p.node) +
               '&vmid='   + encodeURIComponent(p.vmid);

  req.log.info({ vmid: p.vmid, node: p.node, vncUrl: vncUrl }, 'VNC URL generated');
  res.json({ vncUrl: vncUrl });
});

module.exports = router;
