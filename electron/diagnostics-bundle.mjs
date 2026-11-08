// Browser-safe finite projection. Never serialize or enumerate an input object.
export const CHECK_CATALOG = Object.freeze(['Windows workspace', 'OpenRig host', 'Node.js', 'OpenRig', 'tmux', 'Python 3', 'OpenRig daemon', 'Connection / Python']);
const REQUEST_LIMIT = 16 * 1024;
const bytes = text => new TextEncoder().encode(text).length;
const leaf = (object, key) => {
  try { return object != null ? object[key] : undefined; } catch { return undefined; }
};
const domains = {
  'appearance.density': value => ['compact', 'comfortable'].includes(value),
  'appearance.reduceMotion': value => typeof value === 'boolean',
  'editor.fontSize': integer(10, 32),
  'editor.tabSize': integer(1, 8),
  'editor.wordWrap': value => ['on', 'off'].includes(value),
  'terminal.fontSize': integer(10, 32),
  'terminal.cursorStyle': value => ['bar', 'block', 'underline'].includes(value),
  'terminal.scrollback': integer(1000, 100000),
  'workspace.refreshInterval': integer(5, 120),
};
function integer(min, max) { return value => Number.isInteger(value) && value >= min && value <= max; }
function settingsProjection(input) {
  const result = {};
  for (const key of Object.keys(domains)) {
    const value = leaf(input, key);
    if (domains[key](value)) result[key] = value;
  }
  return result;
}
function checksProjection(rows, eligible, native = false) {
  const length = leaf(rows, 'length');
  const available = eligible === true && Array.isArray(rows) && Number.isInteger(length) && length > 0 && length <= 32;
  const statuses = CHECK_CATALOG.map(() => 'unknown');
  const counts = CHECK_CATALOG.map(() => 0);
  if (available) for (let i = 0; i < length; i++) {
    const row = leaf(rows, i);
    const index = CHECK_CATALOG.indexOf(leaf(row, 'name'));
    if (index < 0) continue;
    counts[index]++;
    const value = leaf(row, native ? 'status' : 'ok');
    statuses[index] = native
      ? (['ok', 'failed', 'unknown'].includes(value) ? value : 'unknown')
      : (value === true ? 'ok' : value === false ? 'failed' : 'unknown');
  }
  return { availability: available ? 'available' : 'unavailable', entries: CHECK_CATALOG.map((name, i) => ({ name, status: counts[i] === 1 ? statuses[i] : 'unknown' })) };
}
function request(checks, settings) {
  return { schemaVersion: 1, source: 'represented-connection-doctor', checks, settings: settingsProjection(settings) };
}
export function projectDiagnosticsRequest(report, effective, eligible) {
  const result = JSON.stringify(request(checksProjection(eligible === true ? leaf(report, 'checks') : undefined, eligible), effective));
  if (bytes(result) > REQUEST_LIMIT) throw Error('Invalid diagnostics request.');
  return result;
}
export function parseDiagnosticsRequest(text) {
  if (typeof text !== 'string' || bytes(text) > REQUEST_LIMIT) throw Error('Invalid diagnostics request.');
  const input = JSON.parse(text);
  if (leaf(input, 'schemaVersion') !== 1 || leaf(input, 'source') !== 'represented-connection-doctor') throw Error('Invalid diagnostics request.');
  const checks = leaf(input, 'checks');
  return request(checksProjection(leaf(checks, 'entries'), leaf(checks, 'availability') === 'available', true), leaf(input, 'settings'));
}
export function createDiagnosticsBundle(input, versions) {
  const checks = leaf(input, 'checks');
  const result = request(checksProjection(leaf(checks, 'entries'), leaf(checks, 'availability') === 'available', true), leaf(input, 'settings'));
  result.versions = {};
  for (const key of ['hrig', 'electron', 'chromium', 'node']) {
    const value = leaf(versions, key);
    result.versions[key] = typeof value === 'string' && value.length <= 32 && /^\d{1,5}(?:\.\d{1,5}){1,3}$/.test(value) ? value : 'unavailable';
  }
  const text = JSON.stringify(result);
  if (bytes(text) > 64 * 1024) throw Error('Invalid diagnostics bundle.');
  return text;
}
