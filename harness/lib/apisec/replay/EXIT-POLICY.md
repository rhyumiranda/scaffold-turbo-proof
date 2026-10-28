# Replay exit policy

A replay script that exits non-zero, or is killed by the 25-minute timeout (exit 124), did not prove its attack class and FAILS its shard.
An exception needs a line in the script's own source showing that a non-zero exit is its normal "no finding" result.

Review of every script (`grep -n "process.exit\|exitCode\|exit [0-9]"` over scripts/, own/, coordinator/, r2i/ finds no match):

| Script(s) | Sets its own exit code? | Policy |
|---|---|---|
| scripts/ac41*.mjs, ac39.mjs, cl-hang.mjs, fuzz-z3.mjs | No: they print results and end normally (exit 0) | must exit 0 |
| own/*.mjs (z5a-g, bom, cap, csrf-matcher, hang-verify, n1-n3, verify-patch, z5c, z5diff) | No (5xx and hangs are printed as `5XX`/`HANG` lines and counted, never an exit code) | must exit 0 |
| coordinator/coordinator-fuzz.mjs, coordinator-sweep.mjs | No: print a status histogram and sample lines | must exit 0 |
| scripts/repro-*.sh, cors.sh, logout.sh, r2i/repro-min.sh | No explicit exit; the last command is `printf`/`echo`/`grep` on a header line | must exit 0 |

Exceptions: none. 5xx responses are caught separately by the zero-5xx log checks and the `5XX` / `HTTP 5xx` output markers.
