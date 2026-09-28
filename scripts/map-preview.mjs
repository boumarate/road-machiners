// Top-down pictures of a map draft for tuning the bake: ground type colors under hillshade, site edges
// as rings and rocks as dark discs. An area is a rectangle of the map in tiles, { x, y, w, h } from its
// top-left corner. Pixel (px, py) covers the map point (area.x + (px + 0.5) / pxPerTile, area.y + (py + 0.5) / pxPerTile).

import { REGION } from '../src/data/region.ts';
import { TERRAIN, TERRAIN_TYPES } from '../src/data/terrain.ts';
import { TYPE_IDS } from '../src/sim/terrain.ts';

const OUTSIDE = 0x202020;
const SITE_EDGE = 0x8a1e14;
const ROCK = 0x3a3028;
const COLORS = TYPE_IDS.map((id) => TERRAIN_TYPES[id].color);

export function paintMap(d, area, pxPerTile) {
  const pic = { width: Math.round(area.w * pxPerTile), height: Math.round(area.h * pxPerTile), rgba: new Uint8Array(0) };
  pic.rgba = new Uint8Array(pic.width * pic.height * 4);
  for (let py = 0; py < pic.height; py++) for (let px = 0; px < pic.width; px++) {
    const x = area.x + (px + 0.5) / pxPerTile;
    const y = area.y + (py + 0.5) / pxPerTile;
    put(pic, px, py, groundColor(d, x, y));
  }
  for (const site of [...REGION.towns, ...REGION.locations]) paintDisc(pic, area, pxPerTile, site.pos, site.radius, SITE_EDGE, site.radius - 1 / pxPerTile);
  for (const rock of d.rocks) paintDisc(pic, area, pxPerTile, rock.pos, rock.r, ROCK, 0);
  return pic;
}

function groundColor(d, x, y) {
  if (x < 0 || y < 0 || x >= d.size || y >= d.size) return OUTSIDE;
  const i = Math.floor(x);
  const j = Math.floor(y);
  const w = d.size + 1;
  const a = d.heights[j * w + i];
  const b = d.heights[j * w + i + 1];
  const c = d.heights[(j + 1) * w + i];
  const e = d.heights[(j + 1) * w + i + 1];
  // Slope of the blended ground at the point, not the tile average, so close-ups shade smoothly.
  const gx = b - a + (a - b - c + e) * (y - j);
  const gy = c - a + (a - b - c + e) * (x - i);
  const light = 1 + (gx * TERRAIN.light.x + gy * TERRAIN.light.y) * TERRAIN.slopeShade;
  return shade(COLORS[d.types[j * d.size + i]], light);
}

// Fills the pixels whose centers lie within radius of center and at least inner from it.
function paintDisc(pic, area, pxPerTile, center, radius, color, inner) {
  const x0 = Math.max(0, Math.floor((center.x - radius - area.x) * pxPerTile));
  const x1 = Math.min(pic.width - 1, Math.ceil((center.x + radius - area.x) * pxPerTile));
  const y0 = Math.max(0, Math.floor((center.y - radius - area.y) * pxPerTile));
  const y1 = Math.min(pic.height - 1, Math.ceil((center.y + radius - area.y) * pxPerTile));
  for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
    const r = Math.hypot(area.x + (px + 0.5) / pxPerTile - center.x, area.y + (py + 0.5) / pxPerTile - center.y);
    if (r <= radius && r >= inner) put(pic, px, py, color);
  }
}

function shade(color, k) {
  const ch = (s) => Math.max(0, Math.min(255, Math.round(((color >> s) & 0xff) * k)));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

function put(pic, px, py, color) {
  const at = (py * pic.width + px) * 4;
  pic.rgba[at] = (color >> 16) & 0xff;
  pic.rgba[at + 1] = (color >> 8) & 0xff;
  pic.rgba[at + 2] = color & 0xff;
  pic.rgba[at + 3] = 255;
}
