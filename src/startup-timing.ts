/** One clock domain, one accepted completion. Invalid observations do not finish it. */
export function observeStartupDuration(
  observation: { completed: boolean },
  start: number,
  end: number,
): number | null {
  if (observation.completed || !Number.isFinite(start) || !Number.isFinite(end) || end < start)
    return null;
  const duration = end - start;
  if (!Number.isFinite(duration)) return null;
  observation.completed = true;
  return duration;
}
