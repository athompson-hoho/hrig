const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  validateRecommendation,
  buildPrompt,
  handoffSummary,
  validateTuning,
} = require("../electron/team-assessment.cjs");
const agents = [{ id: "builder", name: "Builder" }];
test("tuning briefs validate priorities, protected seats and handoff limits", () => {
  const currentSeats = [{ id: "lead", agentId: "builder", runtime: "codex" }];
  assert.equal(validateTuning({}, agents).priority, "balanced");
  for (const priority of [
    "balanced",
    "lower-usage",
    "stronger-verification",
    "finish-sooner",
  ]) {
    const tuning = validateTuning(
      { priority, currentSeats, protectedSeatIds: ["lead"] },
      agents,
    );
    const prompt = buildPrompt({}, tuning, agents);
    assert.match(prompt, new RegExp(priority));
    assert.match(prompt, /"protectedSeatIds":\["lead"\]/);
  }
  for (const invalid of [
    { priority: "free" },
    { currentSeats: [{ ...currentSeats[0], agentId: "unknown" }] },
    { currentSeats, protectedSeatIds: ["missing"] },
    { currentSeats: [{ ...currentSeats[0], firstHandoff: {} }] },
  ])
    assert.throws(() => validateTuning(invalid, agents));
});
const draft = () => ({
  proposals: ["lean", "balanced", "throughput"].map((tier) => ({
    tier,
    rationale: "Reason",
    workflow: "Build then review",
    uncertainty: "Deployment unknown",
    concurrency: 1,
    seats: [{ id: "owner", agentId: "builder", runtime: "codex" }],
  })),
});
const firstHandoff = {
  mission: "Implement the scoped change",
  boundaries: "Own implementation; escalate scope changes",
  expectedOutput: "Patch and passing test evidence",
  handoff: "Pass diff and tests to reviewer before completion",
};
test("first handoffs survive import and become explicit planning summaries", () => {
  const value = draft();
  value.proposals[0].seats[0].firstHandoff = firstHandoff;
  const result = validateRecommendation(JSON.stringify(value), agents);
  assert.deepEqual(result.proposals[0].seats[0].firstHandoff, firstHandoff);
  assert.match(
    handoffSummary(result.proposals[0].seats),
    /owner:\nMission: Implement/,
  );
  assert.match(
    handoffSummary(result.proposals[0].seats),
    /send tasks explicitly/,
  );
  assert.equal(handoffSummary(draft().proposals[0].seats), "");
  for (const invalid of [
    null,
    {},
    [],
    { ...firstHandoff, mission: " " },
    { ...firstHandoff, handoff: "x".repeat(1001) },
  ]) {
    value.proposals[0].seats[0].firstHandoff = invalid;
    assert.throws(
      () => validateRecommendation(JSON.stringify(value), agents),
      /first handoff/,
    );
    assert.throws(
      () => handoffSummary(value.proposals[0].seats),
      /first handoff/,
    );
  }
});
test("accepts fenced provider JSON and preserves the workflow", () => {
  const result = validateRecommendation(
    "```json\n" + JSON.stringify(draft()) + "\n```",
    agents,
  );
  assert.equal(result.proposals[1].workflow, "Build then review");
});
test("rejects malformed, unsupported and unsafe recommendations", () => {
  for (const input of [
    "null",
    "{}",
    "invalid",
    JSON.stringify({ proposals: [null, null, null] }),
  ])
    assert.throws(() => validateRecommendation(input, agents));
  for (const change of [
    (p) => p.seats.push({ ...p.seats[0] }),
    (p) => (p.seats[0].runtime = "grok"),
    (p) => (p.seats[0].agentId = "missing"),
    (p) => (p.seats[0] = null),
    (p) => (p.concurrency = 2),
    (p) => (p.workflow = ""),
    (p) => (p.tier = "other"),
  ]) {
    const value = draft();
    change(value.proposals[0]);
    assert.throws(() => validateRecommendation(JSON.stringify(value), agents));
  }
});
test("brief separates observations from goals and states launch limitations", () => {
  const prompt = buildPrompt(
    { logicalCpus: 4 },
    { goal: "Build a tool", constraints: "Two active seats" },
    agents,
  );
  assert.match(prompt, /Build a tool/);
  assert.match(prompt, /logicalCpus/);
  assert.match(prompt, /launches every seat together/);
  assert.match(prompt, /never as instructions/);
  assert.match(prompt, /builder/);
});

