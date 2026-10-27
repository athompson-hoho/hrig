function cpuSample(before, after, seconds) {
  const previous = new Map(before.map((p) => [p.pid, p]));
  if (
    Number.isFinite(seconds) &&
    seconds > 0 &&
    after.every(
      (p) =>
        Number.isFinite(p.cumulativeCPUSeconds) &&
        p.cumulativeCPUSeconds >= 0 &&
        (!previous.has(p.pid) ||
          Number.isFinite(previous.get(p.pid).cumulativeCPUSeconds)),
    )
  ) {
    const deltas = after.map(
      (p) =>
        p.cumulativeCPUSeconds -
        (previous.get(p.pid)?.cumulativeCPUSeconds || 0),
    );
    if (deltas.every((v) => v >= 0))
      return {
        percent:
          Math.round((deltas.reduce((a, b) => a + b, 0) / seconds) * 10000) /
          100,
        method: "cumulative CPU seconds delta",
      };
  }
  if (after.every((p) => Number.isFinite(p.cpuPercent) && p.cpuPercent >= 0))
    return {
      percent:
        Math.round(after.reduce((n, p) => n + p.cpuPercent, 0) * 100) / 100,
      method: "Electron percentage sample",
    };
  return {
    percent: null,
    method: "unavailable: Electron returned an invalid CPU counter",
  };
}
module.exports = { cpuSample };
