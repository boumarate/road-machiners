import Phaser from 'phaser';

type Pt = { x: number; y: number };

export function fillPoly(g: Phaser.GameObjects.Graphics, pts: Pt[], color: number, alpha = 1): void {
  g.fillStyle(color, alpha);
  tracePath(g, pts);
  g.fillPath();
}

export function strokePoly(g: Phaser.GameObjects.Graphics, pts: Pt[], width: number, color: number, alpha = 1): void {
  g.lineStyle(width, color, alpha);
  tracePath(g, pts);
  g.strokePath();
}

function tracePath(g: Phaser.GameObjects.Graphics, pts: Pt[]): void {
  g.beginPath();
  g.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
  g.closePath();
}

export function strokeLine(g: Phaser.GameObjects.Graphics, pts: Pt[], width: number, color: number, alpha = 1): void {
  g.lineStyle(width, color, alpha);
  g.beginPath();
  g.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
  g.strokePath();
}
