import { useMemo, useState } from "react";
import {
  FolderOpen,
  Search,
  Star,
  X,
  Network,
  ArrowUpRight,
} from "lucide-react";
import { ErrorBox, IconButton, Modal } from "./components";
import type { Connection } from "./types";
import { availableConnection, type RecentProject } from "./project-history";

export default function ProjectHub({
  connection,
  connections,
  history,
  path,
  onPath,
  folders,
  loading,
  error,
  opening,
  onOpen,
  onPin,
  onRemove,
  onClose,
}: {
  connection: Connection;
  connections: Connection[];
  history: RecentProject[];
  path: string;
  onPath: (path: string) => void;
  folders: Awaited<ReturnType<typeof window.hrig.projects>>;
  loading: boolean;
  error: string;
  opening: boolean;
  onOpen: (
    root: string,
    connection: Connection,
    rigId?: string,
    rigName?: string,
  ) => void;
  onPin: (id: string) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(""),
    [host, setHost] = useState("all");
  const rows = useMemo(
    () =>
      history.filter(
        (p) =>
          (host === "all" || p.connectionId === host) &&
          `${p.name} ${p.root} ${p.hostName} ${p.rigName}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [history, query, host],
  );
  return (
    <Modal
      title="Open a project"
      subtitle="Pick up where you left off. Each folder keeps its workspace layout."
      onClose={onClose}
      wide
    >
      <div className="project-hub-filters">
        <label className="navigation-search">
          <Search size={15} />
          <input
            aria-label="Search recent and favorite projects"
            placeholder="Find a project, host or rig…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select
          aria-label="Filter project host"
          value={host}
          onChange={(e) => setHost(e.target.value)}
        >
          <option value="all">All hosts</option>
          {connections.map((c) => (
            <option value={c.id} key={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="project-history-caption">
        <span>FAVORITES & RECENTS</span>
        <small>{rows.length} folders</small>
      </div>
      <div
        className="project-hub-list"
        aria-label="Recent and favorite projects"
      >
        {!rows.length && (
          <div className="navigation-empty">
            <FolderOpen size={23} />
            <strong>
              {history.length
                ? "No matching projects"
                : "Your next project starts here"}
            </strong>
            <p>
              {history.length
                ? "Try another name or host filter."
                : "Open a folder below. Recently opened folders and favorites will appear here."}
            </p>
          </div>
        )}
        {rows.map((project) => {
          const target = availableConnection(
            project,
            connections,
            window.hrig.platform,
          );
          const changed = connections.some(
            (c) => c.id === project.connectionId,
          );
          return (
            <div className="project-history-row" key={project.id}>
              <button
                className="project-history-open"
                disabled={opening || !target}
                onClick={() =>
                  target &&
                  onOpen(project.root, target, project.rigId, project.rigName)
                }
                aria-label={`Open project ${project.name} on ${project.hostName}`}
              >
                <FolderOpen size={20} />
                <span>
                  <strong>{project.name}</strong>
                  <small>{project.root}</small>
                  <small>
                    <Network size={10} />
                    {target?.name || project.hostName}
                    {project.rigName ? " · " + project.rigName : ""}
                    {!target
                      ? " · " +
                        (changed
                          ? "Connection target changed"
                          : "Connection unavailable")
                      : ""}
                  </small>
                </span>
                <ArrowUpRight size={14} />
              </button>
              <div className="project-history-actions">
                <IconButton
                  title={`${project.pinned ? "Unpin" : "Pin"} project ${project.name}`}
                  active={project.pinned}
                  disabled={opening}
                  onClick={() => onPin(project.id)}
                >
                  <Star
                    size={14}
                    fill={project.pinned ? "currentColor" : "none"}
                  />
                </IconButton>
                <IconButton
                  title={`Remove project ${project.name} from history`}
                  disabled={opening}
                  onClick={() => onRemove(project.id)}
                >
                  <X size={14} />
                </IconButton>
              </div>
            </div>
          );
        })}
      </div>
      {connection.kind !== "local" && (
        <section className="attached-projects">
          <div className="field-label">
            RIG SESSION FOLDERS · {connection.name}
          </div>
          {loading && <p>Finding attached folders…</p>}
          {!loading && !folders.length && (
            <p>
              No live folders found on this host. Open a saved folder or enter a
              directory below.
            </p>
          )}
          {folders.map((project) => (
            <button
              key={project.path}
              className="attached-project"
              disabled={opening}
              onClick={() =>
                onOpen(
                  project.path,
                  connection,
                  project.rigs.length === 1 ? project.rigs[0].id : undefined,
                  project.rigs.map((r) => r.name).join(", "),
                )
              }
            >
              <FolderOpen size={18} />
              <span>
                <strong>{project.name}</strong>
                <small>{project.path}</small>
                <small>{project.rigs.map((r) => r.name).join(", ")}</small>
              </span>
              <ArrowUpRight size={16} />
            </button>
          ))}
        </section>
      )}
      <label className="field-label">
        PROJECT DIRECTORY · {connection.name}
        <div className="input-with-button">
          <input
            aria-label="Project directory"
            disabled={opening}
            value={path}
            onChange={(e) => onPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && path.trim()) {
                e.preventDefault();
                onOpen(path.trim(), connection);
              }
            }}
            placeholder={
              connection.kind === "local" && window.hrig.platform === "win32"
                ? "C:\\Projects\\my-project"
                : "/home/me/projects/my-project"
            }
          />
          {connection.kind === "local" && (
            <button
              className="secondary-button"
              disabled={opening}
              onClick={async () => {
                const folder = await window.hrig.pickFolder();
                if (folder) onPath(folder);
              }}
            >
              Browse…
            </button>
          )}
        </div>
      </label>
      {error && <ErrorBox error={error} />}
      {opening && (
        <p className="navigation-status" role="status">
          Checking the folder on its host… Your current workspace stays open.
        </p>
      )}
      <div className="modal-actions">
        <button className="secondary-button" onClick={onClose}>
          Cancel
        </button>
        <button
          className="primary-button"
          disabled={opening || !path.trim()}
          onClick={() => onOpen(path.trim(), connection)}
        >
          <FolderOpen size={14} />
          Open project
        </button>
      </div>
    </Modal>
  );
}
