import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const { createWslFixture } = require("../wsl-fixture.cjs");
test("guided designer saves, revises and previews before launch; deletion requires the exact name", async () => {
  test.setTimeout(180000);
  test.skip(process.platform !== "win32");
  const fixture = await createWslFixture();
  test.skip(!fixture, "No WSL installed");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hrig-designer-ui-"));
  const c = fixture.connection;
  await fs.writeFile(
    path.join(dir, "workspace.json"),
    JSON.stringify({
      version: 1,
      connections: [c],
      activeConnection: c.id,
      roots: {},
      activeRig: "test-rig",
      layouts: {},
      savedLayouts: [],
    }),
  );
  const env = { ...process.env, HRIG_DATA_DIR: dir };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ["."], env });
  try {
    await app.evaluate((_electron, corePath) => {
      const core = (process as any).mainModule.require(corePath);
      const original = core.remote;
      core.remote = async (connection: any, command: string, options: any) => {
        let request: any;
        try {
          request = JSON.parse(options?.input || "null");
        } catch {}
        if (request?.op === "providers")
          return JSON.stringify({
            providers: [
              { id: "codex", installed: true, status: "authenticated" },
              { id: "claude-code", installed: false, status: "missing" },
            ],
          });
        if (request?.op === "run" && request.prompt) {
          if (
            request.prompt.includes('"priority":"lower-usage"') &&
            (!request.prompt.includes('"protectedSeatIds":["lead"]') ||
              !request.prompt.includes(
                '"id":"lead","agentId":"implementer","runtime":"claude-code"',
              ))
          )
            throw new Error("Tuning omitted the manually edited team");
          if (
            !request.prompt.includes(
              '"answer":"Production; require independent review"',
            )
          )
            return JSON.stringify({
              content: JSON.stringify({
                questions: [
                  {
                    id: "production",
                    question: "Is this production?",
                    impact: "Changes independent verification requirements",
                  },
                ],
                proposals: [],
              }),
            });
          return JSON.stringify({
            content: JSON.stringify({
              proposals: ["lean", "balanced", "throughput"].map((tier) => ({
                tier,
                rationale: "Independent review protects production changes.",
                workflow: "Implement, review, then verify.",
                uncertainty: "Deployment target is unspecified.",
                concurrency: 2,
                evidence: [
                  {
                    source: "host",
                    observation:
                      "CPU metadata was supplied; inference: use a pair.",
                  },
                ],
                seats: [
                  {
                    id: "owner",
                    agentId: "implementer",
                    runtime: "codex",
                    firstHandoff: {
                      mission: "Implement the scoped feature",
                      boundaries:
                        "Only assigned modules; escalate interface changes",
                      expectedOutput: "Diff and test evidence",
                      handoff:
                        "Send diff and test results to checker before completion",
                    },
                  },
                  {
                    id: "checker",
                    agentId: "reviewer",
                    runtime: request.prompt.includes('"priority":"lower-usage"')
                      ? "codex"
                      : "claude-code",
                  },
                ],
              })),
            }),
          });
        }
        return original(connection, command, options);
      };
    }, path.resolve("electron/core.cjs"));
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "Tools", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Workspace tools" })
      .getByRole("button", { name: "Rig manager", exact: false })
      .click();
    await expect(
      page.getByRole("button", { name: "Delete fixture", exact: true }),
    ).toBeVisible({ timeout: 20000 });
    await page
      .getByRole("button", { name: "Design a new rig", exact: true })
      .click();
    const wizard = page.getByRole("region", { name: "Rig designer" });
    await app.evaluate(({ app }) => {
      const accounts = (process as any).mainModule.require(app.getAppPath() + '/electron/accounts.cjs');
      accounts.discover = async () => ({providers:[{id:'codex',installed:true,status:'authenticated'},{id:'claude-code',installed:true,status:'authenticated'}],accounts:[{id:'demo',runtime:'codex',label:'QA managed account',scope:'host',hostMatch:false}],checkedAt:Date.now(),scope:'Fixture WSL',warning:'',orcaStatus:'available',contextStatus:'Per-session context usage unavailable'});
    });
    await expect(wizard.getByLabel('New rig name',{exact:true})).toBeVisible();
    await page.getByRole('button', {name:/^Accounts:/}).click();
    const accountPanel=page.getByRole('dialog',{name:'Available accounts'});
    await accountPanel.getByRole('button',{name:'Refresh accounts'}).click();
    await expect(accountPanel).toContainText('QA managed account');
    await expect(accountPanel).toContainText('Not available on the selected host');
    await expect(accountPanel).toContainText('Per-session context usage unavailable');
    await fs.mkdir('release/previews',{recursive:true});
    await page.screenshot({path:'release/previews/accounts.png',animations:'disabled'});
    await accountPanel.getByRole('button',{name:'Close',exact:true}).click();
    await wizard.getByText(/Available accounts on/).click();
    await wizard.getByRole('button',{name:'Refresh accounts',exact:true}).click();
    await expect(wizard).toContainText('claude-code: authenticated');
    await wizard.getByLabel('New rig name',{exact:true}).fill('new-team');
    await expect(wizard.getByLabel('Rig goal',{exact:true})).toHaveValue('');
    await wizard.getByRole('button',{name:'Recommend a team',exact:true}).click();
    await expect(wizard.getByLabel('Seat 1 runtime',{exact:true})).toHaveValue('codex');
    await expect(wizard.getByLabel('Seat 2 runtime',{exact:true})).toHaveValue('claude-code');
    await wizard.getByRole('button',{name:'Back to needs',exact:true}).click();
    await expect(wizard.getByLabel('Rig goal',{exact:true})).toHaveValue(/Implement and review/);

    await wizard
      .getByRole("textbox", { name: "New rig name", exact: true })
      .fill("new-team");
    await wizard
      .getByRole("textbox", { name: "Rig goal", exact: true })
      .fill("Build a reliable project");
    await expect(
      wizard.getByRole("radio", { name: /Build or change software/ }),
    ).toBeChecked();
    await expect(wizard.getByRole("radio", { name: /Pair/ })).toBeChecked();
    await wizard
      .getByLabel("Designer project folder", { exact: true })
      .fill(fixture.root);
    await wizard.getByText("Design a team with AI", { exact: true }).click();
    await wizard
      .getByLabel("Team assessment constraints")
      .fill("Production service; at most two active seats");
    await wizard
      .getByRole("button", { name: "Build assessment brief", exact: true })
      .click();
    const prompt = wizard.getByLabel("Team assessment prompt", { exact: true });
    await expect(prompt).toHaveValue(/logicalCpus/, { timeout: 30000 });
    await expect(prompt).toHaveValue(
      /Production service; at most two active seats/,
    );
    await expect(prompt).toHaveValue(/launches every seat together/);
    await wizard
      .getByLabel("Team assessment response")
      .fill('{"proposals":[]}');
    await wizard
      .getByRole("button", { name: "Compare proposals", exact: true })
      .click();
    await expect(wizard).toContainText(
      "Include lean, balanced and throughput proposals.",
      { timeout: 20000 },
    );
    await expect(
      wizard.getByRole("button", { name: "Use balanced team" }),
    ).toHaveCount(0);
    await wizard
      .getByLabel("Team assessment constraints")
      .fill("Production service; two active seats; independent review");
    await expect(prompt).toHaveCount(0);
    await expect(wizard).toContainText("Project details changed.");
    await wizard
      .getByRole("button", { name: "Build assessment brief", exact: true })
      .click();
    await expect(prompt).toHaveValue(/independent review/, { timeout: 30000 });
    await wizard.getByLabel("Team assessment response").fill(
      JSON.stringify({
        proposals: ["lean", "balanced", "throughput"].map((tier) => ({
          tier,
          rationale: "Independent review protects production changes.",
          workflow: "Implement, review, then verify.",
          uncertainty: "Deployment target is unspecified.",
          concurrency: 2,
          seats: [
            { id: "owner", agentId: "implementer", runtime: "codex" },
            { id: "checker", agentId: "reviewer", runtime: "claude-code" },
          ],
        })),
      }),
    );
    await wizard
      .getByRole("button", { name: "Compare proposals", exact: true })
      .click();
    await expect(
      wizard.getByRole("button", { name: "Use balanced team" }),
    ).toBeVisible({ timeout: 20000 });
    await expect(wizard.getByRole("article")).toHaveCount(3);
    await wizard
      .getByRole("article")
      .nth(1)
      .getByText("First handoff for owner", { exact: true })
      .click();
    await expect(wizard.getByRole("article").nth(1)).toContainText(
      "No handoff plan supplied.",
    );
    await wizard
      .getByRole("button", { name: "Assess with provider", exact: true })
      .click();
    await expect(
      wizard.getByLabel("Is this production?", { exact: true }),
    ).toBeVisible({ timeout: 30000 });
    await expect(wizard).toContainText(
      "Changes independent verification requirements",
    );
    await wizard
      .getByLabel("Is this production?", { exact: true })
      .fill("Production; require independent review");
    await wizard
      .getByRole("button", { name: "Assess with provider", exact: true })
      .click();
    await expect(
      wizard.getByRole("button", { name: "Use balanced team" }),
    ).toBeVisible({ timeout: 30000 });
    await wizard
      .getByText("Evidence reported by the provider", { exact: true })
      .nth(1)
      .click();
    await expect(wizard).toContainText(
      "CPU metadata was supplied; inference: use a pair.",
    );
    await wizard
      .getByRole("article")
      .nth(1)
      .getByText("First handoff for owner", { exact: true })
      .click();
    await expect(wizard.getByRole("article").nth(1)).toContainText(
      "Implement the scoped feature",
    );
    await page.screenshot({
      path: "release/previews/rig-designer-ai-proposals.png",
    });
    await page.screenshot({ path: "release/previews/rig-designer-needs.png" });
    await wizard
      .getByRole("button", { name: "Use balanced team", exact: true })
      .click();
    const comparison = wizard.getByRole("region", {
      name: "Review balanced team changes",
      exact: true,
    });
    await expect(comparison).toContainText("2 added");
    await expect(wizard.getByLabel("Seat 1 name", { exact: true })).toHaveCount(
      0,
    );
    await comparison
      .getByRole("button", { name: "Cancel comparison", exact: true })
      .click();
    await expect(comparison).toHaveCount(0);
    await wizard
      .getByRole("button", { name: "Use balanced team", exact: true })
      .click();
    await comparison
      .getByRole("button", { name: "Apply balanced team", exact: true })
      .click();
    await expect(wizard).toContainText(
      "Independent review protects production changes.",
    );
    await expect(wizard.getByLabel("Seat 1 name", { exact: true })).toHaveValue(
      "owner",
    );
    await expect(
      wizard.getByLabel("Seat 2 runtime", { exact: true }),
    ).toHaveValue("claude-code");
    await expect(
      wizard.getByLabel("Seat 1 agent", { exact: true }),
    ).toHaveValue("implementer");
    await expect(
      wizard.getByLabel("Seat 2 agent", { exact: true }),
    ).toHaveValue("reviewer");
    await wizard.getByText("First handoff for owner", { exact: true }).click();
    await wizard.getByLabel("owner Mission", { exact: true }).fill("");
    await expect(
      wizard.getByRole("button", { name: "Review design", exact: true }),
    ).toBeDisabled();
    await wizard
      .getByLabel("owner Mission", { exact: true })
      .fill("Implement the scoped feature with regression tests");
    await wizard.getByLabel("Seat 1 name", { exact: true }).fill("lead");
    await wizard
      .getByLabel("Seat 1 runtime", { exact: true })
      .selectOption("claude-code");
    await expect(
      wizard.getByRole("button", {
        name: "Allow AI changes for lead",
        exact: true,
      }),
    ).toBeVisible();
    await wizard
      .getByRole("radio", { name: "Lower usage", exact: true })
      .check();
    await wizard
      .getByRole("button", { name: "Build assessment brief", exact: true })
      .click();
    await expect(
      wizard.getByLabel("Team assessment prompt", { exact: true }),
    ).toHaveValue(/"priority":"lower-usage"/, { timeout: 30000 });
    await expect(
      wizard.getByLabel("Team assessment prompt", { exact: true }),
    ).toHaveValue(/"protectedSeatIds":\["lead"\]/);
    await wizard
      .getByRole("button", { name: "Assess with provider", exact: true })
      .click();
    await expect(
      wizard.getByRole("button", { name: "Use balanced team", exact: true }),
    ).toBeVisible({ timeout: 30000 });
    await wizard
      .getByRole("button", { name: "Use balanced team", exact: true })
      .click();
    await expect(comparison).toContainText("1 changed");
    await expect(comparison).toContainText("Protected edits retained: lead");
    await expect(comparison).toContainText("checker — Changed");
    await wizard.getByLabel("Seat 1 name", { exact: true }).fill("lead-temp");
    await expect(comparison).toHaveCount(0);
    await expect(
      wizard.getByRole("button", { name: "Apply balanced team", exact: true }),
    ).toHaveCount(0);
    await wizard.getByLabel("Seat 1 name", { exact: true }).fill("lead");
    await wizard
      .getByRole("button", { name: "Use balanced team", exact: true })
      .click();
    await expect(
      wizard.getByLabel("Seat 2 runtime", { exact: true }),
    ).toHaveValue("claude-code");
    await page.setViewportSize({ width: 800, height: 900 });
    await expect
      .poll(() => comparison.evaluate((el) => el.scrollWidth <= el.clientWidth))
      .toBe(true);
    await page.screenshot({
      path: "release/previews/rig-designer-reassessment-review.png",
    });
    await page.setViewportSize({ width: 1510, height: 980 });
    await comparison
      .getByRole("button", { name: "Apply balanced team", exact: true })
      .click();
    await expect(
      wizard.getByLabel("Seat 2 runtime", { exact: true }),
    ).toHaveValue("codex");
    await expect(wizard.getByLabel("Seat 1 name", { exact: true })).toHaveValue(
      "lead",
    );
    await expect(
      wizard.getByLabel("Seat 1 runtime", { exact: true }),
    ).toHaveValue("claude-code");
    await wizard.getByText("First handoff for lead", { exact: true }).click();
    await expect(
      wizard.getByLabel("lead Mission", { exact: true }),
    ).toHaveValue("Implement the scoped feature with regression tests");
    await wizard
      .getByRole("button", { name: "Allow AI changes for lead", exact: true })
      .click();
    await expect(
      wizard.getByRole("button", {
        name: "Allow AI changes for lead",
        exact: true,
      }),
    ).toHaveCount(0);
    await wizard
      .getByLabel("Seat 1 runtime", { exact: true })
      .selectOption("codex");
    await wizard
      .getByLabel("Seat 1 runtime", { exact: true })
      .selectOption("claude-code");
    await expect(
      wizard.getByRole("button", {
        name: "Allow AI changes for lead",
        exact: true,
      }),
    ).toBeVisible();
    await page.screenshot({ path: "release/previews/rig-designer-team.png" });
    await wizard
      .getByRole("button", { name: "Review design", exact: true })
      .click();
    const handoffReview = wizard.getByRole("region", {
      name: "First-handoff review",
    });
    await handoffReview
      .getByText("First handoff for lead", { exact: true })
      .click();
    await expect(handoffReview).toContainText(
      "Implement the scoped feature with regression tests",
    );
    await expect(
      wizard.getByRole("button", { name: "Launch designed rig" }),
    ).toHaveCount(0);
    await wizard
      .getByRole("button", { name: "Save and preview design", exact: true })
      .click();
    await expect(
      wizard.getByRole("button", { name: "Launch designed rig", exact: true }),
    ).toBeDisabled({ timeout: 20000 });
    await page.screenshot({ path: "release/previews/rig-designer-review.png" });
    await page.setViewportSize({ width: 800, height: 900 });
    await expect
      .poll(() => wizard.evaluate((el) => el.scrollWidth <= el.clientWidth))
      .toBe(true);
    await page.screenshot({ path: "release/previews/rig-designer-narrow.png" });
    await page.setViewportSize({ width: 1510, height: 980 });
    await wizard
      .getByRole("button", { name: "Back to team", exact: true })
      .click();
    await wizard
      .getByLabel("Seat 2 runtime", { exact: true })
      .selectOption("claude-code");
    await wizard
      .getByRole("button", { name: "Review design", exact: true })
      .click();
    await expect(
      wizard.getByRole("textbox", {
        name: "Confirm new rig name",
        exact: true,
      }),
    ).toHaveCount(0);
    await wizard
      .getByRole("button", { name: "Save and preview design", exact: true })
      .click();
    await wizard
      .getByRole("textbox", { name: "Confirm new rig name", exact: true })
      .fill("new-team", { timeout: 20000 });
    await wizard
      .getByRole("button", { name: "Launch designed rig", exact: true })
      .click();
    await expect(wizard.getByRole("status")).toContainText("Rig launched", {
      timeout: 20000,
    });
    await page
      .getByRole("button", { name: "Close rig designer", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Delete fixture", exact: true })
      .click();
    const deletion = page.getByRole("region", {
      name: "Delete rig confirmation",
    });
    await expect(deletion).toContainText("test-rig");
    await expect(deletion).toContainText("builder");
    await expect(
      deletion.getByRole("button", {
        name: "Delete rig permanently",
        exact: true,
      }),
    ).toBeDisabled();
    await deletion
      .getByRole("textbox", { name: "Confirm deletion name", exact: true })
      .fill("wrong");
    await expect(
      deletion.getByRole("button", {
        name: "Delete rig permanently",
        exact: true,
      }),
    ).toBeDisabled();
    await deletion
      .getByRole("button", { name: "Cancel deletion", exact: true })
      .click();
    await expect(deletion).toHaveCount(0);
    await page
      .getByRole("button", { name: "Delete fixture", exact: true })
      .click();
    await deletion
      .getByRole("textbox", { name: "Confirm deletion name", exact: true })
      .fill("fixture");
    await deletion
      .getByRole("button", { name: "Delete rig permanently", exact: true })
      .click();
    await expect(deletion).toHaveCount(0, { timeout: 20000 });
    const core = require("../../electron/features.cjs");
    const actions = (
      await core.edit(c, {
        op: "read",
        root: fixture.root,
        path: "actions.jsonl",
      })
    ).content
      .trim()
      .split("\n")
      .map(JSON.parse);
    expect(actions.filter((a: string[]) => a[0] === "down")).toEqual([
      ["down", "test-rig", "--delete", "--snapshot", "--json"],
    ]);
    expect(
      actions.filter((a: string[]) => a[0] === "up" && !a.includes("--plan")),
    ).toHaveLength(1);
  } finally {
    await app.close();
    await fixture.cleanup();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
