# Project and panel navigation

Open a project with Ctrl+O (Cmd+O on macOS). The project hub lists attached rig folders, recent folders and favorites, with host and rig labels. Search, pin or remove history entries, browse a folder, or enter a path. Removing history never deletes files or rigs.

History retains up to 50 favorites and 50 recent projects. Entries are tied to the saved connection and endpoint; removed or retargeted connections appear unavailable. HRig validates a folder before switching and preserves the current project when validation fails or the dialog is canceled. Layouts remain associated with their existing project path. History stores folder/host metadata, not file contents or credentials.

Ctrl+P (Cmd+P) opens fuzzy project-file search. Type a filename or path subsequence, optionally followed by `:line`; use arrows and Enter to open a result. Local, WSL and SSH connections use the same ranking. Traversal is bounded to 20,000 entries and 25 levels, excludes generated directories and symbolic links, and returns the best 100 matches found. Partial and limited scans are explicitly labeled. Existing file confinement and size limits still apply. Superseded results are discarded; dismissing the dialog does not terminate an already-running remote read.

Ctrl+Shift+P (Cmd+Shift+P) finds existing panels in the current workspace by title, file, rig, seat, host or group. Recent panels appear first. Selecting a result focuses its docked panel, floating panel or native popout without opening another copy. The navigator also offers move-to-group and split controls, including Alt+Left/Right/Down/Enter. Rename groups in Arrange workspace; moves, splits and group names participate in arrangement undo.

Project path spelling remains stable to preserve previous layout keys. Different aliases for the same remote folder can remain separate entries. Existing content search remains literal; regex, whole-word and include/exclude content filters are future HR-16 work.

Seat rows and the command center offer Open seat beside current. This reuses an existing seat panel and puts it to the right of the active group. See [terminal splits](docs/terminal-splits.md) for behavior and existing arrange/navigator controls.

Filter sessions narrows the sidebar immediately by seat name, rig name, runtime, pod, model or session metadata in the selected rig (or All rigs). Matching is literal and case-insensitive, with surrounding query whitespace ignored. Clear the input, or enter only whitespace, to restore that rig's represented seats matching the still-selected status, in their original order.

The status control offers All statuses, Working, Idle, Needs input and Stopped. Working, Idle and Needs input match normalized working, idle and attention statuses respectively; Stopped includes stopped/exited/failed. All statuses includes running, unknown and other unclassified or missing statuses. Status intersects with the current text query and selected rig: changing status, including returning to All statuses, preserves both; clearing the query leaves status active. All statuses is the initial/reset status, and both filter values live only in the mounted sidebar component, without storage or network requests.

The session count reflects the final matched rows, which retain their original order. No matching sessions means active filters excluded available seats in the selected scope; an empty inventory retains its connection guidance. Filtering preserves stale-inventory notices and disabled actions; opening, dragging or relaunching a seat still requires an explicit action.
