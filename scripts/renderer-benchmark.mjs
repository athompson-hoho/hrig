import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const origin = "http://hrig-benchmark.invalid";
const scenarios = ["welcome-only", "restored-hidden"];
const metricKeys = ["workspaceReadyMs", "editorOpenMs", "settingsOpenMs", "revisitMs"];
const root = fileURLToPath(new URL("../", import.meta.url));

// This is the production helper, transpiled with the project's existing tooling.
// It is the single acceptance function for both semantic tests and real samples.
const require = createRequire(import.meta.url);
const ts = require("typescript");
const timingExports = {};
runInNewContext(ts.transpileModule(await fs.readFile(new URL("../src/startup-timing.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: timingExports });
const { observeStartupDuration } = timingExports;

/** Serialized by Playwright: no imported code, host bridge or owner data. */
export function syntheticPreload({ scenario }) {
  const violations = [];
  Object.defineProperty(window, "__hrigBenchmarkViolations", { value: violations });
  const deny = () => { violations.push("capability-denied"); throw new Error("capability-denied"); };
  const connection = { id: "benchmark", kind: "local", name: "Synthetic", root: "/synthetic" };
  const config = { connection, root: "/synthetic", path: "benchmark.ts" };
  const children = [{ type: "tab", id: "welcome", name: "Workspace", component: "welcome" }];
  if (scenario === "restored-hidden") children.push(
    { type: "tab", id: "synthetic-editor", name: "benchmark.ts", component: "editor", enableRenderOnDemand: false, config },
    { type: "tab", id: "synthetic-diff", name: "Synthetic diff", component: "diff", enableRenderOnDemand: false, config },
    { type: "tab", id: "synthetic-settings", name: "Settings", component: "settings", enableRenderOnDemand: false },
  );
  const state = { version: 1, connections: [connection], activeConnection: connection.id,
    roots: {}, activeRig: "", savedLayouts: [], preferences: { "appearance.reduceMotion": true },
    layouts: { "benchmark::/synthetic::": { global: { tabEnableRenderOnDemand: false },
      layout: { type: "row", children: [{ type: "tabset", id: "main", selected: 0, children }] } } } };
  const validConnection = c => c?.id === connection.id && c.kind === "local" && c.root === connection.root && !c.host;
  const checked = c => { if (!validConnection(c)) deny(); };
  const subscribe = callback => { if (typeof callback !== "function") deny(); return () => {}; };
  const api = Object.freeze({
    platform: "linux",
    loadState: async () => structuredClone(state),
    detectConnections: async () => [structuredClone(connection)],
    // App owns persistence. These deliberately discard all writes in memory.
    saveState: async () => {}, flushState: () => ({ saved: true }),
    onResume: subscribe, onUpdates: subscribe, onPrepareUpdate: subscribe,
    inventory: async c => { checked(c); return { rigs: [], seats: [], sampledAt: "2026-01-01T00:00:00Z" }; },
    projects: async c => { checked(c); return []; },
    file: async (c, request) => {
      checked(c);
      if (request?.root !== "/synthetic") return deny();
      if (request.op === "list" && request.path === "") return [{ name: "benchmark.ts", path: "benchmark.ts", directory: false }];
      if (request.op === "read" && request.path === "benchmark.ts") return 'export const benchmark = "Synthetic";\n';
      return deny();
    },
    edit: async (c, request) => {
      checked(c);
      if (request?.root !== "/synthetic" || request.op !== "read" || request.path !== "benchmark.ts") return deny();
      return { content: 'export const benchmark = "Synthetic";\n', revision: "synthetic" };
    },
    updates: async request => {
      if (request?.op !== "status") return deny();
      return { phase: "idle", currentVersion: "synthetic", latestVersion: "", canInstall: false, error: "", reason: "", mode: "disabled" };
    },
  });
  Object.defineProperty(window, "hrig", { value: new Proxy(api, {
    get(target, key) { if (Object.hasOwn(target, key)) return target[key]; return deny(); },
    set: deny,
  }) });
  // No websocket, peer connection or beacon can escape the asset router.
  for (const name of ["WebSocket", "EventSource", "RTCPeerConnection"]) Object.defineProperty(window, name, { value: deny });
  if (window.navigator) Object.defineProperty(window.navigator, "sendBeacon", { value: deny });
}

const token = value => typeof value === "string" && /^[A-Za-z0-9._-]{1,80}$/.test(value) ? value : null;
function acceptedSample(sample) {
  if (!scenarios.includes(sample?.scenario)) return null;
  const result = {};
  for (const key of metricKeys) {
    const value = observeStartupDuration({ completed: false }, 0, sample?.[key]);
    if (value === null) return null;
    result[key] = value;
  }
  result.scenario = sample.scenario;
  // Fixed identifiers only; raw resource URLs never enter the report.
  result.readyPanels = ["editor", "settings"].filter(key => Array.isArray(sample.readyPanels) && sample.readyPanels.includes(key));
  result.moduleRequests = Object.fromEntries(["beforeActivation", "afterActivation"].map(stage =>
    [stage, ["editor", "settings"].filter(key => Array.isArray(sample.moduleRequests?.[stage]) && sample.moduleRequests[stage].includes(key))]));
  return result;
}

/** Reconstruct every output field; never spread input state, errors or environment. */
export function projectReport(input) {
  if (!input || typeof input !== "object") input = {};
  let status = ["available", "unavailable", "failed"].includes(input?.status) ? input.status : "failed";
  const samples = status === "available" && Array.isArray(input.samples) ? input.samples.map(acceptedSample).filter(Boolean) : [];
  if (status === "available" && !samples.length) status = "failed";
  const metrics = samples.length ? Object.fromEntries(metricKeys.map(key => {
    const values = samples.map(sample => sample[key]).sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    return [key, { min: values[0], max: values.at(-1), mean: values.reduce((a, b) => a + b, 0) / values.length,
      median: values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2 }];
  })) : null;
  return {
    status, reason: ["runtime-unavailable", "assets-unavailable", "invalid-input", "controlled-run-failed", "capability-denied", "asset-denied", "invalid-clock"].includes(input.reason) ? input.reason : null,
    candidate: { commit: /^[a-f0-9]{40}$/.test(input.candidate?.commit) ? input.candidate.commit : null, dirty: input.candidate?.dirty === true },
    artifact: /^[a-f0-9]{64}$/.test(input.artifact) ? input.artifact : null,
    environment: Object.fromEntries(["platform", "arch", "node", "browser"].map(key => [key, token(input.environment?.[key])])),
    method: "headless; fresh context per sample; shared OS cache; navigation-to-selector orchestration clock includes automation and asset routing; synthetic backend; not paint/native/backend/cold startup",
    units: "ms", sampleCount: samples.length, samples, metrics,
  };
}

async function candidateAssets() {
  const assets = new Map();
  const dist = path.join(root, "dist");
  if (!(await fs.lstat(dist)).isDirectory()) throw new Error("assets-unavailable");
  async function walk(directory, prefix = "") {
    for (const item of await fs.readdir(directory, { withFileTypes: true })) {
      const relative = `${prefix}/${item.name}`;
      if (item.isDirectory()) await walk(path.join(directory, item.name), relative);
      else if (item.isFile() && (relative === "/index.html" || relative === "/icon.svg" || relative.startsWith("/assets/")))
        assets.set(relative, await fs.readFile(path.join(directory, item.name)));
      else if (item.isFile() && relative === "/popout.html") continue; // known output, never served
      else throw new Error("assets-unavailable"); // includes symlinks
    }
  }
  await walk(dist);
  if (!assets.has("/index.html")) throw new Error("assets-unavailable");
  return assets;
}

async function defaultAdapter() {
  let chromium, browser;
  return {
    now: () => performance.now(),
    async availability() {
      try {
        ({ chromium } = await import("@playwright/test"));
        await fs.access(chromium.executablePath());
        return { available: true };
      } catch { return { available: false, reason: "runtime-unavailable" }; }
    },
    async createContext() {
      browser ||= await chromium.launch({ headless: true });
      return browser.newContext({ serviceWorkers: "block", acceptDownloads: false });
    },
    browserVersion: () => browser?.version(),
    async close() { await browser?.close(); },
  };
}

/** The same adapter/report protocol is used by CLI, tests and prohibition subjects. */
export async function runControlledRendererBenchmark(options = {}) {
  if (!options || typeof options !== "object") return projectReport({ status: "failed", reason: "invalid-input" });
  const adapter = options.adapter || await defaultAdapter();
  const result = { status: "unavailable", samples: [], candidate: options.candidate,
    environment: { platform: process.platform, arch: process.arch, node: process.versions.node } };
  let context;
  try {
    if (!result.candidate && !options.adapter) {
      result.candidate = { commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
        dirty: execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).length > 0 };
    }
    const count = options.samples === undefined ? 5 : options.samples;
    if (!Number.isInteger(count) || count < 1 || count > 20 || (options.scenario !== undefined && !scenarios.includes(options.scenario))) {
      result.reason = "invalid-input";
      return projectReport(result);
    }
    const availability = await adapter.availability();
    if (availability.available !== true) {
      result.reason = "runtime-unavailable";
      return projectReport(result);
    }
    let assets;
    try { assets = options.builtAssets || await candidateAssets(); }
    catch { result.reason = "assets-unavailable"; return projectReport(result); }
    const hash = createHash("sha256");
    for (const [name, body] of [...assets].sort(([a], [b]) => a.localeCompare(b))) hash.update(name).update("\0").update(body).update("\0");
    result.artifact = hash.digest("hex");
    for (const scenario of options.scenario ? [options.scenario] : scenarios) {
      for (let index = 0; index < count; index++) {
        let failure;
        const moduleRequests = new Set();
        const refuse = reason => { failure = reason; adapter.recordForbidden?.(reason); };
        context = await adapter.createContext();
        await context.addInitScript(syntheticPreload, { scenario });
        await context.routeWebSocket("**/*", socket => {
          refuse("capability-denied");
          socket.close();
        });
        await context.route("**/*", async route => {
          const request = route.request();
          const url = new URL(request.url());
          const body = assets.get(url.pathname);
          if (url.origin !== origin || url.search || url.hash || request.method() !== "GET" || !body ||
              !(url.pathname === "/index.html" || url.pathname === "/icon.svg" || /^\/assets\/[A-Za-z0-9_.-]+$/.test(url.pathname))) {
            refuse("asset-denied"); await route.abort(); return;
          }
          const extension = path.extname(url.pathname);
          if (/^\/assets\/EditorPanel-[A-Za-z0-9_-]+\.js$/.test(url.pathname)) moduleRequests.add("editor");
          if (/^\/assets\/SettingsPage-[A-Za-z0-9_-]+\.js$/.test(url.pathname)) moduleRequests.add("settings");
          const contentType = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".ttf": "font/ttf", ".svg": "image/svg+xml", ".png": "image/png" }[extension] || "application/octet-stream";
          await route.fulfill({ status: 200, contentType, body });
        });
        const page = await context.newPage();
        page.setDefaultTimeout(30000);
        page.on("pageerror", () => refuse("controlled-run-failed"));
        page.on("popup", () => refuse("capability-denied"));
        const measure = async action => {
          const observation = { completed: false };
          const start = adapter.now();
          await action();
          const duration = observeStartupDuration(observation, start, adapter.now());
          if (duration === null) throw new Error("invalid-clock");
          return duration;
        };
        const sample = { scenario, readyPanels: [], moduleRequests: {} };
        sample.workspaceReadyMs = await measure(async () => {
          await page.goto(`${origin}/index.html`);
          await page.locator('[data-workspace-model-ready="true"]').waitFor();
        });
        sample.moduleRequests.beforeActivation = [...moduleRequests];
        if (moduleRequests.size) throw new Error("controlled-run-failed");
        // The same real controls used by operators, with fixed synthetic identities.
        sample.editorOpenMs = await measure(async () => {
          if (scenario === "restored-hidden") await page.getByRole("tab", { name: "benchmark.ts", exact: true }).click();
          else {
            await page.getByRole("button", { name: "Explorer", exact: true }).click();
            await page.getByRole("button", { name: "benchmark.ts", exact: true }).click();
          }
          await page.locator(".monaco-editor .view-lines").first().waitFor();
        });
        sample.readyPanels.push("editor");
        sample.settingsOpenMs = await measure(async () => {
          await page.getByRole("button", { name: "Settings", exact: true }).click();
          await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();
        });
        sample.readyPanels.push("settings");
        sample.revisitMs = await measure(async () => {
          await page.getByRole("tab", { name: "benchmark.ts", exact: true }).click();
          await page.locator(".monaco-editor .view-lines").first().waitFor();
        });
        sample.moduleRequests.afterActivation = [...moduleRequests];
        if (page.evaluate && await page.evaluate(() => window.__hrigBenchmarkViolations.length)) refuse("capability-denied");
        if (failure) { result.reason = failure; throw new Error("controlled-run-failed"); }
        result.samples.push(sample);
        await context.close(); context = undefined;
      }
    }
    result.status = "available";
    result.environment.browser = adapter.browserVersion?.();
  } catch (error) {
    result.status = "failed";
    result.reason ||= error?.message === "invalid-clock" ? "invalid-clock" : "controlled-run-failed";
    result.samples = [];
  } finally {
    try { await context?.close(); await adapter.close?.(); } catch { result.status = "failed"; result.reason = "controlled-run-failed"; result.samples = []; }
  }
  return projectReport(result);
}
