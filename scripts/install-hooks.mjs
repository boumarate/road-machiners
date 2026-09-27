import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync } from 'node:fs';
import path from 'node:path';

function readGit(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function installHooks() {
  const gitDirectory = path.resolve(readGit('rev-parse', '--git-dir'));
  const commonDirectory = path.resolve(readGit('rev-parse', '--git-common-dir'));
  if (gitDirectory !== commonDirectory) throw new Error('Install hooks from the main checkout after merging. Git hook configuration is shared by worktrees.');
  const existing = readHooksPath();
  if (existing && existing !== '.githooks') throw new Error(`Refusing to replace existing hooksPath: ${existing}`);
  if (!existing && existsSync(path.join(gitDirectory, 'hooks/pre-commit'))) throw new Error('Refusing to hide an existing .git/hooks/pre-commit hook.');
  chmodSync('.githooks/pre-commit', 0o755);
  readGit('config', '--local', 'core.hooksPath', '.githooks');
  console.log('Pre-commit quality checks installed.');
}

function readHooksPath() {
  const configured = spawnSync('git', ['config', '--get', 'core.hooksPath'], { encoding: 'utf8' });
  if (configured.error) throw configured.error;
  if (![0, 1].includes(configured.status)) throw new Error(configured.stderr);
  return configured.stdout.trim();
}

installHooks();
