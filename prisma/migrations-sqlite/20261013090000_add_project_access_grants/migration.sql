-- COL-004 Project access grants. Additive for existing installations: no row means the default role (commenter).

CREATE TABLE IF NOT EXISTS "project_access_grants" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" INTEGER NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL CHECK ("role" IN ('editor', 'commenter', 'viewer')),
    "granted_by" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_access_grants_project_fkey"
      FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX IF NOT EXISTS "project_access_grants_project_user_key"
ON "project_access_grants"("project_id", "user_id");

CREATE INDEX IF NOT EXISTS "idx_project_access_grants_user"
ON "project_access_grants"("user_id");
