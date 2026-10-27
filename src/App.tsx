import {
  useCallback,
  useEffect,
  useRef,
  useState,
  lazy,
  Suspense,
} from "react";
import {
  Actions,
  DockLocation,
  Layout,
  Model,
  TabNode,
  type ILayoutApi,
  type IJsonTabNode,
  type Action,
  type IJsonModel,
} from "flexlayout-react";
import {
  Layers3,
  PanelLeft,
  PanelLeftClose,
  FolderOpen,
  GitBranch,
  Network,
  Plus,
  Search,
  ChevronDown,
  Minus,
  Square,
  X,
  Columns2,
  LayoutGrid,
  Save,
  TerminalSquare,
  FileCode2,
  ListTodo,
  Send,
  Activity,
  ArrowUpRight,
  Check,
  Settings2,
  PanelTop,
  GripVertical,
  ExternalLink,
  RefreshCw,
  CircleHelp,
  Keyboard,
} from "lucide-react";
import type {
  Connection,
  Inventory,
  PanelConfig,
  Seat,
  WorkspaceState,
  FileEntry,
  RoleTemplate,
} from "./types";
import {
  arrangement,
  initialModel,
  restoreModel,
  roleSnapshot,
  instantiateRoles,
} from "./layout";
import {
  Empty,
  ErrorBox,
  IconButton,
  Loading,
  Modal,
  StatusDot,
} from "./components";
import Sidebar from "./Sidebar";
import Welcome from "./Welcome";
import TerminalPanel from "./TerminalPanel";
import {
  bufferText,
  clearBuffer,
  getDirtyBuffers,
  markSaved,
  buffers,
} from "./editor-buffers";
const EditorPanel = lazy(() => import("./EditorPanel"));
import ArrangeWorkspace from "./ArrangeWorkspace";
import {
  DoctorPanel,
  AttentionPanel,
  ProjectTools,
  PreviewPanel,
  PortsPanel,
  RigManager,
} from "./WorkbenchPanels";
import TaskBoard from "./TaskBoard";
import { ReviewWorkspace, ProblemsPanel } from "./ReviewWorkspace";
import {
  ActivityPanel,
  MessagePanel,
  QueuePanel,
  type ActivityEntry,
} from "./RigPanels";

const local: Connection = {
  id: "local",
  name: "This computer",
  kind: "local",
  root: ".",
};
const defaultState: WorkspaceState = {
  version: 1,
  connections: [local],
  activeConnection: "local",
  roots: {},
  activeRig: "",
  layouts: {},
  savedLayouts: [],
  sidebarWidth: 264,
};
type ModalKind =
  "connect" | "project" | "add" | "save" | "palette" | "guide" | "tools" | null;
type PendingAction = {
  title: string;
  description: string;
  run: () => void;
  tabId?: string;
};
const uid = () => crypto.randomUUID();
function panelIcon(component: string | undefined, size = 14) {
  switch (component) {
    case "terminal":
      return <TerminalSquare size={size} />;
    case "editor":
      return <FileCode2 size={size} />;
    case "diff":
      return <GitBranch size={size} />;
    case "queue":
      return <ListTodo size={size} />;
    case "messages":
      return <Send size={size} />;
    case "activity":
      return <Activity size={size} />;
    default:
      return <Layers3 size={size} />;
  }
}

