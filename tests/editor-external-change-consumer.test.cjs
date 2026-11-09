const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mountEditorPanel } = require('./helpers/editor-panel-harness.cjs');

const initial = { content: 'const original = "disk";\n', revision: 'synthetic-r1' };
const observed = { content: 'external observation 分支\n', revision: 'synthetic-r2' };
const fresh = { content: 'fresh disk after confirmation é\n', revision: 'synthetic-r3' };
const local = 'unsaved local e\u0301 <&>\n';
const ackCopy = 'Keeping your text. Save remains blocked while the disk version conflicts. Compare or reload to review the disk changes.';
const conflict = 'CONFLICT: File changed on disk. Reload or compare before saving.';

function exactBuffer(v, expected) {
  assert.equal(v.buffer().content, expected.content);
  assert.equal(v.buffer().saved, expected.saved);
  assert.equal(v.buffer().revision, expected.revision);
}
function request(v, index, op) {
  const actual = v.requests[index];
  assert.ok(actual, `Expected ${op} request ${index}`);
  assert.equal(actual.request.op, op);
  assert.equal(actual.owner, v.props.config.connection);
  assert.equal(actual.request.root, v.props.config.root);
  assert.equal(actual.request.path, v.props.config.path);
  return actual.request;
}

// These assertions precede the feature assertion even in the named RED target.
// A fixture/import failure or failed control is not acceptable semantic RED.
async function currentReadCompareReloadControls(v) {
  assert.ok(v.nodes().some(n => n.type === 'loading'));
  request(v, 0, 'read');
  await v.resolve(0, initial);
  assert.equal(v.editor().props.value, initial.content);
  exactBuffer(v, { content: initial.content, saved: initial.content, revision: initial.revision });
  assert.ok(v.registry.bufferConfigs.get(v.props.id));
  assert.equal([...v.intervals.values()][0].delay, 2500);
  v.type(local);
  assert.equal(v.dirtyCalls.at(-1)[1], true);
  const draftKey = v.drafts.draftKey('editor', v.props.config.connection, v.props.config.root, v.props.config.path);
  assert.equal(v.draftStore[draftKey].data.content, local);
  const before = JSON.stringify(v.buffer());
  const recovery = v.draftBytes();
  v.focusWindow(); request(v, 1, 'read');
  await v.resolve(1, observed);
  assert.equal(JSON.stringify(v.buffer()), before);
  assert.equal(v.draftBytes(), recovery);
  assert.equal(v.editor().props.value, local);
  const reads = v.requests.length;
  v.click('Compare with disk');
  assert.equal(v.comparison().props.original, observed.content);
  assert.equal(v.comparison().props.modified, local);
  assert.equal(v.comparison().props.options.readOnly, true);
  assert.equal(v.requests.length, reads, 'Compare uses the observed snapshot without fetching');
  v.click('Back to editor');
  v.click('Reload from disk');
  assert.ok(v.nodes().some(n => n.props.role === 'dialog' && n.props['aria-label'] === 'Discard local edits and reload?'));
  v.click('Keep editing');
  assert.equal(v.requests.length, reads, 'Cancel does not read or write');
  assert.equal(JSON.stringify(v.buffer()), before);
  assert.equal(v.draftBytes(), recovery);
  v.click('Reload from disk'); v.click('Discard edits and reload');
  request(v, 2, 'read');
  assert.equal(v.editor().props.value, local, 'Pending fresh read retains local text');
  await v.resolve(2, fresh);
  exactBuffer(v, { content: fresh.content, saved: fresh.content, revision: fresh.revision });
  assert.equal(v.editor().props.value, fresh.content, 'Accepted reload uses fresh result, not observed snapshot');
  assert.equal(v.dirtyCalls.at(-1)[1], false);
  assert.equal(v.draftBytes(), '{}', 'Accepted clean reload deletes recovery through actual persistBuffer');
  assert.ok(!v.button('Compare with disk'));
  assert.equal(v.requests.filter(r => r.request.op === 'save').length, 0);
}

test('current EditorPanel read Compare cancel and accepted fresh reload controls', async t => {
  const v = mountEditorPanel(); t.after(() => v.unmount());
  await currentReadCompareReloadControls(v);
});

test('Keep mine preserves original baseline and allows protected review then fresh reload', async t => {
  const v = mountEditorPanel(); t.after(() => v.unmount());
  await currentReadCompareReloadControls(v);
  v.type(local);
  v.focusWindow(); request(v, 3, 'read');
  const changed = { content: 'another external change\n', revision: 'synthetic-r4' };
  await v.resolve(3, changed);
  const buffer = v.buffer(), before = JSON.stringify(buffer), draftBytes = v.draftBytes();
  const dirtyCalls = JSON.stringify(v.dirtyCalls), draftCalls = JSON.stringify(v.draftCalls);
  const requests = v.requests.length;
  // Intended baseline RED: actual current banner has no reachable Keep mine.
  // No proposed helper is imported; every control above must execute first.
  assert.ok(v.button('Keep mine'), 'Detected external change must expose a reachable Keep mine button');
  v.click('Keep mine');
  assert.equal(v.buffer(), buffer, 'Acknowledgement retains actual registry instance');
  assert.equal(JSON.stringify(v.buffer()), before, 'Acknowledgement preserves every buffer field');
  assert.equal(v.draftBytes(), draftBytes, 'Acknowledgement preserves recovery bytes');
  assert.equal(JSON.stringify(v.draftCalls), draftCalls, 'Acknowledgement does not persist/delete recovery');
  assert.equal(JSON.stringify(v.dirtyCalls), dirtyCalls, 'Acknowledgement does not change dirty state');
  assert.equal(v.requests.length, requests, 'Acknowledgement performs no read or save');
  assert.equal(v.savedCalls.length, 0);
  assert.ok(v.visibleText().includes(ackCopy));
  assert.ok(!v.button('Keep mine'), 'Represented acknowledged revision hides the action');
  v.click('Compare with disk');
  assert.equal(v.comparison().props.original, changed.content);
  assert.equal(v.comparison().props.modified, local);
  v.click('Back to editor');
  v.click('Save changes');
  const save = request(v, 4, 'save');
  assert.equal(save.content, local);
  assert.equal(save.revision, fresh.revision, 'Ordinary Save retains original baseline after acknowledgement');
  await v.reject(4, Error(conflict));
  assert.equal(JSON.stringify(v.buffer()), before);
  assert.equal(v.draftBytes(), draftBytes);
  assert.equal(v.dirtyCalls.at(-1)[1], true);
  assert.equal(v.savedCalls.length, 0);
  assert.ok(v.visibleText().includes('File changed on disk.'));
  assert.ok(v.button('Compare with disk')); assert.ok(v.button('Reload from disk'));
  v.click('Reload from disk'); v.click('Discard edits and reload');
  request(v, 5, 'read');
  const latest = { content: 'latest current disk\n', revision: 'synthetic-r5' };
  await v.resolve(5, latest);
  exactBuffer(v, { content: latest.content, saved: latest.content, revision: latest.revision });
  assert.equal(v.editor().props.value, latest.content);
  assert.equal(v.draftBytes(), '{}');
  assert.equal(v.dirtyCalls.at(-1)[1], false);
  assert.equal(v.requests.filter(r => r.request.op === 'save').length, 1, 'Only explicit ordinary Save was attempted');
});
