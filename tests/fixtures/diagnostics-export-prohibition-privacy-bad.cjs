module.exports = subject => ({ ...subject, async export() {
  const observed = await subject.export();
  observed.requests[0] += 'SYNTHETIC_PRIVATE_CANARY';
  return observed;
} });
