/**
 * middleware/requestLogger.js
 *
 * Express middleware that:
 *   1. Generates a unique requestId (UUID v4) for every incoming request.
 *   2. Attaches the child logger (with requestId bound) to `req.log` so that
 *      any route handler can emit correlated log lines via `req.log.info(...)`.
 *   3. Logs the incoming request immediately (level: info).
 *   4. Patches `res.end` to log the outgoing response with HTTP status and
 *      the total processing time in milliseconds.
 *
 * Usage (in server.js):
 *   app.use(require('./middleware/requestLogger'));
 */

'use strict';

var logger = require('../logger');

/**
 * Minimal UUID v4 generator
 *
 * @returns {string} A random RFC-4122 v4 UUID string.
 */
function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = (Math.random() * 16) | 0;
    var v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Express middleware — structured request / response logging.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {Function}                   next
 */
function requestLogger(req, res, next) {
  /* ── 1. Attach a unique ID to this request cycle ─────── */
  var requestId = uuidv4();
  req.requestId = requestId;

  /* ── 2. Create a child logger with the requestId bound ─ */
  req.log = logger.child({ requestId: requestId });

  /* ── 3. Record start time for latency calculation ─────── */
  var startAt = process.hrtime();

  /* ── 4. Log the incoming request ─────────────────────── */
  req.log.info({
    event:  'request',
    method: req.method,
    url:    req.originalUrl || req.url,
    ip:     req.ip || (req.connection && req.connection.remoteAddress)
  }, 'incoming request');

  /* ── 5. Patch res.end to capture the response ────────── */
  var originalEnd = res.end.bind(res);
  res.end = function (chunk, encoding) {
    /* Restore original and send response first */
    res.end = originalEnd;
    res.end(chunk, encoding);

    /* Calculate elapsed time in milliseconds */
    var diff   = process.hrtime(startAt);
    var ms     = (diff[0] * 1e3 + diff[1] / 1e6).toFixed(2);

    /* Choose log level based on HTTP status code:
       5xx → error, 4xx → warn, everything else → info */
    var status = res.statusCode;
    var level  = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';

    req.log[level]({
      event:      'response',
      method:     req.method,
      url:        req.originalUrl || req.url,
      statusCode: status,
      ms:         parseFloat(ms)
    }, 'response sent');
  };

  next();
}

module.exports = requestLogger;
