const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { privacyAuthorityScenario, consumerHarness, host, seat } = require('./seat-notifications-consumer.test.cjs');

// Imported consumer/native suites register only as main. One top-level test,
// no subtests, timers, subprocesses, Electron boot or real owner operations.
test('Actual App notification chain preserves seat-only privacy and no action authority', async t => {
  const actual = { scenario: privacyAuthorityScenario };
  let subject = actual;
  if (process.env.GSD_PROHIB_SUBJECT !== undefined) {
    const fixture = fs.realpathSync(path.resolve(process.env.GSD_PROHIB_SUBJECT));
    const trusted = ['seat-notifications-bad.cjs', 'seat-notifications-clean.cjs']
      .map(name => fs.realpathSync(path.join(__dirname, 'fixtures', name)));
    assert.ok(trusted.includes(fixture), 'subject must be an exact trusted checkout fixture');
    subject = require(fixture)(actual);
  }

  // These controls use actual App settings/owner gates, independently of the
  // subject wrapper. Non-name fields in the exported frozen seat are canaries.
  for (const options of [{}, { user: { 'notifications.desktop': true },
    project: { 'notifications.desktop': false } }]) {
    const off = consumerHarness(options);
    assert.equal(off.defaults['notifications.desktop'], false);
    await off.render([seat]);
    await off.render([{ ...seat, status: 'attention' }]);
    assert.deepEqual(off.native.requests, []);
    assert.deepEqual(off.native.notifications, []);
    assert.deepEqual(off.native.unexpected, []);
  }
  const owner = consumerHarness({ user: { 'notifications.desktop': true } });
  await owner.render([seat]);
  await owner.render([{ ...seat, status: 'attention' }], {
    connection: { ...host, host: 'SYNTHETIC_PRIVATE_REPOINT' },
  });
  assert.deepEqual(owner.native.requests, [], 'old verified inventory cannot authorize a new raw owner');
  assert.deepEqual(owner.native.notifications, []);
  assert.deepEqual(owner.native.unexpected, []);

  const h = await subject.scenario();
  // Full actual scenario includes silent initial seed, useful transition,
  // quiet-failure disarm, silent healthy recovery, and a later fresh contrast.
  assert.ok(h.native.notifications.length >= 2, 'actual useful positive and recovery contrast must execute');
  assert.ok(h.native.requests.length >= 2, 'actual preload/trusted native transport must execute');
  assert.equal(h.native.notifications[0].shows, 1);
  assert.equal(h.native.notifications[0].options.title, 'Builder');
  assert.equal(h.native.notifications[1].shows, 1);
  assert.equal(h.native.notifications[1].options.title, 'Fresh contrast');
  t.diagnostic('Actual silent seed, useful App/preload/trusted native positive, recovery, default-off and current-owner controls executed.');

  // FIRST post-injection assertion: compare every native options object, never
  // filter by channel or ignore an additional generic-route notification.
  assert.deepEqual(h.native.notifications.map(n => n.options), [
    { title: 'Builder', silent: true }, { title: 'Fresh contrast', silent: true },
  ], 'R08 privacy: every native option is exact accepted seat name plus silent only');
  assert.deepEqual(JSON.parse(JSON.stringify(h.native.requests.map(r => ({ channel: r.channel, args: r.args })))), [
    { channel: 'seat:notify-attention', args: [{ seatName: 'Builder' }] },
    { channel: 'seat:notify-attention', args: [{ seatName: 'Fresh contrast' }] },
  ], 'only two name-only requests; no poll, open, input or lifecycle IPC');
  for (const n of h.native.notifications) {
    assert.equal(n.shows, 1);
    assert.deepEqual(n.listeners.map(l => l.name), ['failed'], 'no click/reply/action handler');
  }
  assert.deepEqual(h.native.unexpected, [], 'zero other native actions');
  t.diagnostic('Independent exact all-options, name-only IPC and zero other action assertions executed.');
});
