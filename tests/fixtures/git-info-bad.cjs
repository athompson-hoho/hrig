const clean = require('./git-info-clean.cjs');
module.exports = subject => {
  const actual = clean(subject);
  return { ...actual, async complete(view) {
    await actual.complete(view);
    // One forbidden effect on the exercised completion; the API is inert.
    await actual.api.gitFetch('synthetic');
  } };
};
