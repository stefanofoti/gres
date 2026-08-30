'use strict';

var express = require('express');
var request = require('supertest');
var path = require('path');
var wd = require('../helpers/tempWorkdir');

jest.mock('yahoo-finance2', function () {
  var searchMock = jest.fn();
  var quoteMock = jest.fn();
  var chartMock = jest.fn();
  function YahooFinance() {
    this.search = searchMock;
    this.quote = quoteMock;
    this.chart = chartMock;
  }
  return { default: YahooFinance, __mocks: { search: searchMock, quote: quoteMock, chart: chartMock } };
});
var yfMocks; // reacquired fresh in beforeEach, after resetModules — see helpers/tempWorkdir.js
             // (the jest.mock factory above re-runs on each reset, producing new jest.fn()s)

var MARKETS_ROUTE = path.join(__dirname, '../../backend/routes/markets');

function buildApp() {
  var app = express();
  app.use(express.json());
  app.use(wd.attachNoopLog);
  app.use('/api/markets', wd.requireFresh(MARKETS_ROUTE));
  return app;
}

beforeEach(function () {
  wd.useTempWorkdir();
  yfMocks = require('yahoo-finance2').__mocks;
});
afterEach(function () { wd.restoreWorkdir(); });

describe('GET /api/markets/search', function () {
  test('400 when q is missing', function () {
    var app = buildApp();
    return request(app).get('/api/markets/search').expect(400);
  });

  test('maps quotes and drops entries without a symbol', function () {
    yfMocks.search.mockResolvedValueOnce({
      quotes: [
        { symbol: 'AAPL', shortname: 'Apple Inc.', exchange: 'NMS', quoteType: 'EQUITY' },
        { shortname: 'No Symbol Co' }
      ]
    });
    var app = buildApp();
    return request(app).get('/api/markets/search?q=apple').expect(200).then(function (res) {
      expect(res.body.items).toEqual([
        { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NMS', type: 'EQUITY' }
      ]);
    });
  });

  test('502 when the upstream search rejects', function () {
    yfMocks.search.mockRejectedValueOnce(new Error('upstream down'));
    var app = buildApp();
    return request(app).get('/api/markets/search?q=x').expect(502);
  });
});

describe('favorites', function () {
  test('GET /favorites is empty by default', function () {
    var app = buildApp();
    return request(app).get('/api/markets/favorites').expect(200).then(function (res) {
      expect(res.body).toEqual({ items: [] });
    });
  });

  test('POST /favorites/toggle adds then removes a symbol', function () {
    var app = buildApp();
    return request(app)
      .post('/api/markets/favorites/toggle')
      .send({ symbol: 'aapl', name: 'Apple Inc.', exchange: 'NMS' })
      .expect(200)
      .then(function (res) {
        expect(res.body).toEqual({
          success: true, isFavorite: true,
          favorites: [{ symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NMS', type: '' }]
        });
        return request(app).post('/api/markets/favorites/toggle').send({ symbol: 'AAPL' });
      })
      .then(function (res) {
        expect(res.body).toEqual({ success: true, isFavorite: false, favorites: [] });
      });
  });

  test('POST /favorites/toggle 400 when symbol missing', function () {
    var app = buildApp();
    return request(app).post('/api/markets/favorites/toggle').send({}).expect(400);
  });

  test('GET /favorites enriches saved favorites with live quote data', function () {
    var app = buildApp();
    return request(app)
      .post('/api/markets/favorites/toggle')
      .send({ symbol: 'AAPL', name: 'Apple Inc.' })
      .expect(200)
      .then(function () {
        yfMocks.quote.mockResolvedValueOnce([
          { symbol: 'AAPL', regularMarketPrice: 200.5, regularMarketChange: 1.2, regularMarketChangePercent: 0.6 }
        ]);
        return request(app).get('/api/markets/favorites').expect(200);
      })
      .then(function (res) {
        expect(res.body.items[0]).toEqual({
          symbol: 'AAPL', name: 'Apple Inc.', exchange: '', price: 200.5, change: 1.2, changePercent: 0.6
        });
      });
  });
});

describe('GET /api/markets/detail', function () {
  test('400 when symbol missing', function () {
    var app = buildApp();
    return request(app).get('/api/markets/detail').expect(400);
  });

  test('assembles chart points and quote fields, reflecting favorite status', function () {
    yfMocks.chart.mockResolvedValueOnce({
      meta: { longName: 'Apple Inc.', exchangeName: 'NMS', currency: 'USD' },
      quotes: [
        { date: '2026-08-28T00:00:00Z', close: 199.1 },
        { date: '2026-08-29T00:00:00Z', close: 201.3 },
        { date: '2026-08-30T00:00:00Z', close: null } /* dropped: no close */
      ]
    });
    yfMocks.quote.mockResolvedValueOnce({
      regularMarketPrice: 201.3, regularMarketChange: 2.2, regularMarketChangePercent: 1.1,
      regularMarketDayLow: 198, regularMarketDayHigh: 202, regularMarketVolume: 1000000
    });

    var app = buildApp();
    return request(app).get('/api/markets/detail?symbol=aapl&range=1mo').expect(200).then(function (res) {
      expect(res.body.symbol).toBe('AAPL');
      expect(res.body.name).toBe('Apple Inc.');
      expect(res.body.points).toHaveLength(2);
      expect(res.body.isFavorite).toBe(false);
      expect(res.body.dayLow).toBe(198);
    });
  });

  test('502 when chart/quote lookups fail', function () {
    yfMocks.chart.mockRejectedValueOnce(new Error('not found'));
    yfMocks.quote.mockResolvedValueOnce({});
    var app = buildApp();
    return request(app).get('/api/markets/detail?symbol=ZZZZ').expect(502);
  });
});
