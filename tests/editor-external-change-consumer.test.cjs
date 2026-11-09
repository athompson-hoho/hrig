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

// Task 2: actual consumer expansion. No fixture duplicates publication logic.
async function opened(t, options = {}) {
  const v = mountEditorPanel(options); t.after(() => v.unmount());
  await v.resolve(0, initial);
  assert.equal(v.editor().props.value, initial.content, 'Current opening positive control');
  return v;
}
async function detected(t, options = {}) {
  const v = await opened(t, options); v.type(local); v.focusWindow();
  await v.resolve(1, observed);
  assert.ok(v.button('Keep mine'), 'Current detection positive control');
  return v;
}
function preserved(v) {
  return { buffer: v.buffer(), bytes: JSON.stringify(v.buffer()), drafts: v.draftBytes(),
    dirty: JSON.stringify(v.dirtyCalls), saved: JSON.stringify(v.savedCalls),
    draftCalls: JSON.stringify(v.draftCalls) };
}
function unchanged(v, before) {
  assert.equal(v.buffer(), before.buffer);
  assert.equal(JSON.stringify(v.buffer()), before.bytes);
  assert.equal(v.draftBytes(), before.drafts);
  assert.equal(JSON.stringify(v.dirtyCalls), before.dirty);
  assert.equal(JSON.stringify(v.savedCalls), before.saved);
  assert.equal(JSON.stringify(v.draftCalls), before.draftCalls);
}
function startReload(v) {
  v.click('Reload from disk'); v.click('Discard edits and reload');
  assert.ok(v.button('Reloading…').props.disabled);
  assert.ok(v.button('Keep mine').props.disabled);
  assert.ok(v.button('Save changes').props.disabled);
  return v.requests.length - 1;
}
function renderedText(tree) {
  return tree.map(n => typeof n === 'string' ? n : renderedText(n.children || [])).join('');
}
function renderedEditors(tree) {
  return tree.flatMap(n => typeof n === 'string' ? [] :
    [...(['inert-editor', 'inert-diff'].includes(n.type) ? [n] : []), ...renderedEditors(n.children || [])]);
}

test('owner replacement hides old text notices errors and busy state before effect cleanup', async t => {
  const frames = [];
  const v = await detected(t, { onRender: tree => frames.push({
    text: renderedText(tree), values: renderedEditors(tree).map(n => n.props.value ?? n.props.modified),
  }) });
  // Current error and reload positive controls precede the new owner assertion.
  v.click('Save changes'); await v.reject(2, Error(conflict));
  assert.ok(v.visibleText().includes(conflict));
  const old = preserved(v), pending = startReload(v);
  frames.length = 0;
  v.retarget({ id: 'new-panel', config: { ...v.props.config, path: 'new-file.ts' } });
  assert.ok(frames.length > 0);
  assert.ok(!frames[0].values.includes(local), 'New owner must hide prior local text during render, before cleanup');
  assert.ok(!frames[0].text.includes(conflict), 'New owner must hide prior error');
  assert.ok(!frames[0].text.includes('Reloading…'), 'New owner must hide prior busy state');
  const nextRead = v.requests.length - 1;
  await v.resolve(pending, fresh);
  await v.resolve(nextRead, { content: 'new owner text', revision: 'new-r1' });
  assert.equal(v.editor().props.value, 'new owner text');
  assert.equal(JSON.stringify(old.buffer), old.bytes);
  assert.equal(v.draftBytes(), old.drafts);
  assert.equal(v.savedCalls.length, 0);
});

for (const key of ['id', 'kind', 'host', 'port', 'distro', 'rigBinary', 'root', 'panel.root', 'path']) {
  test(`same-id foreign ${key} owner refuses text and preserves original recovery`, async t => {
    const v = await detected(t), before = preserved(v), oldConfig = v.registry.bufferConfigs.get(v.props.id);
    const config = { ...v.props.config, connection: { ...v.props.config.connection } };
    if (key === 'panel.root') config.root = '/other-panel-root';
    else if (key === 'path') config.path = 'other.ts';
    else config.connection[key] = key === 'port' ? 2202 : `other-${key}`;
    const count = v.requests.length;
    v.retarget({ config });
    assert.ok(!v.editor() && !v.comparison(), 'Foreign buffer text must not render as the new file');
    assert.ok(v.visibleText().includes('different file buffer'));
    assert.equal(v.requests.length, count, 'Ambiguous foreign buffer does not read');
    assert.equal(v.registry.bufferConfigs.get(v.props.id), oldConfig);
    unchanged(v, before);
  });
}

