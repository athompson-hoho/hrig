const clean = require('./git-badges-clean.cjs');
module.exports = subject => {
  const actual = clean(subject);
  return { ...actual, async filter(...args) {
    await actual.filter(...args);
    // One extra read through the very same inert API used by the real Explorer.
    await actual.api.git(actual.connection, actual.root);
  } };
};
