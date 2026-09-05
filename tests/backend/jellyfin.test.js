'use strict';

var express = require('express');
var request = require('supertest');
var fs = require('fs');
var path = require('path');
var wd = require('../helpers/tempWorkdir');

jest.mock('node-fetch');
var fetch; // reacquired fresh in beforeEach, after resetModules — see helpers/tempWorkdir.js

var JF_ROUTE = path.join(__dirname, '../../backend/routes/jellyfin');

function buildApp() {
  var app = express();
  app.use(express.json());
  app.use(wd.attachNoopLog);
  app.use('/api/jf', wd.requireFresh(JF_ROUTE));
  return app;
}

function writeJFConfig(url, token) {
  var dataFile = path.join(process.cwd(), 'data/settings.json');
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  fs.writeFileSync(dataFile, JSON.stringify({ jf_url: url, jf_token: token }));
}

function mockFetchOnce(body, ok) {
  fetch.mockImplementationOnce(function () {
    return Promise.resolve({ ok: ok !== false, status: ok === false ? 500 : 200, json: function () { return Promise.resolve(body); } });
  });
}

beforeEach(function () { wd.useTempWorkdir(); fetch = require('node-fetch'); });
afterEach(function () { wd.restoreWorkdir(); });

describe('GET /api/jf/status', function () {
  test('reports not connected when unconfigured', function () {
    var app = buildApp();
    return request(app).get('/api/jf/status').expect(200).then(function (res) {
      expect(res.body).toEqual({ connected: false, error: 'Non configurato' });
    });
  });

  test('reports server name and version when reachable', function () {
    writeJFConfig('http://jf.local:8096', 'tok');
    mockFetchOnce({ ServerName: 'Home Media', Version: '10.9.0' });
    var app = buildApp();
    return request(app).get('/api/jf/status').expect(200).then(function (res) {
      expect(res.body).toEqual({ connected: true, serverName: 'Home Media', version: '10.9.0' });
    });
  });
});

describe('GET /api/jf/userid', function () {
  test('prefers an administrator account over the first user', function () {
    writeJFConfig('http://jf.local:8096', 'tok');
    mockFetchOnce([
      { Id: 'u1', Name: 'guest', Policy: { IsAdministrator: false } },
      { Id: 'u2', Name: 'admin', Policy: { IsAdministrator: true } }
    ]);
    var app = buildApp();
    return request(app).get('/api/jf/userid').expect(200).then(function (res) {
      expect(res.body).toEqual({ userId: 'u2', userName: 'admin' });
    });
  });

  test('500 when no users are returned', function () {
    writeJFConfig('http://jf.local:8096', 'tok');
    mockFetchOnce([]);
    var app = buildApp();
    return request(app).get('/api/jf/userid').expect(500);
  });
});

describe('GET /api/jf/items', function () {
  test('400 when userId is missing', function () {
    writeJFConfig('http://jf.local:8096', 'tok');
    var app = buildApp();
    return request(app).get('/api/jf/items').expect(400);
  });

  test('paginates and shapes the library response', function () {
    writeJFConfig('http://jf.local:8096', 'tok');
    mockFetchOnce({ Items: [{ Id: 'm1', Name: 'Movie One' }], TotalRecordCount: 57 });
    var app = buildApp();
    return request(app).get('/api/jf/items?userId=u2&page=2&pageSize=10').expect(200).then(function (res) {
      expect(res.body).toEqual({
        items: [{ Id: 'm1', Name: 'Movie One' }], totalCount: 57, page: 2, pageSize: 10
      });
      var calledUrl = fetch.mock.calls[0][0];
      expect(calledUrl).toContain('StartIndex=20');
      expect(calledUrl).toContain('Limit=10');
    });
  });

  test('500 when the upstream call fails', function () {
    writeJFConfig('http://jf.local:8096', 'tok');
    mockFetchOnce({}, false);
    var app = buildApp();
    return request(app).get('/api/jf/items?userId=u2').expect(500);
  });
});

