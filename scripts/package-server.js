import { mkdir, rm, cp, mkdtemp, rename } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';

const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} failed`);
};
run('npm', ['run', 'build']);
const staging = await mkdtemp(path.join(tmpdir(), 'blockfield-release-'));
try {
  const directory = path.join(staging, 'blockfield-server');
  await mkdir(directory, { recursive: true }); await mkdir('release', { recursive: true });
  for (const entry of ['dist', 'src', 'server', 'server.js', 'package.json', 'package-lock.json', 'README.md', 'docs', 'deploy']) await cp(entry, path.join(directory, entry), { recursive: true });
  const temporary = path.resolve('release/blockfield-server.tar.gz.tmp');
  run('tar', ['-czf', temporary, '-C', staging, 'blockfield-server']);
  await rename(temporary, path.resolve('release/blockfield-server.tar.gz'));
} finally { await rm(staging, { recursive: true, force: true }); }
console.log('Server package: release/blockfield-server.tar.gz');
