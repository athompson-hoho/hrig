# Task board

The Task queue panel (Tools, or search Task queue in the command center) lists the active OpenRig queue items in columns by state. This page describes the task details dialog and the panel's filters. HRig reads the queue to show it; assigning work and requesting a handoff are separate, explicit actions.

### Notification for items addressed to you

A desktop notification can tell you when a new queue item addressed to a person appears. It is off by default: turn on Notify about queue items for me under Notifications in Settings (`notifications.humanItems`). It is separate from Desktop attention notifications and needs nothing else turned on. A task counts as addressed to a person when its destination is `human@host`, `human@kernel`, `human-name@host`, `human-name@kernel` or `name@external`, which is how OpenRig names a person, and it is still pending, in-progress or blocked. A quiet update (`--human-intent update`) is not an ask and does not notify, and a task parked on a person is addressed to its own seat, so it does not notify either.

Only new items notify. The first read after you turn the setting on or switch connection only takes in what is already waiting, so starting HRig never notifies for old items, and an item that left and came back is not new again (the last 2,000 are remembered). HRig reads the same queue list the Task queue panel reads, for every rig on the active connection, once per refresh interval (`workspace.refreshInterval`, 15 seconds by default), whether or not the Task queue panel is open. A failed read is skipped and tried again with the same back-off as the rig refresh, and nothing is notified twice. Several new items found in one read give one notification.

The notification says how many new items there are (for example `2 new items for you`), and its body holds at most the first item's summary, cut to 80 characters with control characters removed, or a short reminder to open the Task queue when there is no summary. It never shows an item's text, id, address or tags, and the Activity list gets one matching line. This is read only: HRig never claims, answers, resolves or changes an item and sends nothing to a seat or shell, the notification is silent and clicking it does nothing. Windows notification preferences still apply.

### Keyboard navigation

The board can be driven from the keyboard. Press Tab to reach it: the board is one stop, on the card you used last (the first card at first), instead of one stop per card. On a card, Up and Down move to the previous and next card of the same column, Left and Right move to the nearest column that has cards and keep the same row when it can (the last card of that column otherwise), and Home and End go to the first and last card of the column. Focus does not wrap around: at the first or last card, or when no column lies further in that direction, it stays where it is. Enter or Space opens the task details, as clicking the card does, and Escape closes them again.

Keys are looked at only while a card has focus and only when pressed on their own: a key held with Ctrl, Alt, Cmd or Shift is left to the app, the filter boxes above the board keep their own arrow, Home and End keys, and every other key keeps its usual effect. This is not a shortcut: it is not in the Keyboard shortcuts sheet or in Settings, there is no setting for it, and the look of the board does not change, the focused card showing the same focus ring as any button.

Navigation only moves focus and never changes a task. It does not open, send, assign or hand off anything, nothing is typed into a seat, and the board reads the queue exactly as before. When the board refreshes (every 15 seconds) focus stays on the same task while it is still shown, in its new column if its state changed; if it is gone, focus goes to the card nearest to where it was. A refresh never takes focus from anything outside the board.

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
