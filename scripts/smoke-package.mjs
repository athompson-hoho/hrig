import { _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hrig-package-smoke-"));
const env = { ...process.env, HRIG_DATA_DIR: dir };
delete env.ELECTRON_RUN_AS_NODE;
let latest;
try {
  latest = JSON.parse(await fs.readFile("release/latest.json", "utf8"));
} catch {}
const app = await electron.launch({
  executablePath: path.resolve(
    process.argv[2] || latest?.executable || "release/win-unpacked/HRig.exe",
  ),
  env,
});
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "New panel", exact: true }).waitFor();
  await page.keyboard.press("Control+Shift+T");
  await page.locator(".xterm-helper-textarea").waitFor();
  await page.waitForFunction(() =>
    document.querySelector(".terminal-host")?.textContent?.includes("PS "),
  );
  await page.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type("Write-Output HRIG_PACKAGED_OK");
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () =>
      (
        document
          .querySelector(".terminal-host")
          ?.textContent?.match(/HRIG_PACKAGED_OK/g) || []
      ).length >= 2,
  );
  await page.getByRole("button", { name: "Explorer", exact: true }).click();
  await page.getByRole("button", { name: "README.md", exact: true }).click();
  await page
    .locator(".monaco-editor .view-lines")
    .filter({ hasText: "# HRig" })
    .first()
    .waitFor();
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Workspace tools" })
    .getByRole("button", { name: "Connection doctor", exact: false })
    .click();
  await page.getByText("Windows workspace", { exact: true }).waitFor();
  const gitStatus = await page.evaluate(
    (root) =>
      window.hrig.git(
        { id: "local", name: "Package Git check", kind: "local", root },
        root,
      ),
    process.cwd(),
  );
  if (
    typeof gitStatus.isRepository !== "boolean" ||
    !Array.isArray(gitStatus.entries)
  )
    throw new Error("Packaged Git status returned an incompatible response");
  if (errors.length) throw new Error(errors.join("\n"));
  const secure=await app.evaluate(({safeStorage})=>{
    if(!safeStorage.isEncryptionAvailable()) return false;
    return safeStorage.decryptString(safeStorage.encryptString('hrig-package-fixture'))==='hrig-package-fixture';
  });
  if(!secure)throw new Error('Packaged Windows secure storage roundtrip failed.');
  await page.evaluate(()=>{
    const put=window.hrig.drafts({op:'put',key:'package-fixture',value:{kind:'message',data:{message:'package fixture'}}});
    if(put.error)throw new Error(put.error);
    const list=window.hrig.drafts({op:'list'});
    if(list.result?.['package-fixture']?.data?.message!=='package fixture')throw new Error('Packaged draft roundtrip failed.');
    window.hrig.drafts({op:'delete',key:'package-fixture'});
  });
  await page.getByRole('button',{name:'Tools',exact:true}).click();
  await page.getByRole('dialog',{name:'Workspace tools'}).getByRole('button',{name:'Project boards and integrations',exact:false}).click();
  for(const title of ['Review agent changes','Verify issue imports','Plan the next milestone']){
    await page.getByRole('button',{name:'New task',exact:true}).click();
    await page.getByLabel('Issue title').fill(title);
    await page.getByLabel('Issue description').fill('Example project work. Assign deliberately to a selected OpenRig seat when ready.');
    await page.getByRole('button',{name:'Confirm create'}).click();
  }
  await page.getByRole('button',{name:/Review agent changes/}).click();
  await page.getByLabel('Work item status').selectOption('Doing');
  await page.getByRole('button',{name:'Review status change'}).click();
  await page.getByRole('button',{name:'Confirm status update'}).click();
  await page.getByRole('button',{name:/Review agent changes/}).waitFor();
  await fs.mkdir('release/previews',{recursive:true});
  await page.screenshot({path:'release/previews/packaged-task-boards.png'});
  await fs.mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/packaged.png" });
  console.log(
    "Packaged Windows app: renderer, preload, native PTY, bundled editor, doctor, Git, local boards, draft persistence and Windows secure storage passed.",
  );
} finally {
  await app.close();
  await fs.rm(dir, { recursive: true, force: true });
}
