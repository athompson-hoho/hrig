import {
  useCallback,
  useMemo,
  useEffect,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { attentionScope, attentionJumpEligibility } from "./attention-inbox";
import AccountStatus from "./AccountStatus";
import GitInfoStatus from "./GitInfoStatus";
import UpdateNotice from "./UpdateNotice";
import {
  Actions,
  DockLocation,
  Layout,
  Model,
  TabNode,
  TabSetNode,
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
  PanelBottom,
  Keyboard,
  Focus,
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
  normalizeOptionalPanels,
  normalizeOptionalTab,
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
import { fileTreeOwner } from "./file-tree";
import { normalizeCollapsedPods, podIdentity, togglePodCollapsed } from "./seat-pods";
import { normalizePinnedSeats, pinConnectionIdentity, seatPinIdentity, toggleSeatPin } from "./seat-pins";
import { advanceSeatNotifications, type SeatNotificationState } from "./seat-notifications";
import { SettingsContext } from "./SettingsContext";
import {
  changedKeys,
  noteChanges,
  recentFor,
  type RecentChange,
} from "./settings-recent";
import { HostTintContext } from "./HostTint";
import HostTintDialog from "./HostTintDialog";
import { normalizeHostTints } from "./host-tint";
import { resolveTaskFilters, saveTaskFilters } from "./task-filters";
import { isVisible, parseHidden, statusDividers } from "./status-bar-items";
import {
  markOffer,
  offerFor,
  offerValid,
  toastDelay,
  UNDO_LABEL,
  type UndoKind,
  type UndoNotice,
} from "./undo-toast";
import {
  safeOverrides,
  validateOverrides,
  resolveSettings,
  projectKey,
  type Overrides,
  type SettingsScope,
} from "./settings";
import { applyTheme } from "./themes";
import Welcome from "./Welcome";
import {
  CHECKING_SNAPSHOT,
  failureOutcome,
  pollDelay,
} from "./inventory-health";
import TerminalPanel from "./TerminalPanel";
import TerminalSnippets from "./TerminalSnippets";
import { snippetContext, type SnippetContext } from "./snippet-vars";
import { onSnippetDraft, type SnippetDraft } from "./snippet-draft";
import { onTaskDraft, type TaskDraft } from "./task-draft";
import { sendTerminalCommand, type TerminalCommand } from "./terminal-commands";
import { droppedIds, droppedLabel, markDropped, onTerminalDropped, reconnectAllDropped, reconnectNotice } from "./terminal-dropped";
import RelaunchSession from "./RelaunchSession";
import SeatPrompt from "./SeatPrompt";
import SeatMessage from "./SeatMessage";
import SeatTranscript from "./SeatTranscript";
import { planPodGrid, describePodGrid } from "./pod-grid";
import RigHealthStatus from "./RigHealthStatus";
import ProjectHub from "./ProjectHub";
import QuickOpen from "./QuickOpen";
import PanelNavigator, { type NavigablePanel } from "./PanelNavigator";
import "./navigation.css";
import {
  availableConnection,
  connectionIdentity,
  normalizeHistory,
  projectIdentity,
  visitProject,
  welcomeRecents,
  type RecentProject,
} from "./project-history";
import { planLastProject } from "./last-project";
import { buildWindowTitle, projectNameOf } from "./window-title";
import RigControl from "./RigControl";
import {
  bufferText,
  clearBuffer,
  getDirtyBuffers,
  markSaved,
  buffers,
  bufferConfigs,
  persistBuffer,
  editorFocusers,
  editorLineJumpers,
} from "./editor-buffers";
import SavedDrafts from "./SavedDrafts";
import WorkItems from "./WorkItems";
import { isWindows, localShellLabel } from "./platform";
import { draftOperation } from "./drafts";
import { useHumanItemNotices } from "./useHumanItemNotices";
import { useSeatNeedsInputSound } from "./useSeatNeedsInputSound";
import { clearShortcutLabel, terminalOwnsKey } from "./terminal-keys";
import ShortcutSheet from "./ShortcutSheet";
import {
  hasOpenDialog,
  isHelpKey,
  isReopenPanelKey,
  reopenShortcutHint,
} from "./shortcuts";
import { isMaximizePanelKey, maximizeShortcutHint } from "./shortcuts";
import { focusModeShortcutHint, isFocusModeKey } from "./shortcuts";
import { parseOverrideText, routeOverriddenKey, withEffectiveHints } from "./shortcut-overrides";
import { isPanelCycleKey } from "./shortcuts";
import { emptyMru, endCycle, noteActive, noteClosed, stepCycle } from "./panel-mru";
import PanelContextMenu, { type PanelMenu } from "./PanelContextMenu";
import { dirtyPrompt, panelKind } from "./panel-close-targets";
import {
  applyCustomTitle,
  canRename,
  isRenamed,
  resetTitle,
  type TitlePatch,
} from "./panel-title";
import { filterCommands, pickFirst } from "./palette";
import {
  describeClosedPanel,
  planReopen,
  popLatest,
  pushClosed,
  type ClosedPanel,
} from "./closed-panels";
import {
  planMaximize,
  planOpenInMaximized,
  type MaximizeRequest,
} from "./panel-maximize";
import {
  FOCUS_OFF,
  focusAfterSidebar,
  showStatusBar,
  toggleFocus,
  type FocusState,
} from "./focus-mode";
import {
  SIDEBAR_DEFAULT_WIDTH,
  dragSidebarWidth,
  normalizeSidebarWidth,
} from "./sidebar-width";
import {
  recentKey,
  recentsFor,
  recordRecent,
  removeRecent,
} from "./recent-files";
import DeferredPanel from "./DeferredPanel";
import PanelBoundary from "./PanelBoundary";
import { connectionStatus } from "./connection-status";
import { initialCommand, quickAction } from "./rig-quick-actions";
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
import { normalizeReviewChecks } from "./review-checks";
import { noteKey, normalizeSeatNotes, setNote } from "./seat-notes";
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
  sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
};
type ModalKind =
  | "connect"
  | "project"
  | "quickOpen"
  | "panels"
  | "add"
  | "save"
  | "palette"
  | "guide"
  | "tools"
  | "shortcuts"
  | "hostTint"
  | null;
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
  const [updateRestarting, setUpdateRestarting] = useState(false);
  const [recoveryCount, setRecoveryCount] = useState(() => {
    try {
      return Object.values(draftOperation("list")).filter(
        (d: any) => d.kind === "editor",
      ).length;
    } catch {
      return 0;
    }
  });
  const [bootError, setBootError] = useState("");
  const [model, setModel] = useState<Model>(initialModel);
  const layout = useRef<ILayoutApi>(null);
  const [revision, setRevision] = useState(0);
  const [section, setSection] = useState("sessions");
  const [sidebar, setSidebar] = useState(true);
  // Focus mode is a view state of this session: it is never saved and never writes a preference.
  const [focusMode, setFocusMode] = useState<FocusState>(FOCUS_OFF);
  const [transcriptView, setTranscriptView] = useState<{seat: Seat; connection: Connection} | null>(null);
  const [quickMessage, setQuickMessage] = useState<{seat: Seat; connection: Connection} | null>(null);
  const [promptView, setPromptView] = useState<{seat: Seat; connection: Connection} | null>(null);
  const [relaunch, setRelaunch] = useState<{seat: Seat; connection: Connection} | null>(null);
  const [modal, setModal] = useState<ModalKind>(null);
  const modalRef = useRef(modal);
  modalRef.current = modal;
  const projectIntent = useRef(0);
  const pendingFileFocus = useRef<string | null>(null);
  const [projectOpening, setProjectOpening] = useState(false);
  const [recentPanels, setRecentPanels] = useState<string[]>([]);
  const modelOwners = useRef(new WeakMap<Model, string>());
  // In memory only: closed panels are forgotten when the app restarts.
  const closedPanels = useRef<ClosedPanel[]>([]);
  const [menu, setMenu] = useState<"layout" | "connection" | "statusConnection" | null>(null);
  const [tabMenu, setTabMenu] = useState<PanelMenu | null>(null);
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const inventoryCache = useRef(new Map<string, Inventory>());
  const cacheInventoryPref = useRef(false);
  const attentionContext = useRef<any>(null);
  const inventoryHealth = useRef<{
    key: string;
    failures: number;
    lastSuccessAt: number | null;
    verified: boolean;
  }>({ key: "", failures: 0, lastSuccessAt: null, verified: false });
  const [inventoryError, setInventoryError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [fileRevision, setFileRevision] = useState(0);
  const [events, setEvents] = useState<ActivityEntry[]>([]);
  const [toast, setToast] = useState("");
  const [toastUndo, setToastUndo] = useState<UndoNotice | null>(null);
  const [toastHover, setToastHover] = useState(false);
  const [droppedTerminals, setDroppedTerminals] = useState<ReadonlySet<string>>(() => new Set());
  const [saveName, setSaveName] = useState("");
  const [search, setSearch] = useState("");
  const [fileMatches, setFileMatches] = useState<FileEntry[]>([]);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [actionError, setActionError] = useState("");
  const [connectionForm, setConnectionForm] = useState<Connection>({
    id: "",
    name: "",
    kind: isWindows ? "wsl" : "ssh",
    distro: "Ubuntu",
    root: "~",
  });
  const [formError, setFormError] = useState("");
  const [projectFolders, setProjectFolders] = useState<
    Awaited<ReturnType<typeof window.hrig.projects>>
  >([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [detected, setDetected] = useState<Connection[]>([]);
  const connection =
    state.connections.find((c) => c.id === state.activeConnection) ||
    state.connections[0] ||
    local;
  const root = state.roots[connection.id] || connection.root;
  const pinOwner = pinConnectionIdentity(connection);
  // Ownership is captured at render time, independently of snapshot freshness.
  const pinsAvailable = inventoryHealth.current.key === pinOwner;
  const podsAvailable = pinsAvailable;
  const projectHistory = useMemo(
    () => normalizeHistory(state.projectHistory),
    [state.projectHistory],
  );
  const hostTints = useMemo(
    () => normalizeHostTints(state.hostTints),
    [state.hostTints],
  );
  const endpoint = connectionIdentity(
    connection,
    window.hrig?.platform || "unknown",
  );
  const projectId = projectKey(connection.id, root);
  const userPreferences = useMemo(
    () => safeOverrides(state.preferences),
    [state.preferences],
  );
  const projectPreferences = useMemo(
    () => safeOverrides(state.projectPreferences?.[projectId]),
    [state.projectPreferences, projectId],
  );
  const preferences = useMemo(
    () => resolveSettings(userPreferences, projectPreferences),
    [userPreferences, projectPreferences],
  );
  const overridesText = preferences["shortcuts.overrides"];
  const shortcutOverrides = useMemo(
    () => parseOverrideText(overridesText, window.hrig?.platform || "unknown").map,
    [overridesText],
  );
  const statusHiddenText = preferences["appearance.statusBarHidden"];
  const hiddenStatusItems = useMemo(
    () => parseHidden(statusHiddenText),
    [statusHiddenText],
  );
  const statusSeparators = statusDividers(hiddenStatusItems);
  const themeDocuments = useRef(new Set<Document>([document]));
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const changed = () => setSystemDark(media.matches);
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);
  useEffect(() => {
    for (const doc of themeDocuments.current)
      applyTheme(doc, preferences, systemDark);
  }, [preferences, systemDark]);
  const changePreferences = (
    scope: SettingsScope,
    change: (current: Overrides) => Overrides,
  ) =>
    setState((s) =>
      scope === "user"
        ? { ...s, preferences: change(safeOverrides(s.preferences)) }
        : {
            ...s,
            projectPreferences: {
              ...s.projectPreferences,
              [projectId]: change(
                safeOverrides(s.projectPreferences?.[projectId]),
              ),
            },
          },
    );
  // The settings changed since HRig started, newest first: kept in memory only, never saved or exported.
  const [recentChanges, setRecentChanges] = useState<RecentChange[]>([]);
  const ownSettings = (scope: SettingsScope) =>
    scope === "user" ? userPreferences : projectPreferences;
  const noteRecent = (scope: SettingsScope, after: unknown) => {
    const keys = changedKeys(ownSettings(scope), after);
    if (keys.length)
      setRecentChanges((list) =>
        noteChanges(list, keys, scope, scope === "project" ? projectId : ""),
      );
  };
  const settingsContext = {
    effective: preferences,
    user: userPreferences,
    project: projectPreferences,
    recent: recentFor(recentChanges, projectId),
    update: (
      scope: SettingsScope,
      key: keyof typeof preferences,
      value: unknown,
    ) => {
      noteRecent(scope, { ...ownSettings(scope), [key]: value });
      changePreferences(scope, (current) => ({
        ...current,
        ...validateOverrides({ [key]: value }),
      }));
    },
    replace: (scope: SettingsScope, value: Overrides) => {
      noteRecent(scope, value);
      changePreferences(scope, () => validateOverrides(value));
    },
    reset: (scope: SettingsScope, key?: keyof typeof preferences) => {
      noteRecent(
        scope,
        key ? { ...ownSettings(scope), [key]: undefined } : {},
      );
      changePreferences(scope, (current) => {
        const next = { ...current };
        if (key) delete next[key];
        else return {};
        return next;
      });
    },
  };
  const saveShortcutOverrides = (text: string) => {
    const scope = Object.hasOwn(projectPreferences, "shortcuts.overrides") ? "project" : "user";
    if (text === "") settingsContext.reset(scope, "shortcuts.overrides");
    else settingsContext.update(scope, "shortcuts.overrides", text);
  };
  const workspace = `${connection.id}::${root}::${state.activeRig}`;
  const sameConnection = (c: Connection) =>
    JSON.stringify([c.id, c.kind, c.host, c.port, c.distro, c.rigBinary]) ===
    JSON.stringify([
      connection.id,
      connection.kind,
      connection.host,
      connection.port,
      connection.distro,
      connection.rigBinary,
    ]);
  const freshSeats = (c: Connection) =>
    !inventoryError && sameConnection(c) ? inventory?.seats || [] : [];
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
  useEffect(() => {
    if (!window.hrig?.onPrepareUpdate) return;
    const prepare = window.hrig.onPrepareUpdate(() => {
      if (getDirtyBuffers().length)
        return {
          ready: false,
          error:
            "Save All or discard unsaved editor changes before restarting.",
        };
      const result = window.hrig.flushState(stateRef.current);
      if (!result.saved)
        return {
          ready: false,
          error:
            result.error ||
            "Workspace could not be saved. Restart was cancelled.",
        };
      flushSync(() => setUpdateRestarting(true));
      return { ready: true };
    });
    const updates = window.hrig.onUpdates((s) => {
      if (s.phase === "error" || (s.phase === "downloaded" && s.error))
        setUpdateRestarting(false);
    });
    return () => {
      prepare();
      updates();
    };
  }, []);
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const modelRef = useRef(model);
  modelRef.current = model;
  const dirtyTabs = useRef(new Set<string>());
  const history = useRef<{ past: IJsonModel[]; future: IJsonModel[] }>({
    past: [],
    future: [],
  });
  const seatNotificationState = useRef<SeatNotificationState>({ owner: null, armed: false, attentionIds: [] });
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
  const undoOffered = toastUndo !== null && toastUndo.text === toast;
  const notify = useCallback(
    (text: string) => {
      setToast(text);
      setToastUndo(null);
      log(text, "success");
    },
    [log],
  );
  useEffect(() => {
    const delay = toastDelay(!!toast, undoOffered, toastHover);
    if (delay === null) return;
    const timer = setTimeout(() => setToast(""), delay);
    return () => clearTimeout(timer);
  }, [toast, toastUndo, undoOffered && toastHover]);
  // An Undo offer ends with its notice, and when the history or the panels changed since it was made.
  useEffect(() => {
    if (!toast) setToastHover(false);
    if (!toastUndo) return;
    if (
      !undoOffered ||
      !offerValid(toastUndo.mark, history.current, modelRef.current.toJson())
    )
      setToastUndo(null);
  }, [toast, toastUndo, revision]);
  useEffect(() => onTerminalDropped((id, dropped) => setDroppedTerminals(prev => markDropped(prev, id, dropped))), []);
  useEffect(() => {
    if (!window.hrig) {
      setBootError(
        "HRig is a desktop app. Start it with npm run dev or launch HRig.exe.",
      );
      return;
    }
    Promise.all([window.hrig.loadState(), window.hrig.detectConnections()])
      .then(async ([saved, found]) => {
        setDetected(found);
        const base = saved?.version === 1 ? saved : defaultState;
        // Opt-in cached inventory: seed the unverified-snapshot cache so the
        // sidebar is instant; the existing guard keeps actions off until a
        // live poll succeeds.
        if (base.preferences?.["rig.cacheInventory"] === true) {
          try {
            const { entries } = await window.hrig.inventoryCache({ op: "load" });
            for (const entry of entries) inventoryCache.current.set(entry.key, entry.inventory);
          } catch {}
        }
        const connections = [...base.connections];
        for (const c of found)
          if (!connections.some((x) => x.id === c.id)) connections.push(c);
        const localFound = found.find((c) => c.kind === "local");
        if (!saved && localFound)
          connections[connections.findIndex((c) => c.id === "local")] =
            localFound;
        setState({
          ...base,
          // A hand-edited or damaged saved width is clamped, or replaced by the default.
          sidebarWidth: normalizeSidebarWidth(base.sidebarWidth),
          projectHistory: normalizeHistory(base.projectHistory),
          reviewChecks: normalizeReviewChecks(base.reviewChecks),
          pinnedSeats: normalizePinnedSeats(base.pinnedSeats),
          collapsedPods: normalizeCollapsedPods(base.collapsedPods),
          connections,
          preferences:
            base.preferences ??
            (base.desktopNotifications
              ? { "notifications.desktop": true }
              : {}),
          seatNotes: normalizeSeatNotes(base.seatNotes),
        });
        setLoaded(true);
        log("Workspace ready. Connect a machine or open a project.");
      })
      .catch((e) => setBootError(e.message));
  }, [log]);
  useEffect(() => {
    if (!loaded) return;
    history.current = { past: [], future: [] };
    const next = restoreModel(stateRef.current.layouts[workspace]);
    modelOwners.current.set(next, workspace);
    setModel(next);
    setRevision((n) => n + 1);
  }, [loaded, workspace]);
  useEffect(() => {
    const selected = model.getActiveTabset()?.getSelectedNode()?.getId();
    if (selected)
      setRecentPanels((old) =>
        [selected, ...old.filter((x) => x !== selected)].slice(0, 500),
      );
    const listener = {
      onAfterAction: (action: Action) => {
        if (action.type === Actions.SELECT_TAB) {
          const id = action.data.tabNode as string;
          setRecentPanels((old) =>
            [id, ...old.filter((x) => x !== id)].slice(0, 500),
          );
        }
      },
    };
    model.addChangeListener(listener);
    return () => model.removeChangeListener(listener);
  }, [model]);
  // The OS window title: "hRig" unless the setting is on, and then nothing is ever sent. When on, it follows the project and the active panel; the main process cleans the text again.
  const sentTitle = useRef("hRig");
  const titleDetails = preferences["appearance.windowTitleDetails"];
  useEffect(() => {
    if (!loaded) return;
    const selected = model.getActiveTabset()?.getSelectedNode();
    const title = buildWindowTitle({
      enabled: titleDetails,
      project: projectNameOf(root),
      panel: selected instanceof TabNode ? selected.getName() : "",
    });
    if (title === sentTitle.current) return;
    sentTitle.current = title;
    window.hrig.setWindowTitle(title).catch(() => {});
  }, [loaded, model, revision, root, titleDetails]);
  useEffect(() => window.hrig?.onResume(() => setRefresh((n) => n + 1)), []);
  useEffect(() => {
    const next = advanceSeatNotifications(seatNotificationState.current, {
      enabled: preferences["notifications.desktop"], connection, inventory,
      inventoryError, health: inventoryHealth.current,
    });
    // Advance before transport so failed or repeated requests never replay content.
    seatNotificationState.current = next.state;
    for (const request of next.requests) {
      void window.hrig.notifySeatAttention(request).catch(() => {});
    }
  }, [inventory, preferences["notifications.desktop"], pinOwner, inventoryError,
    inventoryHealth.current.key, inventoryHealth.current.verified,
    inventoryHealth.current.failures]);
  // User-level only (a project override cannot change what is stored on disk or restored at start).
  const cacheInventoryOn = state.preferences?.["rig.cacheInventory"] === true;
  cacheInventoryPref.current = cacheInventoryOn;
  useEffect(() => {
    if (loaded)
      void window.hrig.updateFrequency(Number(preferences["workspace.updateCheckHours"])).catch(() => {});
  }, [loaded, preferences["workspace.updateCheckHours"]]);
  useEffect(() => {
    // Turning the option off removes the stored copy (also on every start while off).
    if (loaded && !cacheInventoryOn)
      void window.hrig.inventoryCache({ op: "clear" }).catch(() => {});
  }, [loaded, cacheInventoryOn]);
  useHumanItemNotices({
    enabled: loaded && preferences["notifications.humanItems"],
    connection,
    intervalSeconds: preferences["workspace.refreshInterval"],
    refresh,
    log,
  });
  useSeatNeedsInputSound({
    enabled: loaded && preferences["notifications.seatNeedsInputSound"],
    connection,
    seats: inventory?.seats ?? null,
    inventoryError,
    log,
  });
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
    const inventoryKey = JSON.stringify([
      connection.id,
      connection.kind,
      connection.host,
      connection.port,
      connection.distro,
      connection.rigBinary,
    ]);
    if (inventoryHealth.current.key !== inventoryKey) {
      // A switched-to connection shows its cached snapshot, unverified: the
      // guard stays on (with a gentle "checking" note) until a poll succeeds.
      const cached = inventoryCache.current.get(inventoryKey);
      inventoryHealth.current = {
        key: inventoryKey,
        failures: 0,
        lastSuccessAt: cached ? Date.parse(cached.sampledAt) || null : null,
        verified: false,
      };
      setInventory(cached || null);
      setInventoryError(cached ? CHECKING_SNAPSHOT : "");
    }
    if (connection.kind === "local" && isWindows) {
      setBusy(false);
      return;
    }
    const interval = preferences["workspace.refreshInterval"];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (!active) return;
      timer = setTimeout(
        load,
        pollDelay(interval, inventoryHealth.current.failures),
      );
    };
    const load = async () => {
      // Never overlap polls, and don't poll a hidden window; it refreshes the
      // moment the window is visible again.
      if (inFlight) return;
      if (document.hidden) return schedule();
      inFlight = true;
      setBusy(true);
      const health = inventoryHealth.current;
      try {
        const result = await window.hrig.inventory(connection);
        if (active) {
          health.failures = 0;
          health.lastSuccessAt = Date.now();
          health.verified = true;
          setInventory(result);
          inventoryCache.current.set(inventoryKey, result);
          if (cacheInventoryPref.current)
            void window.hrig.inventoryCache({ op: "save", key: inventoryKey, inventory: result }).catch(() => {});
          setInventoryError("");
        }
      } catch (e) {
        if (active) {
          health.failures++;
          const outcome = failureOutcome({
            verified: health.verified,
            failures: health.failures,
            lastSuccessAt: health.lastSuccessAt,
            now: Date.now(),
            intervalSeconds: interval,
          });
          // "quiet": keep serving the verified snapshot; "checking": leave the
          // unverified-snapshot guard on without calling it an error.
          if (outcome === "report") setInventoryError((e as Error).message);
        }
      } finally {
        inFlight = false;
        if (active) {
          setBusy(false);
          schedule();
        }
      }
    };
    const visible = () => {
      if (!document.hidden && !inFlight) {
        clearTimeout(timer);
        void load();
      }
    };
    document.addEventListener("visibilitychange", visible);
    void load();
    return () => {
      active = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [
    loaded,
    connection.id,
    connection.kind,
    connection.port,
    connection.rigBinary,
    connection.host,
    connection.distro,
    refresh,
    preferences["workspace.refreshInterval"],
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
    const owner = modelOwners.current.get(next) || workspaceRef.current;
    modelOwners.current.set(next, owner);
    setRevision((n) => n + 1);
    setState((s) => ({
      ...s,
      layouts: { ...s.layouts, [owner]: next.toJson() },
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
    const next = Model.fromJson(normalizeOptionalPanels(json), model);
    setModel(next);
    modelChanged(next);
  };
  // The notice for a layout change. It offers Undo only when the layout really changed, and the offer is one step of the same history that Undo arrangement uses.
  const announceLayout = (kind: UndoKind, label: string, next: Model) => {
    const past = history.current.past;
    const after = next.toJson();
    const offer = offerFor({
      kind,
      label,
      pastLength: past.length,
      before: past.at(-1),
      after,
    });
    notify(offer.text);
    if (offer.canUndo)
      setToastUndo({
        text: offer.text,
        mark: markOffer(history.current, after),
      });
  };
  // The Undo button: one step back through travel, and only while the offer still stands. The notice closes either way.
  const undoFromToast = () => {
    const offer = toastUndo;
    setToast("");
    setToastUndo(null);
    if (offer && offerValid(offer.mark, history.current, model.toJson()))
      travel("undo");
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
            kind: preferences["connections.defaultKind"] as "wsl" | "ssh",
            distro: detected.find((c) => c.kind === "wsl")?.distro || "Ubuntu",
            root: preferences["connections.defaultRoot"],
          }
        : { ...connection },
    );
    setFormError("");
    setModal("connect");
  };
  useEffect(() => {
    if (modal !== "project") return;
    let cancelled = false;
    setProjectFolders([]);
    setProjectsError("");
    setProjectsLoading(true);
    window.hrig
      .projects(connection)
      .then((rows) => {
        if (!cancelled) setProjectFolders(rows);
      })
      .catch((e) => {
        if (!cancelled) setProjectsError(e.message);
      })
      .finally(() => {
        if (!cancelled) setProjectsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [modal, connection]);
  const applyProject = async (
    requested: string,
    target: Connection = connection,
    rigId?: string,
    rigName?: string,
  ) => {
    const request = ++projectIntent.current;
    const previousWorkspace = workspaceRef.current;
    const platform = window.hrig.platform;
    const entry = normalizeHistory(stateRef.current.projectHistory).find(
      (p) => p.id === projectIdentity(target, requested, platform),
    );
    const path = entry?.root || requested;
    const targetEndpoint = connectionIdentity(target, platform);
    setFormError("");
    setProjectOpening(true);
    try {
      if (!path.trim() || path.length > 4096 || path.includes("\0"))
        throw Error("Choose a valid project folder.");
      await window.hrig.file(target, { op: "list", root: path, path: "" });
      if (
        request !== projectIntent.current ||
        workspaceRef.current !== previousWorkspace ||
        modalRef.current !== "project"
      )
        return;
      const fresh = stateRef.current.connections.find(
        (c) => c.id === target.id,
      );
      if (!fresh || connectionIdentity(fresh, platform) !== targetEndpoint)
        throw Error(
          "The connection target changed while checking this folder. Open it again on the intended host.",
        );
      const scope =
        rigId ?? (target.id === connection.id ? state.activeRig : "");
      const scopeName =
        rigName ?? (scope === state.activeRig ? currentRig?.name || "" : "");
      const snapshot = modelRef.current.toJson();
      setState((s) => ({
        ...s,
        activeConnection: target.id,
        activeRig: scope,
        roots: { ...s.roots, [target.id]: path },
        layouts: { ...s.layouts, [previousWorkspace]: snapshot },
        projectHistory: visitProject(
          normalizeHistory(s.projectHistory),
          fresh,
          path,
          platform,
          scope,
          scopeName,
        ),
      }));
      setSection("files");
      setSidebar(true);
      setModal(null);
      notify("Project opened");
    } catch (e) {
      if (request === projectIntent.current && modalRef.current === "project")
        setFormError((e as Error).message);
    } finally {
      if (request === projectIntent.current) setProjectOpening(false);
    }
  };
  const openProject = () => {
    projectIntent.current++;
    setProjectOpening(false);
    setProjectPath(root);
    setModal("project");
    setFormError("");
  };
  const closeProject = () => {
    projectIntent.current++;
    setProjectOpening(false);
    setModal(null);
  };
  // Welcome rows open through the project hub's own path: the hub is where the folder check and any error show, and applyProject only proceeds while the hub is the open modal.
  const openRecentProject = (project: RecentProject) => {
    const target = availableConnection(
      project,
      state.connections,
      window.hrig.platform,
    );
    openProject();
    if (!target) {
      setFormError(
        "This project's connection is unavailable or changed. Open the folder again on the intended host.",
      );
      return;
    }
    void applyProject(project.root, target, project.rigId, project.rigName);
  };
  // Once per launch, after the workspace has loaded, reopen the most recent project when the setting asks for it. It goes through the same path as a Welcome row, so the folder check, the connection check and the error message are the ones that path already has.
  const restoreChecked = useRef(false);
  useEffect(() => {
    if (!loaded || restoreChecked.current) return;
    restoreChecked.current = true;
    const plan = planLastProject({
      enabled: userPreferences["workspace.restoreLastProject"],
      history: projectHistory,
      connections: state.connections,
      platform: window.hrig.platform,
      active: { connection, root },
    });
    if (plan.project) openRecentProject(plan.project);
    else if (plan.reason === "other-connection")
      log("Your last project is on another connection, so it was not reopened.");
  }, [loaded]);
  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    const id = projectIdentity(connection, root, window.hrig.platform);
    const existing = normalizeHistory(stateRef.current.projectHistory).find(
      (p) => p.id === id,
    );
    const record = () => {
      if (cancelled || workspaceRef.current !== workspace) return;
      setState((s) => {
        const fresh = s.connections.find((c) => c.id === connection.id);
        if (
          !fresh ||
          connectionIdentity(fresh, window.hrig.platform) !== endpoint
        )
          return s;
        return {
          ...s,
          projectHistory: visitProject(
            normalizeHistory(s.projectHistory),
            fresh,
            root,
            window.hrig.platform,
            s.activeRig,
            currentRig?.name || "",
          ),
        };
      });
    };
    if (existing) {
      if (
        existing.rigId !== state.activeRig ||
        existing.rigName !== (currentRig?.name || "") ||
        existing.hostName !== connection.name
      )
        record();
    } else
      window.hrig
        .file(connection, { op: "list", root, path: "" })
        .then(record)
        .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [loaded, root, endpoint, state.activeRig, currentRig?.name]);
  // Quick action menu: navigation only. Opens the control center on a command
  // with the rig prefilled; the reviewed Review/confirm/Run flow is unchanged.
  const openRigAction = (rigId: string, actionId: string) => {
    const action = quickAction(actionId);
    const rig = inventory?.rigs.find((r) => r.id === rigId);
    if (!action || !rig) return;
    const request = initialCommand(action, rig, Date.now());
    const panelId = "tool:rigControl:" + workspace;
    const existing = model.getNodeById(panelId) as TabNode | undefined;
    if (existing)
      model.doAction(
        Actions.updateNodeAttributes(panelId, {
          config: { ...existing.getConfig(), initialCommand: request },
        }),
      );
    addPanel("rigControl", "OpenRig control center", { initialCommand: request }, panelId);
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
    const tab: IJsonTabNode = normalizeOptionalTab({
      type: "tab",
      id: id || uid(),
      name,
      component,
      config: { connection: { ...connection }, root, ...config },
    });
    history.current = { past: [], future: [] };
    const landing = model.getActiveTabset() ?? model.getFirstTabSet();
    const maximized = model.getMaximizedTabset();
    if (
      maximized &&
      planOpenInMaximized({
        maximizedId: maximized.getId(),
        targetId: landing?.getId(),
      }) === "restore"
    )
      model.doAction(Actions.maximizeToggle(maximized.getId()));
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
    setRecentPanels((old) =>
      [tab.id!, ...old.filter((id) => id !== tab.id)].slice(0, 500),
    );
    setModal(null);
    log(`Opened ${name}`);
  };
  const openSeat = (seat: Seat) => {
    if (inventoryError) {
      notify("Refresh the connection before opening a stale seat.");
      return;
    }
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
      connection.kind === "local"
        ? localShellLabel(preferences["terminal.localShell"]).replace(
            "Windows PowerShell",
            "PowerShell",
          )
        : "Shell",
      { terminalId: id },
      id,
    );
  };
  const openFile = (
    path: string,
    diff = false,
    line?: number,
    source?: PanelConfig,
  ) => {
    const fileConnection = source?.connection || connection;
    const fileRoot = source?.root || root;
    const id = `${diff ? "diff" : "file"}:${fileConnection.id}:${fileRoot}:${path}`;
    if (!diff)
      setState((s) => ({
        ...s,
        recentFiles: recordRecent(
          s.recentFiles,
          recentKey(fileConnection.id, fileRoot),
          path,
        ),
      }));
    pendingFileFocus.current = id;
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
      { path, line, connection: fileConnection, root: fileRoot },
      id,
    );
    if (existing) focusPanel(id);
  };
  const saveAll = async () => {
    const failures: string[] = [];
    for (const [id, buffer] of getDirtyBuffers()) {
      const c = bufferConfigs.get(id);
      if (!c) continue;
      const content = buffer.content;
      try {
        const result = await window.hrig.edit(c.connection, {
          op: "save",
          root: c.root,
          path: c.path,
          content,
          revision: buffer.revision,
        });
        buffer.saved = content;
        buffer.revision = result.revision;
        persistBuffer(id);
        markDirty(id, buffer.content !== content);
      } catch (e) {
        failures.push(c.path + ": " + (e as Error).message);
      }
    }
    window.dispatchEvent(new Event("hrig:buffers-saved"));
    setFileRevision((n) => n + 1);
    notify(
      failures.length
        ? "Save All: " + failures.join("; ")
        : "All open changes saved",
    );
  };
  const allTabs = () => {
    const tabs: IJsonTabNode[] = [];
    model.visitNodes((node) => {
      if (node instanceof TabNode) tabs.push(node.toJson());
    });
    return tabs;
  };
  const panelGroups = () => {
    const groups: { id: string; name: string }[] = [];
    model.visitNodes((node) => {
      if (node.getType() === "tabset")
        groups.push({
          id: node.getId(),
          name:
            node.getAttributeOwn("name") ||
            node
              .getChildren()
              .map((child) => (child as TabNode).getName())
              .join(" / ") ||
            "Empty group",
        });
    });
    return groups;
  };
  const panelList = () => {
    const rows: NavigablePanel[] = [];
    model.visitNodes((node) => {
      if (!(node instanceof TabNode)) return;
      const config = (node.getConfig() || {}) as Partial<PanelConfig>;
      let group = node.getParent();
      while (group && group.getType() !== "tabset") group = group.getParent();
      const buffer = buffers.get(node.getId());
      rows.push({
        id: node.getId(),
        name: node.getName(),
        component: node.getComponent() || "panel",
        host: config.connection?.name || connection.name,
        root: config.root || root,
        rig: config.seat?.rigName || "",
        seat: config.seat?.name || "",
        path: config.path || "",
        group:
          group?.getAttributeOwn("name") ||
          group
            ?.getChildren()
            .map((child) => (child as TabNode).getName())
            .join(" / ") ||
          "Workspace",
        detached: !!node.getWindow() && node.getWindow() !== window,
        dirty: buffer
          ? buffer.content !== buffer.saved
          : !!node.getConfig()?.dirty,
      });
    });
    return rows;
  };
  const focusPanel = (id: string) => {
    const node = modelRef.current.getNodeById(id) as TabNode | undefined;
    if (!node) {
      setToast("This panel has closed. Open the navigator again.");
      return;
    }
    const activeModel = modelRef.current;
    const maximized = activeModel.getMaximizedTabset(node.getLayoutId());
    let group = node.getParent();
    while (group && group.getType() !== "tabset") group = group.getParent();
    if (maximized && maximized.getId() !== group?.getId())
      activeModel.doAction(Actions.maximizeToggle(maximized.getId()));
    activeModel.doAction(Actions.selectTab(id));
    if (node.getLayoutId() !== Model.MAIN_LAYOUT_ID)
      activeModel.doAction(Actions.movePopoutToFront(node.getLayoutId()));
    modelChanged(activeModel);
    setModal(null);
    requestAnimationFrame(() => {
      if (
        activeModel
          .getActiveTabset(node.getLayoutId())
          ?.getSelectedNode()
          ?.getId() !== id
      )
        return;
      node.getWindow()?.focus();
      const focus = editorFocusers.get(id);
      if (focus) {
        pendingFileFocus.current = null;
        focus();
        return;
      }
      if (["editor", "diff"].includes(node.getComponent() || ""))
        pendingFileFocus.current = id;
      const panel = node
        .getDocument()
        ?.querySelector<HTMLElement>(`[data-panel-id="${CSS.escape(id)}"]`);
      const element = panel?.querySelector<HTMLElement>(
        '.xterm-helper-textarea,.monaco-editor textarea,input,button,[tabindex="0"]',
      );
      (element || panel)?.focus();
    });
  };
  attentionContext.current = { connection, inventory, inventoryError, openSeat, focusPanel };
  const jumpAttention = (captured: Connection, seat: Seat, diagnostic = false): string => {
    const latest = attentionContext.current;
    const current = stateRef.current.connections.find((c) => c.id === stateRef.current.activeConnection) || stateRef.current.connections[0] || local;
    const scope = attentionScope(captured, current, latest.inventory, inventoryHealth.current, latest.inventoryError);
    if (!scope.ready) return scope.reason;
    if (pinConnectionIdentity(latest.connection) !== pinConnectionIdentity(current)) return "Current connection inventory is unavailable. Existing terminal preserved.";
    const reason = attentionJumpEligibility(scope.inventory, seat, diagnostic);
    if (reason) return reason;
    const id = `seat:${current.id}:${seat.id}`;
    try {
    const node = modelRef.current.getNodeById(id) as TabNode | undefined;
    if (node) {
      const config = node.getConfig?.();
      if (node.getComponent?.() !== "terminal" || !config?.connection ||
        pinConnectionIdentity(config.connection) !== pinConnectionIdentity(current) ||
        config.terminalId !== id || config.seat?.id !== seat.id || config.seat?.session !== seat.session ||
        !node.getDocument?.() || !node.getWindow?.() || node.getWindow()?.closed)
        return "Jump is unavailable because an existing terminal belongs to a different or unverified target, or cannot currently be focused. The existing terminal was preserved. Inspect the existing panel or window, its connection and session before trying again.";
      latest.focusPanel(id);
    } else latest.openSeat(scope.inventory!.seats.find((row) => row.id === seat.id)!);
    return "";
    } catch {
      return "This terminal cannot currently be focused. The existing terminal was preserved. Inspect the existing panel or window before trying again.";
    }
  };
  // Ctrl+Tab order, newest first. Kept apart from the navigator's recent list; frozen while Control is held; selecting never touches terminal input.
  const panelMru = useRef(emptyMru());
  useEffect(() => {
    const note = () => {
      panelMru.current = noteActive(panelMru.current, model.getActiveTabset()?.getSelectedNode()?.getId() ?? null);
    };
    note();
    const listener = {
      onAfterAction: (action: Action) => {
        // A close action names the panel that is gone.
        const named = action.data?.node;
        if (typeof named === "string" && !model.getNodeById(named)) panelMru.current = noteClosed(panelMru.current, named);
        note();
      },
    };
    model.addChangeListener(listener);
    return () => model.removeChangeListener(listener);
  }, [model]);
  useEffect(() => {
    const end = () => {
      panelMru.current = endCycle(panelMru.current, modelRef.current.getActiveTabset()?.getSelectedNode()?.getId() ?? null);
    };
    const release = (event: KeyboardEvent) => {
      if (event.key === "Control") end();
    };
    window.addEventListener("keyup", release, true);
    window.addEventListener("blur", end);
    return () => {
      window.removeEventListener("keyup", release, true);
      window.removeEventListener("blur", end);
    };
  }, []);
  const cyclePanel = (direction: 1 | -1, source: EventTarget | null) => {
    const owner = (source as Node | null)?.ownerDocument;
    if (owner && owner !== document) return;
    const step = stepCycle(
      panelMru.current,
      model.getActiveTabset()?.getSelectedNode()?.getId() ?? null,
      direction,
      (id) => {
        const node = model.getNodeById(id);
        return node instanceof TabNode && (!node.getWindow() || node.getWindow() === window);
      },
    );
    panelMru.current = step.state;
    if (step.target !== null) focusPanel(step.target);
  };
  const movePanel = (id: string, target: string, direction: string) => {
    const current = modelRef.current;
    if (
      !current.getNodeById(id) ||
      current.getNodeById(target)?.getType() !== "tabset"
    ) {
      setToast("The panel or destination group is no longer available.");
      return;
    }
    const location = (
      {
        center: DockLocation.CENTER,
        left: DockLocation.LEFT,
        right: DockLocation.RIGHT,
        bottom: DockLocation.BOTTOM,
      } as Record<string, DockLocation>
    )[direction];
    if (!location) return;
    remember();
    current.doAction(Actions.moveNode(id, target, location, -1));
    modelChanged(current);
  };
  const openSeatBeside = (seat: Seat) => {
    if (inventoryError || !seat.session) {openSeat(seat);return;}
    const target = model.getActiveTabset() || model.getFirstTabSet();
    if (!target) {openSeat(seat);return;}
    const id = `seat:${connection.id}:${seat.id}`;
    const existing = model.getNodeById(id) as TabNode | undefined;
    if (existing && existing.getParent() === target && target.getChildren().length === 1) {openSeat(seat);return;}
    if (existing && ((existing.getWindow() && existing.getWindow() !== window) || existing.getLayoutId() !== Model.MAIN_LAYOUT_ID)) {notify("Use the panel navigator to move this detached seat.");return;}
    openSeat(seat);
    if(model.getNodeById(id)) movePanel(id, target.getId(), "right");
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
    announceLayout("preset", preset, next);
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
    announceLayout("sessions", "", next);
  };
  // Keeps only the kind and identifiers needed to reopen; call before the delete.
  const rememberClosed = (id: string) => {
    const node = model.getNodeById(id);
    if (!(node instanceof TabNode)) return;
    closedPanels.current = pushClosed(
      closedPanels.current,
      describeClosedPanel(
        {
          component: node.getComponent(),
          name: node.getName(),
          config: node.getConfig(),
        },
        workspace,
      ),
    );
  };
  // Pod grid: same undoable Team arrangement as openAll, limited to one pod's
  // seats. Opening only attaches terminals; nothing is sent to any session.
  const openPodGrid = (podSeats: Seat[]) => {
    const plan = planPodGrid(podSeats, !inventoryError && sameConnection(connection));
    if (!plan.blocked) {
      remember();
      const existing = allTabs().filter((t) => t.component !== "welcome");
      for (const seat of plan.seats) {
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
    }
    notify(describePodGrid(plan));
  };
  const closeTab = (id: string) => {
    history.current = { past: [], future: [] };
    const node = model.getNodeById(id) as TabNode | undefined;
    const config = node?.getConfig() as PanelConfig | undefined;
    if (config?.terminalId) void window.hrig.closeTerminal(config.terminalId);
    clearBuffer(id);
    dirtyTabs.current.delete(id);
    rememberClosed(id);
    model.doAction(Actions.deleteTab(id));
    modelChanged(model);
  };
  // Closes panels one by one through closeTab. A panel with unsaved edits asks first, like its tab button; Cancel stops the run and leaves the rest open.
  const closePanels = (ids: string[]) => {
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const node = model.getNodeById(id) as TabNode | undefined;
      if (!node) continue;
      if (dirtyTabs.current.has(id)) {
        const rest = ids.slice(i + 1);
        setPending({
          title: "Save your changes?",
          description: dirtyPrompt(node.getName(), rest.length),
          tabId: id,
          run: () => {
            closeTab(id);
            // Deferred: the dialog clears its own state right after run.
            setTimeout(() => closePanels(rest), 0);
          },
        });
        setActionError("");
        return;
      }
      closeTab(id);
    }
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
      rememberClosed(id);
    }
    // A rename typed on the tab itself (double-click or F2) follows the same title rules as the menu for a terminal; other panels keep the built-in rename.
    if (action.type === Actions.RENAME_TAB) {
      const tab = titledTab(action.data.node);
      if (!canRename(tab)) return action;
      const patch = applyCustomTitle(tab, action.data.text);
      return patch
        ? Actions.updateNodeAttributes(action.data.node, patch)
        : undefined;
    }
    return action;
  };
  const markDirty = useCallback((id: string, dirty: boolean) => {
    if (
      dirtyTabs.current.has(id) === dirty &&
      !!(modelRef.current.getNodeById(id) as TabNode | undefined)?.getConfig()
        ?.dirty === dirty
    )
      return;
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
  // The title fields of a tab as the title helpers read them; null when the id is not a tab.
  const titledTab = (id: string) => {
    const node = model.getNodeById(id);
    return node instanceof TabNode
      ? {
          component: node.getComponent(),
          name: node.getName(),
          config: node.getConfig(),
        }
      : null;
  };
  // A title change touches only the tab name and the two title keys of its config. The tab id, the terminal id and the seat are never changed, so the session and everything addressed by an id carry on as before.
  const retitleTab = (id: string, patch: TitlePatch | null) => {
    if (!patch) return;
    model.doAction(Actions.updateNodeAttributes(id, patch));
    modelChanged(model);
  };
  const renamePanel = (id: string, text: string) =>
    retitleTab(id, applyCustomTitle(titledTab(id), text));
  const resetPanelName = (id: string) =>
    retitleTab(id, resetTitle(titledTab(id)));
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
            persistBuffer(tab.getId());
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
  const openSettings = () => {
    setModal(null);
    addPanel("settings", "Settings", {}, "settings");
  };
  // A terminal's Create task from selection arrives as a window event; the draft waits here, addressed to the Task queue tab that opens it, until that board takes it.
  const [taskDraft, setTaskDraft] = useState<{tabId: string; draft: TaskDraft} | null>(null);
  const factory = (node: TabNode) => {
    const config = node.getConfig() as PanelConfig;
    switch (node.getComponent()) {
      case "settings":
        return <DeferredPanel node={node} panelProps={{ project: connection.name + " / " + root }} />;
      case "terminal":
        return (
          <TerminalPanel
            seatActivityAvailable={!!config.seat && freshSeats(config.connection).some((s) => s.id === config.seat?.id)}
            onRelaunch={() => { if (config.seat) setRelaunch({seat: config.seat, connection: config.connection}); }}
            onFile={(path, line) => openFile(path, false, line, config)}
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
                n.getAttributeOwn("name") ||
                n
                  .getChildren()
                  .map((c) => (c as TabNode).getName())
                  .join(" / ") ||
                "Empty group",
            });
        });
        return (
          <ArrangeWorkspace
            model={model.toJson()}
            tabs={allTabs().filter((t) => t.component !== "arranger")}
            groups={groups}
            onRenameGroup={(id, name) => {
              if (model.getNodeById(id)?.getType() !== "tabset") return;
              remember();
              model.doAction(
                Actions.updateNodeAttributes(id, { name: name.slice(0, 80) }),
              );
              modelChanged(model);
            }}
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
                announceLayout("role", template.name, next);
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
      case "rigControl":
        return <RigControl connection={config.connection} root={config.root} inventory={config.connection.id === connection.id ? inventory : null} onFile={(path,line) => openFile(path,false,line,config)} initial={config.initialCommand} />;
      case "attention":
        return (
          <AttentionPanel
            connection={config.connection}
            scope={attentionScope(config.connection, connection, inventory, inventoryHealth.current, inventoryError)}
            inventory={attentionScope(config.connection, connection, inventory, inventoryHealth.current, inventoryError).inventory}
            onSeat={(seat, diagnostic) => jumpAttention(config.connection, seat, diagnostic)}
            notifications={preferences["notifications.desktop"]}
            onNotifications={(value) =>
              settingsContext.update(
                Object.hasOwn(projectPreferences, "notifications.desktop")
                  ? "project"
                  : "user",
                "notifications.desktop",
                value,
              )
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
            key={JSON.stringify([config.connection, config.root])}
            onProject={openProject}
            connection={config.connection}
            root={config.root}
            seats={freshSeats(config.connection).filter(
              (s) => !state.activeRig || s.rigId === state.activeRig,
            )}
            checks={state.reviewChecks}
            onChecks={(update) =>
              setState((s) => {
                const current = normalizeReviewChecks(s.reviewChecks);
                const next = update(current);
                return next === current ? s : { ...s, reviewChecks: next };
              })
            }
            onSeat={(seat) => {
              openSeat(seat);
              applyPreset("Review");
            }}
            onDiff={(path) => {
              addPanel(
                "diff",
                path.split("/").pop() || path,
                { ...config, path },
                `diff:${config.connection.id}:${config.root}:${path}`,
              );
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
          <fieldset
            className="panel-guard"
            disabled={!!inventoryError || !sameConnection(config.connection)}
          >
            <RigManager
              onDeleted={(id) => {
                setState((s) =>
                  s.activeConnection === config.connection.id &&
                  s.activeRig === id
                    ? { ...s, activeRig: "" }
                    : s,
                );
                notify("Rig deleted");
              }}
              connection={config.connection}
              root={config.root}
              inventory={inventory}
              onChanged={refreshAll}
              onSeat={openSeat}
            />
          </fieldset>
        );
      case "savedDrafts":
        return (
          <SavedDrafts
            onOpen={(c) =>
              addPanel(
                "editor",
                c.path?.split(/[\\/]/).pop() || "Recovery",
                c,
                `file:${c.connection.id}:${c.root}:${c.path}`,
              )
            }
          />
        );
      case "workItems":
        return (
          <WorkItems
            key={JSON.stringify([config.connection, config.root])}
            connection={config.connection}
            root={config.root}
            seats={
              inventoryError || !sameConnection(config.connection) ? [] : seats
            }
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
          <DeferredPanel
            node={node}
            panelProps={{
              id: node.getId(),
              config,
              diff: node.getComponent() === "diff",
              onReady: (id) => {
                if (pendingFileFocus.current !== id) return false;
                pendingFileFocus.current = null;
                return (
                  modalRef.current === null &&
                  modelRef.current
                    .getActiveTabset(node.getLayoutId())
                    ?.getSelectedNode()
                    ?.getId() === id
                );
              },
              onDirty: markDirty,
              onSaved: () => {
                setFileRevision((n) => n + 1);
                notify("File saved");
              },
              onLoadFailed: () => {
                const failed = config.path;
                if (failed)
                  setState((s) => ({
                    ...s,
                    recentFiles: removeRecent(
                      s.recentFiles,
                      recentKey(config.connection.id, config.root),
                      failed,
                    ),
                  }));
              },
            }}
          />
        );
      case "queue":
        return (
          <TaskBoard
            connection={config.connection}
            rigName={config.mode}
            seats={freshSeats(config.connection)}
            onSeat={openSeat}
            draft={taskDraft && taskDraft.tabId === node.getId() ? taskDraft.draft : null}
            onDraftTaken={() => setTaskDraft(null)}
            root={config.root}
            onFile={(path, line) => openFile(path, false, line, config)}
            savedFilters={resolveTaskFilters(
              state.taskFilters,
              config.connection.id,
            )}
            onFilters={(next) =>
              setState((s) => ({
                ...s,
                taskFilters: saveTaskFilters(
                  s.taskFilters,
                  config.connection.id,
                  next,
                ),
              }))
            }
          />
        );
      case "messages":
        return (
          <MessagePanel
            key={JSON.stringify([config.connection, config.root])}
            root={config.root}
            connection={config.connection}
            seats={freshSeats(config.connection)}
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
            recents={welcomeRecents(projectHistory)}
            connections={state.connections}
            onOpenRecent={openRecentProject}
          />
        );
    }
  };
  const [snippetTarget, setSnippetTarget] = useState<{id: string; name: string; connection: string; context: SnippetContext} | null>(null);
  const [snippetDraft, setSnippetDraft] = useState<SnippetDraft | null>(null);
  const openPalette = () => {
    projectIntent.current++;
    setSearch("");
    setModal("palette");
  };
  const openQuickOpen = () => {
    projectIntent.current++;
    window.focus();
    setModal("quickOpen");
  };
  const openPanelNavigator = () => {
    projectIntent.current++;
    window.focus();
    setModal("panels");
  };
  const openShortcuts = () => {
    projectIntent.current++;
    window.focus();
    setModal("shortcuts");
  };
  const openHostTint = () => {
    projectIntent.current++;
    setModal("hostTint");
  };
  // Go to line opens Monaco's own prompt in the editor that has text focus once
  // the command center has handed the focus back; nothing is typed or sent.
  const goToLine = () => {
    requestAnimationFrame(() => {
      const opened = [...editorLineJumpers.values()].some((jump) => jump());
      if (!opened) setToast("Click an editor first");
    });
  };
  const terminalTabs = allTabs().filter(t => t.component === "terminal" && t.config?.terminalId && !t.config?.rigControlToken);
  const terminalCommands = terminalTabs.flatMap(t => {
    const config = t.config as PanelConfig;
    const target = {id: config.terminalId!, name: t.name || "Terminal", connection: config.connection.name, context: snippetContext(config.connection, config.root, config.seat)};
    return [
      ...(["focus", "clear", "find", "reconnect"] as TerminalCommand[]).map(command => ({
        name: `Terminal: ${command[0].toUpperCase() + command.slice(1)}`,
        hint: `${target.name} · ${config.connection.name} · ${target.id}` +
          (command === "clear" ? ` · ${clearShortcutLabel(window.hrig.platform)}` : ""),
        icon: <Columns2 size={16} />,
        action: () => {
          model.doAction(Actions.selectTab(t.id!));
          requestAnimationFrame(() => sendTerminalCommand(target.id, command));
        },
      })),
      {name: "Terminal: Saved snippets", hint: `${target.name} · ${config.connection.name} · ${target.id}`, icon: <Columns2 size={16} />,
        action: () => {model.doAction(Actions.selectTab(t.id!));setSnippetTarget(target);}},
      {name: "Terminal: Create task from selection", hint: `${target.name} · ${config.connection.name} · ${target.id}`, icon: <Columns2 size={16} />,
        action: () => {model.doAction(Actions.selectTab(t.id!));requestAnimationFrame(() => sendTerminalCommand(target.id, "task-from-selection"));}},
    ];
  });
  // A terminal's Save selection as snippet arrives as a window event; this only opens Saved snippets filled in, and it saves and sends nothing.
  const openSnippetDraft = useRef<(id: string, draft: SnippetDraft) => void>(() => undefined);
  openSnippetDraft.current = (id, draft) => {
    const tab = terminalTabs.find(t => (t.config as PanelConfig).terminalId === id);
    if (!tab) { notify("Saved snippets are not available in this terminal"); return; }
    const cfg = tab.config as PanelConfig;
    setSnippetTarget({id, name: tab.name || "Terminal", connection: cfg.connection.name, context: snippetContext(cfg.connection, cfg.root, cfg.seat)});
    setSnippetDraft(draft);
  };
  useEffect(() => onSnippetDraft((id, draft) => openSnippetDraft.current(id, draft)), []);
  // A terminal's Create task from selection only opens the Task queue's Assign work dialog filled in (the existing board for that connection, else a new one); it creates and sends nothing. The seat of that terminal travels along as a suggestion only.
  const openTaskDraft = useRef<(id: string, draft: TaskDraft) => void>(() => undefined);
  openTaskDraft.current = (id, draft) => {
    const tab = terminalTabs.find(t => (t.config as PanelConfig).terminalId === id);
    if (!tab) { notify("Create task from selection is not available in this terminal"); return; }
    const cfg = tab.config as PanelConfig;
    const board = allTabs().find(t => t.component === "queue" && (t.config as PanelConfig).connection.id === cfg.connection.id);
    const tabId = board?.id || uid();
    if (board) model.doAction(Actions.selectTab(tabId));
    else addPanel("queue", "Task queue", {connection: cfg.connection, mode: currentRig?.name}, tabId);
    setTaskDraft({tabId, draft: {...draft, suggested: cfg.seat ? cfg.seat.name + "@" + cfg.seat.rigName : ""}});
  };
  useEffect(() => onTaskDraft((id, draft) => openTaskDraft.current(id, draft)), []);
  const droppedNow = droppedIds(droppedTerminals, terminalTabs.map(t => (t.config as PanelConfig).terminalId!));
  const reconnectDropped = () => {
    const count = reconnectAllDropped(droppedNow, id => sendTerminalCommand(id, "reconnect-dropped"));
    if (count > 0) notify(reconnectNotice(count));
  };
  // Hides the sidebar and the status bar for this session; leaving puts the sidebar back as it was.
  const toggleFocusMode = () => {
    const step = toggleFocus(focusMode, {
      sidebar,
      statusBar: preferences["appearance.statusBar"],
    });
    setFocusMode(step.state);
    if (step.view) setSidebar(step.view.sidebar);
  };
  // Opening the sidebar by any route (Ctrl+B, the palette, the rail, a project) ends focus mode and keeps it open.
  useEffect(
    () => setFocusMode((f) => focusAfterSidebar(f, sidebar)),
    [sidebar],
  );
  // Maximize only flips flexlayout's flag on one group: nothing is rebuilt, moved or resized by hand.
  const toggleMaximize = (
    request: MaximizeRequest,
    source: EventTarget | null,
  ) => {
    const holder = (source as Element | null)?.closest?.("[data-panel-id]");
    const panel = holder
      ? model.getNodeById(holder.getAttribute("data-panel-id") || "")
      : undefined;
    let owner = panel ? panel.getParent() : undefined;
    while (owner && !(owner instanceof TabSetNode)) owner = owner.getParent();
    const focused =
      owner instanceof TabSetNode
        ? owner
        : model.getActiveTabset() || model.getFirstTabSet();
    const layoutId = focused ? focused.getLayoutId() : Model.MAIN_LAYOUT_ID;
    let groups = 0;
    model.visitNodes((node) => {
      if (node instanceof TabSetNode && node.getLayoutId() === layoutId)
        groups++;
    });
    const plan = planMaximize(request, {
      tabsetId: focused ? focused.getId() : null,
      enabled: !!focused && focused.isEnableMaximize(),
      groups,
      maximizedId: model.getMaximizedTabset(layoutId)?.getId() ?? null,
    });
    if (plan.action === "none") {
      setToast(plan.message);
      return;
    }
    remember();
    model.doAction(Actions.maximizeToggle(plan.tabsetId, layoutId));
  };
  // Reopens only through openFile and openSeat, the same paths the sidebar uses.
  const reopenClosedPanel = () => {
    const { entry, stack } = popLatest(closedPanels.current, workspace);
    if (!entry) {
      setToast("Nothing to reopen");
      return;
    }
    const plan = planReopen(entry, {
      connectionIds: state.connections.map((c) => c.id),
      activeConnectionId: connection.id,
      inventoryReady: !!inventory && !inventoryError,
      seats: seats.map((s) => ({ id: s.id, session: s.session })),
    });
    closedPanels.current =
      plan.action === "skip" && plan.keep ? pushClosed(stack, entry) : stack;
    if (plan.action === "openFile") {
      const target = state.connections.find((c) => c.id === plan.connectionId);
      if (target)
        openFile(plan.path, plan.diff, plan.line, {
          connection: target,
          root: plan.root,
        });
    } else if (plan.action === "openSeat") {
      const seat = seats.find((s) => s.id === plan.seatId);
      if (seat) openSeat(seat);
    } else setToast(plan.message);
  };
  const commands = [
    {
      name: "Quick Open project file",
      hint: "Ctrl P",
      icon: <FileCode2 size={16} />,
      action: openQuickOpen,
    },
    {
      name: "Find open panels",
      hint: "Ctrl Shift P",
      icon: <Columns2 size={16} />,
      action: openPanelNavigator,
    },
    {
      name: "Save All",
      hint: "All open files",
      icon: <Save size={16} />,
      action: () => void saveAll(),
    },
    {
      name: "Saved drafts and recovery",
      hint: "Local recovery storage",
      icon: <Save size={16} />,
      action: () =>
        addPanel("savedDrafts", "Saved drafts", {}, "tool:savedDrafts"),
    },
    {
      name: "Open settings",
      hint: "Preferences and themes",
      icon: <Settings2 size={16} />,
      action: openSettings,
    },
    {
      name: "Toggle sidebar",
      hint: "Ctrl B",
      icon: <PanelLeft size={16} />,
      action: () => setSidebar((v) => !v),
    },
    {
      name: "Toggle status bar",
      hint: "Appearance setting",
      icon: <PanelBottom size={16} />,
      action: () =>
        settingsContext.update(
          Object.hasOwn(projectPreferences, "appearance.statusBar")
            ? "project"
            : "user",
          "appearance.statusBar",
          !preferences["appearance.statusBar"],
        ),
    },
    {
      name: "Toggle focus mode",
      hint: `Hide the sidebar and status bar · ${focusModeShortcutHint(window.hrig.platform)}`,
      icon: <Focus size={16} />,
      action: toggleFocusMode,
    },
    {
      name: "Open welcome guide",
      hint: "Workspace guide",
      icon: <CircleHelp size={16} />,
      action: () => setModal("guide"),
    },
    {
      name: "Open keyboard shortcuts",
      hint: "?",
      icon: <Keyboard size={16} />,
      action: openShortcuts,
    },
    {
      name: "Go to line",
      hint: "Ctrl G in the editor",
      icon: <FileCode2 size={16} />,
      action: goToLine,
    },
    ...[
      ["Visual workspace arranger", "arranger"],
      ["Task boards and integrations", "workItems"],
      ["Connection doctor", "doctor"],
      ["Attention center", "attention"],
      ["Project tools and text search", "projectTools"],
      ["Review workspace", "review"],
      ["Problems", "problems"],
      ["Ports and previews", "ports"],
      ["Rig manager", "rigManager"],
      ["OpenRig control center", "rigControl"],
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
      name: "Set host label and tint",
      hint: "Mark production or development hosts in terminal headers",
      icon: <Network size={16} />,
      action: openHostTint,
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
      name: "Reopen closed panel",
      hint: `Latest closed file or seat · ${reopenShortcutHint(window.hrig.platform)}`,
      icon: <PanelTop size={16} />,
      action: reopenClosedPanel,
    },
    {
      name: "Maximize panel",
      hint: `Fill the workspace with the focused group · ${maximizeShortcutHint(window.hrig.platform)}`,
      icon: <Square size={16} />,
      action: () => toggleMaximize("maximize", null),
    },
    {
      name: "Restore panel layout",
      hint: `Show every panel group again · ${maximizeShortcutHint(window.hrig.platform)}`,
      icon: <LayoutGrid size={16} />,
      action: () => toggleMaximize("restore", null),
    },
    {
      name: "Open all rig sessions",
      hint: `${seats.length} seats`,
      icon: <Columns2 size={16} />,
      action: openAll,
    },
    {
      name: "Refresh rigs and workspace",
      hint: "Seats and project files",
      icon: <RefreshCw size={16} />,
      action: refreshAll,
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
    ...seats.map(seat => ({name: `Open ${seat.name} beside current`, hint: `${seat.rigName} · ${connection.name}`, icon: <Columns2 size={16}/>, action: () => openSeatBeside(seat)})),
    ...terminalCommands,
    ...(droppedNow.length > 0
      ? [{name: "Terminal: " + droppedLabel(droppedNow.length), hint: "Re-attach ended or errored terminals · others untouched", icon: <RefreshCw size={16} />, action: reconnectDropped}]
      : []),
  ];
  const shownCommands = withEffectiveHints(commands, window.hrig.platform, shortcutOverrides);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.altKey) return;
      // The focused terminal owns its clear shortcut; leave the key untouched.
      if (terminalOwnsKey(event, window.hrig.platform, event.target)) return;
      // A bare ? outside fields, the editor and terminals opens the shortcut sheet.
      if (isHelpKey(event, event.target, modal !== null || hasOpenDialog(event.target))) {
        event.preventDefault();
        event.stopPropagation();
        openShortcuts();
        return;
      }
      // Overridden chords run their shortcut; the old keys of a moved one go back to the terminal.
      const rebound = routeOverriddenKey(event, window.hrig.platform, shortcutOverrides);
      if (rebound !== null) {
        if (rebound.id === null) return;
        event.preventDefault();
        event.stopPropagation();
        if (modal === null && !hasOpenDialog(event.target)) {
          if (rebound.id === "workspace.reopenPanel") reopenClosedPanel();
          else if (rebound.id === "workspace.maximizePanel") toggleMaximize("toggle", event.target);
          else toggleFocusMode();
        }
        return;
      }
      // Claimed always so it never reaches a shell; acts only with no dialog open.
      if (isReopenPanelKey(event, window.hrig.platform)) {
        event.preventDefault();
        event.stopPropagation();
        if (modal === null && !hasOpenDialog(event.target)) reopenClosedPanel();
        return;
      }
      // Same rule: claimed so no shell sees it, and Escape never restores.
      if (isMaximizePanelKey(event, window.hrig.platform)) {
        event.preventDefault();
        event.stopPropagation();
        if (modal === null && !hasOpenDialog(event.target))
          toggleMaximize("toggle", event.target);
        return;
      }
      // Same rule: claimed so no shell sees it; focus mode never writes a preference.
      if (isFocusModeKey(event, window.hrig.platform)) {
        event.preventDefault();
        event.stopPropagation();
        if (modal === null && !hasOpenDialog(event.target)) toggleFocusMode();
        return;
      }
      // Same rule: claimed (a shell would get a plain Tab), acts once per press and only with no dialog open.
      if (isPanelCycleKey(event)) {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat && modal === null && !hasOpenDialog(event.target))
          cyclePanel(event.shiftKey ? -1 : 1, event.target);
        return;
      }
      if (event.ctrlKey || event.metaKey) {
        if (
          [",", "k", "o", "b", "p"].includes(event.key.toLowerCase()) ||
          (event.shiftKey && event.key.toLowerCase() === "t")
        ) {
          event.preventDefault();
          event.stopPropagation();
        }
        if (event.key.toLowerCase() === "p") {
          event.preventDefault();
          event.stopPropagation();
          event.shiftKey ? openPanelNavigator() : openQuickOpen();
          return;
        }
        if (event.key === ",") {
          event.preventDefault();
          openSettings();
        }
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
    const windows = [
      ...new Set(
        [...themeDocuments.current]
          .map((doc) => doc.defaultView)
          .filter((value): value is Window & typeof globalThis => !!value),
      ),
    ];
    for (const target of windows)
      target.addEventListener("keydown", handler, true);
    return () => {
      for (const target of windows)
        target.removeEventListener("keydown", handler, true);
    };
  });
  const chooseConnection = (id: string) => {
    projectIntent.current++;
    setProjectOpening(false);
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
    const startWidth = normalizeSidebarWidth(state.sidebarWidth);
    const move = (e: PointerEvent) =>
      setState((s) => ({
        ...s,
        sidebarWidth: dragSidebarWidth(startWidth, startX, e.clientX),
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
  const sidebarFileOwner = fileTreeOwner(connection, root);
  const activeFile = (() => {
    const selected = model.getActiveTabset()?.getSelectedNode();
    if (!selected || !["editor", "diff"].includes(selected.getComponent() ?? "")) return null;
    const config = selected.getConfig() as PanelConfig;
    return config?.connection && typeof config.root === "string" && typeof config.path === "string"
      ? config as PanelConfig & { path: string } : null;
  })();
  return (
    <SettingsContext.Provider value={settingsContext}>
      <HostTintContext.Provider value={hostTints}>
      <div className="app" inert={updateRestarting || undefined}>
        {transcriptView && <SeatTranscript key={transcriptView.connection.id + transcriptView.seat.id} connection={transcriptView.connection} seat={transcriptView.seat} others={freshSeats(transcriptView.connection)} onClose={() => setTranscriptView(null)} />}
        {quickMessage && <SeatMessage key={quickMessage.connection.id + quickMessage.seat.id} connection={quickMessage.connection} seat={quickMessage.seat} onClose={() => setQuickMessage(null)} onSent={(m) => { setQuickMessage(null); notify(m); }} />}
        {promptView && <SeatPrompt key={promptView.connection.id + promptView.seat.id} connection={promptView.connection} seat={promptView.seat} onClose={() => setPromptView(null)} />}
        {relaunch && <RelaunchSession key={relaunch.connection.id + relaunch.seat.id} connection={relaunch.connection} seat={relaunch.seat} onClose={() => setRelaunch(null)} onDone={() => {
          window.dispatchEvent(new CustomEvent("hrig:session-relaunched", {detail:{connectionId:relaunch.connection.id, seatId:relaunch.seat.id}}));
          refreshAll(); setRelaunch(null); notify("Fresh session launched. Checking readiness...");
        }}/> }
        <header className="titlebar">
          <div className="brand">
            <span className="brand-mark">
              <Layers3 size={18} />
            </span>
            <strong>
              hRig
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
        {recoveryCount > 0 && (
          <div className="editor-notice" role="status">
            {recoveryCount} unsaved recovery{" "}
            {recoveryCount === 1 ? "copy" : "copies"} available.{" "}
            <button
              className="small-button"
              onClick={() => {
                addPanel("savedDrafts", "Saved drafts", {}, "tool:savedDrafts");
                setRecoveryCount(0);
              }}
            >
              Review saved drafts
            </button>
          </div>
        )}
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
                <Network size={18} />
              </IconButton>
              <IconButton title="Settings" onClick={openSettings}>
                <Settings2 size={20} />
              </IconButton>
              <span className="rail-avatar">H</span>
            </div>
          </nav>
          {sidebar && (
            <div
              className="sidebar-container"
              style={{ width: normalizeSidebarWidth(state.sidebarWidth) }}
            >
              <Sidebar
                onManageRigs={() =>
                  addPanel(
                    "rigManager",
                    "Rig manager",
                    {},
                    `rig-manager-${connection.id}-${root}`,
                  )
                }
                section={section}
                connection={connection}
                root={root}
                inventory={inventory}
                inventoryError={inventoryError}
                busy={busy}
                selectedRig={state.activeRig}
                pinnedSeats={state.pinnedSeats || []}
                pinsAvailable={pinsAvailable}
                collapsedPods={state.collapsedPods || []}
                podsAvailable={podsAvailable}
                onTogglePod={(seat) => {
                  if (!podsAvailable) return;
                  setState((s) => {
                    const current = s.connections.find((c) => c.id === s.activeConnection) ||
                      s.connections[0] || local;
                    if (pinConnectionIdentity(current) !== pinOwner) return s;
                    return {
                      ...s,
                      collapsedPods: togglePodCollapsed(s.collapsedPods, podIdentity(current, seat)),
                    };
                  });
                }}
                onToggleSeatPin={(seat) => {
                  if (!pinsAvailable) return;
                  setState((s) => {
                    const current = s.connections.find((c) => c.id === s.activeConnection) ||
                      s.connections[0] || local;
                    if (pinConnectionIdentity(current) !== pinOwner) return s;
                    return {
                      ...s,
                      pinnedSeats: toggleSeatPin(s.pinnedSeats, seatPinIdentity(current, seat.id)),
                    };
                  });
                }}
                onRig={(id) => setState((s) => ({ ...s, activeRig: id }))}
                onRigAction={(rigId, actionId) => openRigAction(rigId, actionId)}
                onRefresh={refreshAll}
                onProject={openProject}
                onConnect={openConnect}
                onSeat={openSeat}
                onSeatBeside={openSeatBeside}
                onSeatPrompt={(seat) => setPromptView({seat, connection})}
                onSeatTranscript={(seat) => setTranscriptView({seat, connection})}
                onPodGrid={(podSeats) => openPodGrid(podSeats)}
                onSeatMessage={(seat) => setQuickMessage({seat, connection})}
                onRelaunch={(seat) => setRelaunch({seat, connection})}
                onDrag={dragSeat}
                activeFile={activeFile}
                onFile={(path) => {
                  const latest = stateRef.current;
                  const current = latest.connections.find(c => c.id === latest.activeConnection) || latest.connections[0] || local;
                  if (modelRef.current !== model || fileTreeOwner(current, latest.roots[current.id] || current.root) !== sidebarFileOwner) return;
                  openFile(path, false, undefined, { connection, root });
                }}
                onDiff={(path) => {
                  const latest = stateRef.current;
                  const current = latest.connections.find(c => c.id === latest.activeConnection) || latest.connections[0] || local;
                  if (modelRef.current !== model || fileTreeOwner(current, latest.roots[current.id] || current.root) !== sidebarFileOwner) return;
                  openFile(path, true, undefined, { connection, root });
                }}
                fileRevision={fileRevision}
                notes={state.seatNotes}
                onNote={(seat, text) => {
                  const now = Date.now();
                  setState((s) => {
                    const current = normalizeSeatNotes(s.seatNotes);
                    const next = setNote(
                      current,
                      noteKey(connection.id, seat.id),
                      text,
                      now,
                    );
                    return next === current ? s : { ...s, seatNotes: next };
                  });
                }}
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
                        <button
                          key={c.id}
                          onClick={() => chooseConnection(c.id)}
                        >
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
                {(() => {
                  const status = connectionStatus({
                    error: inventoryError,
                    hasInventory: !!inventory,
                    busy,
                    local: connection.kind === "local",
                  });
                  return (
                    <span className={`connection-state ${status.error ? "error" : ""}`}>
                      <StatusDot status={status.dot} />
                      {status.label}
                    </span>
                  );
                })()}
              </div>
              <div className="workspace-actions">
                <IconButton
                  title="Quick Open project file (Ctrl P)"
                  onClick={openQuickOpen}
                >
                  <Search size={15} />
                </IconButton>
                <button
                  className="toolbar-button"
                  onClick={openPanelNavigator}
                  title="Find open panels (Ctrl Shift P)"
                >
                  <Columns2 size={14} />
                  <span className="navigation-toolbar-label">Panels</span>
                </button>
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
                              tabIndex={0}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  e.currentTarget.click();
                                }
                              }}
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
            <div
              className="layout-host"
              data-workspace-model-ready={loaded && !bootError && modelOwners.current.get(model) === workspace ? "true" : undefined}
            >
              <Layout
                ref={layout}
                model={model}
                factory={(node) => (
                  <div
                    className="navigation-panel-content"
                    data-panel-id={node.getId()}
                    tabIndex={-1}
                  >
                    <PanelBoundary label={node.getName?.()}>{factory(node)}</PanelBoundary>
                  </div>
                )}
                onModelChange={modelChanged}
                onAction={onAction}
                onContextMenu={(node, event) => {
                  if (!(node instanceof TabNode)) return;
                  if (event.currentTarget.ownerDocument !== document) return;
                  let group = node.getParent();
                  while (group && group.getType() !== "tabset") group = group.getParent();
                  if (!(group instanceof TabSetNode)) return;
                  event.preventDefault();
                  setTabMenu({
                    x: event.clientX,
                    y: event.clientY,
                    id: node.getId(),
                    panels: group.getTabNodes().map((tab) => ({
                      id: tab.getId(),
                      name: tab.getName(),
                      kind: panelKind(tab.getComponent(), tab.getConfig()),
                      dirty: dirtyTabs.current.has(tab.getId()),
                      locked: tab.isPinned() || !tab.isCloseable(),
                    })),
                  });
                }}
                realtimeResize
                onPopoutOpen={(_layout, _window, doc) => {
                  themeDocuments.current.add(doc);
                  setRevision((n) => n + 1);
                  applyTheme(doc, preferences, systemDark);
                }}
                onPopoutClose={(_layout, _window, doc) => {
                  themeDocuments.current.delete(doc);
                  setRevision((n) => n + 1);
                }}
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
                  const groupName = node.getAttributeOwn("name");
                  if (groupName)
                    values.leading = (
                      <span className="navigation-group-name" title={groupName}>
                        {groupName}
                      </span>
                    );
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
        {showStatusBar(focusMode, preferences["appearance.statusBar"]) && (
          <footer className="statusbar">
            {isVisible("accounts", hiddenStatusItems) && (
              <AccountStatus connection={connection} />
            )}
            <div>
              {isVisible("connection", hiddenStatusItems) && (
              <span className="status-connection">
                <button
                  type="button"
                  className="status-brand status-connection-button"
                  aria-haspopup="menu"
                  aria-expanded={menu === "statusConnection"}
                  title={`Connection: ${connection.name}. Choose another configured connection.`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenu(menu === "statusConnection" ? null : "statusConnection");
                  }}
                >
                  <Network size={11} />
                  {connection.kind === "local"
                    ? "Local workspace"
                    : `${connection.kind.toUpperCase()}: ${connection.name}`}
                  <ChevronDown size={10} aria-hidden="true" />
                </button>
                {menu === "statusConnection" && (
                  <div className="dropdown status-connection-menu" role="menu" aria-label="Connections">
                    {state.connections.map((c) => (
                      <button
                        key={c.id}
                        role="menuitemradio"
                        aria-checked={c.id === connection.id}
                        onClick={() => chooseConnection(c.id)}
                      >
                        <Network size={14} />
                        <span>{c.name}</span>
                        <small>{c.kind.toUpperCase()}</small>
                        {c.id === connection.id && <Check size={13} />}
                      </button>
                    ))}
                  </div>
                )}
              </span>
              )}
              {isVisible("source-control", hiddenStatusItems) && (
              <GitInfoStatus connection={connection} root={root} revision={fileRevision}
                onOpen={() => {
                  setSection("changes");
                  setSidebar(true);
                }}
              />
              )}
              <RigHealthStatus
                scope={attentionScope(connection, connection, inventory, inventoryHealth.current, inventoryError)}
                rigId={state.activeRig}
                onOpen={() => {
                  setSection("sessions");
                  setSidebar(true);
                }}
              />
            </div>
            <div>
              {droppedNow.length > 0 && isVisible("reconnect", hiddenStatusItems) && (
                <>
                  <button
                    onClick={reconnectDropped}
                    title="Re-attach every ended or errored terminal. Connected terminals are not touched."
                  >
                    <RefreshCw size={11} />
                    {droppedLabel(droppedNow.length)}
                  </button>
                  {statusSeparators.afterReconnect && (
                    <span className="status-divider" />
                  )}
                </>
              )}
              {isVisible("sessions", hiddenStatusItems) && (
                <span>
                  {tabCount} {tabCount === 1 ? "session" : "sessions"} open
                </span>
              )}
              {statusSeparators.betweenSessionsAndLayout && (
                <span className="status-divider" />
              )}
              {isVisible("layout", hiddenStatusItems) && (
                <span>
                  <Check size={11} />
                  Layout autosaved
                </span>
              )}
              {isVisible("activity", hiddenStatusItems) && (
                <button onClick={() => addPanel("activity", "Activity")}>
                  <Activity size={12} />
                </button>
              )}
            </div>
          </footer>
        )}
        <UpdateNotice />
        {toast && (
          <div
            className="toast"
            role="status"
            onMouseEnter={() => setToastHover(true)}
            onMouseLeave={() => setToastHover(false)}
          >
            <Check size={15} />
            {toast}
            {undoOffered && (
              <button className="small-button" onClick={undoFromToast}>
                {UNDO_LABEL}
              </button>
            )}
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
                disabled={!isWindows}
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
                        port: e.target.value
                          ? Number(e.target.value)
                          : undefined,
                      }))
                    }
                  />
                </label>
                <p className="field-note">
                  Uses system OpenSSH and your SSH config. For a new host or
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
                  setConnectionForm((c) => ({
                    ...c,
                    rigBinary: e.target.value,
                  }))
                }
              />
            </label>
            <p className="field-note">
              OpenRig, tmux, and Python 3 must be available on the target. HRig
              attaches to existing seats.
            </p>
            {formError && <ErrorBox error={formError} />}
            <div className="modal-actions">
              <button
                className="secondary-button"
                onClick={() => setModal(null)}
              >
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
                  "Project boards and integrations",
                  "workItems",
                  "Local tasks, GitHub Issues/Projects, and Linear",
                ],
                [
                  "Saved drafts and recovery",
                  "savedDrafts",
                  "Restore files and manage local drafts",
                ],
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
                  "Settings",
                  "settings",
                  "Themes, editor, terminal, and workspace preferences",
                ],
                [
                  "Rig manager",
                  "rigManager",
                  "Topology and confirmed lifecycle actions",
                ],
                ["OpenRig control center", "rigControl", "All installed commands with guided forms, tooltips, help and action review"],
              ].map(([name, component, description]) => (
                <button
                  key={component}
                  onClick={() =>
                    component === "settings"
                      ? openSettings()
                      : addPanel(
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
          <ProjectHub
            connection={connection}
            connections={state.connections}
            history={projectHistory}
            path={projectPath}
            onPath={setProjectPath}
            folders={[...projectFolders].sort(
              (a, b) =>
                Number(b.rigs.some((r) => r.id === state.activeRig)) -
                Number(a.rigs.some((r) => r.id === state.activeRig)),
            )}
            loading={projectsLoading}
            error={formError || projectsError}
            opening={projectOpening}
            onOpen={(path, target, rigId, rigName) =>
              void applyProject(path, target, rigId, rigName)
            }
            onClose={closeProject}
            onPin={(id) => {
              const entry = projectHistory.find((p) => p.id === id);
              if (!entry) return;
              if (
                !entry.pinned &&
                projectHistory.filter((p) => p.pinned).length >= 50
              ) {
                setFormError("You can pin up to 50 projects. Unpin one first.");
                return;
              }
              setState((s) => ({
                ...s,
                projectHistory: normalizeHistory(s.projectHistory).map((p) =>
                  p.id === id ? { ...p, pinned: !p.pinned } : p,
                ),
              }));
            }}
            onRemove={(id) =>
              setState((s) => ({
                ...s,
                projectHistory: normalizeHistory(s.projectHistory).filter(
                  (p) => p.id !== id,
                ),
              }))
            }
          />
        )}
        {modal === "quickOpen" && (
          <QuickOpen
            connection={connection}
            root={root}
            recent={recentsFor(state.recentFiles, recentKey(connection.id, root))}
            onClose={() => setModal(null)}
            onOpen={(path, line) => {
              setModal(null);
              openFile(path, false, line);
            }}
          />
        )}
        {modal === "panels" && (
          <PanelNavigator
            panels={panelList()}
            recent={recentPanels}
            groups={panelGroups()}
            onFocus={focusPanel}
            onMove={movePanel}
            onClose={() => setModal(null)}
          />
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
              <button
                className="secondary-button"
                onClick={() => setModal(null)}
              >
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
        {snippetTarget && <TerminalSnippets name={snippetTarget.name} connection={snippetTarget.connection} terminalId={snippetTarget.id}
          snippets={state.terminalSnippets || []}
          context={snippetTarget.context}
          draft={snippetDraft}
          onChange={terminalSnippets => setState(s => ({...s,terminalSnippets}))}
          onInsert={(text,run) => requestAnimationFrame(() => sendTerminalCommand(snippetTarget.id,run ? "run" : "insert",text))}
          onClose={() => {setSnippetTarget(null);setSnippetDraft(null);}} />}
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
                    const item = pickFirst(shownCommands, search);
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
              {filterCommands(shownCommands, search)
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
        {modal === "shortcuts" && (
          <ShortcutSheet
            platform={window.hrig.platform}
            overrides={overridesText}
            onSave={saveShortcutOverrides}
            onClose={() => setModal(null)}
          />
        )}
        {modal === "hostTint" && (
          <HostTintDialog
            connections={state.connections}
            tints={hostTints}
            onSave={(next) => {
              setState((s) => ({ ...s, hostTints: next }));
              setModal(null);
              notify("Host labels and tints saved");
            }}
            onClose={() => setModal(null)}
          />
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
                  text: "Ctrl K: command center · Ctrl O: open project · Ctrl P: quick open file · Ctrl Shift P: find panels · Ctrl B: sidebar · Ctrl Shift T: shell · Ctrl Shift K: clear terminal (Cmd K on macOS) · Ctrl S: save file. Press ? for the full list.",
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
        <PanelContextMenu
          menu={tabMenu}
          renamed={!!tabMenu && isRenamed(titledTab(tabMenu.id))}
          onDismiss={() => setTabMenu(null)}
          onClosePanels={closePanels}
          onRenamePanel={renamePanel}
          onResetPanel={resetPanelName}
        />
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
      {updateRestarting && (
        <div
          className="modal-backdrop"
          role="alertdialog"
          aria-modal="true"
          aria-label="Installing update"
        >
          <div className="modal">
            <h2>Restarting HRig</h2>
            <p>
              Your workspace is saved. Existing OpenRig agents keep running.
            </p>
          </div>
        </div>
      )}
      </HostTintContext.Provider>
    </SettingsContext.Provider>
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
