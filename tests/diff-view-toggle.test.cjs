const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('diff toolbar toggle writes editor.diffSideBySide through settings scope rules and is documented', () => {
  const panel = fs.readFileSync('src/EditorPanel.tsx', 'utf8');
  assert.match(panel, /\{\(diff \|\| compare\) && \(\s*<button/);
  assert.match(panel, /Object\.hasOwn\(projectPreferences, "editor\.diffSideBySide"\) \? "project" : "user"/);
  assert.match(panel, /!preferences\["editor\.diffSideBySide"\]/);
  assert.match(panel, /renderSideBySide: preferences\["editor\.diffSideBySide"\]/, 'the same setting drives the diff editor');
  assert.match(panel, /aria-pressed=\{preferences\["editor\.diffSideBySide"\]\}/);
  assert.match(fs.readFileSync('SETTINGS.md', 'utf8'), /Inline \/ Side by side button/);
});
