'use strict';

var express = require('express');
var router = express.Router();
var fetch = require('node-fetch');
var fs   = require('fs');
var path = require('path');

var DATA_FILE = path.join(process.cwd(), 'data/settings.json');
var CACHE_DIR = path.join(process.cwd(), 'data/cache');
var CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function getCacheFilePath(key) {
  /* Sanitize key to use only alphanumeric, dash, underscore */
  var sanitized = key.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(CACHE_DIR, sanitized + '.json');
}

function readWeatherCache(key) {
  try {
    var filePath = getCacheFilePath(key);
    if (!fs.existsSync(filePath)) return null;
    
    var cached = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    var now = Date.now();
    var age = now - cached.timestamp;
    
    if (age > CACHE_TTL_MS) return null;
    
    return cached.data;
  } catch (e) {
    return null;
  }
}

function writeWeatherCache(key, data) {
  try {
    ensureCacheDir();
    var filePath = getCacheFilePath(key);
    var cacheObj = { timestamp: Date.now(), data: data };
    var tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cacheObj));
    fs.renameSync(tmp, filePath);
  } catch (e) {
    // Silently fail on cache write
  }
}

function readSettings() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch(e) { return {}; }
}

function toNum(v) {
  var n = parseFloat(v);
  return isNaN(n) ? null : n;
}

/**
 * GET /api/weather/home-summary
 * Returns compact weather data for the default saved location.
 * Used by the Home tab widget.
 */
router.get('/home-summary', function (req, res) {
  var settings = readSettings();
  var loc = settings.weather_default_location;
  if (!loc || !loc.latitude || !loc.longitude) {
    return res.status(404).json({ error: 'No default location set' });
  }

  var url = 'https://api.open-meteo.com/v1/forecast?' +
    'latitude='  + encodeURIComponent(loc.latitude) +
    '&longitude=' + encodeURIComponent(loc.longitude) +
    '&timezone='  + encodeURIComponent(loc.timezone || 'auto') +
    '&current=temperature_2m,weather_code,is_day' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
    '&forecast_days=1';

  fetch(url, { timeout: 30000 })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (data) {
      var cur   = data.current || {};
      var daily = data.daily   || {};
      res.json({
        location: { name: loc.name, country: loc.country || '' },
        current: {
          temp:        cur.temperature_2m  != null ? Math.round(cur.temperature_2m) : null,
          weatherCode: cur.weather_code    != null ? cur.weather_code : null,
          isDay:       cur.is_day          != null ? cur.is_day       : 1
        },
        today: {
          tempMax:    daily.temperature_2m_max ? Math.round(daily.temperature_2m_max[0]) : null,
          tempMin:    daily.temperature_2m_min ? Math.round(daily.temperature_2m_min[0]) : null,
          precipProb: daily.precipitation_probability_max ? daily.precipitation_probability_max[0] : null,
          weatherCode: daily.weather_code ? daily.weather_code[0] : null
        }
      });
    })
    .catch(function (e) {
      req.log.warn({ err: e.message }, 'weather home-summary failed');
      res.status(502).json({ error: e.message });
    });
});

router.get('/search', function (req, res) {
  var q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'query richiesta' });

  var url = 'https://geocoding-api.open-meteo.com/v1/search?name=' +
    encodeURIComponent(q) +
    '&count=8&language=it&format=json';

  fetch(url, { timeout: 30000 })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (data) {
      var list = [];
      var src = data && data.results ? data.results : [];
      for (var i = 0; i < src.length; i++) {
        list.push({
          id: String(src[i].id || ''),
          name: src[i].name || '',
          admin1: src[i].admin1 || '',
          country: src[i].country || '',
          latitude: src[i].latitude,
          longitude: src[i].longitude,
          timezone: src[i].timezone || 'auto'
        });
      }
      res.json({ locations: list });
    })
    .catch(function (e) {
      req.log.warn({ err: e.message }, 'open-meteo geocoding failed');
      res.status(502).json({ error: e.message });
    });
});

router.get('/forecast', function (req, res) {
  var lat = toNum(req.query.lat);
  var lon = toNum(req.query.lon);
  var timezone = (req.query.timezone || 'auto').trim();
  var forceRefresh = req.query.force === 'true' || req.query.force === '1';

  if (lat === null || lon === null) {
    return res.status(400).json({ error: 'lat/lon richiesti' });
  }

  /* Generate cache key from coordinates and timezone */
  var cacheKey = 'forecast_' + lat + '_' + lon + '_' + (timezone || 'auto');

  /* Try to read from cache if not forced refresh */
  if (!forceRefresh) {
    var cached = readWeatherCache(cacheKey);
    if (cached) {
      req.log.debug({ lat: lat, lon: lon, cacheKey: cacheKey }, 'weather forecast from cache');
      return res.json(cached);
    }
  }

  var url = 'https://api.open-meteo.com/v1/forecast?' +
    'latitude=' + encodeURIComponent(lat) +
    '&longitude=' + encodeURIComponent(lon) +
    '&timezone=' + encodeURIComponent(timezone || 'auto') +
    '&current=temperature_2m,relative_humidity_2m,is_day,weather_code,wind_speed_10m' +
    '&hourly=temperature_2m,weather_code' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset' +
    '&forecast_days=10';

  fetch(url, { timeout: 30000 })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (data) {
      var daily = data.daily || {};
      var days = [];
      var times = daily.time || [];
      for (var i = 0; i < times.length; i++) {
        days.push({
          date: times[i],
          weatherCode: daily.weather_code ? daily.weather_code[i] : null,
          tempMax: daily.temperature_2m_max ? daily.temperature_2m_max[i] : null,
          tempMin: daily.temperature_2m_min ? daily.temperature_2m_min[i] : null,
          precipProb: daily.precipitation_probability_max ? daily.precipitation_probability_max[i] : null,
          sunrise: daily.sunrise ? daily.sunrise[i] : '',
          sunset: daily.sunset ? daily.sunset[i] : ''
        });
      }

      var hourly = data.hourly || {};
      var hourlyOut = [];
      var hTime = hourly.time || [];
      for (var j = 0; j < hTime.length && j < 48; j++) {
        hourlyOut.push({
          time: hTime[j],
          temp: hourly.temperature_2m ? hourly.temperature_2m[j] : null,
          weatherCode: hourly.weather_code ? hourly.weather_code[j] : null
        });
      }

      var responseData = {
        current: data.current || {},
        today: days[0] || null,
        tomorrow: days[1] || null,
        days: days,
        hourly: hourlyOut
      };

      /* Cache the response */
      writeWeatherCache(cacheKey, responseData);

      res.json(responseData);
    })
    .catch(function (e) {
      req.log.warn({ err: e.message }, 'open-meteo forecast failed');
      res.status(502).json({ error: e.message });
    });
});

module.exports = router;
