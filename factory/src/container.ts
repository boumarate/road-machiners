import { must } from './exec';
import type { Container, FactoryConfig, Run } from './types';

const BASE_ARGS = ['run', '--rm', '--label', 'factory=1'];

function mountArgs(clone: string): string[] {
  return ['-v', `${clone}:/work`, '-w', '/work'];
}

function envArgs(env: Record<string, string>): string[] {
  return Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]);
}

// Agents get the work clone and the OAuth token, nothing else. The token travels in the docker process env, never in argv.
export function dockerContainer(run: Run, cfg: FactoryConfig): Container {
  return {
    async agent({ clone, model, prompt, log }) {
      const args = [
        ...BASE_ARGS, '-i', ...mountArgs(clone), '-e', 'CLAUDE_CODE_OAUTH_TOKEN', cfg.image,
        'factory-agent', '-p', '--model', model, '--permission-mode', 'bypassPermissions', '--output-format', 'stream-json', '--verbose',
      ];
      const result = await run('docker', args, { env: { CLAUDE_CODE_OAUTH_TOKEN: cfg.oauthToken }, input: prompt, logPath: log });
      must(result, `agent in ${clone}`);
    },
    async shell(clone, script, log, env = {}) {
      const args = [...BASE_ARGS, ...mountArgs(clone), ...envArgs(env), cfg.image, 'bash', '-lc', script];
      const result = await run('docker', args, { logPath: log });
      must(result, `shell in ${clone}`);
    },
  };
}
