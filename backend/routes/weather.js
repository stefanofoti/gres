'use strict';

var express = require('express');
var router = express.Router();
var fs   = require('fs');
var path = require('path');
var store = require('../lib/settingsStore');

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

function weatherHeaders() {
  return {
    'User-Agent': 'gres/0.1',
    'Content-Type':  'application/json',
    'Accept':        'application/json',
    'Connection':    'close'
  };
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

var readSettings = store.readSettings;

function toNum(v) {
  var n = parseFloat(v);
  return isNaN(n) ? null : n;
}

/* ── Home-summary shaping helpers ────────────────────────
   The Home widget runs on iOS 9 WebKit, where Date parsing of a
   timezone-less ISO string ("2026-01-11T14:00") follows the ES5 rule
   and is read as UTC — the ES6 local-time rule arrived later. Open-Meteo
   returns exactly that format, in the location's own timezone, so
   parsing it in the browser would shift every hour label by the UTC
   offset. Both helpers below therefore derive the display value here
   and send it ready to render, leaving no date maths on the client. */

var WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
var WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday',
                     'Thursday', 'Friday', 'Saturday'];
var MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June',
                   'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-01-11T14:00" -> 14 */
function hourOf(isoLocal) {
  var m = /T(\d{2}):/.exec(isoLocal || '');
  return m ? parseInt(m[1], 10) : null;
}

/** "2026-01-11T06:12" -> "06:12" */
function clockOf(isoLocal) {
  var m = /T(\d{2}:\d{2})/.exec(isoLocal || '');
  return m ? m[1] : '';
}

/** "2026-01-11T06:12" -> minutes since local midnight, for the day arc */
function minutesOf(isoLocal) {
  var m = /T(\d{2}):(\d{2})/.exec(isoLocal || '');
  return m ? (parseInt(m[1], 10) * 60 + parseInt(m[2], 10)) : null;
}

/** "2026-01-12" -> "Mon" */
function weekdayOf(isoDate) {
  var p = (isoDate || '').split('-');
  if (p.length !== 3) return '';
  /* Date.UTC + getUTCDay keeps the weekday independent of the server's
     own timezone — the date string is already local to the location. */
  var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  return WEEKDAYS[d.getUTCDay()] || '';
}

/** "2026-01-12" -> "Monday, 12 January" — the day-detail header */
function dateLabelOf(isoDate) {
  var p = (isoDate || '').split('-');
  if (p.length !== 3) return '';
  var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  return WEEKDAYS_LONG[d.getUTCDay()] + ', ' + (+p[2]) + ' ' + MONTHS_LONG[+p[1] - 1];
}

/** Open-Meteo reports durations in seconds; the UI wants hours. */
function hoursFromSeconds(sec) {
  if (sec === undefined || sec === null || isNaN(sec)) return null;
  return Math.round((sec / 3600) * 10) / 10;
}

/**
 * Group the whole hourly series by local date, for the day browser.
 *
 * Deliberately trimmed to the four fields a forecast row draws. The full
 * ten days at every field would roughly quadruple the payload; at four
 * fields it is about 2.4x, which is the trade the plan settled on. The
 * richer per-hour fields stay on `hourly` (the next-24 slice), which is
 * where the hero and the live strip actually read them.
 */
function groupHoursByDate(hourly) {
  var out = {};
  if (!hourly || !Array.isArray(hourly.time)) return out;

  for (var i = 0; i < hourly.time.length; i++) {
    var iso  = hourly.time[i];
    var date = iso.split('T')[0];
    if (!out[date]) out[date] = [];
    out[date].push({
      clock:       clockOf(iso),
      temp:        hourly.temperature_2m ? hourly.temperature_2m[i] : null,
      weatherCode: hourly.weather_code ? hourly.weather_code[i] : null,
      precipProb:  hourly.precipitation_probability ? hourly.precipitation_probability[i] : null,
      /* One byte-cheap extra: the strip tints daylight columns, and
         deriving it client-side would mean parsing the hour back out. */
      isDay:       hourly.is_day ? hourly.is_day[i] : 1
    });
  }
  return out;
}

/**
 * Slice the hourly series to the next `count` entries at or after `fromIso`.
 * Both are local-time ISO strings from the same response, so a plain
 * lexicographic compare orders them correctly with no parsing.
 */
