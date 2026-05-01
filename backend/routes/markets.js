'use strict';

var express = require('express');
var router  = express.Router();
var fs      = require('fs');
var path    = require('path');
var YahooFinance = require('yahoo-finance2').default;
var yf           = new YahooFinance({ suppressNotices: ['yahooSurvey'] });


var DATA_FILE = path.join(process.cwd(), 'data/settings.json');

/* ── Helpers ──────────────────────────────────────────── */

function ensureDataDir() {
  var dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({}));
}

function readSettings() {
  ensureDataDir();
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch (e) { return {}; }
}

function writeSettings(data) {
  ensureDataDir();
  var tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

function getFavorites() {
  var s = readSettings();
  return Array.isArray(s.markets_favorites) ? s.markets_favorites : [];
}

/**
 * Map UI range key to yahoo-finance2 chart() queryOptions.
 */
function mapRangeToChartOpts(range) {
  var now = new Date();
  var p1;
  var interval;

  if (range === '1d') {
    p1 = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    interval = '5m';
  } else if (range === '1wk') {
    p1 = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
    interval = '30m';
  } else if (range === '1mo') {
    p1 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    interval = '1d';
  } else if (range === '1y') {
    p1 = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    interval = '1wk';
  } else if (range === '5y') {
    p1 = new Date(now.getTime() - 5 * 365 * 24 * 60 * 60 * 1000);
    interval = '1mo';
  } else {
    p1 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    interval = '1d';
  }

  return { period1: p1, period2: now, interval: interval };
}

/* ── Routes ──────────────────────────────────────────── */

/**
 * GET /api/markets/search?q=<query>
 */
router.get('/search', function (req, res) {
  var q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'query richiesta' });

  yf.search(q, { quotesCount: 12, newsCount: 0 })
    .then(function (data) {
      var quotes = (data && data.quotes) ? data.quotes : [];
      var out = [];
      for (var i = 0; i < quotes.length; i++) {
        if (!quotes[i].symbol) continue;
        out.push({
          symbol:   quotes[i].symbol,
          name:     quotes[i].shortname || quotes[i].longname || quotes[i].symbol,
          exchange: quotes[i].exchange  || '',
          type:     quotes[i].quoteType || ''
        });
      }
      res.json({ items: out });
    })
    .catch(function (e) {
      req.log.warn({ err: e.message, query: q }, 'markets search failed');
      res.status(502).json({ error: e.message });
    });
});

/**
 * GET /api/markets/favorites
 */
router.get('/favorites', function (req, res) {
  var favs = getFavorites();
  if (!favs.length) return res.json({ items: [] });

  var symbols = favs.map(function (f) { return f.symbol; });

  yf.quote(symbols)
    .then(function (results) {
      var arr = Array.isArray(results) ? results : [results];
      var quoteMap = {};
      for (var i = 0; i < arr.length; i++) {
        if (arr[i] && arr[i].symbol) quoteMap[arr[i].symbol] = arr[i];
      }

      var out = [];
      for (var j = 0; j < favs.length; j++) {
        var q = quoteMap[favs[j].symbol] || {};
        out.push({
          symbol:        favs[j].symbol,
          name:          favs[j].name || q.shortName || favs[j].symbol,
          exchange:      favs[j].exchange || q.fullExchangeName || '',
          price:         q.regularMarketPrice         != null ? q.regularMarketPrice         : null,
          change:        q.regularMarketChange        != null ? q.regularMarketChange        : null,
          changePercent: q.regularMarketChangePercent != null ? q.regularMarketChangePercent : null
        });
      }
      res.json({ items: out });
    })
    .catch(function (e) {
      req.log.warn({ err: e.message, favorites: symbols }, 'markets favorites failed');
      res.status(502).json({ error: e.message });
    });
});

/**
 * POST /api/markets/favorites/toggle
 */
