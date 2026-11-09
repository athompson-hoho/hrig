# Task board

The Task queue panel (Tools, or search Task queue in the command center) lists the active OpenRig queue items in columns by state. This page describes the panel's filters. HRig reads the queue to show it; assigning work and requesting a handoff are separate, explicit actions.

## Task board filters

Four filters narrow the board: Filter tasks (text in the task title, ignoring case), the owner (the seat a task is assigned to), the state (pending, in-progress, blocked or failed) and the tag. A task shows only when it passes every filter that is set; with no filter set every task shows.

The tag list holds the tags found on the tasks that are loaded, up to the 100 most used, sorted. HRig reads them from the task's tags field as OpenRig reports it (a list of names, or comma separated text) and compares them without case or surrounding spaces, so Mission:Alpha and mission:alpha are one tag. A task without tags never matches a tag filter.

The owner, state and tag you pick are remembered for each connection in HRig's workspace file and come back after a restart or reload. The text box is a quick search and is not remembered. This is not a setting and nothing is sent to OpenRig: the filters only change what the board shows, and no task or seat is touched.

When a filter is set, a line above the board says how many tasks show and offers Clear filters, which empties all four filters. If a remembered owner or tag no longer exists (the seat is gone and no task has it, or no loaded task has the tag), the filter stays visible in its box and the board says so with Clear filters, instead of dropping it silently.
