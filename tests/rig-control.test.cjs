const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  parseHelp,
  buildArgs,
  createRigControl,
} = require("../electron/rig-control.cjs");
const rootHelp = `Usage: rig [options] [command]

OpenRig fixture

Options:
  -V, --version  Version
  -h, --help     Help

Commands:
  scope         Work scope
  send          Message an agent
  restore       Restore snapshot
  help [cmd]    Help
`;
const scopeHelp = `Usage: rig scope [options] [command]

Work scope

Options:
  --workspace <path>  Workspace root
  -h, --help          Help

Commands:
  show [options] <name>  Show scope
`;
const showHelp = `Usage: rig scope show [options] <name>

Show one scope

Arguments:
  name  Exact scope name

Options:
  --json          Return JSON
  --limit <n>     Bound rows (default: 10)
  --output [dir]  Optional output directory
  -h, --help      Help
`;
const sendHelp = `Usage: rig send [options] [session] [text]

Send a message

Options:
  --body <text>       Message text
  --context <path>    Context pack (repeatable)
  --tags <names...>   Names
  --no-enter         Do not press Enter
  -h, --help          Help
`;
test("installed help produces argument, boolean, optional, variadic and wrapped help fields", () => {
  const schema = parseHelp(showHelp, ["scope", "show"]);
  assert.equal(schema.arguments[0].required, true);
  assert.equal(schema.arguments[0].description, "Exact scope name");
  assert.equal(
    schema.options.find((o) => o.flag === "--output").optionalValue,
    true,
  );
  assert.equal(
    parseHelp(sendHelp, ["send"]).options.find((o) => o.flag === "--tags")
      .variadic,
    true,
  );
  assert.equal(parseHelp(rootHelp).commands.length, 3);
  assert.throws(() => parseHelp("Daemon not responding"), /supported help/);
});
test("command builder preserves literal messages and repeats while rejecting unknown controls and argument injection", () => {
  const schema = parseHelp(sendHelp, ["send"]);
  const text = "literal $HOME; $(touch /tmp/never) 'quoted'\nline two";
  assert.deepEqual(
    buildArgs(schema, {
      values: { session: "seat", text },
      options: {
        "--body": text,
        "--context": ["one", "two"],
        "--no-enter": true,
      },
    }),
    [
      "send",
      "--body=" + text,
      "--context=one",
      "--context=two",
      "--no-enter",
      "seat",
      text,
    ],
  );
  assert.throws(
    () => buildArgs(schema, { options: { "--unknown": true } }),
    /does not support/,
  );
  assert.throws(
    () => buildArgs(schema, { values: { text: "late optional" } }),
    /earlier optional/,
  );
  assert.deepEqual(
    buildArgs(schema, { values: { session: "seat", text: "--all" } }),
    ["send", "--", "seat", "--all"],
  );
  assert.throws(
    () => buildArgs(parseHelp(showHelp, ["scope", "show"]), {}),
    /Enter name/,
  );
});
test("advertised direct restore has a required snapshot and target without inventing options", () => {
  const schema = parseHelp(
    "Usage: rig restore [options] [command]\n\nRestore\n\nOptions:\n  -h, --help  Help\n\nDirect restore: rig restore <snapshotId> --rig <rigId>\n",
    ["restore"],
  );
  assert.throws(
    () => buildArgs(schema, { values: { snapshotId: "snap" } }),
    /required --rig/,
  );
  assert.deepEqual(
    buildArgs(schema, {
      values: { snapshotId: "snap" },
      options: { "--rig": "target" },
    }),
    ["restore", "--rig=target", "snap"],
  );
});
test("control center validates the host tree, orders inherited options, and binds single-use execution to exact reviewed inputs", async () => {
  const calls = [];
  const runRig = async (c, args, timeout, root) => {
    calls.push(args);
    if (args.at(-1) === "--help")
      return args.length === 1
        ? rootHelp
        : args[0] === "scope"
          ? args.length === 2
            ? scopeHelp
            : showHelp
          : sendHelp;
    return JSON.stringify({ args, root });
  };
  const service = createRigControl(runRig);
  const connection = { id: "fixture", kind: "wsl", distro: "fixture" };
  const described = await service.describe(connection, ["scope", "show"]);
  assert.equal(
    described.options.find((o) => o.flag === "--workspace").inherited,
    true,
  );
  const prepared = await service.operation(connection, {
    op: "prepare",
    path: ["scope", "show"],
    root: "/workspace one",
    values: { name: "mission" },
    options: { "--workspace": "/project space", "--json": true },
  });
  assert.deepEqual(prepared.args, [
    "scope",
    "--workspace=/project space",
    "show",
    "--json",
    "mission",
  ]);
  assert.equal(calls.filter((args) => args.at(-1) !== "--help").length, 0);
  await assert.rejects(
    () =>
      service.operation(
        { ...connection, id: "other" },
        {
          op: "run",
          token: prepared.token,
          confirmation: prepared.confirmation,
        },
      ),
    /Review this exact/,
  );
  await assert.rejects(
    () =>
      service.operation(connection, {
        op: "run",
        token: prepared.token,
        confirmation: "wrong",
      }),
    /Review this exact/,
  );
  const result = await service.operation(connection, {
    op: "run",
    token: prepared.token,
    confirmation: prepared.confirmation,
  });
  assert.equal(JSON.parse(result.output).root, "/workspace one");
  await assert.rejects(
    () =>
      service.operation(connection, {
        op: "run",
        token: prepared.token,
        confirmation: prepared.confirmation,
      }),
    /Review this exact/,
  );
  await assert.rejects(
    () => service.describe(connection, ["unknown"]),
    /unavailable/,
  );
  await assert.rejects(
    () => service.describe(connection, ["--all"]),
    /Choose a command/,
  );
});
test("terminal plans cannot run through capture mode and consumed actions cannot replay", async () => {
  const service = createRigControl(async () => rootHelp);
  const c = { id: "fixture" };
  const plan = await service.operation(c, {
    op: "prepare",
    path: [],
    options: { "--version": true },
    mode: "terminal",
  });
  await assert.rejects(
    () =>
      service.operation(c, {
        op: "run",
        token: plan.token,
        confirmation: plan.confirmation,
      }),
    /Review this exact/,
  );
  assert.deepEqual(
    service.consume(c, plan.token, plan.confirmation, "terminal"),
    ["--version"],
  );
  assert.throws(
    () => service.consume(c, plan.token, plan.confirmation, "terminal"),
    /Review this exact/,
  );
});
test("audited search index covers the supplied CLI families and all discovered leaf actions", () => {
  const index = require("../src/openrig-command-index.json");
  const required =
    "start daemon status snapshot restore crash-cart gateway parked export import ui tui package bootstrap requirements discover attach bind adopt bundle up down archive unarchive host ps roster mcp agent spec transcript send stream queue slack project view terminal watchdog workflow capture broadcast walk ask chatroom specs context plugin skill agent-image community-harness fork workspace mode policy whoami config file preflight auth provider usage telemetry health doctor expand add create grow reconcile-session env unclaim release launch remove shrink destroy setup restore-check restore-packet compact-plan compact heartbeat seat handover startup-proof scope proof".split(
      " ",
    );
  for (const command of required)
    assert.ok(
      index.entries.some((e) => e.path.length === 1 && e.path[0] === command),
      command,
    );
  assert.ok(index.entries.filter((e) => !e.childCount).length >= 300);
});

