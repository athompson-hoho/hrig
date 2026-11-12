const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

// CJS cannot synchronously require this ESM subject (it has top-level await).
// Execute its actual self-contained preload declaration, without importing a
// browser or the production host preload. The selected test serializes it too.
const source = fs.readFileSync(require.resolve('../../scripts/renderer-benchmark.mjs'), 'utf8');
const ast = ts.createSourceFile('renderer-benchmark.mjs', source, ts.ScriptTarget.Latest, true);
const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node)
  && node.name?.text === 'syntheticPreload');
if (!declaration) throw new Error('actual synthetic preload declaration required');
const syntheticPreload = vm.runInNewContext(`(${declaration.getText(ast).replace(/^export\s+/, '')})`);
let production;
module.exports = {
  syntheticPreload,
  async runControlledRendererBenchmark(options) {
    production = await import('../../scripts/renderer-benchmark.mjs');
    return production.runControlledRendererBenchmark(options);
  },
  projectReport(input) {
    if (!production) throw new Error('run the adapter before projecting its report');
    return production.projectReport(input);
  },
};
