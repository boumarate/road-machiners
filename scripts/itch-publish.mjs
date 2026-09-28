// Builds the last commit and uploads it to itch.io with butler.
// The build runs in a clean worktree, so uncommitted edits never ship.
// Usage: npm run itch
import { execFileSync } from 'node:child_process';
import { existsSync, symlinkSync } from 'node:fs';
import { resolve } from 'node:path';

process.loadEnvFile('.env');
const target = process.env.ITCH_TARGET;
if (!target) throw new Error('ITCH_TARGET is missing from .env, like "user/korovan"');

const run = (cmd, args, cwd) => execFileSync(cmd, args, { stdio: 'inherit', cwd });
const read = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' }).trim();

const version = read('git', ['rev-parse', '--short', 'HEAD']);
const dir = resolve('.worktrees/itch-publish');
if (existsSync(dir)) run('git', ['worktree', 'remove', '--force', dir]);
run('git', ['worktree', 'add', '--detach', dir, 'HEAD']);
try {
  symlinkSync(resolve('node_modules'), resolve(dir, 'node_modules'));
  run('npm', ['run', 'build'], dir);
  run('butler', ['push', resolve(dir, 'dist'), `${target}:html5`, '--userversion', version]);
} finally {
  run('git', ['worktree', 'remove', '--force', dir]);
}
const [user, game] = target.split('/');
console.log(`Uploaded ${version} to https://${user}.itch.io/${game}`);
