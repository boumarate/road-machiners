// Builds the game and uploads dist/ to itch.io with butler.
// The upload version is the commit hash, so the tree must be clean.
// Usage: npm run itch
import { execFileSync } from 'node:child_process';

process.loadEnvFile('.env');
const target = process.env.ITCH_TARGET;
if (!target) throw new Error('ITCH_TARGET is missing from .env, like "user/korovan"');

const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' });
const read = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' }).trim();

if (read('git', ['status', '--porcelain', '--untracked-files=no'])) throw new Error('Commit your changes first, so the upload matches a commit');
const version = read('git', ['rev-parse', '--short', 'HEAD']);

run('npm', ['run', 'build']);
run('butler', ['push', 'dist', `${target}:html5`, '--userversion', version]);
console.log(`Uploaded ${version} to https://${target.split('/')[0]}.itch.io/${target.split('/')[1]}`);
