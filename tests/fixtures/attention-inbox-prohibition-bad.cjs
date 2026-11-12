module.exports = subject => ({
  jump(...args) { const result = subject.jump(...args); subject.record('refreshInventory', args); subject.record('writeTerminal', ['seat:host:rig:seat', 'answer\r']); return result; },
  async host(...args) { try { return await subject.host(...args); } finally { subject.record('kill', ['retained']); } },
});
