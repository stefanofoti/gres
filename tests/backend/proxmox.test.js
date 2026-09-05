'use strict';

var express = require('express');
var request = require('supertest');
var http = require('http');
var fs = require('fs');
var path = require('path');
var wd = require('../helpers/tempWorkdir');

/*
 * proxmox.js talks to the PVE API over raw http/https (not node-fetch), so
 * rather than mocking Node core modules we spin up a real local HTTP server
 * that stands in for Proxmox and answer with its { data: ... } envelope.
 */

var PX_ROUTE = path.join(__dirname, '../../backend/routes/proxmox');

var server;
var serverPort;
var currentHandler;

beforeAll(function (done) {
  server = http.createServer(function (req, res) {
    currentHandler(req, res);
  });
  server.listen(0, '127.0.0.1', function () {
    serverPort = server.address().port;
    done();
  });
});

afterAll(function (done) { server.close(done); });

function jsonHandler(statusCode, dataBody) {
  return function (req, res) {
    var chunks = [];
    req.on('data', function (c) { chunks.push(c); });
    req.on('end', function () {
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: dataBody }));
    });
  };
}

function buildApp() {
  var app = express();
  app.use(express.json());
  app.use(wd.attachNoopLog);
  app.use('/api/px', wd.requireFresh(PX_ROUTE));
  return app;
}

function writePXConfig(overrides) {
  var dataFile = path.join(process.cwd(), 'data/settings.json');
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  var cfg = Object.assign({
    px_url: 'http://127.0.0.1:' + serverPort,
    px_token: 'secret-token',
    px_tokenid: 'root@pam!homeapp'
  }, overrides || {});
  fs.writeFileSync(dataFile, JSON.stringify(cfg));
}

beforeEach(function () { wd.useTempWorkdir(); });
afterEach(function () { wd.restoreWorkdir(); });

describe('GET /api/px/status', function () {
  test('reports not connected when unconfigured, without contacting any server', function () {
    var app = buildApp();
    return request(app).get('/api/px/status').expect(200).then(function (res) {
      expect(res.body).toEqual({ connected: false, error: 'Non configurato' });
    });
  });

  test('reports version/release on a successful ping', function () {
    writePXConfig();
    currentHandler = jsonHandler(200, { version: '8.1', release: 'bookworm' });
    var app = buildApp();
    return request(app).get('/api/px/status').expect(200).then(function (res) {
      expect(res.body).toEqual({ connected: true, version: '8.1', release: 'bookworm' });
    });
  });

  test('reports not connected when the PVE API errors', function () {
    writePXConfig();
    currentHandler = function (req, res) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'authentication failure' }));
    };
    var app = buildApp();
    return request(app).get('/api/px/status').expect(200).then(function (res) {
      expect(res.body.connected).toBe(false);
      expect(res.body.error).toBe('authentication failure');
    });
  });
});

describe('GET /api/px/nodes', function () {
  test('returns the unwrapped node list', function () {
    writePXConfig();
    currentHandler = jsonHandler(200, [{ node: 'pve1', status: 'online' }]);
    var app = buildApp();
    return request(app).get('/api/px/nodes').expect(200).then(function (res) {
      expect(res.body).toEqual([{ node: 'pve1', status: 'online' }]);
    });
  });
});

