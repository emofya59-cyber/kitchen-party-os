#!/usr/bin/env bash
# Applies stub → migration → seed → RLS smoke test to a THROWAWAY local Postgres database.
# Usage: PGHOST=/path/to/socket PGPORT=54329 PGUSER=postgres npm run db:validate
# Refuses to run against anything that looks like a hosted Supabase project.
set -euo pipefail
cd "$(dirname "$0")/.."
DB="${KPOS_VALIDATE_DB:-kpos_validate}"
case "${PGHOST:-localhost}" in *supabase.co*|*supabase.com*|*pooler*) echo "Refusing: PGHOST looks like a hosted Supabase project." >&2; exit 1;; esac
psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
P="psql -v ON_ERROR_STOP=1 -q -d $DB"
$P -f supabase/tests/00_supabase_stub.sql && echo "✓ auth/roles stub"
$P -f supabase/migrations/0001_init.sql   && echo "✓ 0001_init.sql"
$P -f supabase/seed.sql                   && echo "✓ seed.sql"
$P -f supabase/tests/01_rls_smoke.sql
echo "✓ RLS smoke test passed"
