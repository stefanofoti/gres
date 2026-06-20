/**
 * routes/jellyfin.js
 *
 * Proxies requests to a Jellyfin media server so that:
 *   - The Jellyfin API key never reaches the browser.
 *   - Cover images are cached server-side (Cache-Control: 24 h).
 *
 * All connection details are read from the shared settings file on every
 * request; changes are picked up without restarting.
 *
 * Endpoints:
 *   GET /api/jf/status            — test connectivity
 *   GET /api/jf/userid            — resolve first admin user ID
 *   GET /api/jf/items             — paginated library (films / series)
 *   GET /api/jf/image/:itemId     — proxied cover image
 */

'use strict';

var express = require('express');
var router  = express.Router();
var fetch   = require('node-fetch');
var fs      = require('fs');
var path    = require('path');

var DATA_FILE = path.join(process.cwd(), 'data/settings.json');

/* ── Config helpers ─────────────────────────────────────── */

/**
 * Read Jellyfin connection config from the settings file.
 *
 * @returns {{ url: string, token: string }}
 */
function getJFConfig() {
  try {
    var s = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return {
      url:   (s.jf_url   || '').replace(/\/$/, ''),
      token:  s.jf_token || ''
    };
  } catch (e) {
    return { url: '', token: '' };
  }
}

/**
 * Build HTTP headers required by the Jellyfin / Emby API.
 *
 * @param {string} token — API key
 * @returns {Object}
 */
function jfHeaders(token) {
  return {
    'X-Emby-Token':  token,
    'Content-Type':  'application/json',
    'Accept':        'application/json',
    'Connection':    'close'
  };
}

/**
 * Generic Jellyfin API helper — performs a GET and returns parsed JSON.
 *
 * @param {string}   apiPath  — path relative to the Jellyfin base URL
 * @param {Object}   config   — { url, token }
 * @param {Function} cb       — callback(err, data)
 */
function jfFetch(apiPath, config, cb) {
  if (!config.url || !config.token) {
    cb('Jellyfin non configurato', null);
    return;
  }
  fetch(config.url + apiPath, { headers: jfHeaders(config.token), timeout: 10000 })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (d) { cb(null, d); })
    .catch(function (e) { cb(e.message, null); });
}

/**
 * Build a stable play-session ID (ASCII, deterministic per request context).
 *
 * @param {string} userId
 * @param {string} itemId
 * @returns {string}
 */
function makePlaySessionId(userId, itemId) {
  var now = Date.now().toString(36);
  return 'homeapp-' + (userId || 'u') + '-' + (itemId || 'i') + '-' + now;
}

/**
 * Ensure a Jellyfin path is absolute and safe for proxying.
 *
 * @param {string} p
 * @returns {string}
 */
function normalizeProxyPath(p) {
  if (!p) return '/';
  return p.charAt(0) === '/' ? p : '/' + p;
}

/**
 * Resolve a possibly-relative playlist URI against current playlist path.
 *
 * @param {string} currentPathWithQuery
 * @param {string} nextUri
 * @returns {string}
 */
