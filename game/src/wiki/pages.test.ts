import { describe, expect, it } from 'vitest';
import { dataRefs, fillPage, markdownTable, resolveRef, type WikiTable } from './wiki';

const colors: WikiTable = { id: 'colors', headers: ['id', 'n'], rows: () => [['red', 1], ['blue', 2]] };
const tables = { colors };
const roots = { RULES: { a: { b: 3 }, list: [1, 2] } };

describe('fillPage', () => {
  const page = 'Intro `RULES.a.b` text.\n\n<!-- wiki:colors -->\nold\n<!-- /wiki:colors -->\n\nOutro.\n';

  it('replaces only the text between the markers', () => {
    const out = fillPage('p.md', page, tables, roots);
    expect(out.startsWith('Intro `RULES.a.b` text.\n\n<!-- wiki:colors -->\n| id | n |')).toBe(true);
    expect(out.endsWith('<!-- /wiki:colors -->\n\nOutro.\n')).toBe(true);
    expect(out).not.toContain('old');
  });

  it('gives the same text when filled twice', () => {
    const once = fillPage('p.md', page, tables, roots);
    expect(fillPage('p.md', once, tables, roots)).toBe(once);
  });

  it('fills a numbers block with the values of the paths the prose names', () => {
    const text = 'See `RULES.a.b` and `RULES.list`.\n<!-- wiki:numbers -->\n<!-- /wiki:numbers -->\n';
    const out = fillPage('p.md', text, tables, roots);
    expect(out).toContain('| `RULES.a.b` | 3 |');
    expect(out).toContain('| `RULES.list` | 1, 2 |');
  });

  it('throws with the page and id on an unclosed marker', () => {
    expect(() => fillPage('p.md', '<!-- wiki:colors -->\nx\n', tables, roots)).toThrow(/p\.md.*colors/);
  });

  it('throws with the page and id on a block with no table', () => {
    expect(() => fillPage('p.md', '<!-- wiki:nope -->\n<!-- /wiki:nope -->\n', tables, roots)).toThrow(/p\.md.*nope/);
  });

  it('throws with the page and id on a table used twice', () => {
    const twice = '<!-- wiki:colors -->\n<!-- /wiki:colors -->\n<!-- wiki:colors -->\n<!-- /wiki:colors -->\n';
    expect(() => fillPage('p.md', twice, tables, roots)).toThrow(/p\.md.*colors/);
  });
});

describe('dataRefs', () => {
  it('finds data paths and source files in prose and skips generated blocks', () => {
    const text = 'Uses `RULES.leadError` in `src/sim/combat.ts`.\n<!-- wiki:x -->\n`RULES.hidden` `src/hidden.ts`\n<!-- /wiki:x -->\n';
    expect(dataRefs(text)).toEqual({ data: ['RULES.leadError'], files: ['src/sim/combat.ts'] });
  });
});

describe('resolveRef', () => {
  it('returns the value of a valid path', () => {
    expect(resolveRef(roots, 'RULES.a.b')).toBe(3);
  });

  it('throws for a missing key', () => {
    expect(() => resolveRef(roots, 'RULES.a.c')).toThrow(/RULES\.a\.c/);
  });

  it('throws for an unregistered root', () => {
    expect(() => resolveRef(roots, 'OTHER.a')).toThrow(/OTHER/);
  });
});

describe('markdownTable', () => {
  it('escapes pipes, lists arrays and compacts objects', () => {
    const t: WikiTable = { id: 't', headers: ['a', 'b', 'c'], rows: () => [['x|y', ['p', 'q'], { k: 1 }]] };
    expect(markdownTable(t)).toBe('| a | b | c |\n| --- | --- | --- |\n| x\\|y | p, q | {"k":1} |');
  });
});
