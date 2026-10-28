#!/bin/bash
# usage: snapshot.sh <db> [xmin]    Read-only schema fingerprint (SELECT only). Needs PGC (PostgreSQL container).
db="$1"
q() { docker exec -i "$PGC" psql -U postgres -d "$db" -v ON_ERROR_STOP=1 -At -F '|' -c "$1"; }
set -e
echo '## tables'; q "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1"
echo '## columns'; q "SELECT table_name, column_name, data_type, is_nullable, coalesce(column_default,'') FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name, ordinal_position"
echo '## constraints'; q "SELECT conrelid::regclass::text, conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE connamespace='public'::regnamespace ORDER BY 1,2"
echo '## indexes'; q "SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY 1,2"
# Ledger: Prisma's migration history table (applied state included, so a failed or rolled-back row shows up).
echo '## ledger'; q "SELECT migration_name, checksum, finished_at IS NOT NULL, rolled_back_at IS NULL FROM _prisma_migrations ORDER BY migration_name"
if [ "${2:-}" = xmin ]; then echo '## ledger row versions (xmin)'; q "SELECT migration_name, xmin::text FROM _prisma_migrations ORDER BY migration_name"; fi
