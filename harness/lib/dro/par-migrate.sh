#!/bin/bash
# usage: par-migrate.sh <output-prefix>   Starts two `pnpm migrate` at the same moment and prints both exit codes.
pnpm migrate > "$1-a.out" 2> "$1-a.err" & pa=$!
pnpm migrate > "$1-b.out" 2> "$1-b.err" & pb=$!
wait "$pa"; echo "a=$?"
wait "$pb"; echo "b=$?"
