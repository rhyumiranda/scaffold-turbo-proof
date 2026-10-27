// Builds both runtime images and writes an SPDX SBOM for each to sbom/. Syft is pinned by digest.
// Usage: pnpm run sbom   (requires Docker; set SBOM_TAG to reuse already-built tags instead of building)
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const syft = 'anchore/syft:v1.55.0@sha256:4cc92b64ca74ffca4c94d4c8fcc01f217731375300be14d0b6eeb2e82eaa110a';
const images = [
  { name: 'api', dockerfile: 'apps/api/Dockerfile', target: 'runtime' },
  { name: 'web', dockerfile: 'apps/web/Dockerfile', target: 'runtime' },
];
const run = (args, options = {}) => {
  const result = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...options });
  if (result.status !== 0) throw new Error(`docker ${args[0]} failed (exit ${result.status})`);
  return result.stdout;
};
mkdirSync('sbom', { recursive: true });
for (const image of images) {
  const tag = process.env.SBOM_TAG ? `${process.env.SBOM_TAG}-${image.name}` : `sbom-${image.name}:local`;
  if (!process.env.SBOM_TAG)
    run(['build', '-f', image.dockerfile, '--target', image.target, '-t', tag, '.'], {
      stdio: ['ignore', 'ignore', 'inherit'],
    });
  const spdx = run(['run', '--rm', '-v', '/var/run/docker.sock:/var/run/docker.sock', syft, tag, '-o', 'spdx-json']);
  writeFileSync(`sbom/${image.name}.spdx.json`, spdx);
  const packages = JSON.parse(spdx).packages?.length ?? 0;
  console.log(
    JSON.stringify({ event: 'sbom.written', image: image.name, file: `sbom/${image.name}.spdx.json`, packages }),
  );
}
