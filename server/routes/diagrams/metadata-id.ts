/**
 * Constraint and index ids come from the client as `<kind>:<table>:<key>` and are global primary keys,
 * so the same table in two diagrams would share one row. Scope them to the owning entity; applying it
 * twice is a no-op because ids loaded back from the server already carry the prefix.
 */
export function scopeMetadataId(entityId: string, id: string): string {
  const prefix = `${entityId}:`;
  return String(id).startsWith(prefix) ? String(id) : `${prefix}${id}`;
}
