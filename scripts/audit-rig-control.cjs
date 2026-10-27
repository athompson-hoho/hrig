// Read-only discovery: only --help and --version are invoked on the selected host.
const fs = require("node:fs/promises");
const core = require("../electron/core.cjs");
const features = require("../electron/features.cjs");
const { createRigControl } = require("../electron/rig-control.cjs");
async function main() {
  const connections = await core.detectConnections();
  const connection =
    connections.find((c) => c.kind === "wsl") ||
    (process.platform !== "win32"
      ? connections.find((c) => c.kind === "local")
      : null);
  if (!connection)
    throw new Error(
      "A local Unix or WSL OpenRig host is required for the audit.",
    );
  const service = createRigControl(features.runRig);
  const version = (await features.runRig(connection, ["--version"])).trim();
  const root = await service.describe(connection, []);
  const queue = root.commands.map((c) => [c.name]);
  const entries = [];
  const failures = [];
  // Read-only help calls are independent. Limit pressure on WSL/SSH transport.
  while (queue.length) {
    const batch = queue.splice(0, 4);
    const results = await Promise.allSettled(
      batch.map((path) => service.describe(connection, path)),
    );
    results.forEach((result, index) => {
      const path = batch[index];
      if (result.status === "rejected")
        failures.push({ path, error: result.reason.message });
      else {
        const s = result.value;
        entries.push({
          path,
          description: s.description,
          argumentCount: s.arguments.length,
          optionCount: s.options.length,
          childCount: s.commands.length,
        });
        queue.push(...s.commands.map((c) => [...path, c.name]));
      }
    });
    if (entries.length > 2000)
      throw new Error("Unexpected command tree size; audit stopped.");
  }
  if (failures.length) throw new Error(JSON.stringify(failures));
  entries.sort((a, b) => a.path.join(" ").localeCompare(b.path.join(" ")));
  await fs.writeFile(
    "src/openrig-command-index.json",
    JSON.stringify({ version, entries }, null, 2) + "\n",
  );
  const rows = root.commands.map((c) => {
    const all = entries.filter((e) => e.path[0] === c.name);
    return `| ${c.name} | ${all.length} | OpenRig control center → ${c.name}; guided arguments/options, tooltips and installed help |`;
  });
  await fs.writeFile(
    "docs/CLI-GUI-COVERAGE.md",
    `# OpenRig GUI command coverage\n\nAudited installed CLI: ${version}. Read-only discovery invoked only help and version.\n\n${root.commands.length} top-level commands and ${entries.length} command paths were successfully parsed, including ${entries.filter((e) => !e.childCount).length} leaf actions. Help is available through each command's installed-help disclosure; version is an option in the root form.\n\nAll paths have a guided form in Tools → OpenRig control center. Positional arguments, optional and variadic values, boolean and inherited options come from installed help. Unsupported paths and flags are rejected on the selected host; the bundled search index is navigation, not execution authority.\n\nEvery execution requires an exact, expiring, single-use action review. Interactive and continuous commands use terminal mode. No live mutations, messages, authentication switches or daemon operations were performed by this audit. CLI parsing, GUI flows and fixture execution are tested separately; this is interface coverage, not proof that every OpenRig operation succeeds in every environment.\n\n| Command | Paths including group | GUI representation |\n|---|---|---|\n${rows.join("\n")}\n\nRegenerate with \`node scripts/audit-rig-control.cjs\` after upgrading OpenRig. Actual host help is loaded before preparing an action.\n`,
  );
  console.log(
    JSON.stringify({
      version,
      topLevel: root.commands.length,
      paths: entries.length,
      leaves: entries.filter((e) => !e.childCount).length,
    }),
  );
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