describe('GET /api/jf/home-summary', function () {
  /* home-summary fans out five parallel calls after resolving the user, so
     the sequential mockFetchOnce queue is too brittle here — match on URL. */
  function mockFetchByUrl(routes) {
    fetch.mockImplementation(function (url) {
      /* Longest fragment wins: the item queries all live under
         /Users/<id>/Items, so a bare '/Users' key would otherwise
         swallow every one of them. */
      var body = null;
      var found = false;
      var bestLen = -1;
      Object.keys(routes).forEach(function (frag) {
        if (url.indexOf(frag) !== -1 && frag.length > bestLen) {
          body = routes[frag];
          bestLen = frag.length;
          found = true;
        }
      });
      if (!found) {
        return Promise.resolve({ ok: false, status: 404, json: function () { return Promise.resolve({}); } });
      }
      if (body === '__ERROR__') {
        return Promise.resolve({ ok: false, status: 500, json: function () { return Promise.resolve({}); } });
      }
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(body); } });
    });
  }

  var USERS = [{ Id: 'u2', Name: 'admin', Policy: { IsAdministrator: true } }];

  test('400 when Jellyfin is not configured', function () {
    var app = buildApp();
    return request(app).get('/api/jf/home-summary').expect(400);
  });

  test('reports library counts, recent movies and the episode total', function () {
    writeJFConfig('http://jf.local:8096', 'tok');
    mockFetchByUrl({
      '/Users': USERS,
      'IncludeItemTypes=Movie&Recursive=true&Limit=0':   { TotalRecordCount: 214 },
      'IncludeItemTypes=Series&Recursive=true&Limit=0':  { TotalRecordCount: 37 },
      'IncludeItemTypes=Episode&Recursive=true&Limit=0': { TotalRecordCount: 1893 },
      'SortBy=DateCreated': {
        Items: [{ Id: 'm1', Name: '1917', ProductionYear: 2019, ImageTags: { Primary: 'tag1' } }]
      },
      '/Sessions': []
    });

    var app = buildApp();
    return request(app).get('/api/jf/home-summary').expect(200).then(function (res) {
      expect(res.body.totalMovies).toBe(214);
      expect(res.body.totalSeries).toBe(37);
      expect(res.body.totalEpisodes).toBe(1893);
      expect(res.body.recentMovies).toEqual([
        { id: 'm1', name: '1917', year: 2019, imageTag: 'tag1' }
      ]);
      expect(res.body.nowPlaying).toBeNull();
    });
  });

  test('surfaces the session that is currently streaming', function () {
    writeJFConfig('http://jf.local:8096', 'tok');
    mockFetchByUrl({
      '/Users': USERS,
      'IncludeItemTypes=Movie&Recursive=true&Limit=0':   { TotalRecordCount: 1 },
      'IncludeItemTypes=Series&Recursive=true&Limit=0':  { TotalRecordCount: 1 },
      'IncludeItemTypes=Episode&Recursive=true&Limit=0': { TotalRecordCount: 1 },
      'SortBy=DateCreated': { Items: [] },
      '/Sessions': [
        { UserName: 'idle', DeviceName: 'TV' },
        {
          UserName: 'stefano', DeviceName: 'Living Room',
          NowPlayingItem: { Id: 'e9', Name: 'Ozymandias', Type: 'Episode', SeriesName: 'Breaking Bad' }
        }
      ]
    });

    var app = buildApp();
    return request(app).get('/api/jf/home-summary').expect(200).then(function (res) {
      expect(res.body.nowPlaying).toEqual({
        id: 'e9', name: 'Ozymandias', type: 'Episode',
        series: 'Breaking Bad', user: 'stefano', device: 'Living Room'
      });
    });
  });

  /* The episode count and session lookup are extras — losing them must not
     cost the caller the library counts it came for. */
  test('still answers when the optional lookups fail', function () {
    writeJFConfig('http://jf.local:8096', 'tok');
    mockFetchByUrl({
      '/Users': USERS,
      'IncludeItemTypes=Movie&Recursive=true&Limit=0':   { TotalRecordCount: 214 },
      'IncludeItemTypes=Series&Recursive=true&Limit=0':  { TotalRecordCount: 37 },
      'IncludeItemTypes=Episode&Recursive=true&Limit=0': '__ERROR__',
      'SortBy=DateCreated': { Items: [] },
      '/Sessions': '__ERROR__'
    });

    var app = buildApp();
    return request(app).get('/api/jf/home-summary').expect(200).then(function (res) {
      expect(res.body.totalMovies).toBe(214);
      expect(res.body.totalSeries).toBe(37);
      expect(res.body.totalEpisodes).toBeNull();
      expect(res.body.nowPlaying).toBeNull();
    });
  });
});

