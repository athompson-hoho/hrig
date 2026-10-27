import { useEffect, useRef, useState } from "react";
import type { Connection, HrigAPI, DesignSeat } from "./types";
import { ErrorBox } from "./components";
import HandoffPlan from "./HandoffPlan";
import { allocateRuntimes } from "../electron/runtime-preferences.mjs";
import TeamComparison from "./TeamComparison";

type Proposal = NonNullable<
  Awaited<ReturnType<HrigAPI["assessTeam"]>>["proposals"]
>[number];
export default function TeamAssessment({
  connection,
  root,
  goal,
  work,
  currentSeats,
  accountBudgets = {},
  protectedSeatIds,
  previewSeats,
  onApply,
}: {
  connection: Connection;
  root: string;
  goal: string;
  work: string;
  currentSeats: DesignSeat[];
  accountBudgets?: Record<string, number>;
  protectedSeatIds: string[];
  previewSeats: (proposal: Proposal) => DesignSeat[];
  onApply: (proposal: Proposal) => void;
}) {
  const [constraints, setConstraints] = useState("");
  const [brief, setBrief] = useState<{ key: string; prompt: string } | null>(
    null,
  );
  const [response, setResponse] = useState("");
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [providers, setProviders] = useState<
    { id: string; installed: boolean; status: string }[]
  >([]);
  const [provider, setProvider] = useState("codex");
  const [questions, setQuestions] = useState<
    { id: string; question: string; impact: string }[]
  >([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [resultKey, setResultKey] = useState("");
  const [priority, setPriority] = useState("balanced");
  const [comparison, setComparison] = useState<{
    proposal: Proposal;
    seats: DesignSeat[];
    key: string;
  } | null>(null);
  const comparisonTrigger = useRef<HTMLButtonElement | null>(null);
  const key = JSON.stringify({
    connection,
    root,
    goal,
    work,
    constraints,
    answers,
    priority,
    currentSeats,
    protectedSeatIds,
    accountBudgets,
  });
  const latestKey = useRef(key);
  latestKey.current = key;
  useEffect(() => {
    setComparison(null);
  }, [key]);
  useEffect(() => {
    setQuestions([]);
    setAnswers({});
    setProposals([]);
    setComparison(null);
  }, [connection, root, goal, work, constraints]);
  useEffect(() => {
    let active = true;
    setProviders([]);
    window.hrig
      .assessTeam(connection, { op: "providers" })
      .then((result) => {
        if (active) {
          setProviders(result.providers || []);
          setProvider(
            result.providers?.some((p) => p.status === "authenticated")
              ? allocateRuntimes(result.providers, 1, accountBudgets)[0]
              : result.providers?.find((p) => p.installed)?.id || "codex",
          );
        }
      })
      .catch(() => {
        if (active)
          setError(
            "Could not check provider availability. The portable prompt remains available.",
          );
      });
    return () => {
      active = false;
    };
  }, [connection]);
  const current = brief?.key === key;
  async function run(op: "brief" | "import" | "run") {
    setBusy(true);
    setError("");
    setProposals([]);
    setComparison(null);
    try {
      const result = await window.hrig.assessTeam(connection, {
        op,
        root,
        goal,
        work,
        constraints,
        accountBudgets,
        content: response,
        provider,
        priority,
        currentSeats,
        protectedSeatIds,
        answers: questions.map((q) => ({
          question: q.question,
          answer: answers[q.id] || "Unknown; use an explicit assumption",
        })),
      });
      if (latestKey.current !== key) return;
      setResultKey(key);
      if (result.questions?.length) setQuestions(result.questions);
      if (op === "brief") {
        setBrief({ key, prompt: result.prompt! });
        setResponse("");
      } else {
        setProposals(result.proposals || []);
        if (result.prompt) setBrief({ key, prompt: result.prompt });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="designer-choice-group">
      <summary>Design a team with AI</summary>
      <p>
        Assess directly with an installed Codex or Claude Code provider, or use
        the portable prompt with Codex, Claude, Grok or Antigravity.
      </p>
      <fieldset disabled={busy}>
        <legend>Recommendation priority</legend>
        {[
          ["balanced", "Balanced"],
          ["lower-usage", "Lower usage"],
          ["stronger-verification", "Stronger verification"],
          ["finish-sooner", "Finish sooner"],
        ].map(([value, label]) => (
          <label key={value}>
            <input
              type="radio"
              name="assessment-priority"
              value={value}
              checked={priority === value}
              onChange={() => setPriority(value)}
            />{" "}
            {label}
          </label>
        ))}
        <p className="field-note">
          Choose a priority, then assess again or rebuild the portable brief.
          Model usage and completion time depend on the work and provider.
        </p>
        {!!protectedSeatIds.length && (
          <p>
            {protectedSeatIds.length} manually edited{" "}
            {protectedSeatIds.length === 1 ? "seat is" : "seats are"} protected:{" "}
            {protectedSeatIds.join(", ")}. Applying a proposal retains these
            seats, so the final roster may differ from the proposal. Allow AI
            changes in the seat editor to release a seat.
          </p>
        )}
      </fieldset>
      <label className="field-label">
        CONSTRAINTS AND OPEN QUESTIONS
        <textarea
          aria-label="Team assessment constraints"
          rows={3}
          maxLength={4000}
          value={constraints}
          onChange={(e) => setConstraints(e.target.value)}
          placeholder="Prototype or production? Budget, deadlines, provider preferences, maximum active seats, deployment requirements..."
        />
      </label>
      <p className="field-note">
        Collects CPU, available memory, provider sign-in/plan labels, your declared plan budgets, and up to
        100 top-level project names and package dependency/script names from the
        selected host. Direct assessment sends this brief to the selected
        provider using its existing sign-in and may consume model usage.
        Credentials are not collected.
      </p>
      <label className="field-label">
        ASSESSMENT PROVIDER
        <select
          aria-label="Assessment provider"
          disabled={busy}
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
        >
          {["codex", "claude-code"].map((id) => (
            <option key={id} value={id}>
              {id === "codex" ? "Codex" : "Claude Code"} —{" "}
              {providers.find((p) => p.id === id)?.status || "checking"}
            </option>
          ))}
        </select>
      </label>
      <button
        className="primary-button"
        disabled={
          busy ||
          !root.trim() ||
          !goal.trim() ||
          !providers.some((p) => p.id === provider && p.installed)
        }
        onClick={() => run("run")}
      >
        {busy ? "Assessing project…" : "Assess with provider"}
      </button>
      {busy && (
        <p role="status">
          Collecting project evidence and waiting for the assessment. This can
          take up to 150 seconds.
        </p>
      )}
      {!!questions.length && (
        <fieldset disabled={busy}>
          <legend>Questions that affect your team</legend>
          {questions.map((q) => (
            <label className="field-label" key={q.id}>
              {q.question}
              <span className="field-note">Decision affected: {q.impact}</span>
              <textarea
                aria-label={q.question}
                rows={2}
                maxLength={4000}
                value={answers[q.id] || ""}
                onChange={(e) => {
                  setAnswers((previous) => ({
                    ...previous,
                    [q.id]: e.target.value,
                  }));
                  setProposals([]);
                }}
              />
            </label>
          ))}
          <p className="field-note">
            Answer, then assess again or rebuild the portable brief. Leave
            unknown answers blank to request explicit assumptions.
          </p>
        </fieldset>
      )}
      <button
        className="secondary-button"
        disabled={busy || !root.trim() || !goal.trim()}
        onClick={() => run("brief")}
      >
        {busy ? "Working..." : "Build assessment brief"}
      </button>
      {brief && !current && (
        <p>
          Project details changed. Rebuild the brief before importing a
          recommendation.
        </p>
      )}
      {current && (
        <>
          <label className="field-label">
            ASSESSMENT PROMPT
            <textarea
              aria-label="Team assessment prompt"
              rows={10}
              readOnly
              value={brief.prompt}
            />
          </label>
          <button
            className="secondary-button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(brief.prompt);
              } catch {
                setError("Copy the prompt from the text area.");
              }
            }}
          >
            Copy prompt
          </button>
          <label className="field-label">
            PROVIDER RESPONSE
            <textarea
              aria-label="Team assessment response"
              disabled={busy}
              rows={6}
              maxLength={50000}
              value={response}
              onChange={(e) => {
                setResponse(e.target.value);
                setProposals([]);
                setComparison(null);
              }}
              placeholder="Paste the JSON recommendation"
            />
          </label>
          <button
            className="secondary-button"
            disabled={busy || !response.trim()}
            onClick={() => run("import")}
          >
            Compare proposals
          </button>
          {(resultKey === key ? proposals : []).map((p) => (
            <article className="designer-seat" key={p.tier}>
              <h4>
                {p.tier === "throughput"
                  ? "Maximum throughput"
                  : p.tier === "balanced"
                    ? "Balanced"
                    : "Lean"}{" "}
                · {p.seats.length} seats
              </h4>
              <p>{p.rationale}</p>
              <details>
                <summary>Evidence reported by the provider</summary>
                {p.evidence?.length ? (
                  <ul>
                    {p.evidence.map((e, i) => (
                      <li key={i}>
                        <strong>{e.source}:</strong> {e.observation}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>
                    No supporting evidence was supplied. Treat the
                    recommendation as unverified.
                  </p>
                )}
              </details>
              <p>
                <strong>Workflow:</strong> {p.workflow}
              </p>
              <p>
                <strong>Uncertainty:</strong> {p.uncertainty}
              </p>
              <p>
                Suggested concurrency: {p.concurrency}. Launch starts all{" "}
                {p.seats.length} seats; staged work must be coordinated
                manually.
              </p>
              <ul>
                {p.seats.map((s) => (
                  <li key={s.id}>
                    {s.id} · {s.agentId} · {s.runtime}
                    <HandoffPlan seat={s.id} plan={s.firstHandoff} />
                  </li>
                ))}
              </ul>
              <button
                className="primary-button"
                onClick={(event) => {
                  comparisonTrigger.current = event.currentTarget;
                  setComparison(null);
                  setError("");
                  try {
                    setComparison({ proposal: p, seats: previewSeats(p), key });
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Use {p.tier} team
              </button>
            </article>
          ))}
          {comparison && comparison.key === key && (
            <TeamComparison
              tier={comparison.proposal.tier}
              before={currentSeats}
              after={comparison.seats}
              protectedIds={protectedSeatIds}
              onCancel={() => {
                setComparison(null);
                comparisonTrigger.current?.focus();
              }}
              onApply={() => {
                try {
                  if (
                    JSON.stringify(previewSeats(comparison.proposal)) !==
                    JSON.stringify(comparison.seats)
                  )
                    throw new Error(
                      "The draft changed. Review the recommendation again before applying it.",
                    );
                  onApply(comparison.proposal);
                  setComparison(null);
                } catch (e) {
                  setComparison(null);
                  setError((e as Error).message);
                }
              }}
            />
          )}
        </>
      )}
      {error && <ErrorBox error={error} />}
    </details>
  );
}
