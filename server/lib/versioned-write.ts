/** Row filter that only matches while the stored version still equals the client's base version (null counts as 0). */
export function versionedWhere(id: number | bigint, expectedVersion: number | null | undefined): Record<string, unknown> {
  if (expectedVersion === undefined || expectedVersion === null) return { id };
  return expectedVersion === 0
    ? { id, OR: [{ version: 0 }, { version: null }] }
    : { id, version: expectedVersion };
}

/** Accepts only a non-negative integer version from a request body; anything else means "not sent". */
export function parseExpectedVersion(value: unknown): number | undefined {
  const parsed = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof parsed === "number" && Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}
