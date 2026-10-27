const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
function gh(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn("gh", args, {
      windowsHide: true,
      env: { ...process.env, GH_PROMPT_DISABLED: "1", GH_PAGER: "cat" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "",
      err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(
        new Error(
          "GitHub request timed out. Its outcome may be unknown; do not automatically retry writes.",
        ),
      );
    }, 30000);
    child.stdout.on("data", (d) => {
      out += d;
      if (out.length > 8000000) child.kill();
    });
    child.stderr.on("data", (d) => {
      err = (err + d).slice(-3000);
    });
    child.on("error", () => {
      clearTimeout(timer);
      reject(
        new Error(
          "GitHub CLI is unavailable. Install gh on Windows and run gh auth login.",
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code) reject(new Error(err || "GitHub request failed."));
      else {
        try {
          resolve(JSON.parse(out));
        } catch {
          reject(new Error("Invalid GitHub response."));
        }
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input ? JSON.stringify(input) : "");
  });
}
function integrationService({
  directory,
  safeStorage,
  runGh = gh,
  request = fetch,
}) {
  const secureStorageAvailable = () =>
    safeStorage.isEncryptionAvailable() &&
    (process.platform !== "linux" ||
      safeStorage.getSelectedStorageBackend?.() !== "basic_text");
  const credentialFile = path.join(directory, "linear-key.bin");
  const id = (v) => {
    if (typeof v !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$/.test(v))
      throw new Error("Invalid provider identifier.");
    return v;
  };
  const repo = (v) => {
    if (
      typeof v !== "string" ||
      !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(v) ||
      v.includes("..")
    )
      throw new Error("Use owner/repository.");
    return v;
  };
  async function linear(query, variables = {}) {
    if (!fs.existsSync(credentialFile))
      throw new Error("Connect Linear with a personal API key first.");
    const key = safeStorage.decryptString(fs.readFileSync(credentialFile));
    const response = await request("https://api.linear.app/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: key },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
      throw new Error(
        "Linear request failed (HTTP " +
          response.status +
          "). Check the key, permissions or rate limits.",
      );
    const json = await response.json();
    if (json.errors?.length)
      throw new Error(
        "Linear: " +
          json.errors
            .map((e) => e.message)
            .join("; ")
            .replaceAll(key, "[redacted]"),
      );
    if (!json.data) throw new Error("Linear returned no data.");
    return json.data;
  }
  return async function integrate(a = {}) {
    if (a.op === "credentials")
      return {
        linear: fs.existsSync(credentialFile),
        secureStorage: secureStorageAvailable(),
      };
    if (a.op === "disconnectLinear") {
      if (a.confirmed !== true) throw new Error("Confirm disconnect.");
      fs.rmSync(credentialFile, { force: true });
      return { disconnected: true };
    }
    if (a.op === "connectLinear") {
      if (!secureStorageAvailable())
        throw new Error(
          "System secure storage is unavailable; the API key will not be stored as plaintext. Enable the desktop keyring and restart HRig.",
        );
      if (
        typeof a.key !== "string" ||
        a.key.length < 12 ||
        a.key.length > 1000 ||
        /[\r\n]/.test(a.key)
      )
        throw new Error("Enter a valid Linear personal API key.");
      // Verify before replacing the previous credential. Never return the key.
      const response = await request("https://api.linear.app/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: a.key },
        body: JSON.stringify({ query: "{ viewer { id name } }" }),
        signal: AbortSignal.timeout(30000),
      });
      const json = await response.json();
      if (!response.ok || json.errors?.length || !json.data?.viewer)
        throw new Error("Linear rejected this key or permission scope.");
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(
        credentialFile + ".tmp",
        safeStorage.encryptString(a.key),
      );
      fs.renameSync(credentialFile + ".tmp", credentialFile);
      return { name: json.data.viewer.name };
    }
    if (a.provider === "github") {
      if (a.op === "list") {
        const name = repo(a.repo);
        const issues = await runGh([
          "api",
          "--hostname",
          "github.com",
          `repos/${name}/issues?state=all&per_page=100`,
        ]);
        return {
          items: issues
            .filter((i) => !i.pull_request)
            .map((i) => ({
              id: String(i.number),
              title: i.title,
              body: i.body || "",
              url: i.html_url,
              status: i.state,
              assignee: i.assignee?.login || "",
              project: name,
            })),
          partial: issues.length === 100,
          statuses: [
            { id: "open", name: "open" },
            { id: "closed", name: "closed" },
          ],
        };
      }
      if (a.op === "projects") {
        return runGh([
          "project",
          "list",
          "--owner",
          id(a.owner),
          "--format",
          "json",
          "--limit",
          "100",
        ]);
      }
      if (a.op === "board") {
        if (!Number.isSafeInteger(Number(a.number)) || Number(a.number) < 1)
          throw new Error("Enter a positive project number.");
        const result = await runGh([
          "project",
          "item-list",
          String(Number(a.number)),
          "--owner",
          id(a.owner),
          "--format",
          "json",
          "--limit",
          "100",
        ]);
        return {
          items: (result.items || []).map((i) => ({
            id: i.id,
            title: i.content?.title || i.title || "Untitled",
            body: i.content?.body || "",
            url: i.content?.url || "",
            status: i.status || "No status",
            project: i.content?.repository || "",
            assignee: "",
          })),
          partial: (result.items || []).length === 100,
          statuses: [],
        };
      }
      if (!["create", "update"].includes(a.op))
        throw new Error("Unsupported GitHub operation.");
      if (a.confirmed !== true) throw new Error("Confirm the GitHub change.");
      const name = repo(a.repo);
      if (a.op === "create") {
        if (
          typeof a.title !== "string" ||
          !a.title.trim() ||
          a.title.length > 250 ||
          typeof a.body !== "string" ||
          a.body.length > 50000
        )
          throw new Error(
            "Enter an issue title and body under 50,000 characters.",
          );
        return runGh(
          [
            "api",
            "--hostname",
            "github.com",
            `repos/${name}/issues`,
            "--method",
            "POST",
            "--input",
            "-",
          ],
          { title: a.title, body: a.body },
        );
      }
      if (
        !/^[1-9]\d*$/.test(String(a.id)) ||
        !["open", "closed"].includes(a.status)
      )
        throw new Error("Invalid issue or status.");
      return runGh(
        [
          "api",
          "--hostname",
          "github.com",
          `repos/${name}/issues/${a.id}`,
          "--method",
          "PATCH",
          "--input",
          "-",
        ],
        { state: a.status },
      );
    }
    if (a.provider === "linear") {
      if (a.op === "catalog")
        return linear(
          "{ teams(first:100) { nodes { id name states { nodes { id name } } } } projects(first:100) { nodes { id name } pageInfo { hasNextPage } } }",
        );
      if (a.op === "list") {
        const filter = {};
        if (a.team) filter.team = { id: { eq: id(a.team) } };
        if (a.project) filter.project = { id: { eq: id(a.project) } };
        const data = await linear(
          "query($filter: IssueFilter) { issues(first:100, filter:$filter, orderBy:updatedAt) { nodes { id identifier title description url state { id name } assignee { name } team { id } project { name } } pageInfo { hasNextPage } } }",
          { filter },
        );
        return {
          items: data.issues.nodes.map((i) => ({
            id: i.id,
            title: i.identifier + " " + i.title,
            body: i.description || "",
            url: i.url,
            status: i.state.name,
            team: i.team.id,
            assignee: i.assignee?.name || "",
            project: i.project?.name || "",
          })),
          partial: data.issues.pageInfo.hasNextPage,
        };
      }
      if (a.confirmed !== true) throw new Error("Confirm the Linear change.");
      if (a.op === "create") {
        if (
          typeof a.title !== "string" ||
          !a.title.trim() ||
          a.title.length > 250 ||
          typeof a.body !== "string" ||
          a.body.length > 50000
        )
          throw new Error("Enter a valid issue title and body.");
        const result = await linear(
          "mutation($input:IssueCreateInput!) { issueCreate(input:$input) { success issue { id url } } }",
          {
            input: {
              teamId: id(a.team),
              title: a.title,
              description: a.body,
              ...(a.project ? { projectId: id(a.project) } : {}),
            },
          },
        );
        if (!result.issueCreate.success)
          throw new Error("Linear did not confirm creation.");
        return result.issueCreate;
      }
      if (a.op === "update") {
        const result = await linear(
          "mutation($id:String!,$input:IssueUpdateInput!) { issueUpdate(id:$id,input:$input) { success } }",
          { id: id(a.id), input: { stateId: id(a.status) } },
        );
        if (!result.issueUpdate.success)
          throw new Error("Linear did not confirm the update.");
        return result.issueUpdate;
      }
    }
    throw new Error("Unsupported integration operation.");
  };
}
module.exports = { integrationService };
