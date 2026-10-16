-- CLD-010 storage accounting. Additive: objects uploaded before this table exist stay readable through the
-- legacy content check and are simply not tracked.

CREATE TABLE IF NOT EXISTS "storage_objects" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "scope_type" TEXT NOT NULL CHECK ("scope_type" IN ('team', 'user')),
    "scope_id" TEXT NOT NULL,
    "uploaded_by" TEXT,
    "feature" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'committed', 'deleted')),
    "unreferenced_since" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "idx_storage_objects_scope"
ON "storage_objects"("scope_type", "scope_id", "status");

CREATE INDEX IF NOT EXISTS "idx_storage_objects_sweep"
ON "storage_objects"("status", "unreferenced_since");

CREATE TABLE IF NOT EXISTS "storage_usage" (
    "scope_type" TEXT NOT NULL,
    "scope_id" TEXT NOT NULL,
    "document_bytes" BIGINT NOT NULL DEFAULT 0,
    "revision_bytes" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("scope_type", "scope_id")
);