test('same-owner buffer replacement refuses retained editor callbacks and saved synchronization', async t => {
  const v = await detected(t), old = v.buffer(), editor = v.editor();
  const replacement = { content: 'replacement local', saved: 'replacement disk', revision: 'replacement-r1' };
  v.registry.buffers.set(v.props.id, replacement);
  const before = preserved(v);
  editor.props.onChange('obsolete widget edit'); v.flush();
  assert.equal(replacement.content, 'replacement local', 'Old widget cannot edit a replacement buffer instance');
  v.dispatch('hrig:buffers-saved');
  unchanged(v, before);
  assert.equal(old.content, local);
  assert.ok(!v.editor(), 'Replaced instance is refused rather than exposed through stale local state');
});

for (const outcome of ['resolve', 'reject']) test(`A-B-A ${outcome} completion cannot publish into returned owner`, async t => {
  const v = await detected(t), a = v.props.config, before = preserved(v), pending = startReload(v);
  v.retarget({ config: { ...a, path: 'B.ts' } });
  v.retarget({ config: a });
  const opening = v.requests.length - 1;
  await v.resolve(opening, initial);
  const current = preserved(v), text = v.visibleText();
  if (outcome === 'resolve') await v.resolve(pending, fresh);
  else await v.reject(pending, Error('obsolete reload error'));
  unchanged(v, current);
  assert.equal(v.visibleText(), text, 'Obsolete catch/finally cannot publish');
  assert.equal(v.editor().props.value, local);
  assert.equal(v.draftBytes(), before.drafts);
  assert.ok(!v.button('Reloading…'), 'Returned owner does not inherit prior busy state');
  v.type('current edit after A-B-A'); v.click('Save changes');
  await v.resolve(v.requests.length - 1, { revision: 'returned-save' });
  assert.equal(v.buffer().saved, 'current edit after A-B-A', 'Current save positive control');
});

for (const operation of ['read', 'reload', 'save']) for (const outcome of ['resolve', 'reject']) {
  test(`unmount ignores ${operation} ${outcome} including callbacks drafts and state setters`, async t => {
    let v, index;
    if (operation === 'read') { v = mountEditorPanel(); index = 0; }
    else {
      v = await detected(t);
      if (operation === 'reload') index = startReload(v);
      else { v.click('Save changes'); index = v.requests.length - 1; }
    }
    const before = preserved(v); v.unmount();
    const updates = v.observations.stateUpdates;
    if (outcome === 'resolve') await v.resolve(index, fresh);
    else await v.reject(index, Error('unmounted synthetic failure'));
    unchanged(v, before);
    assert.equal(v.observations.stateUpdates, updates);
  });
}

for (const typing of ['new text 分支', 'away-and-back']) {
  test(`pending reload preserves ${typing} and allows fresh confirmed retry`, async t => {
    const v = await detected(t), index = startReload(v);
    v.type('new text 分支'); if (typing === 'away-and-back') v.type(local);
    const before = preserved(v);
    await v.resolve(index, fresh);
    unchanged(v, before);
    assert.ok(v.visibleText().includes('Reload canceled because you edited'));
    assert.ok(v.button('Reload from disk'));
    assert.ok(!v.button('Discard edits and reload'), 'Retry requires another confirmation');
    const retry = startReload(v); await v.resolve(retry, fresh);
    assert.equal(v.editor().props.value, fresh.content);
    assert.equal(v.buffer().saved, fresh.content);
    assert.equal(v.draftBytes(), '{}');
  });
}