describe('POST /api/px/nodes/:node/power', function () {
  test('400 when command is missing', function () {
    writePXConfig();
    var app = buildApp();
    return request(app).post('/api/px/nodes/pve1/power').send({}).expect(400);
  });

  test('sends the PVE token header and command body, unwraps the response', function () {
    writePXConfig();
    var seenAuth, seenBody;
    currentHandler = function (req, res) {
      seenAuth = req.headers.authorization;
      var chunks = [];
      req.on('data', function (c) { chunks.push(c); });
      req.on('end', function () {
        seenBody = JSON.parse(Buffer.concat(chunks).toString() || '{}');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: 'UPID:pve1:...' }));
      });
    };
    var app = buildApp();
    return request(app)
      .post('/api/px/nodes/pve1/power')
      .send({ command: 'reboot' })
      .expect(200)
      .then(function (res) {
        expect(res.body).toEqual({ ok: true, data: 'UPID:pve1:...' });
        expect(seenAuth).toBe('PVEAPIToken=root@pam!homeapp=secret-token');
        expect(seenBody).toEqual({ command: 'reboot' });
      });
  });

  test('500 when the request times out / errors at the transport level', function () {
    writePXConfig({ px_url: 'http://127.0.0.1:1' }); // nothing listens on port 1
    var app = buildApp();
    return request(app).post('/api/px/nodes/pve1/power').send({ command: 'reboot' }).expect(500);
  });
});

describe('GET /api/px/home-summary', function () {
  /* Path-aware stand-in: home-summary fans out to /nodes and then to
     /nodes/<n>/qemu and /nodes/<n>/lxc for every node at once. */
  function clusterHandler(routes) {
    return function (req, res) {
      var chunks = [];
      req.on('data', function (c) { chunks.push(c); });
      req.on('end', function () {
        var apiPath = req.url.replace('/api2/json', '');
        var hit = routes[apiPath];
        if (hit === undefined) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ message: 'unexpected path ' + apiPath }));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: hit }));
      });
    };
  }

  test('400 when Proxmox is not configured, without contacting any server', function () {
    var app = buildApp();
    return request(app).get('/api/px/home-summary').expect(400).then(function (res) {
      expect(res.body.error).toBeTruthy();
    });
  });

  test('rolls node hardware stats and guest counts into one payload', function () {
    writePXConfig();
    currentHandler = clusterHandler({
      '/nodes': [{
        node: 'pve1', status: 'online', uptime: 1893622,
        cpu: 0.07, maxcpu: 8,
        mem: 12884901888, maxmem: 34359738368,
        disk: 41231686041, maxdisk: 100000000000
      }],
      '/nodes/pve1/qemu': [
        { vmid: 100, status: 'running' },
        { vmid: 101, status: 'stopped' }
      ],
      '/nodes/pve1/lxc': [
        { vmid: 200, status: 'running' }
      ]
    });
    var app = buildApp();
    return request(app).get('/api/px/home-summary').expect(200).then(function (res) {
      expect(res.body.totals).toEqual({
        nodes: 1, online: 1, vmsRunning: 2, vmsStopped: 1
      });
      expect(res.body.nodes).toHaveLength(1);
      var n = res.body.nodes[0];
      expect(n.node).toBe('pve1');
      expect(n.vmsRunning).toBe(2);
      expect(n.vmsStopped).toBe(1);
      /* Raw totals pass through so the widget can show both bar and figure */
      expect(n.mem).toBe(12884901888);
      expect(n.maxmem).toBe(34359738368);
      expect(n.cpu).toBeCloseTo(0.07);
    });
  });

  test('counts guests across every node in the cluster', function () {
    writePXConfig();
    currentHandler = clusterHandler({
      '/nodes': [
        { node: 'pve1', status: 'online',  cpu: 0.1, maxcpu: 4, mem: 1, maxmem: 2, disk: 1, maxdisk: 2 },
        { node: 'pve2', status: 'offline', cpu: 0,   maxcpu: 4, mem: 0, maxmem: 2, disk: 0, maxdisk: 2 }
      ],
      '/nodes/pve1/qemu': [{ vmid: 100, status: 'running' }],
      '/nodes/pve1/lxc':  [],
      '/nodes/pve2/qemu': [{ vmid: 300, status: 'stopped' }],
      '/nodes/pve2/lxc':  [{ vmid: 400, status: 'running' }]
    });
    var app = buildApp();
    return request(app).get('/api/px/home-summary').expect(200).then(function (res) {
      expect(res.body.totals).toEqual({
        nodes: 2, online: 1, vmsRunning: 2, vmsStopped: 1
      });
      expect(res.body.nodes.map(function (n) { return n.node; })).toEqual(['pve1', 'pve2']);
    });
  });

  /* One flaky node must degrade to a partial count, not blank the card. */
  test('still reports a node whose guest list fails', function () {
    writePXConfig();
    currentHandler = clusterHandler({
      '/nodes': [{ node: 'pve1', status: 'online', cpu: 0.5, maxcpu: 8, mem: 1, maxmem: 2, disk: 1, maxdisk: 2 }],
      '/nodes/pve1/qemu': [{ vmid: 100, status: 'running' }]
      /* /nodes/pve1/lxc deliberately absent -> 500 from the stand-in */
    });
    var app = buildApp();
    return request(app).get('/api/px/home-summary').expect(200).then(function (res) {
      expect(res.body.nodes).toHaveLength(1);
      expect(res.body.nodes[0].vmsRunning).toBe(1);
      expect(res.body.totals.online).toBe(1);
    });
  });

  test('502 when the node list itself fails', function () {
    writePXConfig({ px_url: 'http://127.0.0.1:1' }); // nothing listens on port 1
    var app = buildApp();
    return request(app).get('/api/px/home-summary').expect(502);
  });

  test('serves an empty cluster without hanging', function () {
    writePXConfig();
    currentHandler = clusterHandler({ '/nodes': [] });
    var app = buildApp();
    return request(app).get('/api/px/home-summary').expect(200).then(function (res) {
      expect(res.body.nodes).toEqual([]);
      expect(res.body.totals.nodes).toBe(0);
    });
  });
});

