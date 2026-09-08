'use strict';

/*
 * CLAUDE.md pins the frontend to iOS 9.3 WebKit, and the CSS side of that
 * constraint is the dangerous half: every feature banned below is valid
 * CSS that parses fine, throws nothing, and simply does not apply on the
 * target engine. A `gap` on the Home widget grid would look correct on
 * every machine anyone develops on and collapse the gutters on the wall
 * panel — no error, no failing assertion, just a wrong-looking iPad.
 *
 * These are static guardrails only. A real device pass remains the
 * authority for rendering; this catches the regressions automation can.
 */

var fs = require('fs');
var path = require('path');

var CSS_DIR = path.join(__dirname, '../../frontend/css');
var CSS_FILES = fs.readdirSync(CSS_DIR).filter(function (f) {
  return /\.css$/.test(f);
}).sort();

/* Comments carry prose about the very features being banned (the block
   above each rule explains why `gap` is not used), so they must be
   stripped before matching or every guardrail fails on its own docs. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '');
}

var CSS = CSS_FILES.map(function (f) {
  return stripComments(fs.readFileSync(path.join(CSS_DIR, f), 'utf8'));
}).join('\n');

/** Resolve a :root spacing token to its rem value. */
function tokenRem(name) {
  var m = CSS.match(new RegExp('--' + name + ':\\s*([\\d.]+)rem'));
  expect(m).not.toBeNull();
  return parseFloat(m[1]);
}

/* Report the offending line, not just "expected no match" — the whole
   point is to make the fix obvious. */
function findLines(re) {
  var hits = [];
  var lines = CSS.split('\n');
  for (var i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) hits.push(lines[i].trim());
    re.lastIndex = 0;
  }
  return hits;
}

describe('frontend/css stays iOS 9.3 WebKit safe', function () {
  test('no flexbox gap (iOS 14.1) — use adjacent-sibling or uniform margins', function () {
    expect(findLines(/(^|[;{\s])(row-|column-)?gap\s*:/)).toEqual([]);
  });

  test('no CSS Grid (iOS 10.3) — use flexbox with calc() widths', function () {
    expect(findLines(/display\s*:\s*(-ms-)?grid|grid-template|grid-auto-|grid-area\s*:/)).toEqual([]);
  });

  test('no clamp()/min()/max() (iOS 11.3-13.4) — use fixed values per breakpoint', function () {
    expect(findLines(/[^-\w](clamp|min|max)\s*\(/)).toEqual([]);
  });

  test('no var() inside calc() (buggy in Safari 9.1-11) — use a literal rem', function () {
    expect(findLines(/calc\([^)]*var\(/)).toEqual([]);
  });

  test('env(safe-area-inset-*) always declares a fallback (iOS 11.2)', function () {
    /* env() with no second argument resolves to nothing before iOS 11.2,
       which drops the whole declaration. */
    expect(findLines(/env\(\s*safe-area-inset-[a-z]+\s*\)/)).toEqual([]);
  });
});

describe('the Home widget grid keeps its width/margin coupling', function () {
  /* The grid cannot use var() inside calc(), so the gutter appears twice:
     as a literal inside each width, and as the card's own margin. If the
     two drift apart, rows wrap one card early as soon as the text-size
     lever scales the margin — a bug that only shows at fs-large. */
  test('every .w-card width subtracts exactly 2x the card margin', function () {
    var marginMatch = CSS.match(/\.w-card\s*\{[^}]*?margin:\s*([\d.]+)rem/);
    expect(marginMatch).not.toBeNull();

    var margin = parseFloat(marginMatch[1]);
    var widths = CSS.match(/\.w-card[^{]*\{[^}]*?width:\s*calc\([^)]*\)/g) || [];
    expect(widths.length).toBeGreaterThan(0);

    for (var i = 0; i < widths.length; i++) {
      var gutter = widths[i].match(/-\s*([\d.]+)rem\s*\)/);
      expect(gutter).not.toBeNull();
      expect(parseFloat(gutter[1])).toBeCloseTo(margin * 2, 5);
    }
  });

  /* .device-card is the only one of these whose margin is a token rather
     than a literal, so the coupling has to be checked against the resolved
     value. Both scales are covered by the same rule: the page-level widths
     on the Smart Home tab, and the narrower `.w-body .device-card` set used
     inside a Home widget. This grid was resized from 4/5/6/8 columns to
     2/3/4/5 with nothing asserting the relationship at the time. */
  test('every .device-card width subtracts exactly 2x the card margin', function () {
    var marginMatch = CSS.match(/\.device-card\s*\{[^}]*?margin:\s*var\(--([\w-]+)\)/);
    expect(marginMatch).not.toBeNull();

    var margin = tokenRem(marginMatch[1]);
    var widths = CSS.match(/\.device-card[^{]*\{[^}]*?width:\s*calc\([^)]*\)/g) || [];
    expect(widths.length).toBeGreaterThan(0);

    for (var i = 0; i < widths.length; i++) {
      var gutter = widths[i].match(/-\s*([\d.]+)rem\s*\)/);
      expect(gutter).not.toBeNull();
      expect(parseFloat(gutter[1])).toBeCloseTo(margin * 2, 5);
    }
  });

  test('.jelly-card width subtracts exactly 2x the card margin', function () {
    var marginMatch = CSS.match(/\.jelly-card\s*\{[^}]*?margin:\s*([\d.]+)rem/);
    expect(marginMatch).not.toBeNull();

    var margin = parseFloat(marginMatch[1]);
    var widths = CSS.match(/\.jelly-card[^{]*\{[^}]*?width:\s*calc\([^)]*\)/g) || [];
    expect(widths.length).toBeGreaterThan(0);

    for (var i = 0; i < widths.length; i++) {
      var gutter = widths[i].match(/-\s*([\d.]+)rem\s*\)/);
      expect(gutter).not.toBeNull();
      expect(parseFloat(gutter[1])).toBeCloseTo(margin * 2, 5);
    }
  });
});

describe('single-margin wrapping rows keep their half-margin width coupling', function () {
  /* .wx-day and .mk-info-item only put margin-right on the non-last column
     in a row (nth-child resets it on the last), so — unlike .w-card, where
     every card carries the full margin — the width must subtract half of
     it, not the whole thing. .wx-day fell out of sync with this exact
     relationship before (0.25rem subtracted instead of 0.125rem). */
  test('.wx-day two-column width is half of --space-2xs less than 50%', function () {
    var margin = tokenRem('space-2xs');
    var widths = CSS.match(/\.wx-day\s*\{[^}]*?width:\s*calc\([^)]*\)/g) || [];
    expect(widths.length).toBeGreaterThan(0);

    var gutter = widths[0].match(/-\s*([\d.]+)rem\s*\)/);
    expect(gutter).not.toBeNull();
    expect(parseFloat(gutter[1])).toBeCloseTo(margin / 2, 5);
  });

  test('.mk-info-item two-up width is half of --space-lg less than 50%', function () {
    var margin = tokenRem('space-lg');
    var widths = CSS.match(/\.mk-info-item\s*\{[^}]*?width:\s*calc\(50%[^)]*\)/g) || [];
    expect(widths.length).toBeGreaterThan(0);

    var gutter = widths[0].match(/-\s*([\d.]+)rem\s*\)/);
    expect(gutter).not.toBeNull();
    expect(parseFloat(gutter[1])).toBeCloseTo(margin / 2, 5);
  });
});
