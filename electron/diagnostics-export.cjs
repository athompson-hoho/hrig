const path = require('node:path');

function registerDiagnosticsExport({ handle, dialog, getWindow, fs, getVersions, randomUUID }) {
  let pending = false;
  handle('diagnostics:export', async (_event, text) => {
    if (pending) return { status: 'error' };
    pending = true;
    let temporary, file, owned = false, closed = false;
    try {
      // Bound before parsing, including when callers bypass the preload.
      if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 16 * 1024) return { status: 'error' };
      const { parseDiagnosticsRequest, createDiagnosticsBundle } = await import('./diagnostics-bundle.mjs');
      const request = parseDiagnosticsRequest(text);
      const choice = await dialog.showSaveDialog(getWindow(), {
        title: 'Export redacted diagnostics', defaultPath: 'hrig-diagnostics.json',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (choice.canceled || !choice.filePath) return { status: 'canceled' };
      const bundle = createDiagnosticsBundle(request, await getVersions());
      temporary = path.join(path.dirname(choice.filePath), `.hrig-diagnostics-${randomUUID()}.tmp`);
      file = await fs.open(temporary, 'wx', 0o600);
      owned = true;
      await file.writeFile(bundle, 'utf8');
      await file.sync();
      await file.close();
      closed = true;
      await fs.link(temporary, choice.filePath);
      return { status: 'saved' };
    } catch {
      return { status: 'error' };
    } finally {
      if (file && !closed) { try { await file.close(); } catch {} }
      if (owned) { try { await fs.unlink(temporary); } catch {} }
      pending = false;
    }
  });
}
module.exports = { registerDiagnosticsExport };
