/** The two searchable fields every command center entry has. */
export interface PaletteCommand {
  name: string;
  hint: string;
}

/**
 * Entries whose name and hint together hold every query word, case-insensitive.
 * Name-only hits come first; input order is kept inside each group.
 */
export function filterCommands<T extends PaletteCommand>(
  commands: readonly T[],
  query: string,
): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return commands.slice();
  const named: T[] = [];
  const hinted: T[] = [];
  for (const command of commands) {
    const name = command.name.toLowerCase();
    const hint = command.hint.toLowerCase();
    // Plain substring checks only: the query is never compiled into a pattern.
    if (!words.every((w) => name.includes(w) || hint.includes(w))) continue;
    (words.every((w) => name.includes(w)) ? named : hinted).push(command);
  }
  return named.concat(hinted);
}

/** The entry Enter runs: always the first one filterCommands lists. */
export function pickFirst<T extends PaletteCommand>(
  commands: readonly T[],
  query: string,
): T | undefined {
  return filterCommands(commands, query)[0];
}