function resolvePlaylistUri(currentPathWithQuery, nextUri) {
  if (!nextUri) return '';
  if (/^https?:\/\//i.test(nextUri)) return nextUri;
  if (nextUri.charAt(0) === '/') return nextUri;

  var basePath = currentPathWithQuery.split('?')[0] || '/';
  var slash = basePath.lastIndexOf('/');
  var baseDir = slash >= 0 ? basePath.slice(0, slash + 1) : '/';
  return baseDir + nextUri;
}

/* ── Routes ─────────────────────────────────────────────── */

/**
 * GET /api/jf/status
 * Returns server name and version on success, or { connected:false } on error.
 */
router.get('/status', function (req, res) {
  var cfg = getJFConfig();
  if (!cfg.url || !cfg.token) {
    req.log.warn('Jellyfin not configured');
    return res.json({ connected: false, error: 'Non configurato' });
  }
  req.log.debug({ jfUrl: cfg.url }, 'checking Jellyfin status');
  jfFetch('/System/Info/Public', cfg, function (err, data) {
    if (err) {
      req.log.warn({ err: err }, 'Jellyfin connection failed');
      return res.json({ connected: false, error: err });
    }
    req.log.info({ serverName: data.ServerName }, 'Jellyfin connection OK');
    res.json({ connected: true, serverName: data.ServerName, version: data.Version });
  });
});

/**
 * GET /api/jf/userid
 * Resolves and returns the ID of the first administrator user.
 * Jellyfin's Items endpoint requires a userId in the path.
 */
router.get('/userid', function (req, res) {
  var cfg = getJFConfig();
  req.log.debug('resolving Jellyfin userId');
  jfFetch('/Users', cfg, function (err, users) {
    if (err || !Array.isArray(users) || !users.length) {
      req.log.error({ err: err }, 'could not list Jellyfin users');
      return res.status(500).json({ error: err || 'Nessun utente' });
    }
    /* Prefer an administrator account; fall back to the first user */
    var user = users[0];
    for (var i = 0; i < users.length; i++) {
      if (users[i].Policy && users[i].Policy.IsAdministrator) {
        user = users[i];
        break;
      }
    }
    req.log.info({ userId: user.Id, userName: user.Name }, 'Jellyfin user resolved');
    res.json({ userId: user.Id, userName: user.Name });
  });
});

/**
 * GET /api/jf/items
 * Returns a paginated subset of the Jellyfin library.
 *
 * Query params:
 *   type      — 'Movie' | 'Series'  (default: 'Movie')
 *   page      — zero-based page index (default: 0)
 *   pageSize  — items per page (default: 20)
 *   userId    — required Jellyfin user ID
 *   sortBy    — field to sort by (default: 'SortName')
 *   sortOrder — 'Ascending' | 'Descending' (default: 'Ascending')
 *   search    — optional free-text search term
 */
router.get('/items', function (req, res) {
  var cfg       = getJFConfig();
  var type      = req.query.type      || 'Movie';
  var page      = parseInt(req.query.page,     10) || 0;
  var pageSize  = parseInt(req.query.pageSize, 10) || 20;
  var userId    = req.query.userId    || '';
  var sortBy    = req.query.sortBy    || 'SortName';
  var sortOrder = req.query.sortOrder || 'Ascending';
  var search    = req.query.search    || '';

  if (!userId) {
    return res.status(400).json({ error: 'userId richiesto' });
  }

  var startIndex = page * pageSize;

  /* Build the Jellyfin Items query string */
  var qs = '?IncludeItemTypes=' + type +
           '&Recursive=true' +
           '&Fields=Overview,Genres,ProductionYear,CommunityRating' +
           '&StartIndex=' + startIndex +
           '&Limit='      + pageSize +
           '&SortBy='     + sortBy +
           '&SortOrder='  + sortOrder +
           '&ImageTypeLimit=1' +
           '&EnableImageTypes=Primary';

  if (search) qs += '&SearchTerm=' + encodeURIComponent(search);

  req.log.debug({ type: type, page: page, pageSize: pageSize, search: search || null },
    'fetching Jellyfin items');

  jfFetch('/Users/' + userId + '/Items' + qs, cfg, function (err, data) {
    if (err) {
      req.log.error({ err: err }, 'error fetching Jellyfin items');
      return res.status(500).json({ error: err });
    }
    req.log.info({ total: data.TotalRecordCount, returned: (data.Items || []).length },
      'Jellyfin items returned');
    res.json({
      items:      data.Items             || [],
      totalCount: data.TotalRecordCount  || 0,
      page:       page,
      pageSize:   pageSize
    });
  });
});

/**
 * GET /api/jf/play/start?userId=:id&itemId=:id
 * Resolves a proxied HLS master URL suitable for iOS Safari native playback.
 */
router.get('/play/start', function (req, res) {
  var cfg = getJFConfig();
  var userId = req.query.userId || '';
  var itemId = req.query.itemId || '';

  if (!cfg.url || !cfg.token) {
    return res.status(400).json({ error: 'Jellyfin non configurato' });
  }
  if (!userId || !itemId) {
    return res.status(400).json({ error: 'userId e itemId richiesti' });
  }

  var playbackInfoPath = '/Items/' + encodeURIComponent(itemId) +
    '/PlaybackInfo?UserId=' + encodeURIComponent(userId);

  jfFetch(playbackInfoPath, cfg, function (err, info) {
    if (err) {
      req.log.warn({ err: err, itemId: itemId }, 'Jellyfin playback info failed');
      return res.status(500).json({ error: err });
    }

    var mediaSourceId = '';
    if (info && info.MediaSources && info.MediaSources.length) {
      mediaSourceId = info.MediaSources[0].Id || '';
    }

    var qs = '?UserId=' + encodeURIComponent(userId) +
      '&DeviceId=homeapp-ios9' +
      '&VideoCodec=h264' +
      '&AudioCodec=aac,mp3' +
      '&Container=ts' +
      '&MaxStreamingBitrate=8000000' +
      '&PlaySessionId=' + encodeURIComponent(makePlaySessionId(userId, itemId));

    if (mediaSourceId) {
      qs += '&MediaSourceId=' + encodeURIComponent(mediaSourceId);
    }

    var upstreamPath = '/Videos/' + encodeURIComponent(itemId) + '/master.m3u8' + qs;
    var proxyUrl = '/api/jf/play/stream?u=' + encodeURIComponent(upstreamPath);
    res.json({ url: proxyUrl });
  });
});

/**
 * GET /api/jf/play/stream?u=:encodedJellyfinPath
 * Proxies HLS playlists and segments so token never reaches the browser.
 */
router.get('/play/stream', function (req, res) {
  var cfg = getJFConfig();
  var encodedUpstream = req.query.u || '';
  var upstreamPath = normalizeProxyPath(decodeURIComponent(encodedUpstream || ''));

  if (!cfg.url || !cfg.token) {
    return res.status(400).send('Not configured');
  }
  if (!encodedUpstream) {
    return res.status(400).send('Missing stream path');
  }

  var upstreamUrl = cfg.url + upstreamPath;

  fetch(upstreamUrl, { headers: jfHeaders(cfg.token), timeout: 15000 })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var contentType = (r.headers.get('content-type') || '').toLowerCase();

      if (contentType.indexOf('mpegurl') !== -1 || contentType.indexOf('application/vnd.apple.mpegurl') !== -1 || contentType.indexOf('text/plain') !== -1) {
        return r.text().then(function (playlistText) {
          var lines = playlistText.split(/\r?\n/);
          var out = [];
          for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            if (!line || line.charAt(0) === '#') {
              out.push(line);
              continue;
            }
            var resolved = resolvePlaylistUri(upstreamPath, line);
            if (/^https?:\/\//i.test(resolved)) {
              if (resolved.indexOf(cfg.url) === 0) {
                resolved = resolved.slice(cfg.url.length);
              } else {
                out.push(line);
                continue;
              }
            }
            out.push('/api/jf/play/stream?u=' + encodeURIComponent(normalizeProxyPath(resolved)));
          }
          res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
          res.setHeader('Cache-Control', 'no-store');
          res.send(out.join('\n'));
        });
      }

      res.setHeader('Content-Type', r.headers.get('content-type') || 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-store');
      r.body.pipe(res);
      return null;
    })
    .catch(function (e) {
      req.log.warn({ err: e.message, upstreamPath: upstreamPath }, 'Jellyfin play proxy failed');
      res.status(502).send(e.message);
    });
});

