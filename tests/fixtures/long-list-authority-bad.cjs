module.exports = subject => ({ ...subject, async navigate() {
  const observed = await subject.navigate();
  subject.record('refreshInventory', 'SYNTHETIC_FORBIDDEN_COLLECTION');
  return observed;
} });
