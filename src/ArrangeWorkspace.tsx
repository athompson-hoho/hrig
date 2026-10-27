import { useState } from "react";
import {
  Columns2,
  LayoutGrid,
  PanelTop,
  Undo2,
  Redo2,
  Equal,
  Save,
} from "lucide-react";
import type { IJsonModel, IJsonTabNode } from "flexlayout-react";
import type { RoleTemplate } from "./types";
function Mini({ node, depth = 0 }: { node: any; depth?: number }) {
  if (node.type === "tabset")
    return (
      <div className="arrange-mini-cell">
        {node.children?.map((t: any) => (
          <span key={t.id || t.name}>{t.name}</span>
        ))}
      </div>
    );
  return (
    <div className={`arrange-mini-row ${depth % 2 ? "vertical" : ""}`}>
      {node.children?.map((child: any, i: number) => (
        <Mini key={i} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}
export default function ArrangeWorkspace({
  model,
  tabs,
  groups,
  onPreset,
  onMove,
  onEqual,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  templates,
  onSaveTemplate,
  onApplyTemplate,
  onDeleteTemplate,
}: {
  model: IJsonModel;
  tabs: IJsonTabNode[];
  groups: { id: string; name: string }[];
  onPreset: (name: string) => void;
  onMove: (id: string, target: string, direction: string) => void;
  onEqual: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  templates: RoleTemplate[];
  onSaveTemplate: (name: string) => void;
  onApplyTemplate: (template: RoleTemplate) => void;
  onDeleteTemplate: (id: string) => void;
}) {
  const [tab, setTab] = useState(tabs[0]?.id || "");
  const [target, setTarget] = useState(groups[0]?.id || "");
  const [name, setName] = useState("");
  return (
    <div className="tool-panel">
      <div className="tool-panel-heading">
        <Columns2 />
        <div>
          <h3>Arrange your workspace</h3>
          <p>
            Move sessions without dragging. Every arrangement change can be
            undone.
          </p>
        </div>
      </div>
      <div className="arrange-controls">
        <button
          className="secondary-button"
          disabled={!canUndo}
          onClick={onUndo}
        >
          <Undo2 size={14} />
          Undo arrangement
        </button>
        <button
          className="secondary-button"
          disabled={!canRedo}
          onClick={onRedo}
        >
          <Redo2 size={14} />
          Redo arrangement
        </button>
        <button className="secondary-button" onClick={onEqual}>
          <Equal size={14} />
          Equalize panels
        </button>
      </div>
      <div className="arrange-preview">
        <Mini node={model.layout} />
      </div>
      <div className="arrange-presets">
        {[
          ["Team", LayoutGrid],
          ["Focus", PanelTop],
          ["Review", Columns2],
        ].map(([title, Icon]: any) => (
          <button key={title} onClick={() => onPreset(title)}>
            <Icon size={20} />
            <strong>{title}</strong>
            <span>
              {title === "Team"
                ? "One place for every session"
                : title === "Focus"
                  ? "Everything in one tab group"
                  : "Code beside your team"}
            </span>
          </button>
        ))}
      </div>
      <div className="form-grid">
        <label className="field-label">
          PANEL
          <select value={tab} onChange={(e) => setTab(e.target.value)}>
            {tabs.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field-label">
          DESTINATION GROUP
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="arrange-controls">
        {[
          ["center", "Group as tab"],
          ["left", "Split left"],
          ["right", "Split right"],
          ["bottom", "Split below"],
        ].map(([dir, label]) => (
          <button
            className="small-button"
            disabled={!tab || !target}
            key={dir}
            onClick={() => onMove(tab, target, dir)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="tool-panel-heading">
        <Save size={18} />
        <div>
          <h3>Role-based templates</h3>
          <p>
            Reusable across rigs. Unmatched roles remain visible as empty
            panels.
          </p>
        </div>
      </div>
      <div className="input-with-button">
        <input
          aria-label="Template name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Builder + reviewer"
        />
        <button
          className="primary-button"
          disabled={!name.trim()}
          onClick={() => {
            onSaveTemplate(name.trim());
            setName("");
          }}
        >
          Save role template
        </button>
      </div>
      <div className="template-list">
        {templates.map((t) => (
          <div key={t.id}>
            <span>{t.name}</span>
            <button className="small-button" onClick={() => onApplyTemplate(t)}>
              Apply to selected rig
            </button>
            <button
              className="small-button"
              aria-label={"Delete template " + t.name}
              onClick={() => onDeleteTemplate(t.id)}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
