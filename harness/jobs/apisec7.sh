#!/bin/bash
# AC-41 shard "n3" (see harness/lib/ac41shard.sh). Writes results/parts/AC-41-n3.json.
. "$(dirname "$0")/../lib/common.sh"
. "$(dirname "$0")/../lib/apisec.sh"
. "$(dirname "$0")/../lib/ac41shard.sh"
ac41_shard n3
exit 0
