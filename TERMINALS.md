# Terminal output tools

Each terminal has Find, Copy selection, Copy output and Export controls. Ctrl+F (Cmd+F on macOS) opens terminal search while the terminal has focus. Enter/Shift+Enter move between matches; Escape closes search, restores the prior scroll position and returns keyboard focus to the terminal. Search text is never submitted to the shell.

Search supports case sensitivity and regular expressions, reports invalid expressions and highlights up to 1,000 matches. The count is capped and labeled `1,000+ matches`. Searches cover retained output, including wrapped lines; output already discarded by the configured scrollback limit cannot be recovered.

Copy output and export use rendered plain text, join soft-wrapped rows and omit terminal escape/control sequences. Export opens a native save dialog, honors cancellation and reports write failures. Exports are snapshots of the active buffer, not continuous recording; applications using an alternate screen expose that active screen. The default filename is `terminal-output.txt`.

HTTP/HTTPS links require native confirmation before opening the system browser. Links with embedded credentials and non-browser protocols are rejected. Conventional unwrapped file paths with extensions, optionally followed by `:line:column`, open in HRig after the existing backend confirms that they resolve inside the terminal's attached project. Relative links use that project root rather than inferring the shell's current directory. Whitespace-containing and wrapped file paths are not detected in this version. Remote file access uses the terminal's original connection even if the selected host/project has changed. Existing backend traversal, symlink and file-size protections apply.

These controls do not recreate the PTY or change OpenRig sessions. Reconnect remains a separate explicit control.
