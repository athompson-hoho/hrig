# Creating a task from a terminal selection

Status: built. It only prepares a task. Creating it stays with the existing Assign work dialog.

## What it does

Select text in a terminal, then right-click and choose Create task from selection, or open the command center and choose Terminal: Create task from selection for that terminal. HRig opens the Task queue panel (the one already open for that connection, else a new one) with the Assign work dialog filled in: the subject is the first line of the selection (cut at 120 characters), the task brief is the selection (cut at 8,000 characters, and the dialog says when it was cut), and the owner is left empty. A note above the brief says the text was prepared from a terminal selection and that nothing is created until you press Create assigned task.

## Prepared versus created

- Opening the dialog, editing the subject or the brief and choosing an owner create nothing and send nothing. Closing the dialog throws the prepared text away, so a selection never comes back in a later dialog.
- Create assigned task is the dialog's own button and the only place a task is created. It runs the action the Assign work dialog always ran (`taskCreate`: `rig queue create` with source `hrig-desktop`, the destination, the subject and the brief you see), after the existing check that the installed OpenRig advertises those options. This feature adds no IPC channel, no preload member and no main process code.
- A task you are already writing in the dialog is never overwritten: the selection is not used and the dialog says so.
- Nothing is typed into the terminal, pasted or sent to a seat, and the selected text is not logged.

## Why the owner is never chosen for you

A task goes to the seat a person decides on, and a selection says nothing about who should do the work. So the Owner list stays on Choose a seat and Create assigned task stays disabled until you pick one. When the selection came from the terminal of a seat that is still in the seat list, a line under the Owner list names that seat as a suggestion; it is a line of text, not a selection. The Assign work button itself still starts with the first seat as owner, as it always did; only a prepared dialog starts empty.

## Secrets and untrusted text

The selected text is untrusted and may hold secrets, so the dialog is the review step:

- Control, zero-width and direction-changing characters, invisible tag characters and terminal escape sequences are removed; line breaks and tabs are kept. At most 100,000 characters of a selection are read and 8,000 are kept.
- The text is shown as plain text in the subject and brief boxes, never as HTML or Markdown, and never run.
- A selection that looks like a private key block is refused with a notice that does not repeat it. A selection that looks like it holds a token, an API key, a password or a long random string is still prepared, with a second warning. Every prepared dialog carries the line: Selections can contain secrets: review before creating. These checks are a help, not a guarantee: read the text before you create the task.
- A task body is stored by OpenRig and shown to its owner, so anything you leave in it is no longer private.
- A subject or brief that starts with two dashes is checked against the OpenRig help text by the existing create path and may be refused with an error, exactly as if you had typed it; change its first characters if that happens.

## Ownership and policy

OpenRig enforces ownership and policy on the created task as for any other. HRig does not impersonate a managed seat, and a refused or unsupported action is shown as an error in the dialog.

## Rejected alternatives

- Creating the task as soon as the selection is chosen, or a one-click send: a selection is raw output, and nothing may be created without a person reading it and picking an owner.
- Pre-selecting the owner from the seat of the terminal: it would make the most likely wrong answer the easiest one to send. The seat is only named.
- A draft preview with a Copy brief button, or a copyable command line: not needed, because the existing dialog can be filled in safely, and a command line invites a paste into a shell.
- An entry for editor selections, sending one selection to several seats, attaching terminal context or links, and task templates: not part of this item.
