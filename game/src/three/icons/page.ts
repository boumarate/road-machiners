// The dev-only icons page that npm run icons drives in headless Chromium. It renders every catalog entry in both views,
// then lays out the two unlabeled sprite sheets the game reads, the two labeled comparison atlases, the closest-pairs
// report and the manifest body. scripts/icons.mjs writes the files.

import { CHASSIS } from '../../data/chassis';
import { GOODS } from '../../data/goods';
import { PARTS } from '../../data/parts';
import { iconCatalog, ICON_SECTIONS, ICON_WEAPON_PICKS, type IconEntry, type IconSection } from '../../render/partLooks';
import { loadModels, type ModelName } from '../render/models';
import { barrelReads, context, hex, iconHash, ICON_VIEWS, MARGIN, OUTLINE_PX, renderIcon, type BarrelRead, type IconView } from './render';

const CELL = { items: 128, chassis: 192 };
const COLS = { items: 16, chassis: 8 };
const VIEWS: readonly IconView[] = ['top', 'diagonal'];
const SMALL = [36, 22]; // the card and chip sizes the atlas shows beside each large icon
const REPORT_SIZE = 36;
const REPORT_PAIRS = 10;

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

// Atlas layout in pixels.
const ATLAS = { cols: 6, tileW: 300, tileH: 176, big: 128, pad: 12, heading: 44, title: 56 };
const PANEL = 0x272b2e; // the UI panel color, so the small sizes read as they do in game
const PAGE = 0x1b1c1d;
const TEXT = 0xe0d8ca;
const MUTED = 0xaaa69e;

type Sheet = 'items' | 'chassis';
type Rendered = { entry: IconEntry; sheet: Sheet; views: Record<IconView, HTMLCanvasElement> };
type Manifest = {
  cell: Record<Sheet, number>;
  margin: number;
  outline: number;
  cols: Record<Sheet, number>;
  views: Record<Sheet, IconView>;
  items: Record<string, { index: number; hash: string }>;
  chassis: Record<string, { index: number; hash: string }>;
};
type Orientation = { id: string; ok: boolean; read: BarrelRead };
export type IconBuild = { files: Record<string, string>; manifest: Manifest; orientation: Orientation[]; report: string };

async function build(): Promise<IconBuild> {
  await loadModels();
  const catalog = iconCatalog(PARTS, GOODS, CHASSIS, ICON_WEAPON_PICKS);
  const bytes = await modelBytes(catalog);
  const rendered: Rendered[] = catalog.map((entry) => {
    const sheet: Sheet = entry.section === 'chassis' ? 'chassis' : 'items';
    const views = { top: renderIcon(entry, 'top', CELL[sheet]), diagonal: renderIcon(entry, 'diagonal', CELL[sheet]) };
    return { entry, sheet, views };
  });
  const files: Record<string, string> = {
    'public/icons/items.png': sheetOf(rendered, 'items').toDataURL('image/png'),
    'public/icons/chassis.png': sheetOf(rendered, 'chassis').toDataURL('image/png'),
    'docs/icons/atlas-top.png': atlasOf(rendered, 'top').toDataURL('image/png'),
    'docs/icons/atlas-diagonal.png': atlasOf(rendered, 'diagonal').toDataURL('image/png'),
  };
  return { files, manifest: manifestOf(rendered, bytes), orientation: orientationOf(catalog), report: reportOf(rendered) };
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

function sheetOf(rendered: readonly Rendered[], sheet: Sheet): HTMLCanvasElement {
  const list = inSheet(rendered, sheet);
  const cell = CELL[sheet];
  const canvas = document.createElement('canvas');
  canvas.width = COLS[sheet] * cell;
  canvas.height = Math.ceil(list.length / COLS[sheet]) * cell;
  const ctx = context(canvas);
  list.forEach((r, i) => ctx.drawImage(r.views[ICON_VIEWS[sheet]], (i % COLS[sheet]) * cell, Math.floor(i / COLS[sheet]) * cell));
  return canvas;
}

function manifestOf(rendered: readonly Rendered[], bytes: Map<ModelName, Uint8Array>): Manifest {
  const read = (name: ModelName): Uint8Array => {
    const b = bytes.get(name);
    if (!b) throw new Error(`Model ${name} was not read`);
    return b;
  };
  const entries = (sheet: Sheet): Manifest['items'] =>
    Object.fromEntries(inSheet(rendered, sheet).map((r, index) => [r.entry.id, { index, hash: iconHash(r.entry, ICON_VIEWS[sheet], read) }]));
  return { cell: CELL, margin: MARGIN, outline: OUTLINE_PX, cols: COLS, views: ICON_VIEWS, items: entries('items'), chassis: entries('chassis') };
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

function atlasOf(rendered: readonly Rendered[], view: IconView): HTMLCanvasElement {
  const sections = ICON_SECTIONS.map((s) => ({ s, list: rendered.filter((r) => r.entry.section === s) })).filter((x) => x.list.length > 0);
  const rows = sections.reduce((n, x) => n + Math.ceil(x.list.length / ATLAS.cols), 0);
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS.cols * ATLAS.tileW + ATLAS.pad * 2;
  canvas.height = ATLAS.title + sections.length * ATLAS.heading + rows * ATLAS.tileH + ATLAS.pad;
  const ctx = context(canvas);
  ctx.fillStyle = hex(PAGE);
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = hex(TEXT);
  ctx.font = 'bold 24px sans-serif';
  const caption = view === 'top' ? 'Top-down, nose up' : 'Diagonal: side view, nose right, 20° toward the rear and 20° up';
  ctx.fillText(`ROAM item icons — ${caption}. Each tile: large, 36 px, 22 px.`, ATLAS.pad, 36);
  let y = ATLAS.title;
  for (const { s, list } of sections) {
    ctx.fillStyle = hex(TEXT);
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText(SECTION_TITLES[s], ATLAS.pad, y + 30);
    y += ATLAS.heading;
    list.forEach((r, i) => tile(ctx, r, view, ATLAS.pad + (i % ATLAS.cols) * ATLAS.tileW, y + Math.floor(i / ATLAS.cols) * ATLAS.tileH));
    y += Math.ceil(list.length / ATLAS.cols) * ATLAS.tileH;
  }
  return canvas;
}

function tile(ctx: CanvasRenderingContext2D, r: Rendered, view: IconView, x: number, y: number): void {
  ctx.fillStyle = hex(PANEL);
  ctx.fillRect(x + 2, y + 2, ATLAS.tileW - 4, ATLAS.tileH - 4);
  const icon = r.views[view];
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(icon, x + 8, y + 6, ATLAS.big, ATLAS.big);
  let sx = x + ATLAS.big + 20;
  for (const s of SMALL) {
    ctx.drawImage(icon, sx, y + 6 + (ATLAS.big - s) / 2, s, s);
    sx += s + 14;
  }
  ctx.fillStyle = hex(TEXT);
  ctx.font = '15px sans-serif';
  ctx.fillText(r.entry.label, x + 8, y + ATLAS.big + 24, ATLAS.tileW - 16);
  ctx.fillStyle = hex(MUTED);
  ctx.font = '12px monospace';
  ctx.fillText(r.entry.id, x + 8, y + ATLAS.big + 40, ATLAS.tileW - 16);
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
