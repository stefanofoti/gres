'use strict';

/**
 * app.js talks to the backend exclusively through a small XMLHttpRequest
 * wrapper (window._xhr) — deliberately not fetch(), which iOS 9 Safari
 * doesn't have. This installs a synchronous-enough fake XMLHttpRequest so
 * DOM tests can drive the app's bootstrap/interaction flows without a real
 * backend, using Jest fake timers to flush the (fake) async response.
 */

function installMockXHR(routeHandler) {
  function MockXHR() {}
  MockXHR.prototype.open = function (method, url) {
    this._method = method;
    this._url = url;
  };
  MockXHR.prototype.setRequestHeader = function () {};
  MockXHR.prototype.send = function (body) {
    var self = this;
    var result = routeHandler(self._method, self._url, body);
    setTimeout(function () {
      self.status = result.status || 200;
      self.responseText = JSON.stringify(result.body !== undefined ? result.body : {});
      self.readyState = 4;
      if (typeof self.onreadystatechange === 'function') self.onreadystatechange();
    }, 0);
  };

  global.XMLHttpRequest = MockXHR;
  if (typeof window !== 'undefined') window.XMLHttpRequest = MockXHR;
  return MockXHR;
}

/** Default responder: nothing configured, no PIN required, HA polling disabled. */
function defaultRouteHandler(method, url) {
  if (url.indexOf('/api/auth/pin-status') !== -1) return { status: 200, body: { required: false, length: 0 } };
  if (url.indexOf('/api/ha/status') !== -1) return { status: 200, body: { connected: false } };
  if (url.indexOf('/api/config') !== -1) return { status: 200, body: { haRefreshIntervalSec: 0 } };
  if (url.indexOf('/api/settings') !== -1) return { status: 200, body: {} };
  return { status: 404, body: { error: 'not found' } };
}

module.exports = { installMockXHR: installMockXHR, defaultRouteHandler: defaultRouteHandler };
