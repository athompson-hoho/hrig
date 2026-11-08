# Dropping files onto terminals

Status: the local insert is built. Remote upload is a design note only. Not implemented.

## What exists

Dropping a file from the desktop onto a local terminal inserts its quoted path at the prompt without Enter (see TERMINALS.md). The renderer reads the path with `webUtils.getPathForFile` through one preload helper, `window.hrig.pathForFile`, quotes it in `src/terminal-drop-path.ts` and pastes it with the terminal's own paste. SSH and WSL terminals refuse, because a path on this computer means nothing on another host.

## Why the image-paste channel does not carry it

`terminal:paste-image` (see [terminal-image-paste.md](terminal-image-paste.md)) is built for one thing, the clipboard image. The main process reads the clipboard itself, encodes a PNG, caps it at 10 MiB, shows a native confirmation naming the host and the generated path, saves it with `terminalImages.saveImage` (native calls locally, a Python 3 program over the existing transport with the bytes on stdin for SSH and WSL) into a private random directory, and returns the quoted path. It never receives a path from the renderer, which is what keeps it safe. A dropped file has none of that: the path comes from the renderer, and the file can be any size and type.

## What a remote upload would need

- A new IPC channel (a handler in the main process, a preload entry and a typed member of `HrigAPI`) that takes a path. The renderer is untrusted, so the handler must treat the path as a request, not as permission: a native confirmation naming the file, its size, the host and the destination, an explicit size cap, and the same check the image channel makes that the terminal is still the one that was asked after the dialog closes.
- A type and size policy: any file or images only, a cap (the image channel uses 10 MiB), and a refusal of folders, symlinks, devices and other special files. The main process cannot tell a dropped path from a forged one, so the confirmation is the guard.
- A destination policy on the remote host: a private 0700 directory and a 0600 file, a random name or the original name (and what happens on a clash), cleanup after a delay, and Python 3 on the host, which the image channel already assumes.
- A transfer path that streams large files instead of holding one buffer, with progress and cancel.
- Quoting of the remote path (always POSIX) and an insert without Enter, as for images.
- A PRIVACY.md note about what leaves the machine, and a human check on a real SSH host and a WSL distribution.

## Decision

Not implemented. The safe local insert ships first; a remote upload needs the policy above decided by a person and its own phase.
