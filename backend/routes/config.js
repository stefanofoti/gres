/**
 * routes/config.js
 *
 * Exposes read-only runtime configuration to the frontend.
 * Values come from environment variables (see .env.example).
 */

'use strict';

var express = require('express');
var router  = express.Router();
var VERSION = require('../lib/appVersion');

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
    haRefreshIntervalSec: parseHaRefreshIntervalSec(),
    /* The release this SERVER is running. The page compares it against the
       version stamped into its own HTML (lib/indexHtml.js) to notice that
       it is still running an older release out of the browser cache — the
       normal state of the wall panel between a deploy and an app restart. */
    version: VERSION
  });
});

module.exports = router;
module.exports.parseHaRefreshIntervalSec = parseHaRefreshIntervalSec;