/**
 * GET /api/jf/home-summary
 * Returns in a single call:
 *   - totalMovies, totalSeries
 *   - recentMovies: last 3 movies added (id, name, year, imageTag)
 * Used by the Home tab widget.
 */
router.get('/home-summary', function (req, res) {
  var cfg = getJFConfig();
  if (!cfg.url || !cfg.token) {
    return res.status(400).json({ error: 'Jellyfin non configurato' });
  }

  /* Step 1: resolve userId */
  jfFetch('/Users', cfg, function (err, users) {
    if (err || !Array.isArray(users) || !users.length) {
      return res.status(502).json({ error: err || 'Nessun utente' });
    }
    var user = users[0];
    for (var i = 0; i < users.length; i++) {
      if (users[i].Policy && users[i].Policy.IsAdministrator) { user = users[i]; break; }
    }
    var uid = user.Id;
    var base = '/Users/' + uid + '/Items';
    var done = 0, total = 3;
    var results = {};
    var failed = null;

    function finish(key, val) {
      if (failed) return;
      results[key] = val;
      done++;
      if (done === total) {
        res.json({
          totalMovies:  results.totalMovies,
          totalSeries:  results.totalSeries,
          recentMovies: results.recentMovies
        });
      }
    }

    function fail(e) {
      if (failed) return;
      failed = e;
      req.log.error({ err: e }, 'jf home-summary failed');
      res.status(502).json({ error: e });
    }

    /* count movies */
    jfFetch(base + '?IncludeItemTypes=Movie&Recursive=true&Limit=0', cfg, function (e, d) {
      if (e) return fail(e);
      finish('totalMovies', d.TotalRecordCount || 0);
    });

    /* count series */
    jfFetch(base + '?IncludeItemTypes=Series&Recursive=true&Limit=0', cfg, function (e, d) {
      if (e) return fail(e);
      finish('totalSeries', d.TotalRecordCount || 0);
    });

    /* last 3 movies by DateCreated desc */
    var recentQs = base +
      '?IncludeItemTypes=Movie' +
      '&Recursive=true' +
      '&SortBy=DateCreated' +
      '&SortOrder=Descending' +
      '&Limit=3' +
      '&Fields=ProductionYear' +
      '&ImageTypeLimit=1' +
      '&EnableImageTypes=Primary';

    jfFetch(recentQs, cfg, function (e, d) {
      if (e) return fail(e);
      var items = (d.Items || []).map(function (it) {
        var tag = it.ImageTags && it.ImageTags.Primary ? it.ImageTags.Primary : null;
        return {
          id:       it.Id,
          name:     it.Name,
          year:     it.ProductionYear || null,
          imageTag: tag
        };
      });
      finish('recentMovies', items);
    });
  });
});

