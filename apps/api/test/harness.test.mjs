import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
test('browser harness SIGTERM reaps both owned children', async () => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.ok(process.env.DATABASE_URL);
  const root = await mkdtemp(join(tmpdir(), 'nest-harness-fixture-'));
  await mkdir(join(root, 'scripts'), { recursive: true });
  await mkdir(join(root, 'node_modules/@playwright/test'), { recursive: true });
  // Lifecycle doubles only: this does not count as browser/application verification.
  await writeFile(
    join(root, 'scripts/start.mjs'),
    "import {createServer} from 'node:http'; createServer((_q,s)=>s.end('ok')).listen(Number(process.env.PORT),'127.0.0.1',()=>console.log('OWNED_CHILD:'+process.pid));",
  );
  await writeFile(
    join(root, 'node_modules/@playwright/test/cli.js'),
    "console.log('OWNED_CHILD:'+process.pid); setInterval(()=>{},1000);",
  );
  const child = spawn(process.execPath, ['test/with-web.mjs', root], {
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const ended = once(child, 'exit');
  let output = '';
  child.stdout.on('data', (part) => {
    output += part;
  });
  child.stderr.on('data', (part) => {
    output += part;
  });
  let pids = [];
  try {
    // Deadline-based so a loaded host is slow, not flaky (about 2 s idle, up to 8 s under heavy load).
    for (const deadline = Date.now() + 30000; Date.now() < deadline;) {
      pids = [...output.matchAll(/OWNED_CHILD:(\d+)/g)].map((match) => Number(match[1]));
      if (pids.length === 2) break;
      if (child.exitCode !== null) throw new Error('Harness exited early: ' + output);
      await delay(50);
    }
    assert.equal(pids.length, 2, output);
    child.kill('SIGTERM');
    const deadline = setTimeout(() => child.kill('SIGKILL'), 8000);
    await ended;
    clearTimeout(deadline);
    await delay(100);
    assert.ok(
      pids.every((pid) => !alive(pid)),
      'Harness left an owned child running',
    );
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await ended;
    }
    for (const pid of pids) if (alive(pid)) process.kill(pid, 'SIGKILL');
  }
});
