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
      await features.edit(connection, {
        op: "create",
        root,
        path: "package.json",
        content: JSON.stringify({
          dependencies: { react: "1.0" },
          scripts: { test: "PRIVATE_COMMAND_DO_NOT_COLLECT" },
          privateToken: "PRIVATE_TOKEN_DO_NOT_COLLECT",
        }),
      });
      const brief = await features.assessTeam(connection, {
        op: "brief",
        root,
        goal: draft.goal,
        constraints: "Two active seats",
        work: "Build",
      });
      assert.match(brief.prompt, /logicalCpus/);
      assert.match(brief.prompt, /Two active seats/);
      assert.match(brief.prompt, /dependencyNames/);
      assert.match(brief.prompt, /react/);
      assert.doesNotMatch(
        brief.prompt,
        /PRIVATE_COMMAND_DO_NOT_COLLECT|PRIVATE_TOKEN_DO_NOT_COLLECT/,
      );
      const assessment = await features.assessTeam(connection, {
        op: "import",
        content: JSON.stringify({
          proposals: ["lean", "balanced", "throughput"].map((tier) => ({
            tier,
            rationale: "Independent verification",
            workflow: "Build then review",
            uncertainty: "Deployment unknown",
            concurrency: 2,
            seats: draft.seats,
          })),
        }),
      });
      assert.equal(assessment.proposals.length, 3);
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
      const handoff = {
        mission: "Implement the change",
        boundaries: "Only assigned scope",
        expectedOutput: "Diff and test evidence",
        handoff: "Ask reviewer to verify before completion",
      };
      const planned = await features.designRig(connection, {
        ...draft,
        name: "handoff-team",
        seats: [{ ...draft.seats[0], firstHandoff: handoff }, draft.seats[1]],
      });
      assert.match(planned.spec.summary, /Mission: Implement the change/);
      assert.match(planned.spec.summary, /Ask reviewer to verify/);
      await assert.rejects(
        () =>
          features.designRig(connection, {
            ...draft,
            op: "launch",
            confirmation: draft.name,
            previewToken: preview.previewToken,
            seats: [
              { ...draft.seats[0], firstHandoff: handoff },
              draft.seats[1],
            ],
          }),
        /Preview this exact design/,
      );
      assert.equal(
        preview.spec.pods[0].members[0].agent_ref,
        "path:" + root + "/implementer",
      );
      assert.equal(preview.spec.summary, draft.goal);
      assert.equal(preview.spec.permission_policy, undefined);
      await assert.rejects(()=>features.designRig(connection,{...draft,op:"launch",confirmation:draft.name,previewToken:preview.previewToken,yolo:true}),/Preview this exact design/);
      await assert.rejects(()=>features.designRig(connection,{...draft,yolo:"yes"}),/boolean/);
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
      const yoloDesign = await features.designRig(connection,{...draft,yolo:true,previewToken:preview.previewToken});
      assert.equal(yoloDesign.spec.permission_policy,"builtin:yolo");
      await assert.rejects(()=>features.designRig(connection,{...draft,op:"launch",confirmation:draft.name,previewToken:yoloDesign.previewToken,yolo:false}),/Preview this exact design/);
      const restored = await features.designRig(connection,{...draft,yolo:false,previewToken:yoloDesign.previewToken});
      assert.equal(restored.spec.permission_policy,undefined);
      const revised = await features.designRig(connection, {
        ...draft,
        goal: "Revised goal",
        previewToken: restored.previewToken,
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
