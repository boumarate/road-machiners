// The dev-only icons page that npm run icons drives in headless Chromium. It renders every catalog entry in both views,
// and each weapon lying in the view the game shows it, then lays out the two unlabeled sprite sheets the game reads, the
// three labeled atlases (top-down, diagonal and the view the game shows), the closest-pairs report and the manifest
// body. It checks that weapon barrels read the right way and that blueprint cells keep to their palette.
// scripts/icons.mjs writes the files and fails on either check.

import { CHASSIS } from '../../data/chassis';
import { GOODS } from '../../data/goods';
import { PARTS } from '../../data/parts';
import { BLUEPRINT } from '../../render/palette';
import { iconCatalog, ICON_SECTIONS, ICON_WEAPON_PICKS, type IconEntry, type IconSection } from '../../render/partLooks';
import { loadModels, type ModelName } from '../render/models';
import {
  barrelReads,
  context,
  hex,
  iconHash,
  iconView,
  ICON_STYLES,
  ICON_VIEWS,
  MARGIN,
  OUTLINE_PX,
  paletteMisses,
  renderIcon,
  type BarrelRead,
  type IconCategory,
  type IconLie,
  type IconView,
} from './render';

const CELL = { items: 128, chassis: 192 };
const COLS = { items: 16, chassis: 8 };
const VIEWS: readonly IconView[] = ['top', 'diagonal'];
const SMALL = [36, 22]; // the card and chip sizes the atlas shows beside each large icon
const REPORT_SIZE = 36;
const REPORT_PAIRS = 10;
const BLUEPRINT_COLORS = Object.values(BLUEPRINT);

const SECTION_TITLES: Record<IconSection, string> = {
  weapon: 'Weapons',
  engine: 'Engines',
  armor: 'Armor',
  cargo: 'Cargo',
  store: 'Stores and scanner',
  core: 'Built-in parts',
  good: 'Goods',
  chassis: 'Chassis',
};
const LYING_TITLE = 'Weapons, rotated';

// Atlas layout in pixels.
const ATLAS = { cols: 6, tileW: 300, tileH: 176, big: 128, pad: 12, heading: 44, title: 56 };
const TOP_CAPTION = 'Top-down blueprint, nose up';
const DIAGONAL_CAPTION = 'Diagonal toon: side view, nose right, 20° toward the rear and 20° up';
const GAME_CAPTION = 'Equipment top-down blueprint, nose up. Cargo and chassis diagonal';
const PANEL = 0x272b2e; // the UI panel color, so the small sizes read as they do in game
const PAGE = 0x1b1c1d;
const TEXT = 0xe0d8ca;
const MUTED = 0xaaa69e;

type Sheet = 'items' | 'chassis';
// lying: a weapon's lying cell, in the view the game shows it. null for every other entry.
type Rendered = { entry: IconEntry; sheet: Sheet; views: Record<IconView, HTMLCanvasElement>; lying: HTMLCanvasElement | null };
// A drawn extent as shares of the cell: x, y, w, h.
type Box = [number, number, number, number];
type Cell = { index: number; hash: string; box: Box };
type Manifest = {
  cell: Record<Sheet, number>;
  margin: number;
  outline: number;
  cols: Record<Sheet, number>;
  views: Record<IconCategory, IconView>;
  items: Record<string, Cell & { lying?: Cell }>;
  chassis: Record<string, Cell>;
};
type Orientation = { id: string; ok: boolean; read: BarrelRead };
// misses: pixels of a blueprint cell, before the downscale, that are neither transparent nor a BLUEPRINT color.
type Palette = { id: string; view: IconView; lie: IconLie; misses: number };
type AtlasSection = { title: string; tiles: { entry: IconEntry; icon: HTMLCanvasElement }[] };
export type IconBuild = {
  files: Record<string, string>;
  manifest: Manifest;
  orientation: Orientation[];
  palette: Palette[];
  report: string;
};

async function build(): Promise<IconBuild> {
  await loadModels();
  const catalog = iconCatalog(PARTS, GOODS, CHASSIS, ICON_WEAPON_PICKS);
  const bytes = await modelBytes(catalog);
  const palette: Palette[] = [];
  const render = (entry: IconEntry, view: IconView, sheet: Sheet, lie: IconLie): HTMLCanvasElement => {
    const { icon, drawn } = renderIcon(entry, view, CELL[sheet], lie);
    if (ICON_STYLES[view] === 'blueprint') palette.push({ id: entry.id, view, lie, misses: paletteMisses(drawn, BLUEPRINT_COLORS) });
    return icon;
  };
  const rendered: Rendered[] = catalog.map((entry) => {
    const sheet: Sheet = entry.section === 'chassis' ? 'chassis' : 'items';
    const views = { top: render(entry, 'top', sheet, 'upright'), diagonal: render(entry, 'diagonal', sheet, 'upright') };
    return { entry, sheet, views, lying: entry.weapon ? render(entry, iconView(entry), sheet, 'lying') : null };
  });
  const files: Record<string, string> = {
    'public/icons/items.png': sheetOf(rendered, 'items').toDataURL('image/png'),
    'public/icons/chassis.png': sheetOf(rendered, 'chassis').toDataURL('image/png'),
    'public/icons/atlas/atlas-top.png': atlasOf(sectionsOf(rendered, () => 'top', true), TOP_CAPTION).toDataURL('image/png'),
    'public/icons/atlas/atlas-diagonal.png': atlasOf(sectionsOf(rendered, () => 'diagonal', false), DIAGONAL_CAPTION).toDataURL('image/png'),
    'public/icons/atlas/atlas-game.png': atlasOf(sectionsOf(rendered, iconView, false), GAME_CAPTION).toDataURL('image/png'),
  };
  return { files, manifest: manifestOf(rendered, bytes), orientation: orientationOf(catalog), palette, report: reportOf(rendered) };
}

