const {test} = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const vm = require('node:vm');
const exportsForTest = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/terminal-seat-activity.ts'),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:exportsForTest});
const {terminalSeatActivity:activity} = exportsForTest;
test('plain shells have no seat activity', () => assert.equal(activity(undefined,true),null));
test('live inventory distinguishes activity and includes its detail', () => {
  for (const [status,label] of [['working','Working'],['idle','Idle'],['attention','Needs input'],['running','Running'],['failed','Stopped']]) {
    assert.equal(activity({status,activity:'detail'},true).label,label);
    assert.equal(activity({status,activity:'detail'},true).detail,'detail');
  }
});
test('unavailable inventory never presents saved activity as current', () => {
  assert.equal(activity({status:'working'},false).label,'Activity unavailable');
  assert.equal(activity({status:'new-state'},true).label,'Activity unknown');
});
