'use strict';

var express = require('express');
var request = require('supertest');
var fs = require('fs');
var path = require('path');
var wd = require('../helpers/tempWorkdir');

jest.mock('node-fetch');
var fetch; // reacquired fresh in beforeEach, after resetModules — see helpers/tempWorkdir.js

var WEATHER_ROUTE = path.join(__dirname, '../../backend/routes/weather');

function buildApp() {
  var app = express();
  app.use(express.json());
  app.use(wd.attachNoopLog);
  app.use('/api/weather', wd.requireFresh(WEATHER_ROUTE));
  return app;
}

function mockFetchOnce(ok, jsonBody) {
  fetch.mockImplementationOnce(function () {
    return Promise.resolve({ ok: ok, status: ok ? 200 : 500, json: function () { return Promise.resolve(jsonBody); } });
  });
}

beforeEach(function () {
  wd.useTempWorkdir();
  fetch = require('node-fetch');
});
afterEach(function () { wd.restoreWorkdir(); });

describe('GET /api/weather/search', function () {
  test('400 when q is missing', function () {
    var app = buildApp();
    return request(app).get('/api/weather/search').expect(400);
  });

  test('maps open-meteo geocoding results', function () {
    mockFetchOnce(true, {
      results: [{ id: 1, name: 'Milan', admin1: 'Lombardy', country: 'Italy', latitude: 45.46, longitude: 9.19, timezone: 'Europe/Rome' }]
    });
    var app = buildApp();
    return request(app).get('/api/weather/search?q=Milan').expect(200).then(function (res) {
      expect(res.body.locations).toEqual([
        { id: '1', name: 'Milan', admin1: 'Lombardy', country: 'Italy', latitude: 45.46, longitude: 9.19, timezone: 'Europe/Rome' }
      ]);
    });
  });

  test('502 when upstream fails', function () {
    mockFetchOnce(false, {});
    var app = buildApp();
    return request(app).get('/api/weather/search?q=xx').expect(502);
  });
});

describe('GET /api/weather/forecast', function () {
  test('400 when lat/lon missing', function () {
    var app = buildApp();
    return request(app).get('/api/weather/forecast').expect(400);
  });

  var upstream = {
    current: { temperature_2m: 20.4 },
    daily: {
      time: ['2026-08-29', '2026-08-30'],
      weather_code: [1, 2],
      temperature_2m_max: [28, 27],
      temperature_2m_min: [18, 17],
      precipitation_probability_max: [10, 20],
      sunrise: ['06:00', '06:01'],
      sunset: ['20:00', '19:59']
    },
    hourly: { time: ['2026-08-29T00:00'], temperature_2m: [19], weather_code: [1] }
  };

  test('returns today/tomorrow/days/hourly shape', function () {
    mockFetchOnce(true, upstream);
    var app = buildApp();
    return request(app).get('/api/weather/forecast?lat=45.46&lon=9.19').expect(200).then(function (res) {
      expect(res.body.today).toEqual({
        date: '2026-08-29', weatherCode: 1, tempMax: 28, tempMin: 18, precipProb: 10, sunrise: '06:00', sunset: '20:00'
      });
      expect(res.body.days).toHaveLength(2);
      expect(res.body.hourly).toEqual([{ time: '2026-08-29T00:00', temp: 19, weatherCode: 1 }]);
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });

  test('second request within TTL is served from cache without calling fetch again', function () {
    mockFetchOnce(true, upstream);
    var app = buildApp();
    return request(app).get('/api/weather/forecast?lat=45.46&lon=9.19').expect(200)
      .then(function () {
        return request(app).get('/api/weather/forecast?lat=45.46&lon=9.19').expect(200);
      })
      .then(function (res) {
        expect(res.body.today.date).toBe('2026-08-29');
        expect(fetch).toHaveBeenCalledTimes(1); // second call hit the cache
      });
  });

  test('force=true bypasses the cache and re-fetches', function () {
    mockFetchOnce(true, upstream);
    mockFetchOnce(true, upstream);
    var app = buildApp();
    return request(app).get('/api/weather/forecast?lat=45.46&lon=9.19').expect(200)
      .then(function () {
        return request(app).get('/api/weather/forecast?lat=45.46&lon=9.19&force=true').expect(200);
      })
      .then(function () {
        expect(fetch).toHaveBeenCalledTimes(2);
      });
  });

  test('502 when upstream errors', function () {
    mockFetchOnce(false, {});
    var app = buildApp();
    return request(app).get('/api/weather/forecast?lat=1&lon=1').expect(502);
  });
});

describe('GET /api/weather/home-summary', function () {
  test('404 when no default location is saved', function () {
    var app = buildApp();
    return request(app).get('/api/weather/home-summary').expect(404);
  });

  test('returns compact summary when a default location is saved', function () {
    var dataFile = path.join(process.cwd(), 'data/settings.json');
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    fs.writeFileSync(dataFile, JSON.stringify({
      weather_default_location: { name: 'Milan', country: 'Italy', latitude: 45.46, longitude: 9.19, timezone: 'Europe/Rome' }
    }));

    mockFetchOnce(true, {
      current: { temperature_2m: 21.6, weather_code: 3, is_day: 1 },
      daily: { weather_code: [3], temperature_2m_max: [25], temperature_2m_min: [15], precipitation_probability_max: [5] }
    });

    var app = buildApp();
    return request(app).get('/api/weather/home-summary').expect(200).then(function (res) {
      expect(res.body.location).toEqual({ name: 'Milan', country: 'Italy' });
      expect(res.body.current).toEqual({ temp: 22, weatherCode: 3, isDay: 1 });
      expect(res.body.today).toEqual({ tempMax: 25, tempMin: 15, precipProb: 5, weatherCode: 3 });
    });
  });
});
