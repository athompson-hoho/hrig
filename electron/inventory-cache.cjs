// Optional on-disk copy of the last verified inventory per connection, so the
// sidebar can show it immediately after a restart. It is only ever a *cached*
// snapshot: the renderer seeds its unverified-snapshot cache with it, which
// keeps seat actions guarded until a live poll succeeds. Opt-in, bounded,
// validated on read, and clearable.
const MAX_CONNECTIONS = 10;
const MAX_SEATS = 500;
const MAX_RIGS = 200;
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const MIN_WRITE_MS = 30000;
const str = (v, max = 300) => (typeof v === "string" ? v.slice(0, max) : "");
const count = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
const optCount = (v) => (Number.isInteger(v) && v >= 0 ? v : null);

function cleanSeat(s) {
  if (!s || typeof s !== "object" || !str(s.id) || !str(s.name)) return null;
  const seat = {
    id: str(s.id), rigId: str(s.rigId), rigName: str(s.rigName), name: str(s.name),
    pod: str(s.pod), runtime: str(s.runtime), model: str(s.model),
    session: typeof s.session === "string" && s.session ? str(s.session) : null,
    status: str(s.status) || "unknown", activity: str(s.activity, 500),
    // Last error text can be long and is not needed to render a cached row.
    error: "", workCount: count(s.workCount),
    assignedWork: optCount(s.assignedWork), pendingWork: optCount(s.pendingWork),
    lastActivityAt:
      typeof s.lastActivityAt === "string" && Number.isFinite(Date.parse(s.lastActivityAt))
        ? s.lastActivityAt : null,
  };
  return seat;
}
function cleanInventory(inv) {
  if (!inv || typeof inv !== "object" || !Array.isArray(inv.seats) || !Array.isArray(inv.rigs)) return null;
  const sampled = Date.parse(inv.sampledAt);
  if (!Number.isFinite(sampled)) return null;
  return {
    rigs: inv.rigs.slice(0, MAX_RIGS).filter((r) => r && str(r.id)).map((r) => ({
      id: str(r.id), name: str(r.name), status: str(r.status) || "unknown", nodeCount: count(r.nodeCount),
    })),
    seats: inv.seats.slice(0, MAX_SEATS).map(cleanSeat).filter(Boolean),
    sampledAt: new Date(sampled).toISOString(),
  };
}

function createInventoryCache({ file, fs, now = Date.now }) {
  let lastWrite = new Map();
  const readAll = () => {
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      return data && data.version === 1 && data.entries && typeof data.entries === "object" ? data.entries : {};
    } catch {
      return {};
    }
  };
  const writeAll = (entries) => {
    fs.mkdirSync(require("node:path").dirname(file), { recursive: true });
    fs.writeFileSync(file + ".tmp", JSON.stringify({ version: 1, entries }));
    fs.renameSync(file + ".tmp", file);
  };
  function load() {
    const out = [];
    for (const [key, entry] of Object.entries(readAll()).slice(0, MAX_CONNECTIONS)) {
      const inventory = cleanInventory(entry?.inventory);
      if (!inventory || typeof key !== "string" || key.length > 2000) continue;
      if (now() - Date.parse(inventory.sampledAt) > MAX_AGE_MS) continue; // too old to be useful
      out.push({ key, inventory });
    }
    return out;
  }
  function save(key, inventory) {
    if (typeof key !== "string" || !key || key.length > 2000) throw Error("Invalid cache key.");
    const clean = cleanInventory(inventory);
    if (!clean) throw Error("Invalid inventory snapshot.");
    if (now() - (lastWrite.get(key) || 0) < MIN_WRITE_MS) return { written: false };
    const entries = readAll();
    entries[key] = { savedAt: new Date(now()).toISOString(), inventory: clean };
    const keys = Object.keys(entries);
    for (const old of keys.slice(0, Math.max(0, keys.length - MAX_CONNECTIONS))) delete entries[old];
    writeAll(entries);
    lastWrite.set(key, now());
    return { written: true };
  }
  function clear() {
    lastWrite = new Map();
    try { fs.rmSync(file, { force: true }); } catch {}
    return { cleared: true };
  }
  function operation(request) {
    if (request?.op === "load") return { entries: load() };
    if (request?.op === "save") return save(request.key, request.inventory);
    if (request?.op === "clear") return clear();
    throw Error("Unsupported inventory cache operation.");
  }
  return { operation, load, save, clear };
}
module.exports = { createInventoryCache, cleanInventory, MAX_AGE_MS, MIN_WRITE_MS };
