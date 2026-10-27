import { Model, type IJsonModel, type IJsonTabNode } from "flexlayout-react";
export const globalLayout = {
  tabEnableRename: true,
  tabEnableFloat: true,
  tabEnableFloatIcon: true,
  tabEnablePopout: true,
  tabEnablePopoutIcon: true,
  tabSetMinWidth: 220,
  tabSetMinHeight: 140,
  splitterSize: 5,
  tabSetEnableMaximize: true,
  tabSetEnableTabStrip: true,
  tabEnableRenderOnDemand: false,
};
export const welcomeTab: IJsonTabNode = {
  type: "tab",
  id: "welcome",
  name: "Workspace",
  component: "welcome",
  enableClose: true,
};
export function initialModel() {
  return Model.fromJson({
    global: globalLayout,
    layout: {
      type: "row",
      children: [{ type: "tabset", id: "main", children: [welcomeTab] }],
    },
  });
}
export function restoreModel(json?: IJsonModel) {
  try {
    if (json)
      return Model.fromJson({
        ...json,
        global: { ...globalLayout, ...json.global },
      });
  } catch {}
  return initialModel();
}
export function arrangement(tabs: IJsonTabNode[], preset: string): Model {
  if (!tabs.length) return initialModel();
  const tabset = (children: IJsonTabNode[], weight = 100, selected = 0) => ({
    type: "tabset" as const,
    weight,
    children,
    selected,
  });
  if (preset === "Focus")
    return Model.fromJson({
      global: globalLayout,
      layout: { type: "row", children: [tabset(tabs)] },
    });
  if (preset === "Review") {
    const files = tabs.filter(
      (t) => t.component === "editor" || t.component === "diff",
    );
    const sessions = tabs.filter(
      (t) => t.component !== "editor" && t.component !== "diff",
    );
    return Model.fromJson({
      global: globalLayout,
      layout: {
        type: "row",
        children: [
          tabset(
            files.length ? files : tabs.slice(0, 1),
            65,
            Math.max(0, files.length - 1),
          ),
          tabset(
            files.length ? sessions : tabs.slice(1),
            35,
            Math.max(
              0,
              sessions.findIndex((t) => t.component === "terminal"),
            ),
          ),
        ],
      },
    });
  }
  const columns = Math.min(tabs.length, 3);
  const groups = Array.from({ length: columns }, () => [] as IJsonTabNode[]);
  tabs.forEach((t, i) => groups[i % columns].push(t));
  return Model.fromJson({
    global: globalLayout,
    layout: {
      type: "row",
      children: groups.map((group) =>
        group.length === 1
          ? tabset(group)
          : {
              type: "row" as const,
              weight: 100,
              children: group.map((t) => tabset([t])),
            },
      ),
    },
  });
}
export function roleSnapshot(json: IJsonModel): IJsonModel {
  const copy = structuredClone(json);
  const walk = (value: any) => {
    if (!value || typeof value !== "object") return;
    if (value.type === "tab") {
      const role = value.config?.seat?.name;
      const { path, port, mode } = value.config || {};
      value.config = role ? { role } : { path, port, mode };
      delete value.id;
      if (value.component === "terminal" && !role)
        value.component = "shellPlaceholder";
    } else {
      if (value.type === "row" || value.type === "tabset") delete value.id;
    }
    for (const child of Object.values(value))
      if (Array.isArray(child)) child.forEach(walk);
      else if (child && typeof child === "object") walk(child);
  };
  walk(copy);
  return copy;
}
export function instantiateRoles(
  json: IJsonModel,
  connection: import("./types").Connection,
  root: string,
  seats: import("./types").Seat[],
): IJsonModel {
  const copy = structuredClone(json);
  const used = new Set<string>();
  const walk = (value: any) => {
    if (!value || typeof value !== "object") return;
    if (value.type === "tab") {
      const role = value.config?.role;
      const seat = role
        ? seats.find((s) => s.name === role && !used.has(s.id))
        : null;
      value.id = crypto.randomUUID();
      value.config = { ...value.config, connection: { ...connection }, root };
      if (role) {
        if (seat?.session) {
          used.add(seat.id);
          value.id = `seat:${connection.id}:${seat.id}`;
          value.component = "terminal";
          value.name = seat.name;
          value.config.seat = seat;
          value.config.terminalId = value.id;
        } else {
          value.component = "missingSeat";
          value.name = role + " (unfilled)";
        }
      } else if (value.component === "shellPlaceholder") {
        value.component = "terminal";
        value.config.terminalId = value.id;
      }
      if (value.component === "queue") value.config.mode = seats[0]?.rigName;
    }
    for (const child of Object.values(value))
      if (Array.isArray(child)) child.forEach(walk);
      else if (child && typeof child === "object") walk(child);
  };
  walk(copy);
  return copy;
}
