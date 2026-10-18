import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  baseline: vi.fn(() => true), sso: vi.fn(() => false), claim: vi.fn(),
  query: vi.fn(), execute: vi.fn(),
}));
vi.mock("./prisma.js", () => ({ prisma: { $queryRawUnsafe: mocks.query, $executeRawUnsafe: mocks.execute } }));
vi.mock("./config.js", () => ({ isLocalPostgres: () => true, isDesktopMode: () => false, isSsoAuthMode: mocks.sso }));
vi.mock("./installation-identity.js", () => ({ hasTeamProvisioningBaseline: mocks.baseline, claimTeamProvisioningBaseline: mocks.claim }));
vi.mock("./logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));
vi.mock("./startup-schema-migration.js", () => ({ addColumnIfMissing: vi.fn(), getColumns: vi.fn(), postgresDateType: () => "TIMESTAMPTZ(3)" }));

import { backfillLegacyTeamData, sealExistingTeamRecords } from "./startup-team-migration.js";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("ERDBPRO_LEGACY_TEAM_ID", "");
  mocks.baseline.mockReturnValue(true);
  mocks.sso.mockReturnValue(false);
  mocks.execute.mockResolvedValue(1);
});
afterEach(() => vi.unstubAllEnvs());

function legacyRows(memberships: unknown[]) {
  mocks.baseline.mockReturnValue(false);
  mocks.query.mockResolvedValueOnce([{ id: "owner", is_super_admin: false }])
    .mockResolvedValueOnce([{ id: "team-a", status: "active", type: "team" }, { id: "team-b", status: "active", type: "team" }])
    .mockResolvedValueOnce([{ id: 1, user_id: "owner", team_id: null }])
    .mockResolvedValueOnce(memberships).mockResolvedValue([]);
}

describe("SH-002 legacy Team migration boundaries", () => {
  it("does not revisit Personal project scope after the provisioning baseline", async () => {
    await backfillLegacyTeamData();
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("never assigns or seals local records in Cloud SSO", async () => {
    mocks.baseline.mockReturnValue(false);
    mocks.sso.mockReturnValue(true);
    await backfillLegacyTeamData();
    await sealExistingTeamRecords();
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it("records ambiguity instead of selecting one of multiple active memberships", async () => {
    legacyRows([{ user_id: "owner", team_id: "team-a", status: "active" }, { user_id: "owner", team_id: "team-b", status: "active" }]);
    await backfillLegacyTeamData();
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(mocks.execute.mock.calls[0][0]).toContain("ambiguous_team_membership");
    expect(mocks.execute.mock.calls[0][0]).not.toContain('UPDATE "projects"');
  });

  it("does not reactivate a banned membership even with an explicit destination", async () => {
    legacyRows([{ user_id: "owner", team_id: "team-a", status: "banned" }]);
    vi.stubEnv("ERDBPRO_LEGACY_TEAM_ID", "team-a");
    await backfillLegacyTeamData();
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(mocks.execute.mock.calls[0][0]).toContain("membership_recovery_required");
    expect(mocks.execute.mock.calls[0][0]).not.toContain('UPDATE "team_members"');
  });

  it("requires an administrator mapping even for a single active membership", async () => {
    legacyRows([{ user_id: "owner", team_id: "team-a", status: "active" }]);
    await backfillLegacyTeamData();
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(mocks.execute.mock.calls[0][0]).toContain("initial_team_selection_required");
  });
});
