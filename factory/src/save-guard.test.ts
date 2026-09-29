import { describe, expect, it } from 'vitest';
import { changesSaveMajor } from './save-guard';

const HEAD = 'diff --git a/game/src/three/save-migrations.ts b/game/src/three/save-migrations.ts\n--- a/game/src/three/save-migrations.ts\n+++ b/game/src/three/save-migrations.ts\n@@ -1,3 +1,3 @@\n';

describe('changesSaveMajor', () => {
  it('is true for a changed SAVE_MAJOR', () => {
    expect(changesSaveMajor(`${HEAD}-export const SAVE_MAJOR = 1;\n+export const SAVE_MAJOR = 2;\n`)).toBe(true);
  });

  it('is true for an added or removed line alone', () => {
    expect(changesSaveMajor(`${HEAD}+const SAVE_MAJOR=3;\n`)).toBe(true);
    expect(changesSaveMajor(`${HEAD}-const SAVE_MAJOR  = 3;\n`)).toBe(true);
  });

  it('is false for a context line', () => {
    expect(changesSaveMajor(`${HEAD} export const SAVE_MAJOR = 1;\n+const other = 1;\n`)).toBe(false);
  });

  it('is false for a migration step', () => {
    expect(changesSaveMajor(`${HEAD}+  (world) => world,\n`)).toBe(false);
  });

  it('is false in another file', () => {
    const other = 'diff --git a/game/src/x.ts b/game/src/x.ts\n--- a/game/src/x.ts\n+++ b/game/src/x.ts\n@@ -1 +1 @@\n+const SAVE_MAJOR = 2;\n';
    expect(changesSaveMajor(other)).toBe(false);
  });

  it('is false for an empty diff', () => {
    expect(changesSaveMajor('')).toBe(false);
  });
});
