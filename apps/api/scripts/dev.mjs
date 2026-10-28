// Development only: recompile on change and restart the compiled server. Production runs `node dist/main.js`.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const children = [
  spawn('tsc', ['-p', 'tsconfig.json', '--watch', '--preserveWatchOutput'], { stdio: 'inherit', shell: false }),
  spawn(process.execPath, ['--watch-path=dist', ...(existsSync('.env') ? ['--env-file=.env'] : []), 'dist/main.js'], {
    stdio: 'inherit',
  }),
];
const stop = (signal) => {
  for (const child of children) child.kill(signal);
};
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
for (const child of children) child.on('exit', (code) => (code ? stop('SIGTERM') : undefined));
