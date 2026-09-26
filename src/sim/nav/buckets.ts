// A uniform grid over circular blockers, so a line check reads only the blockers near its segment.

import { segmentDist, type Vec } from '../vec';

// Circles to route around, such as rocks, wrecks and parked vehicles.
export type Blocker = { pos: Vec; r: number };

const BUCKET = 8; // tiles per bucket side
const HALF_DIAG = (BUCKET * Math.SQRT2) / 2;

export class ObstacleBuckets {
  private readonly cols: number;
  private readonly cells: Blocker[][];
  private readonly outside: Blocker[] = []; // blockers centered off the map sit in no bucket and are always candidates
  private readonly maxR: number;

  constructor(blockers: Blocker[], size: number) {
    this.cols = Math.ceil(size / BUCKET);
    this.cells = Array.from({ length: this.cols * this.cols }, () => []);
    let maxR = 0;
    for (const o of blockers) {
      maxR = Math.max(maxR, o.r);
      const bx = Math.floor(o.pos.x / BUCKET);
      const by = Math.floor(o.pos.y / BUCKET);
      if (bx < 0 || by < 0 || bx >= this.cols || by >= this.cols) this.outside.push(o);
      else this.cells[by * this.cols + bx].push(o);
    }
    this.maxR = maxR;
  }

  // Every blocker whose circle, grown by reach, can touch segment ab. Buckets whose center is farther
  // than reach + the largest radius + half a bucket diagonal cannot hold such a blocker.
  alongSegment(a: Vec, b: Vec, reach: number): Blocker[] {
    const out = this.outside.slice();
    const pad = reach + this.maxR;
    const lim = pad + HALF_DIAG;
    const x0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - pad) / BUCKET));
    const y0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - pad) / BUCKET));
    const x1 = Math.min(this.cols - 1, Math.floor((Math.max(a.x, b.x) + pad) / BUCKET));
    const y1 = Math.min(this.cols - 1, Math.floor((Math.max(a.y, b.y) + pad) / BUCKET));
    for (let by = y0; by <= y1; by++)
      for (let bx = x0; bx <= x1; bx++) {
        const cell = this.cells[by * this.cols + bx];
        if (cell.length === 0) continue;
        if (segmentDist({ x: (bx + 0.5) * BUCKET, y: (by + 0.5) * BUCKET }, a, b) > lim) continue;
        for (const o of cell) out.push(o);
      }
    return out;
  }
}
