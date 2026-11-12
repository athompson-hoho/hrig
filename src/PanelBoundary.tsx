import { Component, type ReactNode } from "react";
import { describePanelError } from "./panel-error";

interface Props { children: ReactNode; label?: string }
interface State { failure: { text: string; attempt: number } | null; attempt: number }

/**
 * Keeps one panel's render error from taking down the whole window. Nothing is
 * retried automatically: the user chooses Try again, so a faulty panel cannot
 * loop, and no terminal, seat or file action is triggered by the failure.
 */
export default class PanelBoundary extends Component<Props, State> {
  state: State = { failure: null, attempt: 0 };
  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { failure: { text: describePanelError(error), attempt: 0 } };
  }
  componentDidCatch(error: unknown) {
    try { console.error("Panel render error:", describePanelError(error)); } catch { /* ignore */ }
  }
  render() {
    if (!this.state.failure) return this.props.children;
    const text = this.state.failure.text;
    return (
      <div className="panel-error" role="alert">
        <h3>{this.props.label ? `${this.props.label} hit an error` : "This panel hit an error"}</h3>
        <p>The rest of HRig is unaffected. Your other panels, terminals and unsaved files were not changed.</p>
        <pre className="panel-error-text">{text}</pre>
        <div className="modal-actions">
          <button className="secondary-button" onClick={() => this.setState({ failure: null, attempt: this.state.attempt + 1 })}>Try again</button>
          <button
            className="small-button"
            onClick={() => { void navigator.clipboard?.writeText(text).catch(() => {}); }}
          >
            Copy details
          </button>
        </div>
      </div>
    );
  }
}
