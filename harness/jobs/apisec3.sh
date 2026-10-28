#!/bin/bash
# AC-41 shard "own" (see harness/lib/ac41shard.sh). Writes results/parts/AC-41-own.json.
. "$(dirname "$0")/../lib/common.sh"
. "$(dirname "$0")/../lib/apisec.sh"
. "$(dirname "$0")/../lib/ac41shard.sh"
ac41_shard own
exit 0