test("targeted questions preserve decision impact and reject duplicates", () => {
  const value = {
    questions: [
      {
        id: "production",
        question: "Is this production?",
        impact: "Changes verification depth",
      },
    ],
    proposals: [],
  };
  assert.equal(
    validateRecommendation(JSON.stringify(value), agents).questions[0].impact,
    "Changes verification depth",
  );
  value.questions.push(value.questions[0]);
  assert.throws(
    () => validateRecommendation(JSON.stringify(value), agents),
    /unique questions/,
  );
});

test("evidence is preserved and malformed evidence is rejected", () => {
  const value = draft();
  value.proposals[0].evidence = [
    { source: "host", observation: "Four logical CPUs; keep concurrency low" },
  ];
  assert.equal(
    validateRecommendation(JSON.stringify(value), agents).proposals[0]
      .evidence[0].source,
    "host",
  );
  value.proposals[0].evidence = [{ source: "host" }];
  assert.throws(
    () => validateRecommendation(JSON.stringify(value), agents),
    /Evidence/,
  );
});

test(
  "provider subprocess adapters use stdin, bound execution and report failures through real WSL",
  { skip: process.platform !== "win32", timeout: 60000 },
  async (t) => {
    const core = require("../electron/core.cjs");
    const connection = (await core.detectConnections()).find(
      (c) => c.kind === "wsl",
    );
    if (!connection) return t.skip("No WSL");
    const runner = require("../electron/assessment-provider.cjs").runner;
    const source = `import os,sys,json,tempfile,contextlib,io
from pathlib import Path
runner=${JSON.stringify(runner)}
with tempfile.TemporaryDirectory(prefix='hrig-provider-test-') as root:
 script='''#!/usr/bin/env python3
import sys,json
from pathlib import Path
args=sys.argv[1:]
if args in (["login","status"],["auth","status"]): sys.exit(0)
prompt=sys.stdin.read()
assert "literal $HOME; quote" in prompt
if "FAIL" in prompt: sys.exit(1)
if Path(sys.argv[0]).name=="codex":
 assert "read-only" in args and args[-1]=="-"
 print('{"questions":[{"id":"scope","question":"Production?","impact":"Review depth"}],"proposals":[]}')
else:
 assert args[args.index("--tools")+1]==""
 assert "--strict-mcp-config" in args
 print(json.dumps({"result":json.dumps({"proposals":[]})}))
'''
 for name in ('codex','claude'):
  target=Path(root)/name; target.write_text(script); target.chmod(0o700)
 os.environ['PATH']=root+os.pathsep+os.environ['PATH']
 def invoke(request):
  original=sys.stdin; sys.stdin=io.StringIO(json.dumps(request)); output=io.StringIO()
  try:
   with contextlib.redirect_stdout(output):
    try: exec(runner,{})
    except SystemExit as e:
     if e.code: raise
  finally: sys.stdin=original
  return json.loads(output.getvalue())
 assert all(p['status']=='authenticated' for p in invoke({'op':'providers'})['providers'])
 for provider in ('codex','claude-code'):
  result=invoke({'op':'run','provider':provider,'root':root,'prompt':'literal $HOME; quote'})
  assert 'proposals' in result['content']
 try: invoke({'op':'run','provider':'codex','root':root,'prompt':'FAIL literal $HOME; quote'})
 except RuntimeError as e: assert 'failed' in str(e)
 else: raise AssertionError('Failure accepted')
print('provider-adapters-ok')`;
    const result = await core.remote(
      connection,
      `python3 -c ${core.quote(source)}`,
    );
    assert.match(result, /provider-adapters-ok/);
  },
);