for (const cancel of ['Keep editing', 'Close dialog', 'Escape']) {
  test(`pending reload canceled by ${cancel} cannot clear a newer request busy state`, async t => {
    const v = await detected(t, { actualModal: cancel === 'Escape' });
    const first = startReload(v), before = preserved(v);
    if (cancel === 'Escape') v.dispatch('keydown', { key: 'Escape' }); else v.click(cancel);
    unchanged(v, before);
    const second = startReload(v);
    await v.reject(first, Error('canceled obsolete error'));
    assert.ok(v.button('Reloading…').props.disabled, 'Old finally cannot enable current request');
    assert.ok(!v.visibleText().includes('canceled obsolete error'));
    unchanged(v, before);
    await v.resolve(second, fresh);
    assert.equal(v.buffer().content, fresh.content);
    assert.equal(v.draftBytes(), '{}');
  });
}

test('same revision acknowledgement remains inert and a new revision prompts again', async t => {
  const v = await detected(t); const staleAck = v.button('Keep mine').props.onClick;
  const before = preserved(v); v.click('Keep mine');
  v.tickIntervals(); await v.resolve(2, observed);
  unchanged(v, before); assert.ok(!v.button('Keep mine'));
  v.focusWindow(); await v.resolve(3, fresh);
  assert.ok(v.button('Keep mine'));
  staleAck(); v.flush();
  assert.ok(v.button('Keep mine'), 'Old represented revision cannot acknowledge newer snapshot');
  v.click('Keep mine'); unchanged(v, before);
  v.click('Compare with disk'); assert.equal(v.comparison().props.original, fresh.content);
  assert.equal(v.requests.length, 4, 'Compare and acknowledgement fetch nothing');
});

for (const kind of ['local', 'ssh', 'wsl']) for (const autoReload of [false, true]) {
  test(`${kind} autoReload=${autoReload} keeps timer focus and clean/dirty choices`, async t => {
    const config = { connection: { id: 'synthetic', kind }, root: '/synthetic', path: 'file.ts' };
    const v = await opened(t, { config, preferences: { 'editor.autoReload': autoReload } });
    assert.equal([...v.intervals.values()][0].delay, kind === 'local' ? 2500 : 8000);
    v.tickIntervals(); await v.resolve(1, observed);
    assert.equal(v.buffer().content, autoReload ? observed.content : initial.content);
    assert.equal(!!v.button('Keep mine'), !autoReload);
    v.type(local); v.focusWindow(); await v.resolve(2, fresh);
    assert.equal(v.buffer().content, local); assert.ok(v.button('Keep mine'));
    assert.ok(!v.nodes().some(n => n.type === 'loading'), 'Background checks retain editor');
  });
}

test('clean autoReload refuses edit-away-and-back while a poll is pending', async t => {
  const v = await opened(t, { preferences: { 'editor.autoReload': true } });
  v.focusWindow(); v.type('temporary'); v.type(initial.content);
  await v.resolve(1, observed);
  assert.equal(v.buffer().revision, initial.revision);
  assert.equal(v.editor().props.value, initial.content);
  v.focusWindow(); await v.resolve(2, fresh);
  assert.equal(v.buffer().content, fresh.content, 'Fresh clean poll positive control');
});

test('accepted Save preserves newer typing and invalidates an earlier poll', async t => {
  const v = await detected(t); v.focusWindow(); const poll = v.requests.length - 1;
  v.click('Save changes'); const save = v.requests.length - 1;
  assert.equal(v.requests[save].request.revision, initial.revision);
  assert.ok(v.button('Saving…').props.disabled);
  v.type('typed during save');
  await v.resolve(save, { revision: 'saved-current' });
  exactBuffer(v, { content: 'typed during save', saved: local, revision: 'saved-current' });
  assert.equal(v.dirtyCalls.at(-1)[1], true); assert.equal(v.savedCalls.length, 1);
  const before = preserved(v); await v.resolve(poll, observed); unchanged(v, before);
  assert.ok(!v.button('Keep mine'), 'Old poll cannot resurrect a pre-save prompt');
  v.click('Save changes'); await v.resolve(v.requests.length - 1, { revision: 'saved-next' });
  assert.equal(v.draftBytes(), '{}'); assert.equal(v.dirtyCalls.at(-1)[1], false);
});

