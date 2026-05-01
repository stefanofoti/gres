/**
 * routes/config.js
 *
 * Exposes read-only runtime configuration to the frontend.
 * Values come from environment variables (see .env.example).
 */

'use strict';

var express = require('express');
var router  = express.Router();

/**
 * Parse HA_REFRESH_INTERVAL_SEC from the environment.
 * Default: 15 seconds. Use 0 to disable automatic refresh.
 *
 * @returns {number}
 */
function parseHaRefreshIntervalSec() {
  var raw = process.env.HA_REFRESH_INTERVAL_SEC;
  if (raw === undefined || raw === '') return 15;
  var n = parseInt(raw, 10);
  if (isNaN(n) || n < 0) return 15;
  return n;
}

router.get('/', function (req, res) {
  res.json({
    haRefreshIntervalSec: parseHaRefreshIntervalSec()
  });
});

module.exports = router;
module.exports.parseHaRefreshIntervalSec = parseHaRefreshIntervalSec;
