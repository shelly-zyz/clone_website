export function distribution(values: readonly (number | null | undefined)[]) {
  const sorted = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .toSorted((first, second) => first - second);
  const count = sorted.length;
  function percentile(fraction: number) {
    if (!count) return null;
    const index = (count - 1) * fraction;
    const before = Math.floor(index);
    return sorted[before] + (sorted[Math.ceil(index)] - sorted[before]) * (index - before);
  }
  return {
    minimum: sorted[0] ?? null,
    lower: percentile(0.25),
    median: percentile(0.5),
    upper: percentile(0.75),
    maximum: sorted[count - 1] ?? null,
    count,
  };
}
