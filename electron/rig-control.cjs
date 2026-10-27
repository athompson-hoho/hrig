const crypto = require("node:crypto");
const validName = /^[a-zA-Z0-9][a-zA-Z0-9:_-]*$/;
const clean = (value) =>
  value.replace(/\x1b\[[0-9;]*m/g, "").replace(/\r/g, "");
function parseHelp(raw, commandPath = []) {
  const help = clean(raw);
  const usage = help.match(/^Usage:\s*(.+)$/m)?.[1];
  if (!usage)
    throw new Error(
      "This CLI did not return a supported help format. Check the connection and OpenRig version.",
    );
  const sections = { Options: [], Arguments: [], Commands: [] };
  let section, previous;
  for (const line of help.split("\n")) {
    const heading = line.match(/^(Options|Arguments|Commands):$/);
    if (heading) {
      section = heading[1];
      previous = null;
      continue;
    }
    if (/^\S/.test(line)) {
      section = null;
      previous = null;
    }
    if (!section) continue;
    const row = line.match(/^ {2}(\S.*?)\s{2,}(\S.*)$/);
    if (row) {
      previous = { signature: row[1], description: row[2] };
      sections[section].push(previous);
    } else if (previous && /^ {4,}\S/.test(line))
      previous.description += " " + line.trim();
    else if (/^ {2}\S/.test(line)) {
      previous = { signature: line.trim(), description: "" };
      sections[section].push(previous);
    }
  }
  const description = help
    .split(/\n(?:Options|Arguments|Commands):/)[0]
    .replace(/^Usage:.*\n?/, "")
    .trim();
  const args = [...usage.matchAll(/<([^>]+)>|\[([^\]]+)\]/g)]
    .filter((m) => !["options", "command"].includes(m[1] || m[2]))
    .map((m) => {
      const name = (m[1] || m[2]).replace(/\.\.\.$/, "");
      return {
        name,
        required: !!m[1],
        variadic: /\.\.\.$/.test(m[1] || m[2]),
        description:
          sections.Arguments.find((a) => a.signature === name)?.description ||
          `Value for ${name}. See installed command help for accepted values.`,
      };
    });
  const options = sections.Options.map((o) => {
    const flags =
      o.signature.match(/--[a-zA-Z0-9][a-zA-Z0-9_-]*|-[a-zA-Z?]/g) || [];
    const flag = flags.find((f) => f.startsWith("--")) || flags[0];
    const value = o.signature.match(/<([^>]+)>|\[([^\]]+)\]/);
    return {
      ...o,
      flag,
      flags,
      depth: commandPath.length,
      valueName: value ? value[1] || value[2] : null,
      optionalValue: !!value?.[2],
      variadic: !!value && /\.\.\.$/.test(value[1] || value[2]),
    };
  }).filter((o) => o.flag && !o.flags.includes("--help"));
  const commands = sections.Commands.map((c) => ({
    ...c,
    name: c.signature.split(/[ |]/)[0],
  })).filter((c) => validName.test(c.name) && c.name !== "help");
  // OpenRig advertises direct restore in an epilogue rather than Commander's
  // argument/option table. Expose exactly that advertised compatibility path.
  const directRestore = help.match(
    /^Direct restore: rig restore <([^>]+)> --rig <([^>]+)>/m,
  );
  if (commandPath.join(" ") === "restore" && directRestore) {
    args.push({
      name: directRestore[1],
      required: true,
      variadic: false,
      description:
        "Snapshot ID to restore. Choose the target rig below; this action restores state and may launch seats.",
    });
    options.push({
      flag: "--rig",
      flags: ["--rig"],
      signature: `--rig <${directRestore[2]}>`,
      description:
        "Target rig ID for the advertised direct restore action (required).",
      depth: commandPath.length,
      valueName: directRestore[2],
      optionalValue: false,
      variadic: false,
      mandatory: true,
      localOnly: true,
    });
  }
  return {
    path: commandPath,
    usage,
    description,
    arguments: args,
    options,
    commands,
    help,
  };
}
function buildArgs(schema, request) {
  const args = [];
  const groups = {};
  const values = request.values || {};
  const options = request.options || {};
  for (const field of schema.options)
    if (
      field.mandatory &&
      (options[field.flag] === undefined ||
        options[field.flag] === false ||
        options[field.flag] === "")
    )
      throw new Error(`Enter a value for required ${field.flag}.`);
  const value = (v, name) => {
    if (
      typeof v !== "string" ||
      !v.length ||
      v.length > 50000 ||
      v.includes("\0")
    )
      throw new Error(`Enter a valid ${name} under 50,000 characters.`);
    return v;
  };
  for (const [flag, input] of Object.entries(options)) {
    const option = schema.options.find((o) => o.flag === flag);
    if (!option)
      throw new Error(
        `The installed command does not support ${flag}. Reload its help.`,
      );
    if (input === false || input === undefined) continue;
    const target = (groups[option.depth ?? schema.path.length] ||= []);
    if (!option.valueName) {
      if (input !== true) throw new Error(`Use a checkbox for ${flag}.`);
      target.push(flag);
      continue;
    }
    if (input === true && option.optionalValue) {
      target.push(flag);
      continue;
    }
    const entries = Array.isArray(input) ? input : [input];
    if (!entries.length) throw new Error(`Enter a value for ${flag}.`);
    if (option.variadic) {
      target.push(flag);
      for (const entry of entries) {
        const v = value(entry, flag);
        if (v.startsWith("-"))
          throw new Error(
            `Values for ${flag} cannot start with a dash. Use an explicit relative path where appropriate.`,
          );
        target.push(v);
      }
    } else
      for (const entry of entries) {
        const v = value(entry, flag);
        // --flag=value keeps literal option values from becoming additional flags.
        target.push(
          flag.startsWith("--") ? `${flag}=${v}` : flag,
          ...(flag.startsWith("--") ? [] : [v]),
        );
      }
  }
  for (let depth = 0; depth <= schema.path.length; depth++) {
    args.push(...(groups[depth] || []));
    if (depth < schema.path.length) args.push(schema.path[depth]);
  }
  let omitted = false;
  const positional = [];
  for (const argument of schema.arguments) {
    const input = values[argument.name];
    if (
      input === undefined ||
      input === "" ||
      (Array.isArray(input) && !input.length)
    ) {
      if (argument.required) throw new Error(`Enter ${argument.name}.`);
      omitted = true;
      continue;
    }
    if (omitted)
      throw new Error(
        "Fill earlier optional arguments before later arguments.",
      );
    const entries = argument.variadic
      ? Array.isArray(input)
        ? input
        : [input]
      : [input];
    for (const entry of entries) {
      const v = value(entry, argument.name);
      positional.push(v);
    }
  }
  if (
    Object.keys(values).some(
      (name) => !schema.arguments.some((a) => a.name === name),
    )
  )
    throw new Error("Unknown command argument. Reload help.");
  if (positional.some((v) => v.startsWith("-"))) args.push("--");
  args.push(...positional);
  if (args.length > 400 || JSON.stringify(args).length > 250000)
    throw new Error("This action is too large. Use fewer values.");
  return args;
}
function createRigControl(runRig, runAction = runRig) {
  const cache = new Map();
  const pending = new Map();
  const identity = (c) => JSON.stringify(c);
  async function describe(connection, commandPath = [], refresh = false) {
    if (
      !Array.isArray(commandPath) ||
      commandPath.length > 12 ||
      commandPath.some((p) => typeof p !== "string" || !validName.test(p))
    )
      throw new Error("Choose a command from the installed catalogue.");
    if (commandPath.length) {
      const parent = await describe(
        connection,
        commandPath.slice(0, -1),
        refresh,
      );
      if (!parent.commands.some((c) => c.name === commandPath.at(-1)))
        throw new Error(
          "This command is unavailable on the selected host. Reload the catalogue.",
        );
    }
    const key = JSON.stringify([connection, commandPath]);
    if (!refresh && cache.get(key)?.expires > Date.now())
      return cache.get(key).schema;
    const schema = parseHelp(
      await runRig(connection, [...commandPath, "--help"]),
      commandPath,
    );
    // Ancestor options (for example scope --workspace) remain usable in nested forms.
    if (commandPath.length) {
      const parent = await describe(connection, commandPath.slice(0, -1));
      schema.options = [
        ...schema.options,
        ...parent.options
          .filter(
            (o) =>
              !o.flags.includes("--version") &&
              !o.localOnly &&
              !schema.options.some((local) => local.flag === o.flag),
          )
          .map((o) => ({ ...o, inherited: true })),
      ];
    }
    if (cache.size > 1500) cache.clear();
    cache.set(key, { schema, expires: Date.now() + 60000 });
    return schema;
  }
  function consume(connection, token, confirmation, mode) {
    const plan = pending.get(token);
    if (
      !plan ||
      plan.expires < Date.now() ||
      plan.connection !== identity(connection) ||
      plan.confirmation !== confirmation ||
      plan.mode !== mode
    )
      throw new Error("Review this exact action again before running it.");
    pending.delete(token); // Never automatically retry a mutation or interactive launch.
    return plan.args;
  }
  async function operation(connection, request) {
    if (request.op === "describe")
      return {
        schema: await describe(connection, request.path, !!request.refresh),
      };
    if (request.op === "prepare") {
      if (
        request.root !== undefined &&
        (typeof request.root !== "string" ||
          request.root.length > 4000 ||
          request.root.includes("\0"))
      )
        throw new Error("Choose a valid working folder.");
      const schema = await describe(connection, request.path, true);
      const args = buildArgs(schema, request);
      const token = crypto.randomUUID();
      const confirmation = "rig " + (schema.path.join(" ") || "root");
      const mode = request.mode === "terminal" ? "terminal" : "capture";
      for (const [key, value] of pending)
        if (value.expires < Date.now()) pending.delete(key);
      if (pending.size >= 100) pending.delete(pending.keys().next().value);
      pending.set(token, {
        connection: identity(connection),
        args,
        confirmation,
        mode,
        root: request.root || "~",
        expires: Date.now() + 120000,
      });
      // Values can include private messages or credentials. Do not persist plans.
      return { token, confirmation, args, mode, root: request.root || "~" };
    }
    if (request.op === "run") {
      const root = pending.get(request.token)?.root;
      const args = consume(
        connection,
        request.token,
        request.confirmation,
        "capture",
      );
      const result = await runAction(connection, args, 60000, root);
      return typeof result === "string"
        ? { output: result }
        : { output: result.stdout, warnings: result.stderr };
    }
    throw new Error("Unsupported control-center operation.");
  }
  function consumeTerminal(connection, token, confirmation) {
    const root = pending.get(token)?.root;
    return { args: consume(connection, token, confirmation, "terminal"), root };
  }
  return { operation, describe, consume, consumeTerminal };
}
module.exports = { parseHelp, buildArgs, createRigControl };
