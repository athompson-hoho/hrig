/**
 * Rig-level quick actions. Navigation only: choosing one opens the OpenRig
 * control center on a read-only command with the rig prefilled. Nothing runs
 * until the user presses Review action and types the confirmation there.
 */
export interface QuickAction { id: string; label: string; hint: string; path: readonly string[] }
export interface InitialCommand { path: string[]; rigId?: string; nonce: number }

export const QUICK_ACTIONS: readonly QuickAction[] = Object.freeze([
  Object.freeze({ id: "ps", label: "View status (ps)", hint: "List rigs and their status", path: Object.freeze(["ps"]) }),
  Object.freeze({ id: "snapshot-list", label: "List snapshots", hint: "List snapshots for this rig", path: Object.freeze(["snapshot", "list"]) }),
]);

export const quickAction = (id: unknown): QuickAction | null =>
  QUICK_ACTIONS.find((a) => a.id === id) ?? null;

const UNSAFE = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤⁦-⁩﻿]/;

/** A rig id is prefilled only if it is plain text that cleaning would not change. */
export function safeRigId(id: unknown): string | undefined {
  return typeof id === "string" && id.length > 0 && id.length <= 200 && !UNSAFE.test(id) && id === id.trim() ? id : undefined;
}

export function initialCommand(action: QuickAction, rig: { id: unknown }, nonce: number): InitialCommand {
  const rigId = safeRigId(rig.id);
  return { path: [...action.path], ...(rigId ? { rigId } : {}), nonce };
}

/** A request older than this is ignored, so a restored layout never re-navigates. */
export const FRESH_MS = 10000;
export const isFreshRequest = (nonce: unknown, now: number) =>
  typeof nonce === "number" && Number.isFinite(nonce) && now - nonce >= -1000 && now - nonce < FRESH_MS;