describe('GET /api/jf/play/start', function () {
  test('400 when Jellyfin is not configured', function () {
    var app = buildApp();
    return request(app).get('/api/jf/play/start?userId=u1&itemId=i1').expect(400);
  });

  test('400 when userId or itemId is missing', function () {
    writeJFConfig('http://jf.local:8096', 'tok');
    var app = buildApp();
    return request(app).get('/api/jf/play/start?userId=u1').expect(400);
  });

  test('resolves a proxied master.m3u8 URL from the playback info', function () {
    writeJFConfig('http://jf.local:8096', 'tok');
    mockFetchOnce({ MediaSources: [{ Id: 'src1' }] });
    var app = buildApp();
    return request(app).get('/api/jf/play/start?userId=u1&itemId=i1').expect(200).then(function (res) {
      expect(res.body.url).toMatch(/^\/api\/jf\/play\/stream\?u=/);
      var upstream = decodeURIComponent(res.body.url.split('u=')[1]);
      expect(upstream).toMatch(/^\/Videos\/i1\/master\.m3u8\?/);
      expect(upstream).toContain('MediaSourceId=src1');
    });
  });

  test('500 when the upstream playback-info call fails', function () {
    writeJFConfig('http://jf.local:8096', 'tok');
    mockFetchOnce({}, false);
    var app = buildApp();
    return request(app).get('/api/jf/play/start?userId=u1&itemId=i1').expect(500);
  });
});

describe('GET /api/jf/play/stream', function () {
  function mockUpstreamResponse(resolution) {
    fetch.mockImplementationOnce(function () { return Promise.resolve(resolution); });
  }

  test('400 when Jellyfin is not configured', function () {
    var app = buildApp();
    return request(app).get('/api/jf/play/stream?u=%2FVideos%2Fi1%2Fmaster.m3u8').expect(400);
  });

  test('400 when the u query param is missing', function () {
    writeJFConfig('http://jf.local:8096', 'tok');
    var app = buildApp();
    return request(app).get('/api/jf/play/stream').expect(400);
  });

  test('rewrites playlist entries to point back through the proxy', function () {
    writeJFConfig('http://jf.local:8096', 'tok');
    mockUpstreamResponse({
      ok: true,
      status: 200,
      headers: { get: function () { return 'application/vnd.apple.mpegurl'; } },
      text: function () {
        return Promise.resolve('#EXTM3U\nsegment1.ts\n');
      }
    });
    var app = buildApp();
    return request(app)
      .get('/api/jf/play/stream?u=' + encodeURIComponent('/Videos/i1/master.m3u8'))
      .expect(200)
      .then(function (res) {
        expect(res.text).toContain('#EXTM3U');
        expect(res.text).toContain('/api/jf/play/stream?u=');
        expect(res.text).toContain(encodeURIComponent('/Videos/i1/segment1.ts'));
      });
  });

  test('502 on upstream failure', function () {
    writeJFConfig('http://jf.local:8096', 'tok');
    mockUpstreamResponse({ ok: false, status: 404, headers: { get: function () { return ''; } } });
    var app = buildApp();
    return request(app)
      .get('/api/jf/play/stream?u=' + encodeURIComponent('/Videos/i1/master.m3u8'))
      .expect(502);
  });
});
