// sanctuary.html contract tests for Sanctuary's End.
//
// The whole game hangs off a few load-bearing lines in sanctuary.html: the Three.js import map (pinned to
// one version, with SRI hashes) and the ES-module shim that copies THREE/TSL onto window before the classic
// game script parses. CI type-checks game.js and runs node tests, but NOTHING parses sanctuary.html — so a
// broken import map (version drift, an SRI key that doesn't match an import, a dropped shim) would sail
// through green CI and produce a 100%-blank game in the browser (esp. Chromium, which enforces the hashes).
// These are cheap offline structural assertions that catch exactly those regressions.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'sanctuary.html'), 'utf8');

function importMap() {
  const m = HTML.match(/<script[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/i);
  assert.ok(m, 'no <script type="importmap"> block found in sanctuary.html');
  let json;
  assert.doesNotThrow(() => {
    json = JSON.parse(m[1]);
  }, 'import map is not valid JSON');
  return json;
}

test('import map parses and defines the three specifiers game.js needs', () => {
  const map = importMap();
  assert.ok(map.imports, 'import map has no "imports"');
  for (const spec of ['three', 'three/webgpu', 'three/tsl', 'three/addons/']) {
    assert.ok(map.imports[spec], `import map missing specifier: ${spec}`);
  }
});

test('all import-map URLs are repo-relative, share one vendored version dir, and exist on disk', () => {
  // v50 self-hosts three.js: a CDN URL sneaking back in (or a vendored file going missing) must fail CI.
  // This is a STRONGER contract than the old version-pin check — same-origin + on-disk + single version.
  const map = importMap();
  const versions = new Set();
  for (const [spec, url] of Object.entries(map.imports)) {
    assert.ok(!/^(https?:)?\/\//i.test(url), `import "${spec}" points at a remote URL: ${url}`);
    const v = url.match(/vendor\/three-(\d+\.\d+\.\d+)\//);
    assert.ok(v, `import "${spec}" is not under a vendor/three-x.y.z/ dir: ${url}`);
    versions.add(v[1]);
    const target = path.join(__dirname, '..', url);
    if (url.endsWith('/')) assert.ok(fs.statSync(target).isDirectory(), `prefix dir missing on disk: ${url}`);
    else assert.ok(fs.statSync(target).isFile(), `vendored file missing on disk: ${url}`);
  }
  assert.equal(versions.size, 1, `all imports must share one vendored version, saw: ${[...versions].join(', ')}`);
});

test('the vendored addon closure is complete (every relative import resolves on disk)', () => {
  // KTX2Loader & friends pull transitive relative imports (libs/, math/, utils/). A partial vendor copy
  // loads fine in CI and 404s in the browser — walk the real import graph from the shim's entry points.
  const map = importMap();
  const root = path.join(__dirname, '..');
  const shim = HTML.match(/<script type="module">([\s\S]*?)<\/script>/i);
  assert.ok(shim, 'module shim not found');
  const entries = [];
  const specRe = /from\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = specRe.exec(shim[1]))) entries.push(m[1]);
  assert.ok(entries.length >= 7, 'shim should import the core builds + addons');
  const resolveSpec = (spec) => {
    if (map.imports[spec]) return map.imports[spec];
    for (const [pre, target] of Object.entries(map.imports)) {
      if (pre.endsWith('/') && spec.startsWith(pre)) return target + spec.slice(pre.length);
    }
    return null;
  };
  const queue = entries.map(resolveSpec).filter(Boolean);
  const seen = new Set();
  const impRe = /(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);
    const abs = path.join(root, rel);
    assert.ok(fs.existsSync(abs), `vendored module missing: ${rel}`);
    const src = fs.readFileSync(abs, 'utf8');
    let im;
    while ((im = impRe.exec(src))) {
      const spec = im[1] || im[2];
      if (!spec) continue;
      if (spec.startsWith('.')) queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec)));
      else if (resolveSpec(spec)) queue.push(resolveSpec(spec));
    }
  }
  assert.ok(seen.size >= 10, `closure suspiciously small (${seen.size} files)`);
});

test('fonts are self-hosted: no remote <link> and the vendored Cinzel files exist on disk', () => {
  // v50 self-hosts the Cinzel display font too — the page must have no remote stylesheet/preconnect at all,
  // or a network-blocked player silently falls back to Georgia. Assert every <link href> is repo-relative and
  // that the vendored CSS + its woff2 files are present (so a dropped file fails CI, not the browser).
  const linkRe = /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi;
  const root = path.join(__dirname, '..');
  let m;
  let sawFontCss = false;
  while ((m = linkRe.exec(HTML))) {
    const href = m[1];
    assert.ok(!/^(https?:)?\/\//i.test(href), `<link> points at a remote URL: ${href}`);
    if (/cinzel\.css$/.test(href)) {
      sawFontCss = true;
      assert.ok(fs.statSync(path.join(root, href)).isFile(), `vendored font CSS missing on disk: ${href}`);
    }
  }
  assert.ok(sawFontCss, 'sanctuary.html should link the vendored vendor/fonts/cinzel/cinzel.css');
  const cssDir = path.join(root, 'vendor', 'fonts', 'cinzel');
  const css = fs.readFileSync(path.join(cssDir, 'cinzel.css'), 'utf8');
  const srcRe = /url\(([^)]+)\)/g;
  let s;
  while ((s = srcRe.exec(css))) {
    const rel = s[1].replace(/['"]/g, '').trim();
    assert.ok(!/^(https?:)?\/\//i.test(rel), `@font-face src is remote: ${rel}`);
    assert.ok(fs.statSync(path.join(cssDir, rel)).isFile(), `vendored woff2 missing on disk: ${rel}`);
  }
});

test('the window.THREE / window.TSL shim and the classic game script are both present', () => {
  // game.js is a classic script that reads THREE/TSL as bare globals, so the module shim must assign them.
  assert.match(HTML, /window\.THREE\s*=/, 'missing window.THREE assignment (module shim)');
  assert.match(HTML, /window\.TSL\s*=/, 'missing window.TSL assignment (module shim)');
  // the game itself must load as at least one deferred .js script so it runs after the shim (matches both the
  // single game.js today and the split js/*.js files later).
  assert.match(HTML, /<script[^>]*\bdefer\b[^>]*src=["'][^"']+\.js["']/i, 'missing deferred game script tag');
});
