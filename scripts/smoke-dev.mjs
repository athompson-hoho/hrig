import { createServer } from "vite";
import { _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hrig-dev-smoke-"));
const server = await createServer();
await server.listen();
const env = {
  ...process.env,
  HRIG_DATA_DIR: dir,
  HRIG_DEV_URL: "http://127.0.0.1:5179",
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ args: ["."], env });
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "New panel", exact: true }).waitFor();
  await page.keyboard.press("Control+k");
  await page
    .getByRole("textbox", { name: "Search commands and sessions" })
    .waitFor();
  await page.keyboard.type("New shell");
  if (
    (await page
      .getByRole("textbox", { name: "Search commands and sessions" })
      .inputValue()) !== "New shell"
  )
    throw new Error("Command input lost focus");
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    "Development app: Vite, React refresh CSP, preload and keyboard interaction passed.",
  );
} finally {
  if (app) await app.close();
  await server.close();
  await fs.rm(dir, { recursive: true, force: true });
}