async function modelBytes(catalog: readonly IconEntry[]): Promise<Map<ModelName, Uint8Array>> {
  const names = [...new Set(catalog.flatMap((e) => e.models))];
  const out = new Map<ModelName, Uint8Array>();
  await Promise.all(
    names.map(async (name) => {
      const res = await fetch(`${import.meta.env.BASE_URL}models/${name}.glb`);
      if (!res.ok) throw new Error(`Model ${name}.glb failed to load: HTTP ${res.status}`);
      out.set(name, new Uint8Array(await res.arrayBuffer()));
    }),
  );
  return out;
}

function inSheet(rendered: readonly Rendered[], sheet: Sheet): Rendered[] {
  return rendered.filter((r) => r.sheet === sheet);
}

// A sheet's cells in order: each entry in the view the game shows, then each weapon's lying cell. manifestOf() numbers
// them the same way.
function cellsOf(rendered: readonly Rendered[], sheet: Sheet): HTMLCanvasElement[] {
  const list = inSheet(rendered, sheet);
  return [...list.map((r) => r.views[iconView(r.entry)]), ...list.flatMap((r) => (r.lying ? [r.lying] : []))];
}

function sheetOf(rendered: readonly Rendered[], sheet: Sheet): HTMLCanvasElement {
  const cells = cellsOf(rendered, sheet);
  const cell = CELL[sheet];
  const canvas = document.createElement('canvas');
  canvas.width = COLS[sheet] * cell;
  canvas.height = Math.ceil(cells.length / COLS[sheet]) * cell;
  const ctx = context(canvas);
  cells.forEach((icon, i) => ctx.drawImage(icon, (i % COLS[sheet]) * cell, Math.floor(i / COLS[sheet]) * cell));
  return canvas;
}

function manifestOf(rendered: readonly Rendered[], bytes: Map<ModelName, Uint8Array>): Manifest {
  const read = (name: ModelName): Uint8Array => {
    const b = bytes.get(name);
    if (!b) throw new Error(`Model ${name} was not read`);
    return b;
  };
  const cellOf = (r: Rendered, index: number): Cell => ({ index, hash: iconHash(r.entry, iconView(r.entry), read), box: boxOf(r.views[iconView(r.entry)]) });
  const itemList = inSheet(rendered, 'items');
  let next = itemList.length;
  const items = itemList.map((r, index): [string, Cell & { lying?: Cell }] => {
    if (!r.lying) return [r.entry.id, cellOf(r, index)];
    const lying = { index: next++, hash: iconHash(r.entry, iconView(r.entry), read, 'lying'), box: boxOf(r.lying) };
    return [r.entry.id, { ...cellOf(r, index), lying }];
  });
  const chassis = inSheet(rendered, 'chassis').map((r, index) => [r.entry.id, cellOf(r, index)]);
  return {
    cell: CELL,
    margin: MARGIN,
    outline: OUTLINE_PX,
    cols: COLS,
    views: ICON_VIEWS,
    items: Object.fromEntries(items),
    chassis: Object.fromEntries(chassis),
  };
}

// Where a cell's drawn pixels lie, outline included, so a slot can fit the drawing to its box.
function boxOf(icon: HTMLCanvasElement): Box {
  const { width: w, height: h } = icon;
  const { data } = context(icon).getImageData(0, 0, w, h);
  let [x0, y0, x1, y1] = [w, h, 0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] === 0) continue;
      [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x + 1), Math.max(y1, y + 1)];
    }
  }
  if (x1 <= x0 || y1 <= y0) throw new Error('An icon drew no pixels');
  return [x0 / w, y0 / h, (x1 - x0) / w, (y1 - y0) / h];
}

// Every weapon's barrel must read from lower left to upper right in the diagonal view, by its sockets and its pixels.
function orientationOf(catalog: readonly IconEntry[]): Orientation[] {
  return catalog.flatMap((entry) => {
    if (!entry.weapon) return [];
    const read = barrelReads(entry, 'diagonal', CELL.items);
    const upRight = (p: { x: number; y: number }): boolean => p.x > read.head.x && p.y < read.head.y;
    return [{ id: entry.id, ok: upRight(read.tip) && upRight(read.pixelTip), read }];
  });
}