test('accepted reload invalidates an earlier poll and recovers after fresh read failure', async t => {
  const v = await detected(t), before = preserved(v);
  const failed = startReload(v); await v.reject(failed, Error('synthetic read denied'));
  unchanged(v, before);
  assert.ok(v.visibleText().includes('Could not reload from disk. Your edits are preserved.'));
  assert.ok(v.button('Compare with disk')); assert.ok(v.button('Reload from disk'));
  v.focusWindow(); const poll = v.requests.length - 1;
  const retry = startReload(v); await v.resolve(retry, fresh);
  const accepted = preserved(v); await v.resolve(poll, observed); unchanged(v, accepted);
  assert.equal(v.editor().props.value, fresh.content);
  assert.ok(!v.button('Keep mine'));
});

for (const content of ['', 'é e\u0301 分支 <&>\n']) {
  test(`exact empty or Unicode text survives comparison and reload ${JSON.stringify(content)}`, async t => {
    const v = await opened(t); v.type(content); v.focusWindow();
    await v.resolve(1, { content, revision: 'exact-observed' });
    v.click('Compare with disk');
    assert.equal(v.comparison().props.modified, content);
    assert.equal(v.comparison().props.original, content);
    assert.equal(v.comparison().props.options.wordWrap, 'off');
    assert.equal(v.comparison().props.options.renderSideBySide, true);
    v.click('Back to editor'); const index = startReload(v);
    await v.resolve(index, { content, revision: 'exact-fresh' });
    exactBuffer(v, { content, saved: content, revision: 'exact-fresh' });
    assert.equal(v.editor().props.value, content);
  });
}

test('opening error and later disk-check failure are distinct from valid empty text', async t => {
  const failed = mountEditorPanel(); t.after(() => failed.unmount());
  await failed.reject(0, Error('synthetic opening failure'));
  assert.ok(failed.visibleText().includes('synthetic opening failure')); assert.ok(!failed.editor());
  const v = await detected(t), before = preserved(v);
  v.focusWindow(); await v.reject(2, Error('synthetic poll failure'));
  unchanged(v, before);
  assert.ok(v.visibleText().includes('Could not check disk changes. Your edits are preserved.'));
  assert.ok(v.button('Compare with disk'));
  v.focusWindow(); await v.resolve(3, fresh);
  assert.ok(v.button('Keep mine')); assert.equal(v.editor().props.value, local);
});

test('recovery restore invalidates a pending poll and current save clears the actual draft', async t => {
  const recovered = { content: 'recovered 分支', saved: 'older disk', revision: 'recovery-r0' };
  const v = await opened(t, { seed({ drafts, props, draftStore }) {
    const key = drafts.draftKey('editor', props.config.connection, props.config.root, props.config.path);
    draftStore[key] = { kind: 'editor', config: props.config, data: recovered };
  } });
  assert.ok(v.editor().props.options.readOnly);
  v.focusWindow(); const poll = v.requests.length - 1;
  v.click('Restore recovery copy');
  exactBuffer(v, recovered); assert.equal(v.editor().props.value, recovered.content);
  const before = preserved(v); await v.resolve(poll, fresh); unchanged(v, before);
  v.click('Save changes'); const save = v.requests.length - 1;
  assert.equal(v.requests[save].request.revision, recovered.revision);
  await v.resolve(save, { revision: 'recovered-save' });
  assert.equal(v.buffer().saved, recovered.content); assert.equal(v.draftBytes(), '{}');
});