router.post('/favorites/toggle', function (req, res) {
  var body   = req.body || {};
  var symbol = (body.symbol || '').trim().toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol richiesto' });

  var s    = readSettings();
  var favs = Array.isArray(s.markets_favorites) ? s.markets_favorites : [];

  var idx = -1;
  for (var i = 0; i < favs.length; i++) {
    if ((favs[i].symbol || '').toUpperCase() === symbol) { idx = i; break; }
  }

  var isFavorite;
  if (idx >= 0) {
    favs.splice(idx, 1);
    isFavorite = false;
  } else {
    favs.push({
      symbol:   symbol,
      name:     body.name     || symbol,
      exchange: body.exchange || '',
      type:     body.type     || ''
    });
    isFavorite = true;
  }

  s.markets_favorites = favs;
  writeSettings(s);
  res.json({ success: true, isFavorite: isFavorite, favorites: favs });
});

/**
 * GET /api/markets/detail?symbol=<SYM>&range=<1d|1wk|1mo|1y|5y>
 * chart() + quote() in parallel — no artificial delay.
 */
router.get('/detail', function (req, res) {
  var symbol = (req.query.symbol || '').trim().toUpperCase();
  var range  = (req.query.range  || '1mo').trim();
  if (!symbol) return res.status(400).json({ error: 'symbol richiesto' });

  var chartOpts = mapRangeToChartOpts(range);

  var chartPromise = yf.chart(symbol, {
    period1:  chartOpts.period1,
    period2:  chartOpts.period2,
    interval: chartOpts.interval
  });

  var quotePromise = yf.quote(symbol);

  Promise.all([chartPromise, quotePromise])
    .then(function (results) {
      var chartData = results[0];
      var quoteData = results[1];

      var quotes = (chartData && chartData.quotes) ? chartData.quotes : [];
      var meta   = (chartData && chartData.meta)   ? chartData.meta   : {};
      var points = [];

      for (var i = 0; i < quotes.length; i++) {
        var row = quotes[i];
        if (row && row.date != null && row.close != null) {
          points.push({
            t: Math.floor(new Date(row.date).getTime() / 1000),
            v: row.close
          });
        }
      }

      var favs       = getFavorites();
      var isFavorite = false;
      for (var j = 0; j < favs.length; j++) {
        if ((favs[j].symbol || '').toUpperCase() === symbol) { isFavorite = true; break; }
      }

      var q = quoteData || {};

      res.json({
        symbol:           symbol,
        name:             meta.longName    || meta.shortName    || q.longName    || q.shortName    || symbol,
        exchange:         meta.exchangeName || q.fullExchangeName || '',
        currency:         meta.currency    || q.currency        || '',
        price:            q.regularMarketPrice         != null ? q.regularMarketPrice         : (meta.regularMarketPrice != null ? meta.regularMarketPrice : null),
        change:           q.regularMarketChange        != null ? q.regularMarketChange        : null,
        changePercent:    q.regularMarketChangePercent != null ? q.regularMarketChangePercent : null,
        isFavorite:       isFavorite,
        points:           points,
        dayLow:           q.regularMarketDayLow        != null ? q.regularMarketDayLow        : null,
        dayHigh:          q.regularMarketDayHigh       != null ? q.regularMarketDayHigh       : null,
        volume:           q.regularMarketVolume        != null ? q.regularMarketVolume        : null,
        marketCap:        q.marketCap                 != null ? q.marketCap                  : null,
        peRatio:          q.trailingPE                != null ? q.trailingPE                 : null,
        dividendYield:    q.dividendYield             != null ? q.dividendYield              : null,
        fiftyTwoWeekLow:  q.fiftyTwoWeekLow           != null ? q.fiftyTwoWeekLow            : null,
        fiftyTwoWeekHigh: q.fiftyTwoWeekHigh          != null ? q.fiftyTwoWeekHigh           : null
      });
    })
    .catch(function (e) {
      req.log.warn({ err: e.message, symbol: symbol }, 'markets detail failed');
      res.status(502).json({ error: e.message });
    });
});

module.exports = router;
