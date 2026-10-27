export function normalizeMonthlyBudgets(value) {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Invalid account plan budgets.");
  const result = {};
  for (const [key, amount] of Object.entries(value)) {
    if (
      !["codex", "claude-code"].includes(key) ||
      typeof amount !== "number" ||
      !Number.isFinite(amount) ||
      amount < 0 ||
      amount > 10000
    )
      throw Error(
        "Account plan budgets must be numbers from 0 to 10000 USD per month.",
      );
    result[key] = amount;
  }
  return result;
}
export function allocateRuntimes(
  providers,
  count,
  budgets = {},
  preferred = "codex",
) {
  budgets = normalizeMonthlyBudgets(budgets);
  const ids = [
    ...new Set(
      providers
        .filter(
          (p) =>
            p.status === "authenticated" &&
            ["codex", "claude-code"].includes(p.id),
        )
        .map((p) => p.id),
    ),
  ];
  if (!ids.length)
    throw Error(
      "No authenticated runtime was confirmed on this host. Refresh accounts, or choose a specific runtime to configure its seats manually.",
    );
  const known = ids.every((id) => budgets[id] > 0);
  const weight = (id) => (known ? budgets[id] : 1);
  ids.sort(
    (a, b) =>
      weight(b) - weight(a) ||
      Number(b === preferred) - Number(a === preferred),
  );
  const total = ids.reduce((sum, id) => sum + weight(id), 0),
    scores = Object.fromEntries(ids.map((id) => [id, 0]));
  return Array.from({ length: count }, (_, index) => {
    for (const id of ids) scores[id] += weight(id);
    const selected =
      index === 1 && ids.length > 1
        ? ids[1]
        : ids.reduce(
            (best, id) => (scores[id] > scores[best] ? id : best),
            ids[0],
          );
    scores[selected] -= total;
    return selected;
  });
}
