'use strict';

/*
 * README.md commits this app to "Pure ES5 (no transpiler needed)" and
 * "Webkit on iOS 9+". These are static-analysis guardrails against
 * regressions: iOS 9's WebKit (~Safari 9, 2015) has no let/const, arrow
 * functions, template literals, classes, for-of, or window.fetch.
 * A real device/BrowserStack pass is still the authority for actual
 * rendering/touch-event quirks — this only catches syntax/API regressions
 * that automation can reliably check.
 */

var fs = require('fs');
var path = require('path');

var APP_JS_SRC = fs.readFileSync(path.join(__dirname, '../../frontend/js/app.js'), 'utf8');
var INDEX_HTML_SRC = fs.readFileSync(path.join(__dirname, '../../frontend/index.html'), 'utf8');

/**
 * Strip block comments, quoted string literals, then line comments — in that
 * order, so a literal "//" inside a string (e.g. the "http://..." in an SVG
 * xmlns attribute string) is removed along with its enclosing string before
 * the line-comment pass ever sees it.
 */
function stripCommentsAndStrings(src) {
  var out = src;
  out = out.replace(/\/\*[\s\S]*?\*\//g, '');
  out = out.replace(/'(?:[^'\\]|\\.)*'/g, '');
  out = out.replace(/"(?:[^"\\]|\\.)*"/g, '');
  out = out.replace(/\/\/[^\n]*/g, '');
  return out;
}

var CODE = stripCommentsAndStrings(APP_JS_SRC);

describe('frontend/js/app.js stays iOS 9 WebKit / pure-ES5 safe', function () {
  test('no let/const declarations', function () {
    expect(CODE).not.toMatch(/\b(let|const)\s+[A-Za-z_$]/);
  });

  test('no arrow functions', function () {
    expect(CODE).not.toMatch(/=>/);
  });

  test('no template literals', function () {
    expect(CODE).not.toMatch(/`/);
  });

  test('no ES6 classes', function () {
    expect(CODE).not.toMatch(/\bclass\s+[A-Za-z_$]/);
  });

  test('no for...of loops', function () {
    expect(CODE).not.toMatch(/for\s*\(\s*(?:var|let)?\s*[A-Za-z_$][\w$]*\s+of\s+/);
  });

  test('no spread/rest syntax', function () {
    expect(CODE).not.toMatch(/\.\.\.\s*[A-Za-z_$]/);
  });

  test('does not call window.fetch (unavailable before iOS 10.3 Safari)', function () {
    expect(CODE).not.toMatch(/\bfetch\s*\(/);
  });

  test('uses XMLHttpRequest for network calls instead', function () {
    expect(CODE).toMatch(/new XMLHttpRequest\(\)/);
  });

  test('localStorage access is wrapped in try/catch (iOS 9 private-mode throws on use)', function () {
    var idx = CODE.indexOf('localStorage.getItem');
    expect(idx).toBeGreaterThan(-1);
    var before = CODE.slice(Math.max(0, idx - 80), idx);
    expect(before).toMatch(/try\s*\{/);
  });
});

describe('frontend/index.html script loading stays iOS 9 safe', function () {
  test('no inline <script type="module"> (ES modules unsupported before iOS 11)', function () {
    expect(INDEX_HTML_SRC).not.toMatch(/<script[^>]+type=["']module["']/i);
  });

  test('app.js is loaded as a classic (non-deferred, non-async) script at the end of body', function () {
    var scriptTags = INDEX_HTML_SRC.match(/<script[^>]*src=["'][^"']*app\.js["'][^>]*>/i);
    expect(scriptTags).not.toBeNull();
    expect(scriptTags[0]).not.toMatch(/\btype=["']module["']/i);
  });
});
