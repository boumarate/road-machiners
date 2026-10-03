// The fortress bake layer: each fortress site's layout pieces from src/sim/fortress.ts as baked props.

import { FORTRESS, FORTRESS_SITES } from '../data/fortress';
import { REGION } from '../data/region';
import { along, fortressPieces, type FortressKind, type FortressPiece } from '../sim/fortress';
import type { Site } from '../sim/sites';
import type { BakedProp, PropKind } from '../sim/terrain';
import type { MapDraft } from './bake';

const PROP_KIND: Record<FortressKind, PropKind> = { wall: 'fortWall', tower: 'fortTower', gate: 'fortGate', bastion: 'fortBastion', inner: 'fortInner' };

// The last layer: each fortress site's pieces as baked props. group is the site's place in the towns and
// locations and step the piece's place in fortressPieces(), so every prop id is unique and stable.
export function fortressLayer(_seed: number, d: MapDraft): MapDraft {
  const sites = [...REGION.towns, ...REGION.locations];
  const props = sites.flatMap((site, group) => (site.id in FORTRESS_SITES ? fortressPieces(site).map((piece, step) => bakedPiece(site, piece, group, step)) : []));
  return { ...d, props: [...d.props, ...props] };
}

// A piece's prop. The gate model faces +x with its origin on the outer face, the inner gate and the bastion also
// run along +x across the curtain, and the layout's yaw runs along the wall.
function bakedPiece(site: Site, piece: FortressPiece, group: number, step: number): BakedProp {
  const base = { kind: PROP_KIND[piece.kind], r: piece.r, group, step };
  if (piece.kind === 'gate') {
    const yaw = piece.yaw - Math.PI / 2;
    return { ...base, pos: along(piece.pos, { x: Math.cos(yaw), y: Math.sin(yaw) }, FORTRESS.gate.depth / 2 - FORTRESS.gateFlare), yaw };
  }
  if (piece.kind === 'bastion') {
    const yaw = piece.yaw - Math.PI / 2;
    return { ...base, pos: along(piece.pos, { x: Math.cos(yaw), y: Math.sin(yaw) }, -FORTRESS.bastionBack), yaw };
  }
  if (piece.kind === 'inner') return { ...base, pos: piece.pos, yaw: piece.yaw - Math.PI / 2 };
  return { ...base, pos: piece.pos, yaw: piece.yaw };
}
