# Terminals beside the current panel

The workspace already supports side-by-side terminal panels through FlexLayout, Arrange workspace and the panel navigator. Reuse those seams rather than creating another terminal split system.

Small change: add Open seat beside current to the seat row and command center. Capture the current tab group, open/focus the seat through the existing openSeat path, then move that panel to the right of the captured group through movePanel. Existing seats are reused, not duplicated. A seat already alone in the destination group stays there; a detached panel stays in its window and can be moved using existing navigator controls. Stale/unattachable seats retain existing guards. Arrangement undo uses the existing movePanel history.

Manual checks: open two different seats and compare side-by-side; existing seat in another group moves without another PTY; single current seat is unchanged; stale inventory blocks opening; navigator and Arrange workspace remain functional; narrow windows preserve minimum sizes. Use Ctrl/Cmd+Shift+P for richer move/split controls, or drag tabs to a panel edge.
