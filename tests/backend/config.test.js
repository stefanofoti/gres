'use strict';

var express = require('express');
var request = require('supertest');
var wd = require('../helpers/tempWorkdir');
var config = require('../../backend/routes/config');
var pkg = require('../../package.json');

/* config.js reads process.env at call time (not require time) and touches
   no files, so no temp-workdir / fresh-require dance is needed here. */

var ORIGINAL_ENV;

beforeEach(function () { ORIGINAL_ENV = Object.assign({}, process.env); });
afterEach(function () { process.env = ORIGINAL_ENV; });

describe('parseHaRefreshIntervalSec (unit)', function () {
  test('defaults to 15 when unset', function () {
    delete process.env.HA_REFRESH_INTERVAL_SEC;
    expect(config.parseHaRefreshIntervalSec()).toBe(15);
  });

  test('defaults to 15 for an empty string', function () {
    process.env.HA_REFRESH_INTERVAL_SEC = '';
    expect(config.parseHaRefreshIntervalSec()).toBe(15);
  });

  test('parses a valid override', function () {
    process.env.HA_REFRESH_INTERVAL_SEC = '30';
    expect(config.parseHaRefreshIntervalSec()).toBe(30);
  });

  test('0 disables refresh and is preserved (not treated as falsy default)', function () {
    process.env.HA_REFRESH_INTERVAL_SEC = '0';
    expect(config.parseHaRefreshIntervalSec()).toBe(0);
  });

  test('falls back to 15 for a negative value', function () {
    process.env.HA_REFRESH_INTERVAL_SEC = '-5';
    expect(config.parseHaRefreshIntervalSec()).toBe(15);
  });

  test('falls back to 15 for a non-numeric value', function () {
    process.env.HA_REFRESH_INTERVAL_SEC = 'abc';
    expect(config.parseHaRefreshIntervalSec()).toBe(15);
  });
});

describe('GET /api/config', function () {
  function buildApp() {
    var app = express();
    app.use(wd.attachNoopLog);
    app.use('/api/config', config);
    return app;
  }

  test('exposes haRefreshIntervalSec read from the environment', function () {
    process.env.HA_REFRESH_INTERVAL_SEC = '42';
    var app = buildApp();
    return request(app).get('/api/config').expect(200).then(function (res) {
      expect(res.body).toEqual({ haRefreshIntervalSec: 42, version: pkg.version });
    });
  });

  /* The frontend's stale-client check compares this against the version
     stamped into its own HTML, so an absent or renamed field silently turns
     the check off rather than failing loudly. */
  test('reports the package version, which CI pins to the release tag', function () {
    var app = buildApp();
    return request(app).get('/api/config').expect(200).then(function (res) {
      expect(typeof res.body.version).toBe('string');
      expect(res.body.version).toBe(pkg.version);
    });
  });
});
