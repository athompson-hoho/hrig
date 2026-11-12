const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mountEditorPanel } = require('./helpers/editor-panel-harness.cjs');

test('Actual EditorPanel preserves acknowledgement and obsolete-completion authority', async t => {
  const actual = {
    mount: () => mountEditorPanel(),
    acknowledge(view) { view.click('Keep mine'); },
  };
  let subject = actual;
  if (process.env.GSD_PROHIB_SUBJECT) {
    const fixture = fs.realpathSync(path.resolve(process.env.GSD_PROHIB_SUBJECT));
    const trusted = ['editor-external-change-bad.cjs', 'editor-external-change-clean.cjs']
      .map(name => fs.realpathSync(path.join(__dirname, 'fixtures', name)));
    assert.ok(trusted.includes(fixture), 'subject must be an exact trusted checkout fixture');
    subject = require(fixture)(actual);
  }
  const v = subject.mount();
  t.after(() => v.unmount());
  const initial = { content: 'original disk\n', revision: 'synthetic-original-r1' };
  const observed = { content: 'observed external 分支\n', revision: 'synthetic-observed-r2' };
  const fresh = { content: 'accepted fresh disk é\n', revision: 'synthetic-fresh-r3' };
  const local = 'unsaved local e\u0301 <&>\n';
  const request = (index, op) => {
    const entry = v.requests[index];
    assert.ok(entry, `request ${index} exists`);
    assert.equal(entry.owner, v.props.config.connection);
    assert.equal(entry.request.op, op);
    assert.equal(entry.request.root, v.props.config.root);
    assert.equal(entry.request.path, v.props.config.path);
    return entry.request;
  };
  const snapshot = () => ({ buffer: JSON.stringify(v.buffer()), drafts: v.draftBytes(),
    draftCalls: JSON.stringify(v.draftCalls), dirty: JSON.stringify(v.dirtyCalls),
    saved: JSON.stringify(v.savedCalls) });
  const unchanged = before => assert.deepEqual(snapshot(), before, 'obsolete completion preserves buffer, drafts and callbacks');
  const startReload = () => {
    v.click('Reload from disk');
    v.click('Discard edits and reload');
    const index = v.requests.length - 1;
    request(index, 'read');
    assert.ok(v.button('Reloading…').props.disabled);
    assert.ok(v.button('Save changes').props.disabled);
    return index;
  };
  request(0, 'read');
  await v.resolve(0, initial);
  assert.equal(v.editor().props.value, initial.content, 'actual current opening positive');
  assert.equal(v.registry.buffers.get(v.props.id), v.buffer());
  v.type(local);
  const buffer = v.buffer(), beforeDetection = snapshot();
  v.focusWindow(); request(1, 'read');
  await v.resolve(1, observed);
  unchanged(beforeDetection);
  assert.equal(v.editor().props.value, local);
  assert.ok(v.button('Keep mine'), 'actual current detection positive');
  v.click('Compare with disk');
  assert.equal(v.comparison().props.original, observed.content);
  assert.equal(v.comparison().props.modified, local);
  assert.equal(v.comparison().props.options.readOnly, true);
  v.click('Back to editor');
  v.click('Reload from disk'); v.click('Keep editing');
  unchanged(beforeDetection);
  assert.equal(v.requests.length, 2, 'Compare and canceled confirmation have no API authority');
  t.diagnostic('Actual EditorPanel opening, detection, snapshot Compare and cancel controls executed.');

  subject.acknowledge(v);
  // First post-ack assertion deliberately names the exact prohibited mutation.
  assert.equal(v.buffer().revision, initial.revision,
    'authority: Keep mine must preserve original revision without baseline rebase');
  assert.equal(v.buffer(), buffer, 'acknowledgement retains actual registry instance');
  unchanged(beforeDetection);
  assert.equal(v.editor().props.value, local);
  assert.equal(v.requests.length, 2, 'acknowledgement performs no read or write');
  assert.ok(v.visibleText().includes('Keeping your text. Saving still checks for conflicts. Compare or reload to review the disk changes.'));
  assert.ok(!v.button('Keep mine'));
  assert.ok(v.button('Compare with disk')); assert.ok(v.button('Reload from disk'));
  v.click('Save changes');
  const save = request(2, 'save');
  assert.equal(save.content, local);
  assert.equal(save.revision, initial.revision, 'ordinary Save keeps protected original revision');
  await v.reject(2, Error('CONFLICT: synthetic disk changed'));
  unchanged(beforeDetection);
  assert.ok(v.visibleText().includes('Your edits are preserved.'));

  // An edit after confirmation invalidates replacement, including its drafts.
  const typedReload = startReload();
  v.type('newer local typing\n');
  const typed = snapshot();
  await v.resolve(typedReload, { content: 'obsolete read', revision: 'obsolete-typed' });
  unchanged(typed);
  assert.equal(v.editor().props.value, 'newer local typing\n');
  assert.ok(v.visibleText().includes('Reload canceled because you edited'));

  // Cancel a pending read, start its successor, then complete old success AND
  // old error while a newer request is busy. All steps use the actual consumer.
  const canceledSuccess = startReload(); v.click('Keep editing');
  const canceledError = startReload(); v.click('Keep editing');
  const accepted = startReload(), pending = snapshot();
  await v.resolve(canceledSuccess, { content: 'canceled disk', revision: 'canceled-success' });
  unchanged(pending);
  assert.ok(v.button('Reloading…').props.disabled, 'obsolete success/finally cannot enable successor');
  await v.reject(canceledError, Error('obsolete canceled error'));
  unchanged(pending);
  assert.ok(v.button('Reloading…').props.disabled, 'obsolete error/finally cannot enable successor');
  assert.ok(!v.visibleText().includes('obsolete canceled error'));
  await v.resolve(accepted, fresh);
  assert.equal(v.buffer(), buffer);
  assert.deepEqual(JSON.parse(JSON.stringify(v.buffer())),
    { content: fresh.content, saved: fresh.content, revision: fresh.revision });
  assert.equal(v.editor().props.value, fresh.content, 'explicit accepted reload publishes fresh disk, not snapshot');
  assert.equal(v.draftBytes(), '{}', 'accepted reload clears recovery through actual persistence');
  assert.equal(v.dirtyCalls.at(-1)[1], false);
  assert.equal(v.savedCalls.length, 0, 'reload never claims a disk Save');
  assert.equal(v.requests.filter(entry => entry.request.op === 'save').length, 1,
    'only the explicit protected ordinary Save attempted a write');
  assert.ok(!v.button('Compare with disk'));
  t.diagnostic('Actual acknowledgement, protected Save, typing cancellation, obsolete success/error/finally and accepted fresh reload assertions executed.');
});