describe('GET /api/px/nodes/:node/rrd', function () {
  test('returns the unwrapped RRD series for a node', function () {
    writePXConfig();
    currentHandler = jsonHandler(200, [{ time: 1000, cpu: 0.2 }, { time: 1010, cpu: 0.3 }]);
    var app = buildApp();
    return request(app).get('/api/px/nodes/pve1/rrd?timeframe=hour').expect(200).then(function (res) {
      expect(res.body).toEqual([{ time: 1000, cpu: 0.2 }, { time: 1010, cpu: 0.3 }]);
    });
  });

  test('500 when the PVE API errors', function () {
    writePXConfig();
    currentHandler = function (req, res) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'rrd failure' }));
    };
    var app = buildApp();
    return request(app).get('/api/px/nodes/pve1/rrd').expect(500);
  });
});

describe('GET /api/px/nodes/:node/:type/:vmid/rrd', function () {
  test('returns the unwrapped RRD series for a VM', function () {
    writePXConfig();
    currentHandler = jsonHandler(200, [{ time: 1000, cpu: 0.1, mem: 512 }]);
    var app = buildApp();
    return request(app).get('/api/px/nodes/pve1/qemu/100/rrd').expect(200).then(function (res) {
      expect(res.body).toEqual([{ time: 1000, cpu: 0.1, mem: 512 }]);
    });
  });
});

describe('GET /api/px/nodes/:node/:type/:vmid/vnc-url', function () {
  test('400 when Proxmox is not configured', function () {
    var app = buildApp();
    return request(app).get('/api/px/nodes/pve1/qemu/100/vnc-url').expect(400);
  });

  test('builds a kvm console URL for a QEMU VM', function () {
    writePXConfig({ px_url: 'https://pve.local:8006' });
    var app = buildApp();
    return request(app).get('/api/px/nodes/pve1/qemu/100/vnc-url').expect(200).then(function (res) {
      expect(res.body.vncUrl).toBe(
        'https://pve.local:8006/?console=kvm&novnc=1&node=pve1&vmid=100'
      );
    });
  });

  test('builds an lxc console URL for a container', function () {
    writePXConfig({ px_url: 'https://pve.local:8006' });
    var app = buildApp();
    return request(app).get('/api/px/nodes/pve1/lxc/101/vnc-url').expect(200).then(function (res) {
      expect(res.body.vncUrl).toContain('console=lxc');
    });
  });
});
