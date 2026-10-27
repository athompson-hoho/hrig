const { execFile } = require("node:child_process");
const { codexPlan, safePlan } = require("./account-plan.cjs");
function run(file, args) {
  return new Promise((resolve, reject) =>
    execFile(
      file,
      args,
      {
        windowsHide: true,
        timeout: 12000,
        maxBuffer: 1024 * 1024,
        encoding: "utf8",
      },
      (error, out) =>
        error ? reject(Error("Account discovery unavailable")) : resolve(out),
    ),
  );
}
function sanitizeOrca(value, connection) {
  const data = value?.result || value;
  const accounts = [];
  for (const [provider, runtime] of [
    ["codex", "codex"],
    ["claude", "claude-code"],
  ]) {
    for (const row of (Array.isArray(data?.[provider]?.accounts)
      ? data[provider].accounts
      : []
    )
      .filter((row) => row && typeof row === "object")
      .slice(0, 50)) {
      const scope =
        row.managedHomeRuntime || row.managedAuthRuntime || "unknown";
      const sameHost =
        (connection.kind === "local" && scope === "host") ||
        (connection.kind === "wsl" &&
          scope === "wsl" &&
          row.wslDistro === connection.distro);
      accounts.push({
        id: String(row.id || "").slice(0, 150),
        runtime,
        label: String(
          row.email || row.workspaceLabel || "Managed account",
        ).slice(0, 200),
        scope:
          scope === "wsl"
            ? `WSL: ${String(row.wslDistro || "unknown").slice(0, 150)}`
            : scope,
        hostMatch: !!sameHost,
        source: "Orca",
        status: "managed; CLI access not verified",
      });
    }
  }
  return accounts;
}
async function windowsProviders() {
  const providers = await Promise.all(
    [
      ["codex", ["login", "status"]],
      ["claude-code", ["auth", "status"]],
    ].map(async ([id, args]) => {
      const command = id === "codex" ? "codex" : "claude";
      const script =
        "$ErrorActionPreference='Stop'; $command=Get-Command " +
        command +
        ' -ErrorAction SilentlyContinue; if (!$command) { \'{"installed":false,"status":"missing"}\'; exit }; try { $ErrorActionPreference="Continue"; $result=& $command.Source ' +
        args.join(" ") +
        " 2>&1 | Out-String; $status=if ($LASTEXITCODE -eq 0) {'authenticated'} else {'unverified'}; $plan=$null; try { $meta=$result | ConvertFrom-Json; $plan=$meta.subscriptionType; if (!$plan) {$plan=$meta.subscription_type}; if (!$plan) {$plan=$meta.planType} } catch {}; @{installed=$true;status=$status;plan=$plan} | ConvertTo-Json -Compress } catch { '{\"installed\":true,\"status\":\"unverified\"}' }";
      try {
        return {
          id,
          ...JSON.parse(
            await run("powershell.exe", [
              "-NoProfile",
              "-NonInteractive",
              "-Command",
              script,
            ]),
          ),
        };
      } catch {
        return { id, installed: false, status: "unverified" };
      }
    }),
  );
  const codex = providers.find(
    (p) => p.id === "codex" && p.status === "authenticated",
  );
  if (codex) codex.plan = await codexPlan();
  return { providers };
}
async function discover(connection, probe) {
  const [providers, orca] = await Promise.allSettled([
    connection.kind === "local" && process.platform === "win32"
      ? windowsProviders()
      : probe(),
    run(process.platform === "linux" ? "orca-ide" : "orca", [
      "account",
      "list",
      "--json",
    ]),
  ]);
  return {
    providers:
      providers.status === "fulfilled"
        ? (providers.value.providers || []).map((p) => ({
            ...p,
            plan: safePlan(p.plan),
          }))
        : [],
    accounts:
      orca.status === "fulfilled"
        ? sanitizeOrca(JSON.parse(orca.value), connection)
        : [],
    checkedAt: Date.now(),
    scope: connection.name,
    warning:
      providers.status === "rejected"
        ? "Could not verify runtime sign-in on this host."
        : "",
    orcaStatus: orca.status === "fulfilled" ? "available" : "unavailable",
    contextStatus:
      "Per-session context usage is not exposed by this account check.",
  };
}
module.exports = { discover, sanitizeOrca };
