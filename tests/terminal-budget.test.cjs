const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const { buildSync } = require('esbuild');
const load = f => { const m = new Module('x', module); m._compile(buildSync({ entryPoints: [f], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text, 'x.js'); return m.exports; };
const b = load('src/terminal-budget.ts');

test('share of the budget, never above the user setting, never below 1,000', () => {
  assert.equal(b.effectiveScrollback(10000, 1, 200000), 10000);
  assert.equal(b.effectiveScrollback(10000, 20, 200000), 10000);
  assert.equal(b.effectiveScrollback(10000, 40, 200000), 5000);
  assert.equal(b.effectiveScrollback(10000, 500, 200000), 1000);
  assert.equal(b.effectiveScrollback(50000, 4, 100000), 25000);
  assert.equal(b.effectiveScrollback(500, 1000, 200000), 500, 'a setting below the floor is respected');
  assert.equal(b.effectiveScrollback(10000, 0, 200000), 10000);
});
test('budget 0 / invalid means no limit; bad setting falls back to the floor', () => {
  for (const bad of [0, -5, NaN, Infinity]) assert.equal(b.effectiveScrollback(10000, 999, bad), 10000, String(bad));
  assert.equal(b.effectiveScrollback(NaN, 5, 100), 1000);
});
test('registry counts live terminals, notifies, and tolerates throwing listeners', () => {
  let calls = 0; const off = b.subscribeTerminals(() => { calls++; });
  const bad = b.subscribeTerminals(() => { throw new Error('x'); });
  const base = b.openTerminalCount();
  const u1 = b.registerTerminal('a'); const u2 = b.registerTerminal('b');
  assert.equal(b.openTerminalCount(), base + 2);
  u1(); u1(); assert.equal(b.openTerminalCount(), base + 1);
  u2(); assert.equal(b.openTerminalCount(), base); assert.equal(calls, 4);
  off(); bad(); b.registerTerminal('c')(); assert.equal(calls, 4);
});
test('setting, docs and panel wiring', () => {
  const s = load('src/settings.ts');
  assert.equal(s.resolveSettings()['terminal.scrollbackBudget'], 200000);
  assert.ok(s.schema.some(r => r.key === 'terminal.scrollbackBudget'));
  assert.throws(() => s.validateOverrides({ 'terminal.scrollbackBudget': -1 }));
  assert.throws(() => s.validateOverrides({ 'terminal.scrollbackBudget': 3000000 }));
  assert.doesNotThrow(() => s.validateOverrides({ 'terminal.scrollbackBudget': 0 }));
  const t = fs.readFileSync('src/TerminalPanel.tsx', 'utf8');
  assert.match(t, /term\.options\.scrollback = scrollbackLines/);
  assert.match(t, /scrollback=\{scrollbackLines\}/);
  assert.match(t, /registerTerminal\(id\)/);
  assert.match(fs.readFileSync('SETTINGS.md', 'utf8'), /`terminal\.scrollbackBudget` \| `200000`/);
});
