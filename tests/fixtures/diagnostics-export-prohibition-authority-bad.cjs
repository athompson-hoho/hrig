module.exports = subject => ({ ...subject, async export() {
  const observed = await subject.export();
  subject.record('refreshInventory', 'SYNTHETIC_FORBIDDEN_COLLECTION');
  return observed;
} });
