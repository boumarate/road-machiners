// The fortress bake layer on a flat draft: the Bowl pit and the pieces as props.

import { describe, expect, it } from 'vitest';
import { FORTRESS_SITES } from '../data/fortress';
import { REGION } from '../data/region';
import { FORT_MODELS, fortressPieces, insideCurtain, pitDepth } from '../sim/fortress';
import { newDraft, typeCode, type MapDraft } from './bake';
import { fortressLayer } from './fortress';

const RIM = 5;
const SAND = typeCode('sand');
const bowl = REGION.towns.find((t) => t.id === 'bowl')!;
const pit = FORTRESS_SITES.bowl.pit!;

function flatDraft(): MapDraft {
  const d = newDraft(REGION.size);
  d.heights.fill(RIM);
  d.types.fill(SAND);
  return d;
}

describe('fortress layer', () => {
  const d = fortressLayer(flatDraft());
  const n = d.size + 1;

  it('bakes every fortress site piece as a prop of its style', () => {
    const sites = [...REGION.towns, ...REGION.locations].filter((s) => s.id in FORTRESS_SITES);
    expect(d.props).toHaveLength(sites.reduce((sum, s) => sum + fortressPieces(s).length, 0));
    for (const p of d.props) expect(FORT_MODELS.has(p.kind)).toBe(true);
  });

  it('lowers each corner inside the Bowl curtain by its pit depth and no other corner (IV17)', () => {
    const lowered: number[] = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const h = d.heights[j * n + i];
        if (h === RIM) continue;
        const p = { x: i, y: j };
        expect(insideCurtain(bowl, p, pit.margin), `corner ${i},${j}`).toBe(true);
        expect(h).toBeCloseTo(RIM - pitDepth(bowl, p), 5);
        lowered.push(h);
      }
    }
    expect(Math.min(...lowered)).toBeCloseTo(RIM - pit.terraces * pit.stepHeight, 5);
  });

  it('types flat pit tiles as field and its risers as scree, and leaves the rest', () => {
    const field = typeCode('field');
    const scree = typeCode('scree');
    const counts = { field: 0, scree: 0 };
    for (let y = 0; y < d.size; y++) {
      for (let x = 0; x < d.size; x++) {
        const corners = [d.heights[y * n + x], d.heights[y * n + x + 1], d.heights[(y + 1) * n + x], d.heights[(y + 1) * n + x + 1]];
        const type = d.types[y * d.size + x];
        if (corners.every((h) => h === RIM)) {
          expect(type, `tile ${x},${y}`).toBe(SAND);
        } else if (corners.every((h) => h === corners[0])) {
          expect(type, `tile ${x},${y}`).toBe(field);
          counts.field++;
        } else {
          expect(type, `tile ${x},${y}`).toBe(scree);
          counts.scree++;
        }
      }
    }
    expect(counts.field).toBeGreaterThan(counts.scree);
    expect(counts.scree).toBeGreaterThan(0);
  });
});
