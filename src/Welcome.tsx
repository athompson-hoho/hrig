import {
  ArrowUpRight,
  FolderOpen,
  Network,
  TerminalSquare,
  Columns2,
  Grip,
  Layers3,
  Command,
  MousePointer2,
} from "lucide-react";
export default function Welcome({
  onConnect,
  onProject,
  onShell,
  onSessions,
  onGuide,
  connectionName,
  seatCount,
}: {
  onConnect: () => void;
  onProject: () => void;
  onShell: () => void;
  onSessions: () => void;
  onGuide: () => void;
  connectionName: string;
  seatCount: number;
}) {
  return (
    <div className="welcome">
      <div className="welcome-topline">
        <span className="eyebrow">
          <span className="live-pip" /> OPENRIG, AT YOUR FINGERTIPS
        </span>
        <span className="version-pill">
          DESKTOP PREVIEW <b>0.6</b>
        </span>
      </div>
      <div className="welcome-hero">
        <div className="hero-logo">
          <Layers3 size={36} strokeWidth={1.5} />
        </div>
        <h1>
          Your rig.
          <br />
          <span>Your arrangement.</span>
        </h1>
        <p>
          A little more room to think.
          <br />
          Bring your agents, code, and tools into one workspace.
        </p>
      </div>
      <div className="quick-actions">
        <button onClick={onConnect}>
          <span className="action-icon mint">
            <Network size={22} />
          </span>
          <strong>Connect a machine</strong>
          <p>Find your rigs in WSL or over SSH.</p>
          <ArrowUpRight size={16} />
        </button>
        <button onClick={onProject}>
          <span className="action-icon lavender">
            <FolderOpen size={22} />
          </span>
          <strong>Open a project</strong>
          <p>Code, files, and changes. Together.</p>
          <ArrowUpRight size={16} />
        </button>
        <button onClick={seatCount ? onSessions : onShell}>
          <span className="action-icon amber">
            {seatCount ? <Columns2 size={22} /> : <TerminalSquare size={22} />}
          </span>
          <strong>{seatCount ? "Open rig sessions" : "Add a shell"}</strong>
          <p>
            {seatCount
              ? `${seatCount} seats ready to arrange.`
              : `Start a session on ${connectionName}.`}
          </p>
          <ArrowUpRight size={16} />
        </button>
      </div>
      <div className="arrangement-intro">
        <div>
          <span className="eyebrow">A WORKSPACE THAT MOVES WITH YOU</span>
          <h3>
            Everything has a place.
            <br />
            You decide where.
          </h3>
          <button className="text-button" onClick={onGuide}>
            How to arrange your workspace <ArrowUpRight size={13} />
          </button>
        </div>
        <div className="mini-workspace" aria-hidden="true">
          <div className="mini-left">
            <div className="mini-panel">
              <div>
                <i />
                Builder<span>×</span>
              </div>
              <b />
              <b />
              <b />
              <b />
            </div>
            <div className="mini-panel">
              <div>
                <i />
                Operator<span>×</span>
              </div>
              <b />
              <b />
              <b />
            </div>
          </div>
          <div className="mini-panel mini-code">
            <div>
              <i />
              Editor<span>＋</span>
            </div>
            <b />
            <b />
            <b />
            <b />
            <b />
            <b />
            <b />
            <div className="drag-label">
              <MousePointer2 size={12} />
              Drag. Dock. Make it yours.
            </div>
          </div>
        </div>
      </div>
      <div className="welcome-bottom">
        <span>
          <Grip size={13} />
          Drag tabs to split or group
        </span>
        <span>
          <Command size={13} />
          <kbd>Ctrl K</kbd> Command palette
        </span>
      </div>
    </div>
  );
}
