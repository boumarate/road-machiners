import { must } from './exec';
import { AGENT_NETWORK, GAME_DIR, PROXY_NAME, PROXY_PORT, type Container, type FactoryConfig, type Run } from './types';

const BASE_ARGS = ['run', '--rm', '--label', 'factory=1'];
const PROXY_URL = `http://${PROXY_NAME}:${PROXY_PORT}`;
const NO_PROXY = 'localhost,127.0.0.1';

function mountArgs(clone: string, dir: string): string[] {
  return ['-v', `${clone}:/work`, '-w', `/work/${dir}`];
}

function envArgs(env: Record<string, string>): string[] {
  return Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]);
}

// The internal network has no route out. Its only way out is the proxy, which passes the allowlisted hosts.
function networkArgs(open: boolean): string[] {
  if (open) return [];
  const proxyEnv = Object.fromEntries(
    ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy'].map((key) => [key, PROXY_URL]).concat([['NO_PROXY', NO_PROXY], ['no_proxy', NO_PROXY]]),
  );
  return ['--network', AGENT_NETWORK, ...envArgs(proxyEnv)];
}

// Creates the internal network and the proxy container when they are missing. Throws when either cannot start.
async function ensureProxy(run: Run, cfg: FactoryConfig): Promise<void> {
  const docker = async (what: string, args: string[]) => must(await run('docker', args), what);
  if ((await run('docker', ['network', 'inspect', AGENT_NETWORK])).code !== 0) {
    await docker(`create network ${AGENT_NETWORK}`, ['network', 'create', '--internal', AGENT_NETWORK]);
  }
  const state = await run('docker', ['inspect', '-f', '{{.State.Running}}', PROXY_NAME]);
  if (state.code === 0 && state.stdout.trim() === 'true') return;
  await run('docker', ['rm', '-f', PROXY_NAME]);
  await docker(`start ${PROXY_NAME}`, ['run', '-d', '--restart', 'unless-stopped', '--name', PROXY_NAME, '--network', AGENT_NETWORK, `${cfg.image}-proxy`]);
  await docker(`connect ${PROXY_NAME} to the default bridge`, ['network', 'connect', 'bridge', PROXY_NAME]);
}

// Agents get the work clone and the OAuth token, nothing else. The token travels in the docker process env, never in argv.
// Unless the run is open, containers sit on the internal network and reach only the proxy's allowlist.
export function dockerContainer(run: Run, cfg: FactoryConfig): Container {
  return {
    async agent({ clone, dir, model, prompt, log, openNetwork }) {
      if (!openNetwork) await ensureProxy(run, cfg);
      const args = [
        ...BASE_ARGS, '-i', ...mountArgs(clone, dir), ...networkArgs(openNetwork === true), '-e', 'CLAUDE_CODE_OAUTH_TOKEN', cfg.image,
        'factory-agent', '-p', '--model', model, '--permission-mode', 'bypassPermissions', '--output-format', 'stream-json', '--verbose',
      ];
      const result = await run('docker', args, { env: { CLAUDE_CODE_OAUTH_TOKEN: cfg.oauthToken }, input: prompt, logPath: log });
      must(result, `agent in ${clone}`);
    },
    async shell(clone, script, log, env = {}) {
      await ensureProxy(run, cfg);
      const args = [...BASE_ARGS, ...mountArgs(clone, GAME_DIR), ...networkArgs(false), ...envArgs(env), cfg.image, 'bash', '-lc', script];
      const result = await run('docker', args, { logPath: log });
      must(result, `shell in ${clone}`);
    },
  };
}
