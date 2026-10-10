import { describe, expect, it } from "vitest";
import { scopeMetadataId } from "./metadata-id.js";

describe("scopeMetadataId", () => {
  const clientId = "constraint:users:primary_key:id";

  it("gives the same table in two diagrams different row ids", () => {
    expect(scopeMetadataId("entity-a", clientId)).not.toBe(scopeMetadataId("entity-b", clientId));
  });

  it("is idempotent for ids that were already scoped and loaded back", () => {
    const once = scopeMetadataId("entity-a", clientId);
    expect(scopeMetadataId("entity-a", once)).toBe(once);
  });
});
