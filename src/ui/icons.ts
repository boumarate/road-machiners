import { el } from "./dom";

const ART = {
  money:
    '<ellipse cx="18" cy="9" rx="11" ry="5"/><path d="M7 9v15c0 7 22 7 22 0V9M7 16c0 7 22 7 22 0"/>',
  fuel: '<path d="M8 10h16v23H8zM11 4h10v6M15 15l6 6-9 8M24 12h7v18h5V15l-5-5"/>',
  supplies: '<path d="M5 13h30v22H5zM5 13l6-8h18l6 8M15 6v28M25 6v28"/>',
  driver:
    '<circle cx="20" cy="12" r="7"/><path d="M7 35v-6q13-15 26 0v6M17 27h6M20 24v6"/>',
  truck:
    '<path d="M10 5h20v31H10zM12 10h16v9H12zM12 25h16M12 30h16M6 8v8M34 8v8M6 27v8M34 27v8"/>',
  cannon:
    '<path d="M5 25l10-5h14v12H7zM23 22L34 5l5 3-11 19M11 32v5M23 32v5"/>',
  mg: '<ellipse cx="19" cy="29" rx="14" ry="7"/><path d="M12 28V17h15v11M22 18L36 7M25 21L39 10"/>',
  engine:
    '<path d="M8 8h24v25H8zM4 15h4M32 15h5M13 4v33M20 4v33M27 4v33M7 14h26M7 26h26"/>',
  armor: '<path d="M6 6h28v23L20 37 6 29zM11 11h18v15l-9 5-9-5z"/>',
  cargo: '<path d="M4 10h32v26H4zM4 10l8-6h18l6 6M4 10l32 26M36 10L4 36"/>',
  wheel:
    '<rect x="10" y="3" width="20" height="34" rx="5"/><path d="M12 9h16M12 16h16M12 23h16M12 30h16M20 4v32"/>',
  transmission: '<path d="M7 16h26v10H7zM14 9v24M26 9v24M4 21h32"/>',
  cab: '<path d="M6 9l5-5h18l5 5v26H6zM10 9h20v13H10zM20 9v13M10 28h20"/>',
  scrap: '<path d="M5 10l25-5 5 25-26 6zM10 14l8 7-4 10M20 8l4 12 9 4"/>',
  salt: '<path d="M12 5h16l-3 7 8 17q1 8-13 8T7 29l8-17zM14 13h12M16 25h8M20 21v8"/>',
  meds: '<path d="M7 11h26v25H7zM14 5h12v6M17 17h6v5h5v6h-5v5h-6v-5h-5v-6h5z"/>',
  grain:
    '<path d="M20 36V6M20 13Q5 14 9 4q10 0 11 9M20 21Q4 22 8 12q11 0 12 9M20 29Q4 30 8 20q11 0 12 9M20 13Q35 14 31 4q-10 0-11 9M20 21q16 1 12-9-11 0-12 9M20 29q16 1 12-9-11 0-12 9"/>',
  textiles:
    '<path d="M6 8h24q7 0 7 7v18H11q-7 0-7-7V13q0-5 7-5M11 8q7 0 7 6t-7 6H5M18 14h18M11 20v12"/>',
  batteries:
    '<path d="M7 9h26v27H7zM11 4h6v5M23 4h6v5M21 13l-7 11h7l-2 9 9-13h-8z"/>',
  electronics:
    '<path d="M8 8h24v24H8zM14 14h12v12H14zM14 3v5M20 3v5M26 3v5M14 32v5M20 32v5M26 32v5M3 14h5M3 20h5M3 26h5M32 14h5M32 20h5M32 26h5"/>',
  turn: '<path d="M5 14h16V5l16 15-16 15v-9H5z"/>',
  tools:
    '<path d="M12 5l6 7-6 6-7-6q-3 10 10 11l14 14 8-8-14-14q1-13-11-10z"/>',
  parts:
    '<circle cx="20" cy="20" r="8"/><circle cx="20" cy="20" r="3"/><path d="M20 4v6M20 30v6M4 20h6M30 20h6M9 9l4 4M27 27l4 4M31 9l-4 4M9 31l4-4"/>',
  scanner: '<path d="M8 30q-4-16 12-22l6 12zM17 19l9-9M26 10l4-4M20 30v6M12 36h16"/>',
} as const;

export type IconName = keyof typeof ART;

const ICON_NAMES: Record<IconName, string> = {
  money: "Money",
  fuel: "Fuel",
  supplies: "Supplies",
  driver: "Driver",
  truck: "Truck inventory",
  cannon: "Forward cannon",
  mg: "MG turret",
  engine: "Engine",
  armor: "Armor",
  cargo: "Cargo",
  wheel: "Wheel",
  transmission: "Transmission",
  cab: "Cab",
  scrap: "Scrap",
  salt: "Salt",
  meds: "Medicine",
  turn: "End turn",
  tools: "Machine tools",
  grain: "Grain",
  textiles: "Textiles",
  batteries: "Batteries",
  electronics: "Electronics",
  parts: "Parts",
  scanner: "Radio scanner",
};

export function createIcon(name: IconName): HTMLElement {
  const icon = el("span", {
    class: `icon icon-${name}`,
    title: ICON_NAMES[name],
    "aria-hidden": "true",
  });
  icon.innerHTML = `<svg viewBox="0 0 40 40" focusable="false">${ART[name]}</svg>`;
  return icon;
}

export function createSpeedDial(speed: number, maxSpeed: number): HTMLElement {
  const dial = el("span", { class: "speed-dial", "aria-hidden": "true" });
  const angle = -120 + Math.min(Math.abs(speed) / maxSpeed, 1) * 240;
  dial.innerHTML = `<svg viewBox="0 0 100 100"><circle class="dial-rim" cx="50" cy="50" r="47"/><circle class="dial-face" cx="50" cy="50" r="41"/><path class="dial-ticks" d="M17 68A38 38 0 1 1 83 68"/><path class="dial-needle" d="M50 50V17" transform="rotate(${angle} 50 50)"/><circle class="dial-pin" cx="50" cy="50" r="4"/></svg>`;
  return dial;
}
