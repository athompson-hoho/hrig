# Missing seat sessions

Design note only — dead-seat detection is not implemented.

This is R07's short design-note alternative. It records the unresolved evidence seam and the existing explicit recovery safeguards. It adds no detector, sidebar state, polling, action or automatic relaunch.

## What current evidence establishes

In [core inventory and attachment](../electron/core.cjs), `normalizeInventory` projects `canonicalSessionName` to `session` or `null` and coalesces attention, startup, activity and session statuses. `inventory` requests two inventory projections; `sampledAt` timestamps normalization. Neither that timestamp nor represented idle, startup failure, stale/checking inventory, null or absent canonical/session metadata, or a disconnected/closed client certifies exact-host tmux absence. These describe metadata or client state, not an authoritative session-existence observation.

The inspected adapter exposes no authoritative absence contract. This bounded finding does not describe every upstream OpenRig surface. In [createSessionRelaunch](../electron/session-relaunch.cjs), `target` rejects absent session metadata and invalid session targets. Its `plan` requires supported launch flags and `complete === true` plus `launchable === true`. Those establish launchability, not absence. A valid preview must not be interpreted as confirmation that tmux is missing.

## Existing reviewed recovery

[RelaunchSession](../src/RelaunchSession.tsx) requests a preview and enables submission only with a review token, the exact typed seat name and a nonblank reason, while neither checking nor busy. Its warning is consequential: fresh relaunch stops the current agent, interrupts active work and starts a fresh conversation; conversation context is not resumed.

The service's `keyFor` binds receipts to the serialized connection plus seat id. Receipts record the reviewed session, name and time, expire after five minutes, and are replaced by a new preview for the same target. Execution requires a receipt for that same target, the exact reviewed name, and a nonblank reason of at most 1,000 characters without NUL. It consumes the token before execution, refetches the target, requires latest-session equality, reruns planning and guards concurrent relaunch for that target. Failed execution cannot reuse the consumed receipt. These checks describe existing source behavior, not a new missing-session recovery integration or live CLI verification.

Reconnect instead attaches the client to an existing exact session: `sessionCommand` requests an exact tmux session match and does not create or restart a seat. Closing a client therefore does not establish that its host session disappeared. Reconnect and disruptive fresh relaunch serve different operator intentions.

Retained PTYs also have ownership safeguards. [seatTerminalReuse](../electron/terminal-reuse.cjs) requires matching connection identity, seat id and session, including the current inventory seat. [terminal:create](../electron/main.cjs) refetches inventory and refuses changed/unavailable sessions or unknown/conflicting retained ownership, preserving the existing terminal. Future recovery must preserve these checks. The renderer, service and host responsibilities remain those in [ADR-001](architecture/ADR-001-electron.md).

## Future acceptance proposal — unimplemented

A later implementation needs an authoritative, fresh `present` / `missing` / `unknown` / `error` observation bound to the exact owning connection/host, seat, tmux namespace and session. Identical visible names or session strings across different captured owners remain distinct; equal display text cannot establish identity. Transport, authentication, timeout, stale-response and other error evidence must remain inconclusive.

Represented status and launchability must stay separate from an absence observation. There is no proposed priority rule that relabels conflicting metadata as missing; this documentation leaves current sidebar ordering and status behavior unchanged. Any later reviewed action must revalidate its exact target and retain review and retained-owner protections. The authority, freshness and invalidation contract remains unresolved.

Future fake/disposable QA groups are proposed, unimplemented and unrun here:

- Present versus absent exact session; idle, null metadata, failed startup, stale/checking inventory and client-only disconnection.
- Unavailable host or wrong host/namespace, including equal names across owners.
- Target/session changes after review; stale, replayed or wrong-target tokens; wrong name or missing reason.
- Retained-owner mismatch; cancellation with zero lifecycle calls.

Source/link/diff review and existing injected-fake relaunch tests support this note and current guards only. Native/live behavior remains unobserved. Independent content review and verification remain required; prior R01–R06 human/live/judgment gates remain open. The parent retains the coordinated postmerge build/suite gate. W8/W10 remain transferred and unverified; this note closes none of those gates.