test("JSON results stay readable, preserve raw data and escape untrusted CLI output", () => {
  const { buildSync } = require("esbuild");
  const Module = require("node:module");
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const built = buildSync({
    entryPoints: ["src/RigCommandResult.tsx"],
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["react", "react/jsx-runtime"],
    write: false,
  });
  const mod = new Module("rig-result", module);
  mod.paths = module.paths;
  mod._compile(built.outputFiles[0].text, "rig-result");
  const result = renderToStaticMarkup(
    React.createElement(mod.exports.default, {
      output: JSON.stringify([
        { ok: false, count: 0, message: "<script>do not execute</script>" },
      ]),
    }),
  );
  assert.match(result, /<table/);
  assert.match(result, /Raw command output/);
  assert.match(result, /&lt;script&gt;/);
  assert.doesNotMatch(result, /<script>/);
  assert.match(result, />No</);
  assert.match(result, />0</);
});

test("captured successful commands retain stderr notices without corrupting structured output", async () => {
  const core = require("../electron/core.cjs");
  const result = await core.execute(
    process.execPath,
    [
      "-e",
      "process.stdout.write('{\"ok\":true}');process.stderr.write('Advisory notice')",
    ],
    { captureStderr: true },
  );
  assert.equal(JSON.parse(result.stdout).ok, true);
  assert.equal(result.stderr, "Advisory notice");
  const service = createRigControl(
    async () => rootHelp,
    async () => result,
  );
  const c = { id: "fixture" };
  const plan = await service.operation(c, {
    op: "prepare",
    path: [],
    options: { "--version": true },
  });
  const captured = await service.operation(c, {
    op: "run",
    token: plan.token,
    confirmation: plan.confirmation,
  });
  assert.equal(captured.warnings, "Advisory notice");
  assert.equal(JSON.parse(captured.output).ok, true);
});
