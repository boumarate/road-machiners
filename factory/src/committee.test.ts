import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { githubLogins, readCommittee, telegramIds } from './committee';

const ROOT = resolve('tmp/factory-committee-test');
const BOOT = { telegram: '7', github: 'boss' };

function put(text: string): void {
  writeFileSync(join(ROOT, 'committee', 'committee.json'), text);
}

describe('readCommittee', () => {
  beforeEach(() => {
    rmSync(ROOT, { recursive: true, force: true });
    mkdirSync(join(ROOT, 'committee'), { recursive: true });
  });

  it('returns the bootstrap member when the file is missing', () => {
    expect(readCommittee(ROOT, BOOT)).toEqual([{ telegram: '7', github: 'boss', name: null }]);
  });

  it('reads the file fresh each call', () => {
    put('{"members":[{"telegram":"1","github":"a","name":"Ann"}]}');
    expect(telegramIds(readCommittee(ROOT, BOOT))).toEqual(['1']);
    put('{"members":[{"telegram":"2","github":null,"name":null}]}');
    expect(telegramIds(readCommittee(ROOT, BOOT))).toEqual(['2']);
  });

  it('lists github logins and skips members without one', () => {
    put('{"members":[{"telegram":"1","github":"a","name":null},{"telegram":"2","github":null,"name":null}]}');
    expect(githubLogins(readCommittee(ROOT, BOOT))).toEqual(['a']);
  });

  it('throws on malformed files', () => {
    for (const text of ['nope', '{}', '{"members":[5]}', '{"members":[{"telegram":1,"github":null,"name":null}]}', '{"members":[{"telegram":"x","github":null,"name":null}]}', '{"members":[{"telegram":"1","github":3,"name":null}]}']) {
      put(text);
      expect(() => readCommittee(ROOT, BOOT), text).toThrow();
    }
  });
});
