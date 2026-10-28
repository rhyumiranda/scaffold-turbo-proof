-- Generated with `prisma migrate diff --from-empty --to-schema prisma/schema --script`, then reviewed.
-- The generated CREATE SCHEMA line was removed: the target schema already exists, and a least-privilege
-- migration role may not hold CREATE on the database.
-- BEGIN/COMMIT: `prisma migrate deploy` does not wrap a migration in a transaction, so a failing statement would
-- leave the earlier ones applied. check:arch requires every migration to be wrapped like this.

BEGIN;

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "owner_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "projects_owner_order" ON "projects"("owner_id", "created_at" DESC, "id" DESC);

-- Integrity rules the Prisma schema cannot express (added by hand to the generated script).
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_length" CHECK (char_length("owner_id") BETWEEN 1 AND 200);
ALTER TABLE "projects" ADD CONSTRAINT "projects_name_valid" CHECK (char_length("name") BETWEEN 1 AND 100 AND "name" = btrim("name"));
ALTER TABLE "projects" ADD CONSTRAINT "projects_version_positive" CHECK ("version" >= 1);

COMMIT;
