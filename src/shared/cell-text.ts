/** Plain-text rendering of a cell value; BigInt-safe for INT64 columns. */
export function cellText(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  // DATE columns decode to UTC midnight; show just the day. Timestamps keep the time.
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const iso = value.toISOString();
    return iso.endsWith("T00:00:00.000Z")
      ? iso.slice(0, 10)
      : iso.replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
  }
  if (typeof value === "object") {
    return JSON.stringify(value, (_key, item) =>
      typeof item === "bigint" ? item.toString() : item,
    );
  }
  return String(value);
}
