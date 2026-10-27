import type { IJsonModel } from "flexlayout-react";
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
  error: string;
  workCount: number;
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
  version: 1;
  connections: Connection[];
  activeConnection: string;
  roots: Record<string, string>;
  activeRig: string;
  layouts: Record<string, IJsonModel>;
  savedLayouts: SavedLayout[];
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
  mode?: string;
  port?: number;
  line?: number;
  role?: string;
}
export interface TerminalEvent {
  id: string;
  data?: string;
  exitCode?: number;
}
export interface HrigAPI {
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
    },
  ): Promise<any>;
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
    id: string;
    connection: Connection;
    root: string;
    session?: string | null;
    seatId?: string;
    cols: number;
    rows: number;
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
