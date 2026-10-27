import { _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const { cpuSample } = createRequire(import.meta.url)(
  "../electron/performance-model.cjs",
);
const latest = JSON.parse(await fs.readFile("release/latest.json", "utf8"));
const results = [];
for (const terminals of [0, 12, 24]) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hrig-benchmark-"));
  const c = {
    id: "benchmark",
    kind: "local",
    name: "Benchmark fixture",
    root: dir,
  };
  await fs.writeFile(
    path.join(dir, "benchmark.ts"),
    'export const benchmark = "Workspace responsiveness";\n',
  );
  if (process.platform !== "win32") {
    c.rigBinary = path.join(dir, "rig-fixture");
    await fs.writeFile(c.rigBinary, '#!/usr/bin/env python3\nprint("[]")\n', {
      mode: 0o700,
    });
  }
  const tabs = Array.from({ length: terminals }, (_, i) => ({
    type: "tab",
    id: "bench-" + i,
    name: "Shell " + (i + 1),
    component: "terminal",
    config: { connection: c, root: dir, terminalId: "bench-" + i },
  }));
  const model = {
    global: { tabEnableRenderOnDemand: false },
    layout: {
      type: "row",
      children: [
        {
          type: "tabset",
          id: "main",
          children: tabs.length
            ? tabs
            : [
                {
                  type: "tab",
                  id: "welcome",
                  name: "Workspace",
                  component: "welcome",
                },
              ],
        },
      ],
    },
  };
  await fs.writeFile(
    path.join(dir, "workspace.json"),
    JSON.stringify({
      version: 1,
      connections: [c],
      activeConnection: c.id,
      roots: {},
      activeRig: "",
      layouts: { [c.id + "::" + dir + "::"]: model },
      savedLayouts: [],
      preferences: {
        "terminal.localShell": process.platform === "win32" ? "cmd" : "bash",
        "appearance.reduceMotion": true,
      },
    }),
  );
  const env = { ...process.env, HRIG_DATA_DIR: dir };
  delete env.ELECTRON_RUN_AS_NODE;
  const started = performance.now();
  const app = await electron.launch({
    executablePath: latest.executable,
    args: process.platform === "linux" ? ["--no-sandbox"] : [],
    env,
  });
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(90000);
    await page
      .getByRole("button", { name: "New panel", exact: true })
      .waitFor();
    const workspaceReadyMs = Math.round(performance.now() - started);
    if (terminals)
      await page.waitForFunction(
        (n) =>
          document.querySelectorAll(".session-toolbar .status-dot.idle")
            .length === n,
        terminals,
        { timeout: 90000 },
      );
    const terminalsReadyMs = Math.round(performance.now() - started);
    const before = await app.evaluate(({ app }) =>
      app
        .getAppMetrics()
        .map((m) => ({
          pid: m.pid,
          cumulativeCPUSeconds: m.cpu.cumulativeCPUUsage,
          cpuPercent: m.cpu.percentCPUUsage,
        })),
    );
    const sampleStarted = performance.now();
    await new Promise((r) => setTimeout(r, 2000));
    const metrics = await app.evaluate(({ app }) =>
      app.getAppMetrics().map((m) => ({
        pid: m.pid,
        cumulativeCPUSeconds: m.cpu.cumulativeCPUUsage,
        type: m.type,
        workingSetKiB: m.memory.workingSetSize,
        cpuPercent: m.cpu.percentCPUUsage,
      })),
    );
    const cpu = cpuSample(
      before,
      metrics,
      (performance.now() - sampleStarted) / 1000,
    );
    const open = performance.now();
    await page.getByRole("button", { name: "Explorer", exact: true }).click();
    await page
      .getByRole("button", { name: "benchmark.ts", exact: true })
      .click();
    await page
      .locator(".monaco-editor .view-lines")
      .filter({ hasText: "Workspace responsiveness" })
      .first()
      .waitFor();
    const editorOpenMs = Math.round(performance.now() - open);
    const settings = performance.now();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .getByRole("heading", { name: "Settings", exact: true })
      .waitFor();
    results.push({
      terminals,
      workspaceReadyMs,
      terminalsReadyMs,
      editorOpenMs,
      settingsOpenMs: Math.round(performance.now() - settings),
      electronWorkingSetMiB: Math.round(
        metrics.reduce((n, m) => n + m.workingSetKiB, 0) / 1024,
      ),
      idleCpuPercent: cpu.percent,
      idleCpuMethod: cpu.method,
      processes: metrics.length,
    });
  } finally {
    await app.close();
  }
}
const report = {
  version: latest.version,
  platform: process.platform,
  arch: process.arch,
  osRelease: os.release(),
  logicalCpus: os.cpus().length,
  systemMemoryGiB: Math.round(os.totalmem() / 1024 ** 3),
  method:
    "One fresh application process per case; shared OS cache; disposable local shells (no agents). Working sets sum Electron processes and can double-count shared pages; external shell/agent memory is excluded. Idle CPU is a two-second sample. CI measurements are baselines, not desktop guarantees.",
  results,
};
await fs.writeFile(
  `release/performance-${process.platform}-${process.arch}.json`,
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
