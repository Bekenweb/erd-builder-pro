-- CLD-010 G4: which Note or Drawing an upload belongs to, for the per-document image budget. Additive.

ALTER TABLE "storage_objects" ADD COLUMN "document_uid" TEXT;

CREATE INDEX IF NOT EXISTS "idx_storage_objects_document" ON "storage_objects"("document_uid");
