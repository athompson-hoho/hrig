import { useEffect, useState } from "react";
import { ErrorBox, Modal } from "./components";
export type UpdateState = {
  phase: string;
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  notes: string;
  progress: number;
  canInstall: boolean;
  requiresUnsignedConsent?: boolean;
  error: string;
  mode: string;
  reason: string;
};
export default function UpdateSettings() {
  const [state, setState] = useState<UpdateState | null>(null),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState(false);
  useEffect(() => {
    let active = true;
    window.hrig
      .updates({ op: "status" })
      .then((s) => {
        if (active) setState(s);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    const off = window.hrig.onUpdates((s) => {
      if (active) setState(s);
    });
    return () => {
      active = false;
      off();
    };
  }, []);
  const run = async (op: string, confirmed = false) => {
    setError("");
    try {
      setState(
        await window.hrig.updates({
          op,
          confirmed,
          allowUnsigned: confirmed && state?.requiresUnsignedConsent === true,
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const busy =
    state && ["checking", "downloading", "installing"].includes(state.phase);
  return (
    <section className="settings-about">
      <h3>Updates</h3>
      <p>
        HRig checks for updates after startup and every six hours. Downloads
        require your approval. Installation always requires a separate restart
        confirmation. Unsaved files must be saved or discarded first.
      </p>
      {(error || state?.error) && <ErrorBox error={error || state!.error} />}
      {state && (
        <>
          <p>
            Installed: <strong>{state.currentVersion}</strong>
            {state.latestVersion && (
              <>
                {" "}
                · Latest stable: <strong>{state.latestVersion}</strong>
              </>
            )}
          </p>
          <p role="status">
            {{
              idle: "Ready to check",
              checking: "Checking for updates…",
              available: "A newer stable release is available",
              current: "No newer stable release is available",
              downloading: "Downloading and verifying the update…",
              downloaded: "Update downloaded and verified. Ready when you are.",
              installing: "Restarting to install…",
              error: "Update operation did not complete",
            }[state.phase as "idle"] || state.phase}
          </p>
          {state.reason && <p className="field-note">{state.reason}</p>}
          <div className="arrange-controls">
            <button
              className="secondary-button"
              disabled={!!busy}
              onClick={() => run("check")}
            >
              Check for updates
            </button>
            {state.phase === "available" && state.canInstall && (
              <button
                className="primary-button"
                onClick={() => run("download")}
              >
                Download verified update
              </button>
            )}
            {state.phase === "downloaded" && state.canInstall && (
              <button
                className="primary-button"
                onClick={() => setConfirm(true)}
              >
                Restart and install update
              </button>
            )}
            <button
              className="secondary-button"
              disabled={!!busy}
              onClick={() => run("open-release")}
            >
              Open release downloads
            </button>
          </div>
          {state.phase === "downloading" && (
            <progress
              aria-label="Update download progress"
              max={100}
              value={state.progress}
            />
          )}
          {state.notes && (
            <details>
              <summary>Release notes</summary>
              <pre className="work-description">{state.notes}</pre>
            </details>
          )}
        </>
      )}
      {confirm && (
        <Modal
          title="Restart HRig to install?"
          subtitle="HRig will verify that no unsaved editor buffers remain and flush your workspace before restarting. Existing OpenRig agents keep running."
          onClose={() => setConfirm(false)}
        >
          {state?.requiresUnsignedConsent && (
            <p>
              This update is unsigned. Its download checksum is verified, but
              publisher identity is not verified. Windows may show a security
              prompt. By confirming, you agree to install this unsigned update.
            </p>
          )}
          {state?.reason && <p>{state.reason}</p>}
          <div className="modal-actions">
            <button
              className="secondary-button"
              onClick={() => setConfirm(false)}
            >
              Keep working
            </button>
            <button
              className="primary-button"
              onClick={() => {
                setConfirm(false);
                void run("install", true);
              }}
            >
              Confirm restart and install
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
