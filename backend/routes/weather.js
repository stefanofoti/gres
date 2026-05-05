'use strict';

var express = require('express');
var router = express.Router();
var fetch = require('node-fetch');

function toNum(v) {
  var n = parseFloat(v);
  return isNaN(n) ? null : n;
}

router.get('/search', function (req, res) {
  var q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'query richiesta' });

  var url = 'https://geocoding-api.open-meteo.com/v1/search?name=' +
    encodeURIComponent(q) +
    '&count=8&language=it&format=json';

  fetch(url, { timeout: 10000 })
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

  if (lat === null || lon === null) {
    return res.status(400).json({ error: 'lat/lon richiesti' });
  }

  var url = 'https://api.open-meteo.com/v1/forecast?' +
    'latitude=' + encodeURIComponent(lat) +
    '&longitude=' + encodeURIComponent(lon) +
    '&timezone=' + encodeURIComponent(timezone || 'auto') +
    '&current=temperature_2m,relative_humidity_2m,is_day,weather_code,wind_speed_10m' +
    '&hourly=temperature_2m,weather_code' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset' +
    '&forecast_days=10';

  fetch(url, { timeout: 12000 })
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

      res.json({
        current: data.current || {},
        today: days[0] || null,
        tomorrow: days[1] || null,
        days: days,
        hourly: hourlyOut
      });
    })
    .catch(function (e) {
      req.log.warn({ err: e.message }, 'open-meteo forecast failed');
      res.status(502).json({ error: e.message });
    });
});

module.exports = router;