export default function App() {
  const [state, setState] = useState<WorkspaceState>(defaultState);
  const [loaded, setLoaded] = useState(false);
  const [bootError, setBootError] = useState("");
  const [model, setModel] = useState<Model>(initialModel);
  const layout = useRef<ILayoutApi>(null);
  const [revision, setRevision] = useState(0);
  const [section, setSection] = useState("sessions");
  const [sidebar, setSidebar] = useState(true);
  const [modal, setModal] = useState<ModalKind>(null);
  const [menu, setMenu] = useState<"layout" | "connection" | null>(null);
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [inventoryError, setInventoryError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [fileRevision, setFileRevision] = useState(0);
  const [events, setEvents] = useState<ActivityEntry[]>([]);
  const [toast, setToast] = useState("");
  const [saveName, setSaveName] = useState("");
  const [search, setSearch] = useState("");
  const [fileMatches, setFileMatches] = useState<FileEntry[]>([]);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [actionError, setActionError] = useState("");
  const [connectionForm, setConnectionForm] = useState<Connection>({
    id: "",
    name: "",
    kind: "wsl",
    distro: "Ubuntu",
    root: "~",
  });
  const [formError, setFormError] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [detected, setDetected] = useState<Connection[]>([]);
  const connection =
    state.connections.find((c) => c.id === state.activeConnection) ||
    state.connections[0] ||
    local;
  const root = state.roots[connection.id] || connection.root;
  const workspace = `${connection.id}::${root}::${state.activeRig}`;
  const seats = (inventory?.seats || []).filter(
    (s) => !state.activeRig || s.rigId === state.activeRig,
  );
  const currentRig = inventory?.rigs.find((r) => r.id === state.activeRig);
  useEffect(() => {
    setFileMatches([]);
    if (modal !== "palette" || search.trim().length < 2) return;
    let active = true;
    const timer = setTimeout(
      () =>
        window.hrig
          .file(connection, {
            op: "search",
            root,
            path: "",
            query: search.trim(),
          })
          .then((matches) => {
            if (active) setFileMatches(matches);
          })
          .catch(() => {}),
      200,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [modal, search, connection.id, root]);
  const stateRef = useRef(state);
  stateRef.current = state;
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const modelRef = useRef(model);
  modelRef.current = model;
  const dirtyTabs = useRef(new Set<string>());
  const history = useRef<{ past: IJsonModel[]; future: IJsonModel[] }>({
    past: [],
    future: [],
  });
  const attentionSeen = useRef(new Set<string>());
  const log = useCallback(
    (text: string, kind: ActivityEntry["kind"] = "info") =>
      setEvents((old) =>
        [
          {
            id: uid(),
            text,
            kind,
            time: new Date().toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            }),
          },
          ...old,
        ].slice(0, 150),
      ),
    [],
  );
  const notify = useCallback(
    (text: string) => {
      setToast(text);
      log(text, "success");
    },
    [log],
  );
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!window.hrig) {
      setBootError(
        "HRig is a desktop app. Start it with npm run dev or launch HRig.exe.",
      );
      return;
    }
    Promise.all([window.hrig.loadState(), window.hrig.detectConnections()])
      .then(([saved, found]) => {
        setDetected(found);
        const base = saved?.version === 1 ? saved : defaultState;
        const connections = [...base.connections];
        for (const c of found)
          if (!connections.some((x) => x.id === c.id)) connections.push(c);
        const localFound = found.find((c) => c.kind === "local");
        if (!saved && localFound)
          connections[connections.findIndex((c) => c.id === "local")] =
            localFound;
        setState({ ...base, connections });
        setLoaded(true);
        log("Workspace ready. Connect a machine or open a project.");
      })
      .catch((e) => setBootError(e.message));
  }, [log]);
  useEffect(() => {
    if (!loaded) return;
    history.current = { past: [], future: [] };
    setModel(restoreModel(stateRef.current.layouts[workspace]));
    setRevision((n) => n + 1);
  }, [loaded, workspace]);
  useEffect(() => window.hrig?.onResume(() => setRefresh((n) => n + 1)), []);
  useEffect(() => {
    if (!inventory || !state.desktopNotifications) return;
    const current = new Set<string>();
    for (const seat of inventory.seats.filter(
      (s) => s.status === "attention" || (s.status === "failed" && s.error),
    )) {
      const key =
        connection.id + ":" + seat.id + ":" + (seat.error || seat.activity);
      current.add(key);
      if (!attentionSeen.current.has(key))
        void window.hrig.notifyAttention(
          seat.name + " needs your attention",
          seat.rigName +
            " · " +
            (seat.error || seat.activity || "Input requested"),
        );
    }
    attentionSeen.current = current;
  }, [inventory, state.desktopNotifications, connection.id]);
  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(
      () =>
        window.hrig.saveState(state).catch((e) => {
          setToast("Could not save workspace: " + e.message);
          log(e.message, "error");
        }),
      350,
    );
    return () => clearTimeout(timer);
  }, [state, loaded, log]);
  useEffect(() => {
    if (!loaded) return;
    let active = true;
    let inFlight = false;
    setInventory(null);
    setInventoryError("");
    if (connection.kind === "local") {
      setBusy(false);
      return;
    }
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      setBusy(true);
      try {
        const result = await window.hrig.inventory(connection);
        if (active) {
          setInventory(result);
          setInventoryError("");
        }
      } catch (e) {
        if (active) {
          setInventoryError((e as Error).message);
          setInventory(null);
        }
      } finally {
        inFlight = false;
        if (active) setBusy(false);
      }
    };
    load();
    const timer = setInterval(load, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [
    loaded,
    connection.id,
    connection.rigBinary,
    connection.host,
    connection.distro,
    refresh,
  ]);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      // Flush the latest layout before Electron shuts down.
      if (window.hrig) window.hrig.flushState(stateRef.current);
      if (getDirtyBuffers().length) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", key);
    };
  }, [menu]);
  const modelChanged = (next: Model) => {
    setRevision((n) => n + 1);
    setState((s) => ({
      ...s,
      layouts: { ...s.layouts, [workspaceRef.current]: next.toJson() },
    }));
  };
  const remember = () => {
    const snapshot = model.toJson();
    const past = history.current.past;
    if (JSON.stringify(past.at(-1)) !== JSON.stringify(snapshot))
      past.push(structuredClone(snapshot));
    if (past.length > 40) past.shift();
    history.current.future = [];
  };
  const travel = (direction: "undo" | "redo") => {
    const from =
      direction === "undo" ? history.current.past : history.current.future;
    const to =
      direction === "undo" ? history.current.future : history.current.past;
    const json = from.pop();
    if (!json) return;
    to.push(model.toJson());
    const next = Model.fromJson(json, model);
    setModel(next);
    modelChanged(next);
  };
  const refreshAll = () => {
    setRefresh((n) => n + 1);
    setFileRevision((n) => n + 1);
  };
  const openConnect = () => {
    setConnectionForm(
      connection.kind === "local"
        ? {
            id: "",
            name: "",
            kind: "wsl",
            distro: detected.find((c) => c.kind === "wsl")?.distro || "Ubuntu",
            root: "~",
          }
        : { ...connection },
    );
    setFormError("");
    setModal("connect");
  };
  const openProject = () => {
    setProjectPath(root);
    setModal("project");
    setFormError("");
  };
  const addPanel = (
    component: string,
    name: string,
    config: Partial<PanelConfig> = {},
    id?: string,
  ) => {
    const existing = id && model.getNodeById(id);
    if (existing) {
      model.doAction(Actions.selectTab(id!));
      modelChanged(model);
      return;
    }
    const tab: IJsonTabNode = {
      type: "tab",
      id: id || uid(),
      name,
      component,
      config: { connection: { ...connection }, root, ...config },
    };
    history.current = { past: [], future: [] };
    if (!layout.current?.addTabToActiveTabSet(tab)) {
      const first = model.getFirstTabSet();
      if (first)
        model.doAction(
          Actions.addTab(tab, first.getId(), DockLocation.CENTER, -1),
        );
      else
        setModel(
          Model.fromJson({
            global: model.toJson().global,
            layout: {
              type: "row",
              children: [{ type: "tabset", children: [tab] }],
            },
          }),
        );
    }
    modelChanged(model);
    setModal(null);
    log(`Opened ${name}`);
  };
  const openSeat = (seat: Seat) => {
    if (!seat.session) {
      notify(
        `${seat.name} has no attachable tmux session. Inspect its readiness in OpenRig.`,
      );
      return;
    }
    const id = `seat:${connection.id}:${seat.id}`;
    addPanel("terminal", seat.name, { seat, terminalId: id }, id);
  };
  const openShell = () => {
    const id = uid();
    addPanel(
      "terminal",
      connection.kind === "local" ? "PowerShell" : "Shell",
      { terminalId: id },
      id,
    );
  };
  const openFile = (path: string, diff = false, line?: number) => {
    const id = `${diff ? "diff" : "file"}:${connection.id}:${root}:${path}`;
    const existing = model.getNodeById(id) as TabNode | undefined;
    if (existing && line)
      model.doAction(
        Actions.updateNodeAttributes(id, {
          config: { ...existing.getConfig(), line },
        }),
      );
    addPanel(
      diff ? "diff" : "editor",
      path.split("/").pop()!,
      { path, line },
      id,
    );
  };
  const allTabs = () => {
    const tabs: IJsonTabNode[] = [];
    model.visitNodes((node) => {
      if (node instanceof TabNode) tabs.push(node.toJson());
    });
    return tabs;
  };
  const dirtyInLayout = () =>
    allTabs().filter((t) => dirtyTabs.current.has(t.id!));
  const protect = (run: () => void, title = "Replace this arrangement?") => {
    if (dirtyInLayout().length) {
      setPending({
        title,
        description:
          "This workspace has unsaved edits. Save or discard them before replacing the layout.",
        run,
      });
      setActionError("");
    } else run();
  };
  const applyPreset = (preset: string) => {
    remember();
    const tabs = allTabs().filter((t) => t.component !== "welcome");
    const next = arrangement(tabs, preset);
    setModel(next);
    modelChanged(next);
    setMenu(null);
    notify(`${preset} arrangement applied`);
  };
  const openAll = () => {
    remember();
    const existing = allTabs().filter((t) => t.component !== "welcome");
    for (const seat of seats.filter((s) => s.session)) {
      const id = `seat:${connection.id}:${seat.id}`;
      if (!existing.some((t) => t.id === id))
        existing.push({
          type: "tab",
          id,
          name: seat.name,
          component: "terminal",
          config: { connection: { ...connection }, root, seat, terminalId: id },
        });
    }
    const next = arrangement(existing, "Team");
    setModel(next);
    modelChanged(next);
    notify("Rig sessions arranged");
  };
  const closeTab = (id: string) => {
    history.current = { past: [], future: [] };
    const node = model.getNodeById(id) as TabNode | undefined;
    const config = node?.getConfig() as PanelConfig | undefined;
    if (config?.terminalId) void window.hrig.closeTerminal(config.terminalId);
    clearBuffer(id);
    dirtyTabs.current.delete(id);
    model.doAction(Actions.deleteTab(id));
    modelChanged(model);
  };
  const onAction = (action: Action) => {
    if (
      [
        Actions.MOVE_NODE,
        Actions.ADJUST_WEIGHTS,
        Actions.MAXIMIZE_TOGGLE,
        Actions.POPOUT_TAB,
        Actions.POPOUT_TABSET,
      ].includes(action.type)
    )
      remember();
    if (action.type === Actions.DELETE_TAB) {
      history.current = { past: [], future: [] };
      const id = action.data.node;
      if (dirtyTabs.current.has(id)) {
        setPending({
          title: "Save your changes?",
          description:
            "This file has unsaved edits. Save them before closing, or discard them.",
          tabId: id,
          run: () => closeTab(id),
        });
        setActionError("");
        return undefined;
      }
      const node = model.getNodeById(id) as TabNode | undefined;
      const config = node?.getConfig() as PanelConfig | undefined;
      if (config?.terminalId) void window.hrig.closeTerminal(config.terminalId);
      clearBuffer(id);
    }
    return action;
  };
  const markDirty = useCallback((id: string, dirty: boolean) => {
    dirty ? dirtyTabs.current.add(id) : dirtyTabs.current.delete(id);
    const m = modelRef.current;
    const node = m.getNodeById(id) as TabNode | undefined;
    if (node) {
      const config = node.getConfig();
      m.doAction(
        Actions.updateNodeAttributes(id, { config: { ...config, dirty } }),
      );
      setRevision((n) => n + 1);
    }
  }, []);
  const savePending = async () => {
    if (!pending) return;
    setActionError("");
    const tabs = pending.tabId
      ? [model.getNodeById(pending.tabId) as TabNode]
      : dirtyInLayout().map((t) => model.getNodeById(t.id!) as TabNode);
    try {
      for (const tab of tabs) {
        const config = tab.getConfig() as PanelConfig;
        const text = bufferText(tab.getId());
        if (text !== undefined) {
          const saved = await window.hrig.edit(config.connection, {
            op: "save",
            root: config.root,
            path: config.path,
            content: text,
            revision: buffers.get(tab.getId())?.revision,
          });
          const buffer = buffers.get(tab.getId());
          if (buffer) {
            buffer.revision = saved.revision;
            buffer.saved = text;
            if (buffer.content !== text)
              throw new Error(
                "The file changed while saving. Review the newest edits before closing.",
              );
          }
          dirtyTabs.current.delete(tab.getId());
        }
      }
      pending.run();
      setPending(null);
      setFileRevision((n) => n + 1);
    } catch (e) {
      setActionError((e as Error).message);
    }
  };
  const dragSeat = (event: React.DragEvent, seat: Seat) => {
    if (!seat.session) {
      event.preventDefault();
      return;
    }
    const id = `seat:${connection.id}:${seat.id}`;
    const existing = model.getNodeById(id);
    if (existing instanceof TabNode)
      layout.current?.moveTabWithDragAndDrop(event.nativeEvent, existing);
    else
      layout.current?.addTabWithDragAndDrop(event.nativeEvent, {
        type: "tab",
        id,
        name: seat.name,
        component: "terminal",
        config: { connection: { ...connection }, root, seat, terminalId: id },
      });
  };
  const factory = (node: TabNode) => {
    const config = node.getConfig() as PanelConfig;
    switch (node.getComponent()) {
      case "terminal":
        return (
          <TerminalPanel
            config={{
              ...config,
              seat:
                config.connection.id === connection.id
                  ? inventory?.seats.find((s) => s.id === config.seat?.id) ||
                    config.seat
                  : config.seat,
            }}
          />
        );
      case "arranger": {
        const groups: { id: string; name: string }[] = [];
        model.visitNodes((n) => {
          if (n.getType() === "tabset")
            groups.push({
              id: n.getId(),
              name:
                n
                  .getChildren()
                  .map((c) => (c as TabNode).getName())
                  .join(" / ") || "Empty group",
            });
        });
        return (
          <ArrangeWorkspace
            model={model.toJson()}
            tabs={allTabs().filter((t) => t.component !== "arranger")}
            groups={groups}
            onPreset={applyPreset}
            onMove={(id, target, dir) => {
              remember();
              model.doAction(
                Actions.moveNode(
                  id,
                  target,
                  (
                    {
                      left: DockLocation.LEFT,
                      right: DockLocation.RIGHT,
                      bottom: DockLocation.BOTTOM,
                      center: DockLocation.CENTER,
                    } as Record<string, DockLocation>
                  )[dir],
                  -1,
                ),
              );
              modelChanged(model);
            }}
            onEqual={() => {
              remember();
              model.visitNodes((n) => {
                if (n.getType() === "row" && n.getChildren().length)
                  model.doAction(
                    Actions.adjustWeights(
                      n.getId(),
                      n.getChildren().map(() => 100 / n.getChildren().length),
                    ),
                  );
              });
              modelChanged(model);
            }}
            onUndo={() => travel("undo")}
            onRedo={() => travel("redo")}
            canUndo={!!history.current.past.length}
            canRedo={!!history.current.future.length}
            templates={state.roleTemplates || []}
            onSaveTemplate={(name) => {
              setState((s) => ({
                ...s,
                roleTemplates: [
                  ...(s.roleTemplates || []).filter((t) => t.name !== name),
                  { id: uid(), name, model: roleSnapshot(model.toJson()) },
                ],
              }));
              notify("Role template saved");
            }}
            onApplyTemplate={(template) => {
              if (!state.activeRig) {
                notify(
                  "Select one rig in the sidebar before applying a role template.",
                );
                return;
              }
              protect(() => {
                remember();
                const next = restoreModel(
                  instantiateRoles(template.model, connection, root, seats),
                );
                setModel(next);
                modelChanged(next);
              });
            }}
            onDeleteTemplate={(id) =>
              setState((s) => ({
                ...s,
                roleTemplates: s.roleTemplates?.filter((t) => t.id !== id),
              }))
            }
          />
        );
      }
      case "doctor":
        return <DoctorPanel connection={config.connection} />;
      case "attention":
        return (
          <AttentionPanel
            connection={config.connection}
            inventory={
              config.connection.id === connection.id ? inventory : null
            }
            onSeat={openSeat}
            notifications={!!state.desktopNotifications}
            onNotifications={(value) =>
              setState((s) => ({ ...s, desktopNotifications: value }))
            }
          />
        );
      case "projectTools":
        return (
          <ProjectTools
            connection={config.connection}
            root={config.root}
            onFile={(path, line) => openFile(path, false, line)}
            onChanged={() => setFileRevision((n) => n + 1)}
          />
        );
      case "review":
        return (
          <ReviewWorkspace
            connection={config.connection}
            root={config.root}
            seats={seats}
            onSeat={(seat) => {
              openSeat(seat);
              applyPreset("Review");
            }}
            onDiff={(path) => {
              openFile(path, true);
              applyPreset("Review");
            }}
          />
        );
      case "problems":
        return (
          <ProblemsPanel
            onFile={(c, r, path, line) => {
              if (c.id === connection.id && r === root)
                openFile(path, false, line);
              else
                notify(
                  "Switch to the diagnostic’s project before opening this file.",
                );
            }}
          />
        );
      case "ports":
        return (
          <PortsPanel
            connection={config.connection}
            onPreview={(port) =>
              addPanel(
                "preview",
                `Preview :${port}`,
                {
                  port,
                  connection: config.connection,
                },
                `preview:${config.connection.id}:${port}`,
              )
            }
          />
        );
      case "preview":
        return <PreviewPanel config={config} />;
      case "rigManager":
        return (
          <RigManager
            connection={config.connection}
            root={config.root}
            inventory={inventory}
            onChanged={refreshAll}
            onSeat={openSeat}
          />
        );
      case "missingSeat":
        return (
          <Empty
            icon={<Layers3 size={26} />}
            title={"Unfilled role: " + config.role}
            description="This rig has no attachable seat matching the template role. Drag a seat into this group or choose another template."
          />
        );
      case "editor":
      case "diff":
        return (
          <Suspense fallback={<Loading text="Opening editor…" />}>
            <EditorPanel
              id={node.getId()}
              config={config}
              diff={node.getComponent() === "diff"}
              onDirty={markDirty}
              onSaved={() => {
                setFileRevision((n) => n + 1);
                notify("File saved");
              }}
            />
          </Suspense>
        );
      case "queue":
        return (
          <TaskBoard
            connection={config.connection}
            rigName={config.mode}
            seats={inventory?.seats || []}
            onSeat={openSeat}
          />
        );
      case "messages":
        return (
          <MessagePanel
            connection={config.connection}
            seats={
              inventory?.seats.filter(
                (s) => config.connection.id === connection.id,
              ) || []
            }
            onSent={notify}
          />
        );
      case "activity":
        return <ActivityPanel entries={events} />;
      default:
        return (
          <Welcome
            onConnect={openConnect}
            onProject={openProject}
            onShell={openShell}
            onSessions={openAll}
            onGuide={() => setModal("guide")}
            connectionName={connection.name}
            seatCount={seats.filter((s) => s.session).length}
          />
        );
    }
  };
  const openPalette = () => {
    setSearch("");
    setModal("palette");
  };
  const commands = [
    ...[
      ["Visual workspace arranger", "arranger"],
      ["Connection doctor", "doctor"],
      ["Attention center", "attention"],
      ["Project tools and text search", "projectTools"],
      ["Review workspace", "review"],
      ["Problems", "problems"],
      ["Ports and previews", "ports"],
      ["Rig manager", "rigManager"],
    ].map(([name, component]) => ({
      name,
      hint: "Workspace tool",
      icon: <Layers3 size={16} />,
      action: () =>
        addPanel(component, name, {}, "tool:" + component + ":" + workspace),
    })),
    {
      name: "Undo arrangement",
      hint: "Layout history",
      icon: <Columns2 size={16} />,
      action: () => travel("undo"),
    },
    {
      name: "Redo arrangement",
      hint: "Layout history",
      icon: <Columns2 size={16} />,
      action: () => travel("redo"),
    },
    {
      name: "Connect a machine",
      hint: "WSL / SSH",
      icon: <Network size={16} />,
      action: openConnect,
    },
    {
      name: "Open project folder",
      hint: "Ctrl O",
      icon: <FolderOpen size={16} />,
      action: openProject,
    },
    {
      name: "New shell",
      hint: "Ctrl Shift T",
      icon: <TerminalSquare size={16} />,
      action: openShell,
    },
    {
      name: "Open all rig sessions",
      hint: `${seats.length} seats`,
      icon: <Columns2 size={16} />,
      action: openAll,
    },
    {
      name: "Arrange: Team",
      hint: "Grid",
      icon: <LayoutGrid size={16} />,
      action: () => applyPreset("Team"),
    },
    {
      name: "Arrange: Focus",
      hint: "Tabs",
      icon: <PanelTop size={16} />,
      action: () => applyPreset("Focus"),
    },
    {
      name: "Arrange: Review",
      hint: "Side by side",
      icon: <Columns2 size={16} />,
      action: () => applyPreset("Review"),
    },
    {
      name: "Task queue",
      hint: "OpenRig",
      icon: <ListTodo size={16} />,
      action: () => addPanel("queue", "Task queue", { mode: currentRig?.name }),
    },
    {
      name: "Send a message",
      hint: "OpenRig",
      icon: <Send size={16} />,
      action: () => addPanel("messages", "Messages"),
    },
    {
      name: "Workspace activity",
      hint: "Events",
      icon: <Activity size={16} />,
      action: () => addPanel("activity", "Activity"),
    },
    {
      name: "Save layout",
      hint: "Named arrangement",
      icon: <Save size={16} />,
      action: () => {
        setSaveName("My workspace");
        setModal("save");
      },
    },
    ...seats.map((seat) => ({
      name: `Open ${seat.name}`,
      hint: seat.rigName,
      icon: <TerminalSquare size={16} />,
      action: () => openSeat(seat),
    })),
  ];
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey) {
        if (event.key.toLowerCase() === "k") {
          event.preventDefault();
          openPalette();
        }
        if (event.key.toLowerCase() === "o") {
          event.preventDefault();
          openProject();
        }
        if (event.key.toLowerCase() === "b") {
          event.preventDefault();
          setSidebar((v) => !v);
        }
        if (event.shiftKey && event.key.toLowerCase() === "t") {
          event.preventDefault();
          openShell();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  const chooseConnection = (id: string) => {
    setState((s) => ({ ...s, activeConnection: id, activeRig: "" }));
    setMenu(null);
    log(`Selected ${state.connections.find((c) => c.id === id)?.name}`);
  };
  const saveConnection = () => {
    if (
      connectionForm.kind === "ssh" &&
      !/^[a-zA-Z0-9_][a-zA-Z0-9_.@:[\]-]*$/.test(connectionForm.host || "")
    ) {
      setFormError("Enter an SSH config alias or user@hostname.");
      return;
    }
    if (connectionForm.kind === "wsl" && !connectionForm.distro?.trim()) {
      setFormError("Enter a WSL distribution name.");
      return;
    }
    const c = {
      ...connectionForm,
      id: connectionForm.id || uid(),
      name:
        connectionForm.name.trim() ||
        (connectionForm.kind === "wsl"
          ? connectionForm.distro!
          : connectionForm.host!),
      root: connectionForm.root || "~",
    };
    if (c.port && (!Number.isInteger(c.port) || c.port < 1 || c.port > 65535)) {
      setFormError("SSH port must be between 1 and 65535.");
      return;
    }
    setState((s) => ({
      ...s,
      connections: [...s.connections.filter((x) => x.id !== c.id), c],
      activeConnection: c.id,
      activeRig: "",
    }));
    setModal(null);
    setRefresh((n) => n + 1);
    notify(`Connection saved: ${c.name}`);
  };
  const resizeSidebar = (event: React.PointerEvent) => {
    const startX = event.clientX;
    const startWidth = state.sidebarWidth || 264;
    const move = (e: PointerEvent) =>
      setState((s) => ({
        ...s,
        sidebarWidth: Math.max(
          210,
          Math.min(440, startWidth + e.clientX - startX),
        ),
      }));
    const stop = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", stop);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "col-resize";
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", stop);
  };
  if (bootError)
    return (
      <div className="boot">
        <ErrorBox error={bootError} />
      </div>
    );
  if (!loaded)
    return (
      <div className="boot">
        <Layers3 size={40} />
        <Loading text="Opening your workspace…" />
      </div>
    );
  const tabCount = allTabs().filter((t) => t.component === "terminal").length;
  void revision;
  return (
    <div className="app">
      <header className="titlebar">
        <div className="brand">
          <span className="brand-mark">
            <Layers3 size={18} />
          </span>
          <strong>
            hrig<span>.</span>
          </strong>
          <span className="titlebar-divider" />
          <span className="titlebar-label">OPENRIG WORKSPACE</span>
        </div>
        <button className="command-trigger" onClick={openPalette}>
          <Search size={13} />
          <span>Find a session, file, or command…</span>
          <kbd>Ctrl K</kbd>
        </button>
        <div className="window-controls">
          <button
            aria-label="Minimize window"
            onClick={() => window.hrig.window("minimize")}
          >
            <Minus size={15} />
          </button>
          <button
            aria-label="Maximize window"
            onClick={() => window.hrig.window("maximize")}
          >
            <Square size={12} />
          </button>
          <button
            aria-label="Close window"
            onClick={() => window.hrig.window("close")}
          >
            <X size={16} />
          </button>
        </div>
      </header>
      <div className="main-shell">
        <nav className="activity-rail">
          <div>
            <IconButton
              title="Sessions"
              active={section === "sessions" && sidebar}
              onClick={() => {
                setSection("sessions");
                setSidebar(true);
              }}
            >
              <PanelsIcon />
            </IconButton>
            <IconButton
              title="Explorer"
              active={section === "files" && sidebar}
              onClick={() => {
                setSection("files");
                setSidebar(true);
              }}
            >
              <FolderOpen size={21} />
            </IconButton>
            <IconButton
              title="Source control"
              active={section === "changes" && sidebar}
              onClick={() => {
                setSection("changes");
                setSidebar(true);
              }}
            >
              <GitBranch size={21} />
            </IconButton>
            <span className="rail-divider" />
            <IconButton
              title="Task queue"
              onClick={() =>
                addPanel("queue", "Task queue", { mode: currentRig?.name })
              }
            >
              <ListTodo size={21} />
            </IconButton>
            <IconButton
              title="Messages"
              onClick={() => addPanel("messages", "Messages")}
            >
              <Send size={20} />
            </IconButton>
          </div>
          <div>
            <IconButton
              title="Arrange workspace guide"
              onClick={() => setModal("guide")}
            >
              <CircleHelp size={20} />
            </IconButton>
            <IconButton title="Connection settings" onClick={openConnect}>
              <Settings2 size={20} />
            </IconButton>
            <span className="rail-avatar">H</span>
          </div>
        </nav>
        {sidebar && (
          <div
            className="sidebar-container"
            style={{ width: state.sidebarWidth || 264 }}
          >
            <Sidebar
              section={section}
              connection={connection}
              root={root}
              inventory={inventory}
              inventoryError={inventoryError}
              busy={busy}
              selectedRig={state.activeRig}
              onRig={(id) => setState((s) => ({ ...s, activeRig: id }))}
              onRefresh={refreshAll}
              onProject={openProject}
              onConnect={openConnect}
              onSeat={openSeat}
              onDrag={dragSeat}
              onFile={(path) => openFile(path)}
              onDiff={(path) => openFile(path, true)}
              fileRevision={fileRevision}
            />
            <div className="sidebar-resizer" onPointerDown={resizeSidebar} />
          </div>
        )}
        <main className="workspace">
          <div className="workspace-toolbar">
            <div className="breadcrumbs">
              <IconButton
                title={sidebar ? "Hide sidebar" : "Show sidebar"}
                onClick={() => setSidebar((v) => !v)}
              >
                {sidebar ? (
                  <PanelLeftClose size={16} />
                ) : (
                  <PanelLeft size={16} />
                )}
              </IconButton>
              <span className="toolbar-divider" />
              <div className="menu-anchor">
                <button
                  className="connection-button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenu(menu === "connection" ? null : "connection");
                  }}
                >
                  <span className="host-type">
                    {connection.kind === "local"
                      ? "WIN"
                      : connection.kind.toUpperCase()}
                  </span>
                  {connection.name}
                  <ChevronDown size={12} />
                </button>
                {menu === "connection" && (
                  <div className="dropdown connection-dropdown">
                    {state.connections.map((c) => (
                      <button key={c.id} onClick={() => chooseConnection(c.id)}>
                        <Network size={14} />
                        <span>{c.name}</span>
                        <small>{c.kind.toUpperCase()}</small>
                        {c.id === connection.id && <Check size={13} />}
                      </button>
                    ))}
                    <div className="menu-separator" />
                    <button onClick={openConnect}>
                      <Plus size={14} />
                      Add connection
                    </button>
                  </div>
                )}
              </div>
              <span className="crumb-separator">/</span>
              <span className="current-rig">
                {currentRig?.name || "Workspace"}
              </span>
              <span
                className={`connection-state ${inventoryError ? "error" : ""}`}
              >
                <StatusDot
                  status={
                    busy
                      ? "unknown"
                      : connection.kind === "local" || inventory
                        ? "running"
                        : "unknown"
                  }
                />
                {busy
                  ? "Connecting"
                  : inventoryError
                    ? "Unavailable"
                    : connection.kind === "local"
                      ? "Local"
                      : inventory
                        ? "Connected"
                        : "Ready"}
              </span>
            </div>
            <div className="workspace-actions">
              <button
                className="toolbar-button"
                onClick={() => setModal("tools")}
              >
                <Layers3 size={14} />
                Tools
              </button>
              <div className="menu-anchor">
                <button
                  className="toolbar-button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenu(menu === "layout" ? null : "layout");
                  }}
                >
                  <Columns2 size={14} />
                  Arrange
                  <ChevronDown size={11} />
                </button>
                {menu === "layout" && (
                  <div className="dropdown layout-dropdown">
                    <label>LAYOUT PRESETS</label>
                    <button
                      onClick={() => {
                        setMenu(null);
                        addPanel(
                          "arranger",
                          "Arrange workspace",
                          {},
                          "arranger:" + workspace,
                        );
                      }}
                    >
                      <Columns2 size={14} />
                      Visual workspace arranger
                    </button>
                    {[
                      ["Team", "Grid of sessions"],
                      ["Focus", "One tab group"],
                      ["Review", "Code beside sessions"],
                    ].map(([name, hint]) => (
                      <button key={name} onClick={() => applyPreset(name)}>
                        {name === "Team" ? (
                          <LayoutGrid size={14} />
                        ) : (
                          <Columns2 size={14} />
                        )}
                        <span>
                          {name}
                          <small>{hint}</small>
                        </span>
                      </button>
                    ))}
                    <div className="menu-separator" />
                    <button
                      onClick={() => {
                        setSaveName("My workspace");
                        setModal("save");
                        setMenu(null);
                      }}
                    >
                      <Save size={14} />
                      Save current layout
                    </button>
                    {state.savedLayouts
                      .filter((s) => s.workspace === workspace)
                      .map((saved) => (
                        <button
                          key={saved.id}
                          onClick={() =>
                            protect(() => {
                              const next = restoreModel(saved.model);
                              setModel(next);
                              modelChanged(next);
                              setMenu(null);
                              notify(`Restored ${saved.name}`);
                            })
                          }
                        >
                          <Layers3 size={14} />
                          <span>{saved.name}</span>
                          <span
                            role="button"
                            aria-label={`Delete layout ${saved.name}`}
                            className="delete-layout"
                            onClick={(e) => {
                              e.stopPropagation();
                              setState((s) => ({
                                ...s,
                                savedLayouts: s.savedLayouts.filter(
                                  (x) => x.id !== saved.id,
                                ),
                              }));
                            }}
                          >
                            <X size={12} />
                          </span>
                        </button>
                      ))}
                  </div>
                )}
              </div>
              <button
                className="new-panel-button"
                onClick={() => setModal("add")}
              >
                <Plus size={14} />
                New panel
              </button>
            </div>
          </div>
          <div className="layout-host">
            <Layout
              ref={layout}
              model={model}
              factory={factory}
              onModelChange={modelChanged}
              onAction={onAction}
              realtimeResize
              supportsPopout
              popoutURL="popout.html"
              onRenderTab={(node, values) => {
                values.leading = panelIcon(node.getComponent());
                if (node.getConfig()?.dirty)
                  values.buttons.push(
                    <span
                      className="dirty-dot"
                      key="dirty"
                      title="Unsaved changes"
                    />,
                  );
              }}
              onRenderTabSet={(node, values) => {
                values.buttons.push(
                  <button
                    className="tabset-add"
                    key="add"
                    title="Add panel to this group"
                    aria-label="Add panel to this group"
                    onClick={() => {
                      model.doAction(Actions.setActiveTabset(node.getId()));
                      setModal("add");
                    }}
                  >
                    <Plus size={13} />
                  </button>,
                );
              }}
              onTabSetPlaceHolder={() => (
                <Empty
                  icon={<PanelTop size={26} />}
                  title="Make room for your next session"
                  description="Drag a session here or add a panel to get started."
                >
                  <button
                    className="primary-button"
                    onClick={() => setModal("add")}
                  >
                    <Plus size={14} />
                    Add panel
                  </button>
                </Empty>
              )}
            />
          </div>
          <div className="workspace-hint">
            <span>
              <GripVertical size={12} />
              Drag tabs to arrange · Drop at an edge to split
            </span>
            <button onClick={() => setModal("guide")}>
              Workspace guide
              <ArrowUpRight size={11} />
            </button>
          </div>
        </main>
      </div>
      <footer className="statusbar">
        <div>
          <span className="status-brand">
            <Network size={11} />
            {connection.kind === "local"
              ? "Local workspace"
              : `${connection.kind.toUpperCase()}: ${connection.name}`}
          </span>
          <button
            onClick={() => {
              setSection("changes");
              setSidebar(true);
            }}
          >
            <GitBranch size={11} />
            Source control
          </button>
        </div>
        <div>
          <span>
            {tabCount} {tabCount === 1 ? "session" : "sessions"} open
          </span>
          <span className="status-divider" />
          <span>
            <Check size={11} />
            Layout autosaved
          </span>
          <button onClick={() => addPanel("activity", "Activity")}>
            <Activity size={12} />
          </button>
        </div>
      </footer>
      {toast && (
        <div className="toast" role="status">
          <Check size={15} />
          {toast}
          <button onClick={() => setToast("")}>
            <X size={13} />
          </button>
        </div>
      )}
      {modal === "connect" && (
        <Modal
          title="Connect your workspace"
          subtitle="Your agents keep running on their machine. HRig brings them here."
          onClose={() => setModal(null)}
        >
          <div className="segmented">
            <button
              className={connectionForm.kind === "wsl" ? "selected" : ""}
              onClick={() =>
                setConnectionForm((c) => ({ ...c, kind: "wsl", id: "" }))
              }
            >
              WSL
            </button>
            <button
              className={connectionForm.kind === "ssh" ? "selected" : ""}
              onClick={() =>
                setConnectionForm((c) => ({ ...c, kind: "ssh", id: "" }))
              }
            >
              SSH
            </button>
          </div>
          {detected.filter((c) => c.kind === connectionForm.kind).length >
            0 && (
            <div className="detected-connections">
              <span className="field-label">DETECTED ON THIS COMPUTER</span>
              {detected
                .filter((c) => c.kind === connectionForm.kind)
                .map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setConnectionForm({ ...c })}
                  >
                    <Network size={14} />
                    {c.name}
                    <ArrowUpRight size={13} />
                  </button>
                ))}
            </div>
          )}
          <div className="form-grid">
            <label className="field-label">
              DISPLAY NAME
              <input
                placeholder={
                  connectionForm.kind === "wsl"
                    ? "Ubuntu workstation"
                    : "Development server"
                }
                value={connectionForm.name}
                onChange={(e) =>
                  setConnectionForm((c) => ({ ...c, name: e.target.value }))
                }
              />
            </label>
            <label className="field-label">
              {connectionForm.kind === "wsl"
                ? "DISTRIBUTION"
                : "HOST / SSH CONFIG ALIAS"}
              <input
                placeholder={
                  connectionForm.kind === "wsl"
                    ? "Ubuntu"
                    : "user@server or dev-server"
                }
                value={
                  connectionForm.kind === "wsl"
                    ? connectionForm.distro || ""
                    : connectionForm.host || ""
                }
                onChange={(e) =>
                  setConnectionForm((c) => ({
                    ...c,
                    [c.kind === "wsl" ? "distro" : "host"]: e.target.value,
                  }))
                }
              />
            </label>
          </div>
          {connectionForm.kind === "ssh" && (
            <>
              <label className="field-label">
                PORT
                <input
                  type="number"
                  min="1"
                  max="65535"
                  placeholder="22 (or SSH config default)"
                  value={connectionForm.port || ""}
                  onChange={(e) =>
                    setConnectionForm((c) => ({
                      ...c,
                      port: e.target.value ? Number(e.target.value) : undefined,
                    }))
                  }
                />
              </label>
              <p className="field-note">
                Uses Windows OpenSSH and your SSH config. For a new host or
                password login, open a shell to accept its host key or
                authenticate, then refresh rigs. Key / agent authentication is
                used for background discovery.
              </p>
            </>
          )}
          <label className="field-label">
            PROJECT PATH
            <input
              placeholder="~/projects/my-project"
              value={connectionForm.root}
              onChange={(e) =>
                setConnectionForm((c) => ({ ...c, root: e.target.value }))
              }
            />
          </label>
          <label className="field-label">
            OPENRIG EXECUTABLE <span className="optional">optional</span>
            <input
              placeholder="rig (or an absolute path)"
              value={connectionForm.rigBinary || ""}
              onChange={(e) =>
                setConnectionForm((c) => ({ ...c, rigBinary: e.target.value }))
              }
            />
          </label>
          <p className="field-note">
            OpenRig, tmux, and Python 3 must be available on the target. HRig
            attaches to existing seats.
          </p>
          {formError && <ErrorBox error={formError} />}
          <div className="modal-actions">
            <button className="secondary-button" onClick={() => setModal(null)}>
              Cancel
            </button>
            <button className="primary-button" onClick={saveConnection}>
              <Network size={14} />
              Open connection
            </button>
          </div>
        </Modal>
      )}
      {modal === "tools" && (
        <Modal
          title="Workspace tools"
          subtitle="Coordinate your rig, arrange sessions, and work on your project."
          onClose={() => setModal(null)}
          wide
        >
          <div className="panel-picker">
            {[
              [
                "Arrange workspace",
                "arranger",
                "Layouts, grouping, undo, and role templates",
              ],
              [
                "Connection doctor",
                "doctor",
                "Environment and daemon diagnostics",
              ],
              [
                "Attention center",
                "attention",
                "Seats and work needing your input",
              ],
              ["Task board", "queue", "Inspect and assign work"],
              [
                "Review workspace",
                "review",
                "Changes, sessions, and review feedback",
              ],
              [
                "Project tools",
                "projectTools",
                "Search text, create, and rename files",
              ],
              ["Problems", "problems", "Diagnostics from opened editors"],
              [
                "Ports and previews",
                "ports",
                "Local servers and SSH forwarding",
              ],
              [
                "Rig manager",
                "rigManager",
                "Topology and confirmed lifecycle actions",
              ],
            ].map(([name, component, description]) => (
              <button
                key={component}
                onClick={() =>
                  addPanel(
                    component,
                    name,
                    { mode: currentRig?.name },
                    "tool:" + component + ":" + workspace,
                  )
                }
              >
                <Layers3 size={20} />
                <strong>{name}</strong>
                <span>{description}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}
      {modal === "project" && (
        <Modal
          title="Open a project"
          subtitle={`Project files will open on ${connection.name}.`}
          onClose={() => setModal(null)}
        >
          <label className="field-label">
            PROJECT DIRECTORY
            <div className="input-with-button">
              <input
                autoFocus
                value={projectPath}
                onChange={(e) => setProjectPath(e.target.value)}
                placeholder={
                  connection.kind === "local"
                    ? "C:\\Projects\\my-project"
                    : "/home/me/projects/my-project"
                }
              />
              {connection.kind === "local" && (
                <button
                  className="secondary-button"
                  onClick={async () => {
                    const path = await window.hrig.pickFolder();
                    if (path) setProjectPath(path);
                  }}
                >
                  Browse…
                </button>
              )}
            </div>
          </label>
          {formError && <ErrorBox error={formError} />}
          <div className="modal-actions">
            <button className="secondary-button" onClick={() => setModal(null)}>
              Cancel
            </button>
            <button
              className="primary-button"
              disabled={!projectPath.trim()}
              onClick={async () => {
                try {
                  await window.hrig.file(connection, {
                    op: "list",
                    root: projectPath,
                    path: "",
                  });
                  setState((s) => ({
                    ...s,
                    roots: { ...s.roots, [connection.id]: projectPath },
                  }));
                  setSection("files");
                  setSidebar(true);
                  setModal(null);
                  notify("Project opened");
                } catch (e) {
                  setFormError((e as Error).message);
                }
              }}
            >
              <FolderOpen size={14} />
              Open project
            </button>
          </div>
        </Modal>
      )}
      {modal === "add" && (
        <Modal
          title="Add to your workspace"
          subtitle="Every panel can be moved, grouped, split, or detached."
          onClose={() => setModal(null)}
        >
          <div className="panel-picker">
            {[
              {
                name: "Shell",
                description: `A terminal on ${connection.name}`,
                icon: <TerminalSquare size={22} />,
                action: openShell,
              },
              {
                name: "Agent session",
                description: `${seats.length} available seats`,
                icon: <Layers3 size={22} />,
                action: () => {
                  setSection("sessions");
                  setSidebar(true);
                  setModal(null);
                  if (!seats.length) openConnect();
                },
              },
              {
                name: "Code editor",
                description: "Open a file from your project",
                icon: <FileCode2 size={22} />,
                action: () => {
                  setSection("files");
                  setSidebar(true);
                  setModal(null);
                },
              },
              {
                name: "Task queue",
                description: "Work owned by your rig",
                icon: <ListTodo size={22} />,
                action: () =>
                  addPanel("queue", "Task queue", { mode: currentRig?.name }),
              },
              {
                name: "Messages",
                description: "Send instructions to a seat",
                icon: <Send size={22} />,
                action: () => addPanel("messages", "Messages"),
              },
              {
                name: "Activity",
                description: "Your workspace event stream",
                icon: <Activity size={22} />,
                action: () => addPanel("activity", "Activity"),
              },
            ].map((item) => (
              <button key={item.name} onClick={item.action}>
                {item.icon}
                <strong>{item.name}</strong>
                <span>{item.description}</span>
              </button>
            ))}
          </div>
          {seats.length > 0 && (
            <div className="seat-picker">
              <span className="field-label">RUNNING SEATS</span>
              {seats.map((s) => (
                <button
                  key={s.id}
                  onClick={() => openSeat(s)}
                  disabled={!s.session}
                >
                  <StatusDot status={s.status} />
                  <span>{s.name}</span>
                  <small>{s.rigName}</small>
                  <Plus size={13} />
                </button>
              ))}
            </div>
          )}
        </Modal>
      )}
      {modal === "save" && (
        <Modal
          title="Save this arrangement"
          subtitle="Keep a named layout for this machine, project, and rig."
          onClose={() => setModal(null)}
        >
          <label className="field-label">
            LAYOUT NAME
            <input
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && saveName.trim()) {
                  setState((s) => ({
                    ...s,
                    savedLayouts: [
                      ...s.savedLayouts.filter(
                        (l) =>
                          !(
                            l.workspace === workspace &&
                            l.name === saveName.trim()
                          ),
                      ),
                      {
                        id: uid(),
                        name: saveName.trim(),
                        workspace,
                        model: model.toJson(),
                      },
                    ],
                  }));
                  setModal(null);
                  notify("Layout saved");
                }
              }}
            />
          </label>
          <div className="modal-actions">
            <button className="secondary-button" onClick={() => setModal(null)}>
              Cancel
            </button>
            <button
              className="primary-button"
              disabled={!saveName.trim()}
              onClick={() => {
                setState((s) => ({
                  ...s,
                  savedLayouts: [
                    ...s.savedLayouts.filter(
                      (l) =>
                        !(
                          l.workspace === workspace &&
                          l.name === saveName.trim()
                        ),
                    ),
                    {
                      id: uid(),
                      name: saveName.trim(),
                      workspace,
                      model: model.toJson(),
                    },
                  ],
                }));
                setModal(null);
                notify("Layout saved");
              }}
            >
              <Save size={14} />
              Save layout
            </button>
          </div>
        </Modal>
      )}
      {modal === "palette" && (
        <Modal title="Command center" onClose={() => setModal(null)} wide>
          <div className="palette-input">
            <Search size={18} />
            <input
              aria-label="Search commands and sessions"
              placeholder="Where do you want to go?"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const item = commands.find((c) =>
                    `${c.name} ${c.hint}`
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  );
                  if (item) {
                    setModal(null);
                    item.action();
                  } else if (fileMatches.length) {
                    setModal(null);
                    openFile(fileMatches[0].path);
                  }
                }
              }}
            />
            <kbd>ESC</kbd>
          </div>
          <div className="command-list">
            {commands
              .filter((c) =>
                `${c.name} ${c.hint}`
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              )
              .map((c) => (
                <button
                  key={c.name + c.hint}
                  onClick={() => {
                    setModal(null);
                    c.action();
                  }}
                >
                  {c.icon}
                  <span>{c.name}</span>
                  <small>{c.hint}</small>
                  <ArrowUpRight size={13} />
                </button>
              ))}
            {fileMatches.length > 0 && (
              <div className="palette-section-label">PROJECT FILES</div>
            )}
            {fileMatches.map((file) => (
              <button
                key={file.path}
                onClick={() => {
                  setModal(null);
                  openFile(file.path);
                }}
              >
                <FileCode2 size={16} />
                <span>{file.name}</span>
                <small>{file.path}</small>
                <ArrowUpRight size={13} />
              </button>
            ))}
          </div>
        </Modal>
      )}
      {modal === "guide" && (
        <Modal
          title="A place for every session"
          subtitle="Arrange the workspace with your mouse. Your rig keeps running."
          onClose={() => setModal(null)}
        >
          <div className="guide-list">
            {[
              {
                icon: <GripVertical />,
                title: "Drag a tab or session",
                text: "Drag any panel tab, or a seat from the sidebar. Drop onto a tab strip to group panels.",
              },
              {
                icon: <Columns2 />,
                title: "Drop at an edge to split",
                text: "Move to the left, right, top, or bottom of a panel. The highlighted area shows exactly where it will go.",
              },
              {
                icon: <ExternalLink />,
                title: "Float or open another window",
                text: "Use the tab group’s float or popout button to make room. Double-click the group background to maximize it.",
              },
              {
                icon: <Save />,
                title: "Keep the arrangement",
                text: "Layouts save automatically per connection, project, and rig. Use Arrange → Save current layout for a named preset.",
              },
              {
                icon: <Keyboard />,
                title: "A few useful shortcuts",
                text: "Ctrl K: command center · Ctrl O: open project · Ctrl B: sidebar · Ctrl Shift T: shell · Ctrl S: save file.",
              },
            ].map((item) => (
              <div key={item.title}>
                {item.icon}
                <section>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </section>
              </div>
            ))}
          </div>
        </Modal>
      )}
      {pending && (
        <Modal
          title={pending.title}
          subtitle={pending.description}
          onClose={() => setPending(null)}
        >
          {actionError && <ErrorBox error={actionError} />}
          <div className="modal-actions">
            <button
              className="secondary-button"
              onClick={() => setPending(null)}
            >
              Cancel
            </button>
            <button
              className="secondary-button danger"
              onClick={() => {
                const ids = pending.tabId
                  ? [pending.tabId]
                  : dirtyInLayout().map((t) => t.id!);
                for (const id of ids) {
                  clearBuffer(id);
                  dirtyTabs.current.delete(id);
                }
                pending.run();
                setPending(null);
              }}
            >
              Discard changes
            </button>
            <button className="primary-button" onClick={savePending}>
              <Save size={14} />
              Save and continue
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function PanelsIcon() {
  return (
    <div className="panels-icon">
      <i />
      <i />
      <i />
    </div>
  );
}
