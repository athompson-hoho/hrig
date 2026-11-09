# Review checks

Status: built. A review check is a private, local note to yourself. It sends nothing and changes nothing in the project.

## What it does

In the Review workspace each changed file in the list has a checkbox named after its path (for example Mark src/app.ts reviewed). A tick means I looked at this file as it is now. Above the list a line says N of M reviewed, a Show unreviewed only box hides the files you already ticked (it is only a view and is not remembered), and Clear all checks removes every tick of the project.

## A tick belongs to the file's content

When you tick a file, HRig reads it once and keeps the file's content revision (the same opaque hash the review notes already use) with the tick. When the change list loads and each time you choose Refresh changes, HRig reads the ticked files again, one at a time and at most 50 per load or refresh, and compares:

- Same revision: the box is ticked and counts as reviewed.
- A different revision: the box is unticked and the row says changed since reviewed. The old tick is never kept silently. Tick the file again after looking at it.
- The file could not be read: the box is unticked and the row says could not verify. The saved tick is left as it is.
- More than 50 ticked files: the ones past 50 are not read and say not rechecked.

A deleted file, a file that cannot be read (binary, too large or outside the project) and a path that cannot be remembered cannot be ticked: the box is disabled and its title says why. They are left out of the M in N of M reviewed, and the line says how many cannot be checked. A tick of a file that is no longer in the change list (committed, reverted or deleted) is dropped when the list loads, unless the list is empty.

## What is kept, and where

The ticks are kept in the saved workspace state on this computer, per connection and project folder: the file path and its content revision, nothing else, and no file content. At most 20 projects and 200 ticked files per project are kept (the oldest go first), a path is at most 1,024 characters and a revision at most 128, and a path with control, zero-width or direction-changing characters is not kept. They are not drafts: they do not use the draft store and are not cleared when you send feedback. They are not put in the feedback message, not exported with the settings, not written to the Git index or to any file of the project, and not sent to a seat, a host or anywhere else. Use Clear all checks to remove them, or untick a file.

## Not built

Syncing checks between computers, checks per hunk, ticking a file automatically when you view its diff, putting the reviewed state into the feedback text and ticks in the Source control list of the sidebar.
