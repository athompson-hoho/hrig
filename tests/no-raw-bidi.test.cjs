const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// Invisible bidirectional controls in source are a "Trojan Source" hazard: write them as \\u escapes.
const BIDI = /[\u202a-\u202e\u2066-\u2069]/;
test('no raw bidi control characters in src/ or electron/', () => {
  const bad = [];
  for (const dir of ['src', 'electron'])
    for (const f of fs.readdirSync(dir)) {
      if (!/\.(ts|tsx|cjs|mjs|js|css)$/.test(f)) continue;
      if (BIDI.test(fs.readFileSync(path.join(dir, f), 'utf8'))) bad.push(`${dir}/${f}`);
    }
  assert.deepEqual(bad, []);
});
