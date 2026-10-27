const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createWslFixture } = require("./wsl-fixture.cjs");
const features = require("../electron/features.cjs");
const core = require("../electron/core.cjs");
test(
  "rig design validates, preserves files and existing rigs, and launches only with confirmation; delete targets an exact ID and reports blocks",
  { skip: process.platform !== "win32", timeout: 120000 },
  async (t) => {
    const f = await createWslFixture();
    if (!f) return t.skip("No WSL installed");
    const { connection, root } = f;
    const draft = {
      op: "preview",
      name: "designed-team",
      goal: "Build a reliable tool. $HOME stays literal.",
      root,
      seats: [
        { id: "build", agentId: "implementer", runtime: "codex" },
        { id: "review", agentId: "reviewer", runtime: "claude-code" },
      ],
    };
    try {
      await assert.rejects(
        () => features.designRig(connection, { ...draft, name: "../bad" }),
        /lowercase/,
      );
      await assert.rejects(
        () => features.designRig(connection, { ...draft, name: "fixture" }),
        /already exists/,
      );
      await assert.rejects(
        () =>
          features.designRig(connection, {
            ...draft,
            op: "launch",
            confirmation: "wrong",
          }),
        /confirm/,
      );
      await assert.rejects(
        () =>
          features.designRig(connection, {
            ...draft,
            seats: [draft.seats[0], draft.seats[0]],
          }),
        /unique/,
      );
      await assert.rejects(
        () =>
          features.designRig(connection, {
            ...draft,
            seats: [{ ...draft.seats[0], agentId: "missing" }],
          }),
        /installed agent/,
      );
      const preview = await features.designRig(connection, draft);
      assert.equal(
        preview.spec.pods[0].members[0].agent_ref,
        "path:" + root + "/implementer",
      );
      assert.equal(preview.spec.summary, draft.goal);
      assert.equal(preview.result.preview, true);
      await features.designRig(connection, draft); // an identical preview is safe to retry
      await assert.rejects(
        () =>
          features.designRig(connection, { ...draft, goal: "Different goal" }),
        /exists/,
      );
      const saved = await features.edit(connection, {
        op: "read",
        root,
        path: "hrig-designed-team.yaml",
      });
      assert.equal(JSON.parse(saved.content).summary, draft.goal);
      await assert.rejects(
        () =>
          features.designRig(connection, {
            ...draft,
            op: "launch",
            confirmation: draft.name,
          }),
        /Preview/,
      );
      const revised = await features.designRig(connection, {
        ...draft,
        goal: "Revised goal",
        previewToken: preview.previewToken,
      });
      const launch = await features.designRig(connection, {
        ...draft,
        goal: "Revised goal",
        op: "launch",
        confirmation: draft.name,
        previewToken: revised.previewToken,
      });
      assert.equal(launch.result.preview, false);
      const retryDraft = {
        ...draft,
        name: "retry-team",
        designId: require("node:crypto").randomUUID(),
      };
      await features.edit(connection, {
        op: "create",
        root,
        path: "block-plan",
        content: "",
      });
      await assert.rejects(
        () => features.designRig(connection, retryDraft),
        /preflight blocked/,
      );
      await core.remote(connection, "rm " + core.quote(root + "/block-plan"));
      const retried = await features.designRig(connection, {
        ...retryDraft,
        goal: "Corrected after preflight",
      });
      assert.equal(retried.result.preview, true);
      const onDisk = await features.edit(connection, {
        op: "read",
        root,
        path: "hrig-retry-team.yaml",
      });
      await features.edit(connection, {
        op: "save",
        root,
        path: "hrig-retry-team.yaml",
        revision: onDisk.revision,
        content: "External edit",
      });
      await assert.rejects(
        () =>
          features.designRig(connection, {
            ...retryDraft,
            goal: "Must preserve external edit",
          }),
        /exists/,
      );
      await assert.rejects(
        () =>
          features.rigAction(connection, {
            op: "delete",
            name: "fixture",
            id: "test-rig",
            confirmation: "wrong",
          }),
        /confirm/,
      );
      await assert.rejects(
        () =>
          features.rigAction(connection, {
            op: "delete",
            name: "fixture",
            id: "another-rig",
            confirmation: "fixture",
          }),
        /changed/,
      );
      await features.edit(connection, {
        op: "create",
        root,
        path: "block-delete",
        content: "",
      });
      await assert.rejects(
        () =>
          features.rigAction(connection, {
            op: "delete",
            name: "fixture",
            id: "test-rig",
            confirmation: "fixture",
          }),
        /not fully delete/,
      );
      await core.remote(connection, "rm " + core.quote(root + "/block-delete"));
      const deleted = await features.rigAction(connection, {
        op: "delete",
        name: "fixture",
        id: "test-rig",
        confirmation: "fixture",
      });
      assert.equal(deleted.deleted, true);
      const actions = (
        await features.edit(connection, {
          op: "read",
          root,
          path: "actions.jsonl",
        })
      ).content
        .trim()
        .split("\n")
        .map(JSON.parse);
      assert.equal(
        actions.filter((a) => a[0] === "up" && !a.includes("--plan")).length,
        1,
      );
      assert.ok(
        actions
          .filter((a) => a[0] === "down")
          .every(
            (a) =>
              a[1] === "test-rig" &&
              a.includes("--delete") &&
              a.includes("--snapshot"),
          ),
      );
    } finally {
      await f.cleanup();
    }
  },
);
