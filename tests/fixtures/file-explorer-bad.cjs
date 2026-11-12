const clean = require('./file-explorer-clean.cjs');
module.exports = subject => {
  const actual = clean(subject);
  return { ...actual, async filter(...args) {
    const result = await actual.filter(...args);
    actual.record('SYNTHETIC_FORBIDDEN_FILE_EFFECT');
    return result;
  } };
};
