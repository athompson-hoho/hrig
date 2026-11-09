import type { IJsonModel } from "flexlayout-react";
export interface SeatAttentionRequest {
  seatName: string;
}
export interface SeatAttentionResult {
  status: "ignored" | "requested";
}
export interface Connection {
  id: string;
  name: string;
  kind: "local" | "wsl" | "ssh";
  distro?: string;
  host?: string;
  port?: number;
  root: string;
  rigBinary?: string;
}
export interface Seat {
  id: string;
  rigId: string;
  rigName: string;
  name: string;
  pod: string;
  runtime: string;
  model: string;
  session: string | null;
  status: string;
  activity: string;
  /** Raw OpenRig lastActivityAt (ISO) when reported and valid; otherwise null/absent (old host). */
  lastActivityAt?: string | null;
  error: string;
  workCount: number;
  /** Raw reported counts; null/absent = not reported (distinct from a confirmed 0). */
  assignedWork?: number | null;
  pendingWork?: number | null;
}
export interface Rig {
  id: string;
  name: string;
  status: string;
  nodeCount: number;
}
export interface Inventory {
  rigs: Rig[];
  seats: Seat[];
  sampledAt: string;
}
export interface FileEntry {
  name: string;
  path: string;
  directory: boolean;
}
export interface GitEntry {
  path: string;
  status: string;
}
export interface GitStatus {
  isRepository: boolean;
  root: string;
  projectPrefix?: string;
  omittedPaths?: number;
  entries: GitEntry[];
}
export interface SavedLayout {
  id: string;
  name: string;
  model: IJsonModel;
  workspace: string;
}
export interface RoleTemplate {
  id: string;
  name: string;
  model: IJsonModel;
}
export interface WorkspaceState {
  terminalSnippets?: import("./terminal-commands").TerminalSnippet[];
  preferences?: import("./settings").Overrides;
  projectPreferences?: Record<string, import("./settings").Overrides>;
  version: 1;
  connections: Connection[];
  activeConnection: string;
  roots: Record<string, string>;
  activeRig: string;
  layouts: Record<string, IJsonModel>;
  savedLayouts: SavedLayout[];
  projectHistory?: import("./project-history").RecentProject[];
  pinnedSeats?: string[];
  collapsedPods?: string[];
  sidebarWidth?: number;
  roleTemplates?: RoleTemplate[];
  desktopNotifications?: boolean;
  windowBounds?: { x: number; y: number; width: number; height: number };
}
export interface PanelConfig {
  connection: Connection;
  root: string;
  seat?: Seat;
  path?: string;
  terminalId?: string;
  rigControlToken?: string;
  rigControlConfirmation?: string;
  mode?: string;
  port?: number;
  line?: number;
  role?: string;
  /** One-shot request to open the control center on a command (navigation only). */
  initialCommand?: { path: string[]; rigId?: string; nonce: number };
}
export interface TerminalLogState { id: string; active: boolean; path: string; bytes: number; error: string }
export interface TerminalEvent {
  id: string;
  data?: string;
  exitCode?: number;
}
export interface FirstHandoff {
  mission: string;
  boundaries: string;
  expectedOutput: string;
  handoff: string;
}
export interface DesignSeat {
  id: string;
  agentId: string;
  runtime: string;
  firstHandoff?: FirstHandoff;
}
export interface HrigAPI {
  terminalLog(request: {id: string; op: "start" | "stop" | "status"}): Promise<TerminalLogState>;
  onTerminalLog(callback: (state: TerminalLogState) => void): () => void;
  clipboardHasImage(): Promise<boolean>;
  pasteClipboardImage(id: string): Promise<string|null>;
  rigControl(connection: Connection, request: Record<string, unknown>): Promise<import("./rig-control-types").ControlResult>;
  updateFrequency(hours: number): Promise<{ hours: number }>;
  updates(request:{op:string;confirmed?:boolean;allowUnsigned?:boolean}):Promise<import('./UpdateSettings').UpdateState>;
  onUpdates(callback:(state:import('./UpdateSettings').UpdateState)=>void):()=>void;
  onPrepareUpdate(callback:()=>{ready:boolean;error?:string}):()=>void;
  mobile(request: { op: string; id?: string }): Promise<any>;
  platform: string;
  integrate(request: Record<string,unknown>): Promise<any>;
  openWorkLink(url: string): Promise<void>;
  exportTerminal(text: string): Promise<{saved: boolean}>;
  openTerminalLink(url: string): Promise<void>;
  readClipboardText(): Promise<string>;
  drafts(request: {op: string; key?: string; value?: unknown}): {result?: any; error?: string};
  assessTeam(
    connection: Connection,
    request: Record<string, unknown>,
  ): Promise<{
    prompt?: string;
    providers?: { id: string; installed: boolean; status: string }[];
    questions?: { id: string; question: string; impact: string }[];
    proposals?: {
      tier: string;
      rationale: string;
      workflow: string;
      uncertainty: string;
      concurrency: number;
      evidence?: { source: string; observation: string }[];
      seats: DesignSeat[];
    }[];
  }>;
  designRig(
    connection: Connection,
    request: Record<string, unknown>,
  ): Promise<{
    path: string;
    spec: unknown;
    result: any;
    previewToken: string;
  }>;
  exportDiagnostics(request: string): Promise<import('../electron/diagnostics-bundle.mjs').DiagnosticsExportResult>;
  doctor(connection: Connection): Promise<{
    healthy: boolean;
    checks: { name: string; ok: boolean; detail: string }[];
  }>;
  edit(
    connection: Connection,
    request: {
      op: string;
      root: string;
      path?: string;
      destination?: string;
      content?: string;
      revision?: string;
      query?: string;
      allowMissing?: boolean;
    },
  ): Promise<any>;
  seatMessage(
    connection: Connection,
    request: { op: "prepare"; id: string; message: string } | { op: "send"; id: string; token: string },
  ): Promise<any>;
  seatTranscript(
    connection: Connection,
    id: string,
  ): Promise<{ seatName: string; text: string; truncated: boolean; capturedAt: string }>;
  inventoryCache(
    request: { op: "load" } | { op: "clear" } | { op: "save"; key: string; inventory: Inventory },
  ): Promise<any>;
  seatPrompt(
    connection: Connection,
    id: string,
  ): Promise<{ seatName: string; text: string; truncated: boolean; capturedAt: string }>;
  rigAction(
    connection: Connection,
    request: Record<string, unknown>,
  ): Promise<any>;
  ports(connection: Connection): Promise<{ port: number }[]>;
  openPreview(
    connection: Connection,
    port: number,
  ): Promise<{ url: string; localPort: number }>;
  closePreview(connection: Connection, port: number): Promise<void>;
  notifyAttention(title: string, body: string): Promise<void>;
  notifySeatAttention(request: SeatAttentionRequest): Promise<SeatAttentionResult>;
  onResume(callback: () => void): () => void;
  loadState(): Promise<WorkspaceState | null>;
  saveState(state: WorkspaceState): Promise<void>;
  flushState(state: WorkspaceState): { saved: boolean; error?: string };
  detectConnections(): Promise<Connection[]>;
  inventory(connection: Connection): Promise<Inventory>;
  sendMessage(
    connection: Connection,
    seat: string,
    message: string,
  ): Promise<string>;
  queue(
    connection: Connection,
    rigName?: string,
  ): Promise<Record<string, unknown>[]>;
  file(
    connection: Connection,
    request: {
      op: string;
      root: string;
      path?: string;
      content?: string;
      query?: string;
    },
  ): Promise<any>;
  git(connection: Connection, root: string): Promise<GitStatus>;
  projects(
    connection: Connection,
  ): Promise<
    { path: string; name: string; rigs: { id: string; name: string }[] }[]
  >;
  pickFolder(): Promise<string | null>;
  createTerminal(options: {
    rigControlToken?: string;
    rigControlConfirmation?: string;
    id: string;
    connection: Connection;
    root: string;
    session?: string | null;
    seatId?: string;
    cols: number;
    rows: number;
    localShell?: string;
  }): Promise<{ id: string; buffer: string; reused?: boolean }>;
  closeTerminal(id: string): Promise<void>;
  writeTerminal(id: string, data: string): void;
  resizeTerminal(id: string, cols: number, rows: number): void;
  onTerminal(callback: (event: TerminalEvent) => void): () => void;
  window(action: "minimize" | "maximize" | "close"): void;
}
declare global {
  interface Window {
    hrig: HrigAPI;
  }
}
