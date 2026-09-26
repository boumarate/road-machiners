// Dev corner readout: frame rate, frame time p95 and the last times of the timed seams.

import { perfSnapshot } from "../perf";
import { el } from "./dom";

const REFRESH_MS = 500;
const WINDOW_FRAMES = 120; // about 2 s at 60 FPS, long enough for a stable p95
const TIMERS = ["turn", "preview", "route", "fog"];

// Matches the #ui .panel look. The overlay sits outside #ui, so the style is inline.
// It sits top left, beside the help button, because the sound controls hold the top right.
const STYLE = [
  "position: absolute",
  "left: 56px",
  "top: 8px",
  "background: rgba(30, 22, 16, 0.88)",
  "border: 1px solid #6a5238",
  "border-radius: 4px",
  "padding: 6px 8px",
  "font: 11px/1.35 ui-monospace, Menlo, monospace",
  "color: #f0e0b8",
  "white-space: pre",
].join("; ");

export function mountPerfPanel(host: HTMLElement): void {
  const box = el("div", { class: "perf-panel", style: STYLE });
  host.append(box);

  const frames: number[] = [];
  let prev = performance.now();
  const sample = (t: number) => {
    frames.push(t - prev);
    if (frames.length > WINDOW_FRAMES) frames.shift();
    prev = t;
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);

  const ms = (x: number) => x.toFixed(1).padStart(6);
  window.setInterval(() => {
    const lines: string[] = [];
    if (frames.length > 0) {
      const sorted = [...frames].sort((a, b) => a - b);
      const mean = frames.reduce((a, b) => a + b, 0) / frames.length;
      const p95 = sorted[Math.floor(sorted.length * 0.95)];
      lines.push(`fps     ${(1000 / mean).toFixed(0).padStart(6)}`);
      lines.push(`p95 ms  ${ms(p95)}`);
    }
    const snap = perfSnapshot();
    for (const name of TIMERS) {
      const s = snap[name];
      lines.push(`${name.padEnd(8)}${s ? ms(s.last) : "     -"}`);
    }
    lines.push(`routes  ${String(snap.route?.calls ?? 0).padStart(6)}`);
    box.textContent = lines.join("\n");
  }, REFRESH_MS);
}