function upcomingHours(hourly, fromIso, count) {
  var out = [];
  if (!hourly || !Array.isArray(hourly.time)) return out;

  var start = 0;
  if (fromIso) {
    for (var i = 0; i < hourly.time.length; i++) {
      if (hourly.time[i] >= fromIso) { start = i; break; }
    }
  }

  for (var j = start; j < hourly.time.length && out.length < count; j++) {
    out.push({
      time:       hourly.time[j],
      hour:       hourOf(hourly.time[j]),
      temp:       hourly.temperature_2m ? Math.round(hourly.temperature_2m[j]) : null,
      code:       hourly.weather_code ? hourly.weather_code[j] : null,
      precipProb: hourly.precipitation_probability ? hourly.precipitation_probability[j] : null
    });
  }
  return out;
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
    /* One upstream call still covers the whole widget: asking for the
       hourly series and three extra days adds fields, not requests. */
    '&current=temperature_2m,weather_code,is_day,relative_humidity_2m,wind_speed_10m' +
    '&hourly=temperature_2m,weather_code,precipitation_probability' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
    '&forecast_days=4';

  fetch(url, { headers: weatherHeaders(), signal: AbortSignal.timeout(30000) })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (data) {
      var cur   = data.current || {};
      var daily = data.daily   || {};

      /* Days 1..3 — index 0 is today, already reported as `today`. */
      var outlook = [];
      if (daily.time) {
        for (var d = 1; d < daily.time.length && outlook.length < 3; d++) {
          outlook.push({
            date:       daily.time[d],
            weekday:    weekdayOf(daily.time[d]),
            max:        daily.temperature_2m_max ? Math.round(daily.temperature_2m_max[d]) : null,
            min:        daily.temperature_2m_min ? Math.round(daily.temperature_2m_min[d]) : null,
            code:       daily.weather_code ? daily.weather_code[d] : null,
            precipProb: daily.precipitation_probability_max ? daily.precipitation_probability_max[d] : null
          });
        }
      }

      res.json({
        location: { name: loc.name, country: loc.country || '' },
        current: {
          temp:        cur.temperature_2m  != null ? Math.round(cur.temperature_2m) : null,
          weatherCode: cur.weather_code    != null ? cur.weather_code : null,
          isDay:       cur.is_day          != null ? cur.is_day       : 1,
          humidity:    cur.relative_humidity_2m != null ? Math.round(cur.relative_humidity_2m) : null,
          wind:        cur.wind_speed_10m       != null ? Math.round(cur.wind_speed_10m)       : null
        },
        today: {
          tempMax:    daily.temperature_2m_max ? Math.round(daily.temperature_2m_max[0]) : null,
          tempMin:    daily.temperature_2m_min ? Math.round(daily.temperature_2m_min[0]) : null,
          precipProb: daily.precipitation_probability_max ? daily.precipitation_probability_max[0] : null,
          weatherCode: daily.weather_code ? daily.weather_code[0] : null
        },
        hourly: upcomingHours(data.hourly, cur.time, 6),
        daily:  outlook
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

  fetch(url, { headers: weatherHeaders(), signal: AbortSignal.timeout(30000) })
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

  /* Cache key carries a shape version: entries live 12 hours, so without
     the bump a client would keep being served the old, narrower payload
     for half a day after a deploy that widened it. v3 added hoursByDate
     and the per-day detail fields — a client on a v2 entry would open a
     day detail with no hours in it, which reads as a frontend bug. */
  var cacheKey = 'forecast_v3_' + lat + '_' + lon + '_' + (timezone || 'auto');

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
    /* Still one upstream call — the extra series are fields on the same
       response, not additional requests. */
    '&current=temperature_2m,relative_humidity_2m,is_day,weather_code,wind_speed_10m,' +
      'apparent_temperature,precipitation,surface_pressure,wind_direction_10m,cloud_cover' +
    '&hourly=temperature_2m,weather_code,precipitation_probability,apparent_temperature,' +
      'is_day,wind_speed_10m,relative_humidity_2m' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,' +
      'sunrise,sunset,uv_index_max,precipitation_sum,wind_speed_10m_max,wind_direction_10m_dominant,' +
      'apparent_temperature_max,apparent_temperature_min,daylight_duration,sunshine_duration' +
    '&forecast_days=10';

  fetch(url, { headers: weatherHeaders(), signal: AbortSignal.timeout(30000) })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (data) {
      var cur   = data.current || {};
      var daily = data.daily   || {};
      var days  = [];
      var times = daily.time || [];

      /* Everything the client would otherwise need Date() for is derived
         here. On iOS 9 WebKit a timezone-less ISO string ("2026-01-11T14:00")
         parses under the ES5 rule — as UTC — so any hour or weekday the
         browser computed would be shifted by the location's UTC offset. */
      for (var i = 0; i < times.length; i++) {
        days.push({
          date:        times[i],
          weekday:     weekdayOf(times[i]),
          /* Long form for the day-detail header. Server-formatted for the
             same reason as `weekday`: a browser deriving it from the ISO
             string would land a day either side of midnight on iOS 9. */
          dateLabel:   dateLabelOf(times[i]),
          weatherCode: daily.weather_code ? daily.weather_code[i] : null,
          tempMax:     daily.temperature_2m_max ? daily.temperature_2m_max[i] : null,
          tempMin:     daily.temperature_2m_min ? daily.temperature_2m_min[i] : null,
          feelsMax:    daily.apparent_temperature_max ? daily.apparent_temperature_max[i] : null,
          feelsMin:    daily.apparent_temperature_min ? daily.apparent_temperature_min[i] : null,
          precipProb:  daily.precipitation_probability_max ? daily.precipitation_probability_max[i] : null,
          precipSum:   daily.precipitation_sum ? daily.precipitation_sum[i] : null,
          uvIndexMax:  daily.uv_index_max ? daily.uv_index_max[i] : null,
          windMax:     daily.wind_speed_10m_max ? daily.wind_speed_10m_max[i] : null,
          windDir:     daily.wind_direction_10m_dominant ? daily.wind_direction_10m_dominant[i] : null,
          daylightHours: hoursFromSeconds(daily.daylight_duration ? daily.daylight_duration[i] : null),
          sunshineHours: hoursFromSeconds(daily.sunshine_duration ? daily.sunshine_duration[i] : null),
          sunrise:     daily.sunrise ? daily.sunrise[i] : '',
          sunset:      daily.sunset  ? daily.sunset[i]  : '',
          sunriseTime: clockOf(daily.sunrise ? daily.sunrise[i] : ''),
          sunsetTime:  clockOf(daily.sunset  ? daily.sunset[i]  : ''),
          sunriseMin:  minutesOf(daily.sunrise ? daily.sunrise[i] : ''),
          sunsetMin:   minutesOf(daily.sunset  ? daily.sunset[i]  : '')
        });
      }

      /* The hourly series starts at local midnight, so half of it is
         already in the past by mid-afternoon. Slice from the current hour
         instead — "the next 24 hours" is what the tab actually shows. */
      var hourly    = data.hourly || {};
      var hTime     = hourly.time || [];
      var hourlyOut = [];
      var start     = 0;

      if (cur.time) {
        for (var s = 0; s < hTime.length; s++) {
          if (hTime[s] >= cur.time) { start = s; break; }
        }
      }

      for (var j = start; j < hTime.length && hourlyOut.length < 24; j++) {
        hourlyOut.push({
          time:        hTime[j],
          hour:        hourOf(hTime[j]),
          clock:       clockOf(hTime[j]),
          temp:        hourly.temperature_2m ? hourly.temperature_2m[j] : null,
          feelsLike:   hourly.apparent_temperature ? hourly.apparent_temperature[j] : null,
          weatherCode: hourly.weather_code ? hourly.weather_code[j] : null,
          precipProb:  hourly.precipitation_probability ? hourly.precipitation_probability[j] : null,
          wind:        hourly.wind_speed_10m ? hourly.wind_speed_10m[j] : null,
          humidity:    hourly.relative_humidity_2m ? hourly.relative_humidity_2m[j] : null,
          isDay:       hourly.is_day ? hourly.is_day[j] : 1
        });
      }

      var responseData = {
        current:     cur,
        currentTime: clockOf(cur.time),
        currentMin:  minutesOf(cur.time),
        today:       days[0] || null,
        tomorrow:    days[1] || null,
        days:        days,
        /* The next 24 hours, richer per entry — the hero and live strip. */
        hourly:      hourlyOut,
        /* Every hour of every day, trimmed — the day browser. */
        hoursByDate: groupHoursByDate(hourly)
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