// The atlas sections in ICON_SECTIONS order, each entry in viewOf's view. With lying, the weapons' lying cells follow
// the weapons as their own section.
function sectionsOf(rendered: readonly Rendered[], viewOf: (entry: IconEntry) => IconView, lying: boolean): AtlasSection[] {
  return ICON_SECTIONS.flatMap((s) => {
    const list = rendered.filter((r) => r.entry.section === s);
    const section = { title: SECTION_TITLES[s], tiles: list.map((r) => ({ entry: r.entry, icon: r.views[viewOf(r.entry)] })) };
    const turned = lying ? list.flatMap((r) => (r.lying ? [{ entry: r.entry, icon: r.lying }] : [])) : [];
    return [section, { title: LYING_TITLE, tiles: turned }].filter((x) => x.tiles.length > 0);
  });
}

function atlasOf(sections: readonly AtlasSection[], caption: string): HTMLCanvasElement {
  const rows = sections.reduce((n, x) => n + Math.ceil(x.tiles.length / ATLAS.cols), 0);
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS.cols * ATLAS.tileW + ATLAS.pad * 2;
  canvas.height = ATLAS.title + sections.length * ATLAS.heading + rows * ATLAS.tileH + ATLAS.pad;
  const ctx = context(canvas);
  ctx.fillStyle = hex(PAGE);
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = hex(TEXT);
  ctx.font = 'bold 24px sans-serif';
  ctx.fillText(`ROAM item icons — ${caption}. Each tile: large, 36 px, 22 px.`, ATLAS.pad, 36);
  let y = ATLAS.title;
  for (const { title, tiles } of sections) {
    ctx.fillStyle = hex(TEXT);
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText(title, ATLAS.pad, y + 30);
    y += ATLAS.heading;
    tiles.forEach((t, i) => tile(ctx, t.entry, t.icon, ATLAS.pad + (i % ATLAS.cols) * ATLAS.tileW, y + Math.floor(i / ATLAS.cols) * ATLAS.tileH));
    y += Math.ceil(tiles.length / ATLAS.cols) * ATLAS.tileH;
  }
  return canvas;
}

function tile(ctx: CanvasRenderingContext2D, entry: IconEntry, icon: HTMLCanvasElement, x: number, y: number): void {
  ctx.fillStyle = hex(PANEL);
  ctx.fillRect(x + 2, y + 2, ATLAS.tileW - 4, ATLAS.tileH - 4);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(icon, x + 8, y + 6, ATLAS.big, ATLAS.big);
  let sx = x + ATLAS.big + 20;
  for (const s of SMALL) {
    ctx.drawImage(icon, sx, y + 6 + (ATLAS.big - s) / 2, s, s);
    sx += s + 14;
  }
  ctx.fillStyle = hex(TEXT);
  ctx.font = '15px sans-serif';
  ctx.fillText(entry.label, x + 8, y + ATLAS.big + 24, ATLAS.tileW - 16);
  ctx.fillStyle = hex(MUTED);
  ctx.font = '12px monospace';
  ctx.fillText(entry.id, x + 8, y + ATLAS.big + 40, ATLAS.tileW - 16);
}

// The item pairs that differ least at the card size, per view, over the panel color. A diagnostic, not a gate.
function reportOf(rendered: readonly Rendered[]): string {
  const items = inSheet(rendered, 'items');
  const lines: string[] = [`Closest item pairs at ${REPORT_SIZE} px by mean RGB difference (0-255) over the panel color.`];
  for (const view of VIEWS) {
    const px = items.map((r) => smallPixels(r.views[view]));
    const pairs: { a: string; b: string; d: number }[] = [];
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) pairs.push({ a: items[i].entry.id, b: items[j].entry.id, d: meanDiff(px[i], px[j]) });
    }
    pairs.sort((p, q) => p.d - q.d);
    lines.push('', `${view}:`, ...pairs.slice(0, REPORT_PAIRS).map((p) => `  ${p.d.toFixed(1).padStart(5)}  ${p.a} / ${p.b}`));
  }
  return `${lines.join('\n')}\n`;
}

function smallPixels(icon: HTMLCanvasElement): Uint8ClampedArray {
  const canvas = document.createElement('canvas');
  canvas.width = REPORT_SIZE;
  canvas.height = REPORT_SIZE;
  const ctx = context(canvas);
  ctx.fillStyle = hex(PANEL);
  ctx.fillRect(0, 0, REPORT_SIZE, REPORT_SIZE);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(icon, 0, 0, REPORT_SIZE, REPORT_SIZE);
  return ctx.getImageData(0, 0, REPORT_SIZE, REPORT_SIZE).data;
}

function meanDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 4) sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  return sum / ((a.length / 4) * 3);
}

declare global {
  interface Window {
    __ICONS__?: { build: () => Promise<IconBuild> };
  }
}

window.__ICONS__ = { build };
