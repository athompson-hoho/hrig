import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const { createWslFixture } = require("../wsl-fixture.cjs");
const features = require("../../electron/features.cjs");

test("all-command control center guides fields, explains options, binds reviews and runs literal argv and interactive output in a disposable WSL fixture", async () => {
  test.setTimeout(150000);
  test.skip(process.platform !== "win32");
  const fixture = await createWslFixture();
  test.skip(!fixture, "No WSL installed");
  const { connection, root } = fixture;
  const original = await features.edit(connection, {
    op: "read",
    root,
    path: "rig-fixture",
  });
  const addon = `
args=sys.argv[1:]
if '--help' in args:
 path=args[:-1]
 if path==[]: print('Usage: rig [options] [command]\\n\\nFixture control plane\\n\\nOptions:\\n  -V, --version  Version\\n  -h, --help     Help\\n\\nCommands:\\n  status [options]  Read fixture status\\n  send [options] <session> <text>  Send fixture message\\n  restore [options]  Restore fixture state\\n  scope  Scope tools')
 elif path==['send']: print('Usage: rig send [options] <session> <text>\\n\\nSend fixture message\\n\\nArguments:\\n  session  Exact fixture session\\n  text     Literal message text\\n\\nOptions:\\n  --no-enter  Do not press Enter\\n  -h, --help  Help')
 elif path==['status']: print('Usage: rig status [options]\\n\\nRead fixture status\\n\\nOptions:\\n  --interactive  Wait for input\\n  --json         Return JSON\\n  -h, --help     Help')
 elif path==['restore']: print('Usage: rig restore [options] [command]\\n\\nRestore fixture state\\n\\nOptions:\\n  -h, --help  Help\\n\\nDirect restore: rig restore <snapshotId> --rig <rigId>')
 elif path==['scope']: print('Usage: rig scope [options] [command]\\n\\nScope tools\\n\\nOptions:\\n  --workspace <path>  Root workspace directory\\n  -h, --help          Help\\n\\nCommands:\\n  show [options] <name>  Inspect a scope')
 elif path==['scope','show']: print('Usage: rig scope show [options] <name>\\n\\nInspect a scope\\n\\nArguments:\\n  name  Exact scope name\\n\\nOptions:\\n  --json  Return JSON\\n  -h, --help  Help')
 else: raise RuntimeError('Unknown fixture help')
 sys.exit(0)
if args and args[0] in ('status','send','scope'):
 with open(root+'/control-actions.jsonl','a') as f: f.write(json.dumps(args)+'\\n')
 if '--interactive' in args:
  print('Terminal fixture ready',flush=True)
  print('interactive echo: '+sys.stdin.readline().strip(),flush=True)
 else:
  if args[0]=='send': print('Fixture advisory: no live message sent',file=sys.stderr)
  print(json.dumps({'argv':args,'cwd':os.getcwd()}))
 sys.exit(0)
`;
  await features.edit(connection, {
    op: "save",
    root,
    path: "rig-fixture",
    revision: original.revision,
    content: original.content.replace(
      "root=os.path.dirname(__file__)",
      "root=os.path.dirname(__file__)\n" + addon,
    ),
  });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hrig-control-ui-"));
  await fs.writeFile(
    path.join(dir, "workspace.json"),
    JSON.stringify({
      version: 1,
      connections: [connection],
      activeConnection: connection.id,
      roots: { [connection.id]: root },
      layouts: {},
      savedLayouts: [],
    }),
  );
  const env = { ...process.env, HRIG_DATA_DIR: dir };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "Tools", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Workspace tools" })
      .getByRole("button", { name: /OpenRig control center/ })
      .click();
    const panel = page.getByRole("region", {
      name: "OpenRig control center",
      exact: true,
    });
    await expect(panel.getByLabel("Installed actions")).toContainText(
      "Send fixture message",
      { timeout: 20000 },
    );
    await panel.getByLabel("Find OpenRig action").fill("restore status");
    await expect(panel.getByLabel("Command search results")).toContainText(
      "restore",
    );
    await panel.getByLabel("Find OpenRig action").fill("");
    await panel
      .getByLabel("Installed actions")
      .getByRole("button")
      .filter({ hasText: "Send fixture message" })
      .click();
    await expect(panel.getByLabel("session", { exact: true })).toHaveAttribute(
      "title",
      "Exact fixture session",
    );
    await panel
      .getByRole("button", { name: "Review action", exact: true })
      .click();
    await expect(panel).toContainText("Enter session.");
    const literal =
      "literal $HOME; $(touch /tmp/never-run) 'quoted'\nsecond line";
    await panel.getByLabel("session", { exact: true }).fill("fixture-seat");
    const message = literal;
    await panel.getByLabel("text", { exact: true }).fill(message);
    await panel.getByText(/^Options \(/).click();
    await panel.getByLabel("Enable --no-enter", { exact: true }).check();
    await panel.getByText("Help for --no-enter", { exact: true }).click();
    await expect(panel).toContainText("Do not press Enter");
    await panel
      .getByRole("button", { name: "Review action", exact: true })
      .click();
    const review = panel.getByRole("region", { name: "Review OpenRig action" });
    await expect(review).toContainText("fixture-seat", { timeout: 20000 });
    await review.getByLabel("Confirm OpenRig action").fill("wrong");
    await expect(
      review.getByRole("button", { name: "Run reviewed action", exact: true }),
    ).toBeDisabled();
    await panel.getByLabel("text", { exact: true }).fill(message + " changed");
    await expect(review).toHaveCount(0);
    await panel
      .getByRole("button", { name: "Review action", exact: true })
      .click();
    await review
      .getByLabel("Confirm OpenRig action")
      .fill("rig send", { timeout: 20000 });
    await review
      .getByRole("button", { name: "Run reviewed action", exact: true })
      .click();
    await expect(
      panel.getByRole("region", { name: "OpenRig result" }),
    ).toContainText("argv", { timeout: 20000 });
    await expect(
      panel
        .getByRole("region", { name: "OpenRig result" })
        .getByText("Raw command output", { exact: true }),
    ).toBeVisible();
    expect(
      JSON.parse(
        (await panel
          .getByRole("region", { name: "OpenRig result" })
          .locator("pre")
          .textContent())!,
      ).argv,
    ).toEqual(["send", "--no-enter", "fixture-seat", message + " changed"]);
    await expect(
      panel.getByRole("status", { name: "OpenRig warnings" }),
    ).toContainText("Fixture advisory: no live message sent");
    expect(
      JSON.parse(
        (await panel
          .getByRole("region", { name: "OpenRig result" })
          .locator("pre")
          .textContent())!,
      ).cwd,
    ).toBe(root);
    await expect(review).toHaveCount(0);
    const actions = (
      await features.edit(connection, {
        op: "read",
        root,
        path: "control-actions.jsonl",
      })
    ).content
      .trim()
      .split("\n")
      .map(JSON.parse);
    expect(actions).toEqual([
      ["send", "--no-enter", "fixture-seat", message + " changed"],
    ]);
    await panel
      .getByRole("button", { name: "All commands", exact: true })
      .click();
    await panel
      .getByLabel("Installed actions")
      .getByRole("button")
      .filter({ hasText: "Restore fixture state" })
      .click();
    await expect(panel.getByLabel("snapshotId", { exact: true })).toBeVisible({
      timeout: 20000,
    });
    await panel.getByText(/^Options \(/).click();
    await expect(
      panel.getByLabel("Enable --rig", { exact: true }),
    ).toBeChecked();
    await expect(
      panel.getByLabel("Value for --rig", { exact: true }),
    ).toBeVisible();
    await panel
      .getByRole("button", { name: "All commands", exact: true })
      .click();
    await panel
      .getByLabel("Installed actions")
      .getByRole("button")
      .filter({ hasText: "Read fixture status" })
      .click();
    await panel.getByText(/^Options \(/).click();
    await panel.getByLabel("Enable --interactive", { exact: true }).check();
    await panel.getByLabel("Run in terminal", { exact: true }).check();
    await page.evaluate(() => {
      (window as any).controlOutput = "";
      (window as any).controlTerminal = "";
      window.hrig.onTerminal((e) => {
        if (e.data) {
          (window as any).controlOutput += e.data;
          (window as any).controlTerminal = e.id;
        }
      });
    });
    await panel
      .getByRole("button", { name: "Review action", exact: true })
      .click();
    await review
      .getByLabel("Confirm OpenRig action")
      .fill("rig status", { timeout: 20000 });
    await review
      .getByRole("button", { name: "Run reviewed action", exact: true })
      .click();
    await expect
      .poll(() => page.evaluate(() => (window as any).controlOutput), {
        timeout: 20000,
      })
      .toContain("Terminal fixture ready");
    await page.evaluate(() =>
      window.hrig.writeTerminal((window as any).controlTerminal, "hello\r"),
    );
    await expect
      .poll(() => page.evaluate(() => (window as any).controlOutput), {
        timeout: 10000,
      })
      .toContain("interactive echo: hello");
    await expect(
      panel
        .getByRole("region", { name: "OpenRig action terminal" })
        .getByRole("button", { name: "Reconnect terminal", exact: true }),
    ).toHaveCount(0);
    await page.screenshot({
      path: "release/previews/rig-control-terminal.png",
    });
    await panel
      .getByRole("button", { name: "Close action terminal", exact: true })
      .click();
    await expect(
      panel.getByRole("region", { name: "OpenRig action terminal" }),
    ).toHaveCount(0);
    await page.setViewportSize({ width: 800, height: 900 });
    await expect
      .poll(() => panel.evaluate((el) => el.scrollWidth <= el.clientWidth))
      .toBe(true);
  } finally {
    await app.close();
    await fixture.cleanup();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
