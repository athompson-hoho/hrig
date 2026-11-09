# Task board

The Task queue panel (Tools, or search Task queue in the command center) lists the active OpenRig queue items in columns by state. This page describes the task details dialog and the panel's filters. HRig reads the queue to show it; assigning work and requesting a handoff are separate, explicit actions.

### Card details

A card for a blocked task shows why under the owner, for example `Blocked on qitem-20261108170835-ab12cd34ef56ab78`. HRig reads the reason from the task's `blockedOn` field, which OpenRig sets when a task is parked on a blocker (another task, a typed gate or a human seat), and from the fields `blockedReason` and `reason` when a version of OpenRig sends them; the first of these fields that holds text wins. A task held on purpose (state held, on-hold or parked; OpenRig itself parks a held task as blocked, so these names only matter if a version sends them) reads `heldReason`, `holdReason`, `reason` and `blockedOn` the same way. Only text is read. A task in any other state shows no reason, and a blocked task without a reason keeps its card as it was.

The reason line is cut after 80 characters with three dots, and its tooltip holds up to 400 characters. Control, zero-width and direction-changing characters are removed and line breaks become spaces. The reason is shown as plain text only. This is display only: no task or seat is changed, nothing is sent to OpenRig, and the board makes no extra request and starts no timer.

A card also shows an age badge under the state badge, in the same badge style: the time since the task was created (`tsCreated`) as `<1m`, minutes (`5m`), hours (`3h`) or days (`2d`). Its tooltip says how old the task is. A task with no valid creation time, or one dated later than this computer's clock, shows no badge.

A task in progress or blocked with no update for more than 24 hours is stuck. The time without an update is counted from `tsUpdated`, or from the creation time when there is no update time. The badge then adds the word stuck, its tooltip says `Stuck: no update for 2d`, and the card border and the badge turn amber; the word carries the meaning, the colour only helps. Pending tasks and tasks in other states are never marked stuck. The limit is a constant in `src/task-age.ts` (`STUCK_AFTER_MS`) and is not a setting. A task that is being worked quietly without queue updates also shows as stuck after a day, so read the word as a reason to look, not as a verdict. Ages are measured each time the board refreshes (every 15 seconds); the board reads only the queue list it already loads and sends nothing to OpenRig.

## Task details

Selecting a task on the board opens its details. The text of the task is shown as formatted text, taken from the first of its body, bodyPreview and summary fields that holds text (when only the summary is used, the dialog says so). The Raw JSON button switches to the whole item exactly as OpenRig returns it, and a task with no text, or a failed read, shows only that JSON. Viewing a task is read only: nothing is sent to OpenRig, no task or seat is changed, and the owner and handoff controls below the text work as before.

The formatting is a small fixed subset of Markdown: headings (`#` to `###`), paragraphs, bullet lists (`-`, `*` or `+`) and numbered lists with one level, block quotes (`>`) with one level, rules (`---`), fenced code blocks (three backticks or `~~~`), inline code, bold (`**text**`), italic (`*text*` or `_text_`) and links. A line break inside a paragraph is kept as a line break. Wrap names such as `__init__` or `src/*.ts` in inline code so their marks stay visible.

Nothing in the text is ever treated as HTML or as a program. HTML such as script or img tags, entities and comments are shown exactly as typed. A link written `[text](https://example.com)` shows its text followed by its address in parentheses and cannot be clicked, so HRig never opens anything from a task; only plain http and https addresses count as links, and anything else (javascript:, data:, file:, relative paths) stays as typed, as do images. Tables, nested lists, setext headings, backslash escapes and syntax highlighting are not supported and show as typed. Control, zero-width and direction-changing characters are removed.

A text longer than 100,000 characters or 2,000 blocks (a list item counts as a block) is cut with a note, and very long or very repetitive lines show their formatting only in part, always as plain text. Raw JSON has the whole item.

## Task board filters

Four filters narrow the board: Filter tasks (text in the task title, ignoring case), the owner (the seat a task is assigned to), the state (pending, in-progress, blocked or failed) and the tag. A task shows only when it passes every filter that is set; with no filter set every task shows.

The tag list holds the tags found on the tasks that are loaded, up to the 100 most used, sorted. HRig reads them from the task's tags field as OpenRig reports it (a list of names, or comma separated text) and compares them without case or surrounding spaces, so Mission:Alpha and mission:alpha are one tag. A task without tags never matches a tag filter.

The owner, state and tag you pick are remembered for each connection in HRig's workspace file and come back after a restart or reload. The text box is a quick search and is not remembered. This is not a setting and nothing is sent to OpenRig: the filters only change what the board shows, and no task or seat is touched.

When a filter is set, a line above the board says how many tasks show and offers Clear filters, which empties all four filters. If a remembered owner or tag no longer exists (the seat is gone and no task has it, or no loaded task has the tag), the filter stays visible in its box and the board says so with Clear filters, instead of dropping it silently.
