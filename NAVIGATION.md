# Project and panel navigation

Open a project with Ctrl+O (Cmd+O on macOS). The project hub lists attached rig folders, recent folders and favorites, with host and rig labels. Search, pin or remove history entries, browse a folder, or enter a path. Removing history never deletes files or rigs.

History retains up to 50 favorites and 50 recent projects. Entries are tied to the saved connection and endpoint; removed or retargeted connections appear unavailable. HRig validates a folder before switching and preserves the current project when validation fails or the dialog is canceled. Layouts remain associated with their existing project path. History stores folder/host metadata, not file contents or credentials.

Ctrl+P (Cmd+P) opens fuzzy project-file search. Type a filename or path subsequence, optionally followed by `:line`; use arrows and Enter to open a result. Local, WSL and SSH connections use the same ranking. Traversal is bounded to 20,000 entries and 25 levels, excludes generated directories and symbolic links, and returns the best 100 matches found. Partial and limited scans are explicitly labeled. Existing file confinement and size limits still apply. Superseded results are discarded; dismissing the dialog does not terminate an already-running remote read.

Ctrl+Shift+P (Cmd+Shift+P) finds existing panels in the current workspace by title, file, rig, seat, host or group. Recent panels appear first. Selecting a result focuses its docked panel, floating panel or native popout without opening another copy. The navigator also offers move-to-group and split controls, including Alt+Left/Right/Down/Enter. Rename groups in Arrange workspace; moves, splits and group names participate in arrangement undo.

Project path spelling remains stable to preserve previous layout keys. Different aliases for the same remote folder can remain separate entries. Existing content search remains literal; regex, whole-word and include/exclude content filters are future HR-16 work.
