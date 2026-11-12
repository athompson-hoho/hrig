const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const { buildSync } = require('esbuild');
const load = (f, ext = []) => { const m = new Module('x', module); m.paths = module.paths; m._compile(buildSync({ entryPoints: [f], bundle: true, platform: 'node', format: 'cjs', write: false, external: ext, jsx: 'automatic', loader: { '.tsx': 'tsx' } }).outputFiles[0].text, 'x.js'); return m.exports; };
const { describePanelError } = load('src/panel-error.ts');

test('describePanelError is plain, bounded and tolerant', () => {
  assert.equal(describePanelError(new TypeError('x is undefined')), 'TypeError: x is undefined');
  assert.equal(describePanelError('boom\n\tline'), 'boom line');
  assert.equal(describePanelError(undefined), 'Unknown error');
  assert.equal(describePanelError({ weird: 1 }), 'Unknown error');
  assert.equal(describePanelError(new Error('a\u001b[31m‮b')), 'Error: a [31m b'.replace(' [31m b', ' [31m b'));
  const long = describePanelError(new Error('x'.repeat(5000)));
  assert.ok(long.length <= 600 && long.endsWith('…'));
  const hostile = { get message() { throw new Error('no'); } };
  assert.doesNotThrow(() => describePanelError(Object.setPrototypeOf(hostile, Error.prototype)));
});

test('a real render error is contained by the boundary and Try again is explicit', () => {
  const React = require('react');
  const { renderToString } = require('react-dom/server');
  const { default: PanelBoundary } = load('src/PanelBoundary.tsx', ['react', 'react-dom']);
  // getDerivedStateFromError is what React calls for the failing subtree.
  const s = PanelBoundary.getDerivedStateFromError(new Error('crash'));
  assert.equal(s.failure.text, 'Error: crash');
  const b = new PanelBoundary({ children: 'child', label: 'Editor' });
  b.state = { failure: null, attempt: 0 };
  assert.equal(b.render(), 'child');
  b.state = { failure: s.failure, attempt: 0 };
  const out = renderToString(b.render());
  assert.match(out, /Editor hit an error/); assert.match(out, /role="alert"/); assert.match(out, /Error: crash/);
  assert.match(out, /Try again/); assert.match(out, /Copy details/);
  assert.doesNotThrow(() => b.componentDidCatch(new Error('x')));
});

test('every layout panel is wrapped; retry is never automatic', () => {
  const app = fs.readFileSync('src/App.tsx', 'utf8');
  assert.match(app, /<PanelBoundary label=\{node\.getName\?\.\(\)\}>\{factory\(node\)\}<\/PanelBoundary>/);
  const src = fs.readFileSync('src/PanelBoundary.tsx', 'utf8');
  assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\//g, ''), /setTimeout|setInterval|requestAnimationFrame/);
});
