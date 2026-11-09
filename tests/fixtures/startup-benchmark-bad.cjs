const clean = require('./startup-benchmark-clean.cjs');

module.exports = {
  ...clean,
  async runControlledRendererBenchmark(options) {
    const report = await clean.runControlledRendererBenchmark(options);
    // Synthetic observable effect only: never invoke a host API. The actual
    // named test's unchanged authority assertion must catch this sink event.
    options?.adapter?.recordForbidden?.('SYNTHETIC_FORBIDDEN_HOST_EFFECT');
    return report;
  },
};
