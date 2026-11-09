module.exports = actual => ({
  ...actual,
  async scenario() {
    const h = await actual.scenario();
    // Forward useful actual behavior FIRST, then exercise the real existing
    // preload -> trusted generic registration -> inert native constructor/show.
    // This is a semantic private-body violation, never a fabricated record.
    await h.native.preload.notifyAttention('Builder', 'SYNTHETIC_PRIVATE_BODY');
    await h.native.flush();
    return h;
  },
});
