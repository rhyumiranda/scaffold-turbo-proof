#!/bin/bash
# AC-41 shard "fuzzA" (see harness/lib/ac41shard.sh). Writes results/parts/AC-41-fuzzA.json.
. "$(dirname "$0")/../lib/common.sh"
. "$(dirname "$0")/../lib/apisec.sh"
. "$(dirname "$0")/../lib/ac41shard.sh"
ac41_shard fuzzA
exit 0
