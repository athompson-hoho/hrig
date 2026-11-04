const fs = require('node:fs/promises');

// Streaming ANSI stripper: sequence state survives PTY chunk boundaries without
// retaining unbounded OSC/DCS payloads. Logs are transcripts, not screen replays.
function plainTerminalStream() {
  let mode = 'text';
  return chunk => {
    let out = '';
    for (const c of chunk) {
      const n = c.codePointAt(0);
      if (mode === 'string') {
        if (c === '\x07' || c === '\x9c') mode = 'text';
        else if (c === '\x1b') mode = 'string-escape';
        continue;
      }
      if (mode === 'string-escape') { mode = c === '\\' ? 'text' : 'string'; continue; }
      if (mode === 'csi') { if (n >= 0x40 && n <= 0x7e) mode = 'text'; continue; }
      if (mode === 'escape') {
        if (c === '[') mode = 'csi';
        else if (']PX^_'.includes(c)) mode = 'string';
        else if (n >= 0x20 && n <= 0x2f) mode = 'escape-intermediate';
        else mode = 'text';
        continue;
      }
      if (mode === 'escape-intermediate') { if (n >= 0x30 && n <= 0x7e) mode = 'text'; continue; }
      if (c === '\x1b') mode = 'escape';
      else if (c === '\x9b') mode = 'csi';
      else if ('\x90\x9d\x98\x9e\x9f'.includes(c)) mode = 'string';
      else if (c === '\n' || c === '\t' || (n >= 0x20 && !(n >= 0x7f && n <= 0x9f))) out += c;
      // CR, backspace and other cursor controls are omitted, not interpreted.
    }
    return out;
  };
}
function createTerminalLogs({ io = fs, notify = () => {}, maxBytes = 32 * 1024 * 1024, maxPending = 1024 * 1024 } = {}) {
  const logs = new Map();
  const state = id => {
    const log = logs.get(id);
    return log ? { id, active: log.active, path: log.path, bytes: log.bytes, error: log.error } : { id, active: false, path: '', bytes: 0, error: '' };
  };
  const publish = id => { notify(state(id)); return state(id); };
  async function stop(id) {
    const log = logs.get(id);
    if (!log) return state(id);
    log.active = false;
    if (!log.closing) log.closing = log.queue.then(async () => {
      try { await log.file.close(); } catch (e) { log.error = e.message; }
      return publish(id);
    });
    publish(id);
    return log.closing;
  }
  return {
    state,
    async start(id, path) {
      await stop(id);
      const file = await io.open(path, 'a', 0o600);
      let bytes;
      try {
        const info = await file.stat();
        if (!info.isFile() || info.size >= maxBytes) throw Error('Choose a regular log file smaller than 32 MiB.');
        bytes = info.size;
      } catch (e) { await file.close(); throw e; }
      logs.set(id, { file, path, bytes, active: true, error: '', pending: 0, queue: Promise.resolve(), strip: plainTerminalStream(), closing: null });
      return publish(id);
    },
    append(id, data) {
      const log = logs.get(id);
      if (!log?.active) return;
      const text = log.strip(data), bytes = Buffer.byteLength(text, 'utf8');
      if (!bytes) return;
      if (log.bytes + bytes > maxBytes || log.pending + bytes > maxPending) {
        log.error = log.bytes + bytes > maxBytes ? 'Logging stopped at the 32 MiB file limit.' : 'Logging stopped: disk writes could not keep up (1 MiB pending limit).';
        void stop(id); return;
      }
      log.bytes += bytes; log.pending += bytes;
      log.queue = log.queue.then(() => log.file.writeFile(text, 'utf8')).catch(e => {
        log.error = `Logging stopped: ${e.message}`; log.active = false; publish(id);
        // Close after this write chain settles, without awaiting itself.
        void stop(id);
      }).finally(() => { log.pending -= bytes; });
    },
    stop,
    async forget(id) { const log=logs.get(id); await stop(id); if(logs.get(id)===log) logs.delete(id); },
    async stopAll() { await Promise.all([...logs.keys()].map(stop)); },
  };
}
module.exports = { plainTerminalStream, createTerminalLogs };
