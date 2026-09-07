'use strict';

var express = require('express');
var request = require('supertest');
var fs = require('fs');
var path = require('path');
var wd = require('../helpers/tempWorkdir');

var fetch; // reassigned fresh in beforeEach — see helpers/tempWorkdir.js

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
  fetch = global.fetch = jest.fn();
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
    current: { time: '2026-08-29T10:00', temperature_2m: 20.4, apparent_temperature: 22.1 },
    daily: {
      time: ['2026-08-29', '2026-08-30'],
      weather_code: [1, 2],
      temperature_2m_max: [28, 27],
      temperature_2m_min: [18, 17],
      precipitation_probability_max: [10, 20],
      precipitation_sum: [0, 3.4],
      uv_index_max: [6.2, 5.1],
      wind_speed_10m_max: [14, 11],
      wind_direction_10m_dominant: [220, 180],
      apparent_temperature_max: [30, 29],
      apparent_temperature_min: [16, 15],
      daylight_duration: [50400, 50280],
      sunshine_duration: [39600, 21600],
      sunrise: ['2026-08-29T06:00', '2026-08-30T06:01'],
      sunset: ['2026-08-29T20:00', '2026-08-30T19:59']
    },
    hourly: {
      time: ['2026-08-29T08:00', '2026-08-29T09:00', '2026-08-29T10:00', '2026-08-29T11:00'],
      temperature_2m:            [17, 18, 19, 21],
      apparent_temperature:      [16, 18, 20, 23],
      weather_code:              [1, 1, 1, 2],
      precipitation_probability: [0, 0, 10, 20],
      wind_speed_10m:            [5, 6, 7, 8],
      relative_humidity_2m:      [70, 68, 65, 60],
      is_day:                    [1, 1, 1, 1]
    }
  };

  test('returns today/tomorrow/days/hourly shape', function () {
    mockFetchOnce(true, upstream);
    var app = buildApp();
    return request(app).get('/api/weather/forecast?lat=45.46&lon=9.19').expect(200).then(function (res) {
      expect(res.body.today).toEqual({
        date: '2026-08-29', weekday: 'Sat', dateLabel: 'Saturday, 29 August',
        weatherCode: 1,
        tempMax: 28, tempMin: 18, feelsMax: 30, feelsMin: 16,
        precipProb: 10, precipSum: 0,
        uvIndexMax: 6.2, windMax: 14, windDir: 220,
        daylightHours: 14, sunshineHours: 11,
        sunrise: '2026-08-29T06:00', sunset: '2026-08-29T20:00',
        sunriseTime: '06:00', sunsetTime: '20:00',
        sunriseMin: 360, sunsetMin: 1200
      });
      expect(res.body.days).toHaveLength(2);
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });

  /* The upstream hourly series starts at local midnight, so by the
     afternoon most of it is already history. */
  test('slices the hourly series from the current hour, not from midnight', function () {
    mockFetchOnce(true, upstream);
    var app = buildApp();
    return request(app).get('/api/weather/forecast?lat=45.46&lon=9.19').expect(200).then(function (res) {
      expect(res.body.hourly).toHaveLength(2);   // 10:00 and 11:00 of four
      expect(res.body.hourly[0]).toEqual({
        time: '2026-08-29T10:00', hour: 10, clock: '10:00',
        temp: 19, feelsLike: 20, weatherCode: 1,
        precipProb: 10, wind: 7, humidity: 65, isDay: 1
      });
    });
  });

  /* Hour labels and weekdays are derived server-side because iOS 9 reads
     a timezone-less ISO string as UTC (the ES5 rule). */
  test('pre-computes clock and weekday labels so the client never parses dates', function () {
    mockFetchOnce(true, upstream);
    var app = buildApp();
    return request(app).get('/api/weather/forecast?lat=45.46&lon=9.19').expect(200).then(function (res) {
      expect(res.body.currentTime).toBe('10:00');
      expect(res.body.currentMin).toBe(600);
      expect(res.body.days[1].weekday).toBe('Sun');
      expect(res.body.days[1].sunriseTime).toBe('06:01');
    });
  });

  /* The day browser reads hoursByDate; the live strip keeps reading
     `hourly`. Both come from the same upstream response. */
  test('groups every hour by local date for the day browser', function () {
    mockFetchOnce(true, upstream);
    var app = buildApp();
    return request(app).get('/api/weather/forecast?lat=45.46&lon=9.19').expect(200).then(function (res) {
      expect(Object.keys(res.body.hoursByDate)).toEqual(['2026-08-29']);
      expect(res.body.hoursByDate['2026-08-29']).toHaveLength(4);
      /* trimmed shape: the four fields a forecast row draws, plus isDay */
      expect(res.body.hoursByDate['2026-08-29'][0]).toEqual({
        clock: '08:00', temp: 17, weatherCode: 1, precipProb: 0, isDay: 1
      });
    });
  });

  test('keeps the next-24 slice alongside the grouped hours', function () {
    mockFetchOnce(true, upstream);
    var app = buildApp();
    return request(app).get('/api/weather/forecast?lat=45.46&lon=9.19').expect(200).then(function (res) {
      /* `hourly` still starts at the current hour and keeps the richer
         per-entry fields the hero uses */
      expect(res.body.hourly[0].clock).toBe('10:00');
      expect(res.body.hourly[0].feelsLike).toBe(20);
      expect(res.body.hourly[0].humidity).toBe(65);
      /* while the grouped copy starts at midnight and omits them */
      expect(res.body.hoursByDate['2026-08-29'][0].clock).toBe('08:00');
      expect(res.body.hoursByDate['2026-08-29'][0].feelsLike).toBeUndefined();
    });
  });

  test('formats the long date label server-side for the day header', function () {
    mockFetchOnce(true, upstream);
    var app = buildApp();
    return request(app).get('/api/weather/forecast?lat=45.46&lon=9.19').expect(200).then(function (res) {
      expect(res.body.days[0].dateLabel).toBe('Saturday, 29 August');
      expect(res.body.days[1].dateLabel).toBe('Sunday, 30 August');
    });
  });

  test('converts daylight and sunshine durations from seconds to hours', function () {
    mockFetchOnce(true, upstream);
    var app = buildApp();
    return request(app).get('/api/weather/forecast?lat=45.46&lon=9.19').expect(200).then(function (res) {
      expect(res.body.days[0].daylightHours).toBe(14);   // 50400s
      expect(res.body.days[1].sunshineHours).toBe(6);    // 21600s
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
  function writeDefaultLocation() {
    var dataFile = path.join(process.cwd(), 'data/settings.json');
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    fs.writeFileSync(dataFile, JSON.stringify({
      weather_default_location: {
        name: 'Milan', country: 'Italy',
        latitude: 45.46, longitude: 9.19, timezone: 'Europe/Rome'
      }
    }));
  }

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
      /* humidity/wind are reported as null rather than omitted when the
         upstream response lacks them, so the widget can render one shape */
      expect(res.body.current).toEqual({
        temp: 22, weatherCode: 3, isDay: 1, humidity: null, wind: null
      });
      expect(res.body.today).toEqual({ tempMax: 25, tempMin: 15, precipProb: 5, weatherCode: 3 });
      expect(res.body.hourly).toEqual([]);
      expect(res.body.daily).toEqual([]);
    });
  });

  test('reports humidity and wind alongside the current conditions', function () {
    writeDefaultLocation();
    mockFetchOnce(true, {
      current: {
        time: '2026-01-11T10:00', temperature_2m: 7.4, weather_code: 3, is_day: 1,
        relative_humidity_2m: 63.2, wind_speed_10m: 11.4
      },
      daily: { time: ['2026-01-11'], weather_code: [3], temperature_2m_max: [9], temperature_2m_min: [2], precipitation_probability_max: [20] }
    });

    var app = buildApp();
    return request(app).get('/api/weather/home-summary').expect(200).then(function (res) {
      expect(res.body.current.humidity).toBe(63);
      expect(res.body.current.wind).toBe(11);
    });
  });

  /* The widget runs on iOS 9 WebKit, where a timezone-less ISO string
     parses as UTC — so hour labels and weekdays are derived here, and the
     client never touches Date. */
  test('slices the hourly series from the current hour and pre-computes labels', function () {
    writeDefaultLocation();
    mockFetchOnce(true, {
      current: { time: '2026-01-11T10:00', temperature_2m: 7, weather_code: 3, is_day: 1 },
      hourly: {
        time: ['2026-01-11T08:00', '2026-01-11T09:00', '2026-01-11T10:00',
               '2026-01-11T11:00', '2026-01-11T12:00', '2026-01-11T13:00',
               '2026-01-11T14:00', '2026-01-11T15:00', '2026-01-11T16:00'],
        temperature_2m:             [4, 5, 7, 8, 9, 9, 8, 7, 6],
        weather_code:               [3, 3, 3, 2, 2, 61, 61, 3, 3],
        precipitation_probability:  [0, 0, 10, 10, 20, 80, 70, 30, 10]
      },
      daily: { time: ['2026-01-11'], weather_code: [3], temperature_2m_max: [9], temperature_2m_min: [2], precipitation_probability_max: [20] }
    });

    var app = buildApp();
    return request(app).get('/api/weather/home-summary').expect(200).then(function (res) {
      expect(res.body.hourly).toHaveLength(6);
      /* starts at the current hour, not at the top of the series */
      expect(res.body.hourly[0]).toEqual({
        time: '2026-01-11T10:00', hour: 10, temp: 7, code: 3, precipProb: 10
      });
      expect(res.body.hourly[5].hour).toBe(15);
    });
  });

  test('returns the next three days as an outlook, excluding today', function () {
    writeDefaultLocation();
    mockFetchOnce(true, {
      current: { time: '2026-01-11T10:00', temperature_2m: 7, weather_code: 3, is_day: 1 },
      daily: {
        time: ['2026-01-11', '2026-01-12', '2026-01-13', '2026-01-14'],
        weather_code:                  [3, 61, 0, 2],
        temperature_2m_max:            [9, 8, 11, 12],
        temperature_2m_min:            [2, 3, 1, 4],
        precipitation_probability_max: [20, 80, 0, 10]
      }
    });

    var app = buildApp();
    return request(app).get('/api/weather/home-summary').expect(200).then(function (res) {
      expect(res.body.daily).toHaveLength(3);
      expect(res.body.daily[0]).toEqual({
        date: '2026-01-12', weekday: 'Mon', max: 8, min: 3, code: 61, precipProb: 80
      });
      expect(res.body.daily.map(function (d) { return d.weekday; }))
        .toEqual(['Mon', 'Tue', 'Wed']);
      /* today stays in `today`, never duplicated into the outlook */
      expect(res.body.today.tempMax).toBe(9);
    });
  });
});