test('obsolete recovery discard callback cannot delete the original owner draft', async t => {
  const v = await opened(t, { seed({ drafts, props, draftStore }) {
    draftStore[drafts.draftKey('editor', props.config.connection, props.config.root, props.config.path)] = {
      data: { content: local, saved: initial.content, revision: initial.revision },
    };
  } });
  assert.ok(v.button('Restore recovery copy'), 'Current recovery positive control');
  const discard = v.button('Discard recovery copy').props.onClick;
  const before = preserved(v);
  v.retarget({ config: { ...v.props.config, path: 'foreign.ts' } });
  const calls = JSON.stringify(v.draftCalls);
  discard(); v.flush();
  assert.equal(v.draftBytes(), before.drafts, 'Obsolete discard must preserve original recovery bytes');
  assert.equal(JSON.stringify(v.draftCalls), calls, 'Obsolete discard must perform no draft operation');
});

for (const operation of ['save', 'reload']) for (const outcome of ['resolve', 'reject']) {
  test(`buffer replacement ignores pending ${operation} ${outcome} and busy completion`, async t => {
    const v = await detected(t);
    let index;
    if (operation === 'reload') index = startReload(v);
    else { v.click('Save changes'); index = v.requests.length - 1; }
    const old = v.buffer(), oldBytes = JSON.stringify(old);
    v.registry.buffers.set(v.props.id, { content: 'replacement', saved: 'disk', revision: 'replacement-r1' });
    const before = preserved(v), updates = v.observations.stateUpdates;
    if (outcome === 'resolve') await v.resolve(index, fresh);
    else await v.reject(index, Error('obsolete replaced failure'));
    unchanged(v, before); assert.equal(JSON.stringify(old), oldBytes);
    assert.equal(v.observations.stateUpdates, updates, 'Replaced completion cannot publish busy/error state');
  });
}

test('display rename preserves current owner buffer and pending read', async t => {
  const v = await opened(t); v.focusWindow();
  const config = { ...v.props.config, connection: { ...v.props.config.connection, name: 'Only display changed' } };
  v.retarget({ config });
  assert.equal(v.requests.length, 2, 'Display rename does not reopen file');
  await v.resolve(1, observed); assert.ok(v.button('Keep mine'));
  assert.equal(v.editor().props.value, initial.content);
});

test('diff opening failure cannot manufacture an empty working tree snapshot', async t => {
  const good = mountEditorPanel({ props: { diff: true } }); t.after(() => good.unmount());
  await good.resolve(0, { content: '', revision: 'empty-working' });
  await good.resolve(1, { content: 'HEAD baseline' });
  assert.equal(good.comparison().props.modified, '', 'Successful empty working tree positive control');
  assert.equal(good.comparison().props.original, 'HEAD baseline');
  const v = mountEditorPanel({ props: { diff: true } }); t.after(() => v.unmount());
  assert.equal(v.requests[0].request.op, 'read');
  assert.equal(v.requests[1].request.op, 'original');
  await v.reject(0, Error('synthetic current read failed'));
  await v.resolve(1, { content: 'HEAD baseline' });
  assert.ok(!v.comparison(), 'Failed current read is not valid empty comparison content');
  assert.ok(v.visibleText().includes('synthetic current read failed'));
});

test('diff retarget hides editable owner text before receiving its own read', async t => {
  const v = await detected(t), before = preserved(v);
  v.retarget({ diff: true, config: { ...v.props.config, path: 'different-diff.ts' } });
  assert.ok(!v.editor(), 'Diff owner cannot retain editable widget');
  assert.ok(!v.comparison(), 'Diff owner must wait for its own current read');
  const read = v.requests.length - 2, original = v.requests.length - 1;
  await v.resolve(read, { content: 'current diff working text', revision: 'diff-r1' });
  await v.resolve(original, { content: 'current diff HEAD' });
  assert.equal(v.comparison().props.modified, 'current diff working text', 'Diff must not borrow foreign registry text');
  assert.equal(v.comparison().props.original, 'current diff HEAD');
  unchanged(v, before);
});

test('incomplete reload response preserves local text baseline and recovery', async t => {
  const v = await detected(t), before = preserved(v), index = startReload(v);
  await v.resolve(index, {});
  unchanged(v, before);
  assert.equal(v.editor().props.value, local, 'Missing disk fields cannot become an empty/loading file');
  assert.ok(v.button('Reload from disk'));
});
