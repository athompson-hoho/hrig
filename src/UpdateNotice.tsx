import { useEffect, useState } from "react";
import { Modal, ErrorBox } from "./components";
import type { UpdateState } from "./UpdateSettings";
const reminderKey = "hrig-update-reminder";
export default function UpdateNotice() {
  const [state, setState] = useState<UpdateState | null>(null);
  const [dismissed, setDismissed] = useState<{
    version: string;
    until: number;
  }>(() => {
    try {
      return (
        JSON.parse(localStorage.getItem(reminderKey) || "null") || {
          version: "",
          until: 0,
        }
      );
    } catch {
      return { version: "", until: 0 };
    }
  });
  const [confirm, setConfirm] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    window.hrig
      .updates({ op: "status" })
      .then((s) => {
        if (active) setState(s);
      })
      .catch(() => {});
    const off = window.hrig.onUpdates((s) => {
      if (active) setState(s);
    });
    return () => {
      active = false;
      off();
    };
  }, []);
  const close = () => {
    const value = {
      version: state?.latestVersion || "",
      until: Date.now() + 24 * 60 * 60 * 1000,
    };
    setDismissed(value);
    setConfirm(false);
    try {
      localStorage.setItem(reminderKey, JSON.stringify(value));
    } catch {}
  };
  const run = async (op: string) => {
    setError("");
    try {
      setState(
        await window.hrig.updates({
          op,
          confirmed: op === "install",
          allowUnsigned:
            op === "install" && state?.requiresUnsignedConsent === true,
        }),
      );
      setConfirm(false);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  if (
    !state?.latestVersion ||
    state.latestVersion === state.currentVersion ||
    !["available", "downloading", "downloaded", "error"].includes(
      state.phase,
    ) ||
    (dismissed.version === state.latestVersion && dismissed.until > Date.now())
  )
    return null;
  return (
    <Modal
      title={
        confirm
          ? "Restart HRig to update?"
          : `HRig ${state.latestVersion} is available`
      }
      subtitle={`You are running ${state.currentVersion}. OpenRig agents continue running while the desktop app updates.`}
      onClose={close}
    >
      {(error || state.error) && <ErrorBox error={error || state.error} />}
      {state.reason && <p>{state.reason}</p>}
      {confirm && (
        <>
          <p>
            Save or discard unsaved edits before continuing. HRig checks your
            workspace before restarting.
          </p>
          {state.requiresUnsignedConsent && (
            <p>
              This update is unsigned. Download checksums are verified;
              publisher identity is not verified. Confirm only if you agree to
              install the unsigned update.
            </p>
          )}
        </>
      )}
      {state.phase === "downloading" && (
        <>
          <p>Downloading and verifying update…</p>
          <progress
            aria-label="Update download progress"
            max={100}
            value={state.progress}
          />
        </>
      )}
      {state.notes && (
        <details>
          <summary>Release notes</summary>
          <pre className="work-description">{state.notes}</pre>
        </details>
      )}
      <div className="modal-actions">
        <button className="secondary-button" onClick={close}>
          Remind me tomorrow
        </button>
        {state.phase === "available" && state.canInstall && (
          <button
            className="primary-button"
            onClick={() => void run("download")}
          >
            Download update
          </button>
        )}
        {state.phase === "downloaded" && state.canInstall && (
          <button
            className="primary-button"
            onClick={() => (confirm ? void run("install") : setConfirm(true))}
          >
            {confirm
              ? "Confirm restart and install"
              : "Restart and install update"}
          </button>
        )}
        {!state.canInstall && (
          <button
            className="primary-button"
            onClick={() => void run("open-release")}
          >
            Open update downloads
          </button>
        )}
      </div>
    </Modal>
  );
}
