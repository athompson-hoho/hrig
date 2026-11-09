const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createInventoryCache, cleanInventory, MAX_AGE_MS, MIN_WRITE_MS } = require('../electron/inventory-cache.cjs');

const seat = (n, extra = {}) => ({ id: 'r:' + n, rigId: 'r', rigName: 'Rig', name: n, pod: 'p', runtime: 'codex', model: 'm',
  session: n + '@Rig', status: 'idle', activity: '', error: 'SECRET stack trace', workCount: 1, assignedWork: 1, pendingWork: 0,
  lastActivityAt: '2026-01-01T00:00:00.000Z', ...extra });
const inv = (sampledAt, seats = [seat('a')]) => ({ rigs: [{ id: 'r', name: 'Rig', status: 'running', nodeCount: seats.length }], seats, sampledAt });
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hrig-inv-'));
  let clock = Date.parse('2026-01-02T00:00:00.000Z');
  const file = path.join(dir, 'sub', 'inventory-cache.json');
  const api = createInventoryCache({ file, fs, now: () => clock });
  return { api, file, dir, tick: ms => { clock += ms; }, clean: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('save then load round-trips a validated snapshot and drops error text', () => {
  const f = fixture();
  try {
    assert.deepEqual(f.api.operation({ op: 'load' }).entries, []);
    assert.equal(f.api.operation({ op: 'save', key: 'k1', inventory: inv('2026-01-01T23:59:00.000Z') }).written, true);
    const { entries } = f.api.operation({ op: 'load' });
    assert.equal(entries.length, 1); assert.equal(entries[0].key, 'k1');
    const s = entries[0].inventory.seats[0];
    assert.equal(s.error, ''); assert.equal(s.session, 'a@Rig'); assert.equal(s.assignedWork, 1);
    assert.equal(entries[0].inventory.sampledAt, '2026-01-01T23:59:00.000Z', 'keeps the ORIGINAL sample time so age stays honest');
    assert.ok(!fs.readFileSync(f.file, 'utf8').includes('SECRET'));
  } finally { f.clean(); }
});

test('writes are throttled per key; clear removes the file', () => {
  const f = fixture();
  try {
    f.api.operation({ op: 'save', key: 'k', inventory: inv('2026-01-01T23:59:00.000Z') });
    assert.equal(f.api.operation({ op: 'save', key: 'k', inventory: inv('2026-01-01T23:59:30.000Z') }).written, false);
    f.tick(MIN_WRITE_MS + 1);
    assert.equal(f.api.operation({ op: 'save', key: 'k', inventory: inv('2026-01-02T00:00:20.000Z') }).written, true);
    assert.ok(fs.existsSync(f.file));
    f.api.operation({ op: 'clear' });
    assert.ok(!fs.existsSync(f.file)); assert.deepEqual(f.api.operation({ op: 'load' }).entries, []);
  } finally { f.clean(); }
});

test('load rejects corrupt, old, malformed and oversized data instead of trusting it', () => {
  const f = fixture();
  try {
    fs.mkdirSync(path.dirname(f.file), { recursive: true });
    fs.writeFileSync(f.file, '{not json');
    assert.deepEqual(f.api.load(), []);
    const old = inv(new Date(Date.parse('2026-01-02T00:00:00.000Z') - MAX_AGE_MS - 1000).toISOString());
    const many = inv('2026-01-01T23:00:00.000Z', Array.from({ length: 700 }, (_, i) => seat('s' + i)));
    fs.writeFileSync(f.file, JSON.stringify({ version: 1, entries: {
      old: { inventory: old }, bad: { inventory: { seats: 'x', rigs: [] , sampledAt: 'nope' } }, many: { inventory: many },
      weird: { inventory: inv('2026-01-01T23:00:00.000Z', [null, 5, { id: 'x' }, seat('ok', { status: 7, workCount: -3, lastActivityAt: 'garbage', session: 12 })]) } } }));
    const got = Object.fromEntries(f.api.load().map(e => [e.key, e.inventory]));
    assert.deepEqual(Object.keys(got).sort(), ['many', 'weird']);
    assert.equal(got.many.seats.length, 500);
    assert.equal(got.weird.seats.length, 1);
    assert.deepEqual([got.weird.seats[0].status, got.weird.seats[0].workCount, got.weird.seats[0].lastActivityAt, got.weird.seats[0].session], ['unknown', 0, null, null]);
    fs.writeFileSync(f.file, JSON.stringify({ version: 2, entries: { k: { inventory: inv('2026-01-01T23:00:00.000Z') } } }));
    assert.deepEqual(f.api.load(), []);
  } finally { f.clean(); }
});

test('save refuses invalid keys and snapshots; caps stored connections', () => {
  const f = fixture();
  try {
    assert.throws(() => f.api.operation({ op: 'save', key: '', inventory: inv('2026-01-01T23:00:00.000Z') }), /Invalid cache key/);
    assert.throws(() => f.api.operation({ op: 'save', key: 'k', inventory: { seats: [] } }), /Invalid inventory/);
    assert.throws(() => f.api.operation({ op: 'nope' }), /Unsupported/);
    for (let i = 0; i < 14; i++) f.api.operation({ op: 'save', key: 'k' + i, inventory: inv('2026-01-01T23:00:00.000Z') });
    assert.equal(f.api.load().length, 10);
    assert.equal(cleanInventory(null), null);
  } finally { f.clean(); }
});

test('wiring: opt-in setting, IPC/preload, seeded cache stays unverified, off clears', () => {
  const app = fs.readFileSync('src/App.tsx', 'utf8');
  assert.match(app, /base\.preferences\?\.\["rig\.cacheInventory"\] === true/);
  assert.match(app, /inventoryCache\.current\.set\(entry\.key, entry\.inventory\)/);
  assert.match(app, /if \(cacheInventoryPref\.current\)\s*\n?\s*void window\.hrig\.inventoryCache\(\{ op: "save"/);
  assert.match(app, /op: "clear"/);
  // The seeded snapshot flows through the existing guarded path (unverified + CHECKING_SNAPSHOT).
  assert.match(app, /verified: false,/); assert.match(app, /setInventoryError\(cached \? CHECKING_SNAPSHOT : ""\)/);
  assert.match(fs.readFileSync('electron/main.cjs', 'utf8'), /handle\("inventory:cache"/);
  assert.match(fs.readFileSync('electron/preload.cjs', 'utf8'), /inventoryCache: invoke\("inventory:cache"\)/);
  const settings = fs.readFileSync('src/settings.ts', 'utf8');
  assert.match(settings, /"rig\.cacheInventory": false/);
  assert.match(fs.readFileSync('SETTINGS.md', 'utf8'), /`rig\.cacheInventory` \| `false`/);
});
