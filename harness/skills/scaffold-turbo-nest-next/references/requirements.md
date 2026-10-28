# Requirements catalog

Use these IDs in the composite manifest and evidence notes.

## Foundation

- F01 one package manager and root lockfile
- F02 exact tested package-manager/runtime contract
- F03 explicit `apps/*` and `packages/*` workspaces; no nested packages
- F04 frozen install
- F05 private root and applications
- F06 dependencies declared where used
- F07 non-mutating root checks
- F08 safe environment examples

## Composition

- C01 companions exist
- C02 staged generation
- C03 staged manifests verified
- C04 tested versions only
- C05 deterministic allowlist/denylist adapter
- C06 no standalone ownership files remain
- C07 preserved security/concurrency/input tests
- C08 transformed application checks rerun
- C09 source and result provenance recorded
- C10 existing destinations refused
- C11 interrupted runs visible
- C12 dry run writes nothing

## Boundaries

- B01 applications are leaves
- B02 no cross-app source imports
- B03 no alias bypass
- B04 package exports used
- B05 Nest owns business and data rules
- B06 no database code in web/client
- B07 no default junk-drawer package
- B08 extraction requires actual reuse/contract
- B09 cross-runtime module strategy proven
- B10 compiled package for cross-framework runtime code
- B11 JIT limited to bundler-owned consumers
- B12 stable lint/import enforcement
- B13 experimental Turbo boundaries not sole gate

## Integration

- I01 Nest OpenAPI authoritative
- I02 deterministic schema
- I03 browser-safe generated client
- I04 generated files not hand-edited
- I05 checked-in integration artifact
- I06 explicit mutating generation
- I07 non-mutating drift check
- I08 ordinary build does not rewrite contracts
- I09 same-origin browser default
- I10 server reads call API directly
- I11 no default CORS
- I12 Nest authorization preserved
- I13 request correlation propagated
- I14 internal/public API addresses separated
- I15 real persisted combined journey

## Tasks and environment

- T01 package scripts remain truth
- T02 small root command facade
- T03 correct dependency build order
- T04 actual outputs declared
- T05 no invented outputs
- T06 default inputs retained
- T07 `$TURBO_DEFAULT$` retained for custom inputs
- T08 persistent uncached development
- T09 side effects uncached
- T10 external-state tests uncached
- T11 deterministic unit tests may cache
- T12 correctness before graph optimization
- T13 package task overrides only when needed
- T14 root tasks explicit
- T15 builds have no external side effects
- T16 invalidation behavior tested
- E01 strict environment mode
- E02 application-local environment files
- E03 output-changing variables hashed
- E04 passthrough only when output-neutral
- E05 environment files included when read
- E06 each app validates configuration
- E07 no source secrets
- E08 no client secrets
- E09 safe cache logs
- E10 remote cache optional
- E11 remote artifacts signed when enabled
- E12 trusted and untrusted caches separated

## Quality and delivery

- Q01 one-command development
- Q02 readiness, not fixed sleeps
- Q03 isolated test database
- Q04 migration-based setup
- Q05 compiled real API/browser path
- Q06 persistence after reload
- Q07 failure/retry/duplicate coverage
- Q08 contract drift test
- Q09 boundary negative test
- Q10 cache restoration test
- Q11 invalidation test
- Q12 clean-clone test
- Q13 filtered commands test
- Q14 companion gates retained
- Q15 fixtures not integration proof
- D01 frozen CI install
- D02 version parity
- D03 required CI gates
- D04 affected checks only optimization
- D05 full release gate
- D06 separate app artifacts
- D07 target-neutral default
- D08 pruned container contexts for both apps
- D09 Next standalone tracing
- D10 compiled Nest runtime
- D11 non-root images
- D12 small runtime images
- D13 controlled migration step
- D14 both artifacts smoked
- D15 target claims need target evidence
