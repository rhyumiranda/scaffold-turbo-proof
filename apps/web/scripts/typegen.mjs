import { rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// next typegen adds route types but never deletes them. Remove the old ones first, so a deleted or renamed route
// cannot leave a type file that points at a page that no longer exists.
for (const directory of ['.next/types', '.next/dev/types']) rmSync(directory, { recursive: true, force: true });
execFileSync('next', ['typegen'], { stdio: 'inherit', shell: process.platform === 'win32' });
