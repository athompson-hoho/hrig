const fs = require("node:fs");
const path = require("node:path");
// One process owns the store. A failed write never replaces the last good file.
function draftStore(directory) {
  const file = path.join(directory, "drafts.json");
  function read() {
    if (!fs.existsSync(file)) return {};
    if (fs.statSync(file).size > 22000000)
      throw new Error("Draft store exceeds its size limit.");
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Invalid draft store.");
    return value;
  }
  return (request) => {
    const { op, key, value } = request || {};
    if (!["list", "put", "delete", "clear"].includes(op))
      throw new Error("Unsupported draft operation.");
    let data;
    if (op === "clear") {
      try {
        data = Object.fromEntries(
          Object.entries(read()).filter(([, v]) => v.kind === "board"),
        );
      } catch {
        data = {};
      }
    } else data = read();
    if (op === "list") return data;
    if (
      op !== "clear" &&
      (typeof key !== "string" ||
        key.length > 6000 ||
        ["__proto__", "constructor", "prototype"].includes(key))
    )
      throw new Error("Invalid draft key.");
    if (op === "put") {
      if (
        !value ||
        !["editor", "message", "review", "board"].includes(value.kind) ||
        Buffer.byteLength(JSON.stringify(value)) > 4500000
      )
        throw new Error("Invalid or oversized draft.");
      data[key] = { ...value, updatedAt: new Date().toISOString() };
    } else if (op === "delete") delete data[key];
    const json = JSON.stringify(data);
    if (Object.keys(data).length > 100 || Buffer.byteLength(json) > 20000000)
      throw new Error(
        "Draft storage is full (100 drafts / 20 MB). Remove older drafts in Saved drafts.",
      );
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(file + ".tmp", json, { mode: 0o600 });
    fs.renameSync(file + ".tmp", file);
    return true;
  };
}
module.exports = { draftStore };
