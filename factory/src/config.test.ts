import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

const FULL = {
  FACTORY_REPO: 'o/r', FACTORY_PROJECT_OWNER: 'o', FACTORY_PROJECT_NUMBER: '3', FACTORY_HOME: '/h', FACTORY_WEB_ROOT: '/w',
  FACTORY_PUBLIC_URL: 'http://x', FACTORY_IMAGE: 'img', CLAUDE_CODE_OAUTH_TOKEN: 't', FACTORY_DESIGN_MODEL: 'opus',
  FACTORY_BUILD_MODEL: 'sonnet', FACTORY_MIN_VOTES: '5', FACTORY_MIN_AGE_HOURS: '24', FACTORY_COMMITTEE_BOOTSTRAP_GITHUB: 'boss',
  FACTORY_COMMITTEE_BOOTSTRAP: '1', TELEGRAM_BOT_TOKEN: 'bt', FACTORY_COMMITTEE_CHAT: '-1', FACTORY_PUBLIC_CHANNEL: '@c',
  FACTORY_STAGE_TIMEOUT_MINUTES: '180', FACTORY_RELEASE_DAYS: '7', FACTORY_MAINTENANCE_HOURS: '24',
};

describe('loadConfig', () => {
  it('parses numbers and bootstrap member', () => {
    const cfg = loadConfig(FULL);
    expect(cfg.minVotes).toBe(5);
    expect(cfg.committeeBootstrapGithub).toBe('boss');
    expect(cfg.committeeBootstrapTelegram).toBe('1');
    expect(cfg.committeeChat).toBe('-1');
  });

  it('names every missing key', () => {
    expect(() => loadConfig({ ...FULL, FACTORY_REPO: '', TELEGRAM_BOT_TOKEN: undefined })).toThrow('FACTORY_REPO, TELEGRAM_BOT_TOKEN');
  });

  it('rejects a bad number', () => {
    expect(() => loadConfig({ ...FULL, FACTORY_MIN_VOTES: 'many' })).toThrow('FACTORY_MIN_VOTES');
  });
});