/**
 * GET /api/jf/image/:itemId[?type=Primary&maxH=400]
 * Proxies a Jellyfin cover image, keeping the API key server-side and
 * adding a 24-hour Cache-Control header so the browser caches covers.
 */
router.get('/image/:itemId', function (req, res) {
  var cfg  = getJFConfig();
  var type = req.query.type || 'Primary';
  var maxH = req.query.maxH || '400';

  if (!cfg.url || !cfg.token) {
    return res.status(400).send('Not configured');
  }

  var imgUrl = cfg.url + '/Items/' + req.params.itemId +
               '/Images/' + type + '?maxHeight=' + maxH + '&quality=85';

  req.log.debug({ itemId: req.params.itemId, maxH: maxH }, 'proxying Jellyfin image');

  fetch(imgUrl, { headers: jfHeaders(cfg.token), timeout: 10000 })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      res.setHeader('Content-Type',  r.headers.get('content-type') || 'image/jpeg');
      /* Cache covers for 24 hours in the browser */
      res.setHeader('Cache-Control', 'public, max-age=86400');
      r.body.pipe(res);
    })
    .catch(function (e) {
      req.log.warn({ err: e.message, itemId: req.params.itemId }, 'image proxy failed');
      res.status(404).send(e.message);
    });
});

module.exports = router;
