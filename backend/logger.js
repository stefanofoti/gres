/**
 * logger.js
 *
 * Centralised logging module built on Pino (https://github.com/pinojs/pino).
 * Pino writes structured newline-delimited JSON to stdout; in production you
 * can pipe the output through `pino-pretty` for human-readable formatting:
 *
 *   node server.js | npx pino-pretty
 *
 * Every log line includes:
 *   - time        ISO-8601 timestamp
 *   - level       trace/debug/info/warn/error/fatal
 *   - requestId   UUID attached to a request (via middleware)
 *   - msg         human-readable message
 *   - …           any extra fields passed by the caller
 */

'use strict';

var pino = require('pino');

/* ── Root logger ────────────────────────────────────────
   level is read from the LOG_LEVEL environment variable;
   defaults to 'info' for production safety.             */
var logger = pino({
  level: process.env.LOG_LEVEL || 'info',

  /* Rename pino's default 'time' serialiser to emit ISO strings */
  timestamp: pino.stdTimeFunctions.isoTime,

  /* Serialisers: strip noise, mask sensitive fields */
  serializers: {
    req: function (req) {
      return {
        method:    req.method,
        url:       req.url,
        userAgent: req.headers && req.headers['user-agent'],
        ip:        req.remoteAddress || (req.socket && req.socket.remoteAddress)
      };
    },
    res: function (res) {
      return {
        statusCode: res.statusCode
      };
    },
    err: pino.stdSerializers.err
  }
});

module.exports = logger;
