/**
 * lib/appVersion.js
 *
 * The single release identifier the whole app agrees on.
 *
 * It is package.json's version rather than a build hash because CI already
 * treats that string as the release identity: .github/workflows/build.yml
 * refuses to publish an image whose package.json version does not match the
 * pushed tag. So bumping the version *is* cutting a release, and the value
 * below changes exactly once per published build — which is precisely the
 * granularity the frontend's "is what I'm running still current?" check
 * needs.
 *
 * Two consumers, deliberately reading the same constant:
 *   - GET /api/config          — the version the SERVER is running
 *   - lib/indexHtml.js         — stamped into the HTML, so the page knows
 *                                the version it was BUILT from even when the
 *                                browser served it out of cache
 * The comparison between those two is what detects a stale client.
 */

'use strict';

var pkg = require('../../package.json');

module.exports = String(pkg.version || '0.0.0');
