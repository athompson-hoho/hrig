import { useEffect, useState } from "react";
import "./accounts.css";
import type { Connection } from "./types";
export interface AccountAvailability {
  providers: {
    id: string;
    installed: boolean;
    status: string;
    plan?: string | null;
  }[];
  accounts: {
    id: string;
    runtime: string;
    label: string;
    scope: string;
    hostMatch: boolean;
    source: string;
    status: string;
  }[];
  checkedAt: number;
  scope: string;
  warning: string;
  orcaStatus: string;
  contextStatus: string;
}
export function useAccounts(connection: Connection, enabled = true) {
  const [revision, refresh] = useState(0);
  const [state, setState] = useState<{
    key: string;
    data?: AccountAvailability;
    error?: string;
  }>({ key: "" });
  const key = JSON.stringify([
    connection.id,
    connection.kind,
    connection.host,
    connection.port,
    connection.distro,
  ]);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setState({ key });
    window.hrig
      .assessTeam(connection, { op: "accounts" })
      .then((value) => {
        if (active)
          setState({ key, data: value as unknown as AccountAvailability });
      })
      .catch(() => {
        if (active) setState({ key, error: "Account discovery unavailable" });
      });
    return () => {
      active = false;
    };
  }, [key, revision, enabled]);
  return {
    data: state.key === key ? state.data : undefined,
    error: state.key === key ? state.error : undefined,
    refresh: () => refresh((v) => v + 1),
  };
}
export function AccountDetails({
  data,
  error,
}: {
  data?: AccountAvailability;
  error?: string;
}) {
  if (!data)
    return <p role="status">{error || "Checking available accounts…"}</p>;
  return (
    <div>
      <p>
        Runtime access on {data.scope} · checked{" "}
        {new Date(data.checkedAt).toLocaleTimeString()}
      </p>
      {data.providers.map((p) => (
        <p key={p.id}>
          {p.id}: {p.status} | Plan: {p.plan || "unavailable"}
        </p>
      ))}
      {data.warning && <p>{data.warning}</p>}
      <p>
        Orca-managed accounts
        {data.orcaStatus === "unavailable"
          ? ": unavailable on this computer"
          : ""}
      </p>
      {data.accounts.map((a) => (
        <p key={a.runtime + a.id}>
          {a.label} · {a.runtime} · {a.scope} ·{" "}
          {a.hostMatch
            ? "Matching host; launch access unverified"
            : "Not available on the selected host"}{" "}
        </p>
      ))}
      <p>{data.contextStatus}</p>
      <p>
        Managed accounts are informational. New seats use the selected host’s
        CLI sign-in. Account switching does not change existing sessions.
      </p>
    </div>
  );
}
export default function AccountStatus({
  connection,
}: {
  connection: Connection;
}) {
  const [open, setOpen] = useState(false);
  const { data, error, refresh } = useAccounts(connection, open);
  const ready =
    data?.providers.filter((p) => p.status === "authenticated").length || 0;
  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        Accounts:{" "}
        {data
          ? `${ready} runtime${ready === 1 ? "" : "s"} ready`
          : error
            ? "unavailable"
            : open
              ? "checking"
              : "view accounts"}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Available accounts"
          className="account-status-popover"
          style={{
            position: "absolute",
            bottom: "100%",
            left: 0,
            width: 420,
            maxWidth: "80vw",
            maxHeight: "60vh",
            overflow: "auto",
            padding: 16,
            background: "var(--panel)",
            border: "1px solid var(--border)",
            zIndex: 1000,
            boxShadow: "0 8px 24px #0008",
          }}
        >
          <h3>Accounts and context</h3>
          <AccountDetails data={data} error={error} />
          <button onClick={refresh}>Refresh accounts</button>
          <button onClick={() => setOpen(false)}>Close</button>
        </div>
      )}
    </div>
  );
}
