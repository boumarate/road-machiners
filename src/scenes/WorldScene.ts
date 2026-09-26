import Phaser from 'phaser';
import { CONFIG } from '../config';
import { partDef } from '../data/parts';
import { REGION } from '../data/region';
import { playerVehicle } from '../sim/damage';
import { mountedParts } from '../sim/grid';
import { maxTurn, vehicleStats } from '../sim/stats';
import { clickOrder, planPath, throttleFor, type TurnPlan } from '../sim/steering';
import { drawThrottleZones } from '../render/throttle';
import type { Pose, Vehicle, World } from '../sim/types';
import { endTurn, hostileToPlayer, newWorld, setAutoFire, setMoveOrder, setWeaponOrder } from '../sim/world';
import { groundRing } from '../render/box';
import { Fx } from '../render/fx';
import { setGroundLift, toScreen, toWorld } from '../render/iso';
import { PAL } from '../render/palette';
import { strokeLine } from '../render/poly';
import { depthOf, drawLocation, drawObstacle, drawTown } from '../render/props';
import { drawTerrain } from '../render/terrain';
import { groundLiftOf } from '../render/ground';
import { drawFog, makeFog } from '../render/fog';
import type { IsoCanvas } from '../render/isoCanvas';
import { drawVehicle, type Ring } from '../render/vehicle';
import { playerExplored, playerSees, tileOf } from '../sim/vision';
import type { UiHost } from '../ui/host';
import { Hud } from '../ui/hud';
import { CharacterScreen } from '../ui/character';
import { InventoryScreen } from '../ui/inventory';
import { TownScreen } from '../ui/town';
import { getWeaponReadout, WeaponPanel, weaponsForClick } from '../ui/weapons';
import { drawWeaponRange } from '../render/weaponRange';
import { canScavenge, scavenge } from '../sim/locations';
import { locationAt, townAt } from '../sim/sites';

const TURN_ANIM_MS = 700;
const PLAN_TURNS = 8;
const ZOOM = { min: 0.5, max: 2, step: 0.1, start: 1.1 };
const CAMERA_LERP = 0.12;
const OVERLAY_DEPTH = 8e5; // plans and zones: above terrain and objects, below fog
const PICK_PX = 30; // click radius around a vehicle's screen position
const VEHICLE_MID_PX = 10; // screen height of a vehicle's visual center

export class WorldScene extends Phaser.Scene {
  world!: World;
  private vehicleGfx = new Map<string, Phaser.GameObjects.Graphics>();
  private obstacleGfx = new Map<string, Phaser.GameObjects.Graphics>();
  private planGfx!: Phaser.GameObjects.Graphics;
  private fog!: IsoCanvas;
  private fx!: Fx;
  private hud!: Hud;
  private weapons!: WeaponPanel;
  private town!: TownScreen;
  private character!: CharacterScreen;
  private inventory!: InventoryScreen;
  private labels = new Map<string, Phaser.GameObjects.Text>();
  private plan: { world: World; plans: TurnPlan[] } | null = null;
  private hoverGround: { x: number; y: number } | null = null;
  private selected: string | null = null;
  private hovered: string | null = null;
  private animStart: number | null = null;
  private fxPlayed = true;
  private impactsPlayed = true;
  private hasCombat = false;
  private beforeTurn: World | null = null;
  private phase: ReturnType<UiHost['getTurnPhase']> = null;
  private targetMarkers = new Map<string, Phaser.GameObjects.Text>();
  private following = true;
  private panFrom: { x: number; y: number; sx: number; sy: number } | null = null;

  constructor() {
    super('World');
  }

  create(): void {
    this.world = newWorld(CONFIG.seed);
    setGroundLift(groundLiftOf(this.world.terrain));
    drawTerrain(this, this.world.terrain);
    for (const town of REGION.towns) drawTown(this, town);
    for (const loc of REGION.locations) drawLocation(this, loc);
    this.syncObstacles();
    this.drawLabels();
    this.planGfx = this.add.graphics().setDepth(OVERLAY_DEPTH);
    this.fog = makeFog(this, this.world.size);
    this.fx = new Fx(this);
    this.hud = new Hud();
    this.weapons = new WeaponPanel(this.uiHost());
    this.town = new TownScreen(this.uiHost());
    this.character = new CharacterScreen(this.uiHost());
    this.inventory = new InventoryScreen(this.uiHost());
    this.bindInput();
    this.cameras.main.setZoom(ZOOM.start);
    const p = toScreen(playerVehicle(this.world).pos.x, playerVehicle(this.world).pos.y);
    this.cameras.main.centerOn(p.x, p.y);
    this.refreshUi();
  }

  private uiHost(): UiHost {
    return {
      world: () => this.getDisplayWorld(),
      apply: (next) => this.apply(next),
      selectedWeapon: () => this.selected,
      selectWeapon: (id) => {
        if (this.animStart !== null) return;
        this.selected = id;
        this.refreshUi();
      },
      endTurn: () => this.endTurn(),
      getTurnPhase: () => this.phase,
    };
  }

  // Screen point of a map point on the ground, for browser test scripts.
  debugScreenOf(x: number, y: number): { x: number; y: number } {
    return toScreen(x, y);
  }

  apply(next: World): void {
    this.world = next;
    this.refreshUi();
  }

  // Fog of war depends only on the world, so it is redrawn here, not every frame.
  private refreshFog(): void {
    const visible = new Set(this.world.player.visible);
    if (!this.impactsPlayed) {
      for (const v of [...this.world.vehicles, ...this.world.removed]) {
        if (this.canShowCombatVehicle(v)) visible.add(tileOf(this.world, v.pos));
      }
    }
    drawFog(this.fog, this.world, visible);
  }

  private isVehicleVisible(v: Vehicle): boolean {
    return v.id === playerVehicle(this.world).id || playerSees(this.world, v.pos);
  }

  private refreshUi(): void {
    if (this.selected && !vehicleStats(this.world, playerVehicle(this.world)).weapons.some((mw) => mw.part.id === this.selected)) this.selected = null;
    this.refreshFog();
    this.hud.renderTop(this.getDisplayWorld());
    this.weapons.render();
    this.town.render();
    this.character.render();
    this.inventory.render();
    this.hud.renderAction(this.contextLabel(), () => this.useContext());
    this.refreshInfo();
    this.refreshLabels();
    this.refreshTargetMarkers();
  }

  private getDisplayWorld(): World {
    return this.beforeTurn && !this.impactsPlayed ? this.beforeTurn : this.world;
  }

  private contextLabel(): string | null {
    if (this.animStart !== null) return null;
    const town = townAt(this.world);
    if (town) return `Enter ${town.name}`;
    if (canScavenge(this.world)) return `Search ${locationAt(this.world)!.name}`;
    return null;
  }

  private useContext(): void {
    if (this.animStart !== null) return;
    if (townAt(this.world)) return this.town.open();
    if (canScavenge(this.world)) {
      this.apply(scavenge(this.world));
      this.hud.pushEvents(this.world);
    }
  }

  private modalOpen(): boolean {
    return this.town.isOpen() || this.character.isOpen() || this.inventory.isOpen();
  }

  private refreshInfo(): void {
    const w = this.getDisplayWorld();
    const v = this.hovered ? w.vehicles.find((x) => x.id === this.hovered && playerSees(w, x.pos)) ?? null : null;
    this.hud.showInfo(w, v, v ? hostileToPlayer(w, v) : false);
  }

  private bindInput(): void {
    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.rightButtonDown()) this.panFrom = { x: p.x, y: p.y, sx: this.cameras.main.scrollX, sy: this.cameras.main.scrollY };
      else this.onLeftClick(p);
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      this.onPan(p);
      this.onHover(p);
    });
    this.input.on('pointerup', () => (this.panFrom = null));
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => this.onZoom(dy));
    const kb = this.input.keyboard!;
    kb.on('keydown-SPACE', (e: KeyboardEvent) => {
      if (e.repeat || this.isEditingControl() || this.modalOpen()) return;
      e.preventDefault();
      this.endTurn();
    });
    kb.on('keydown-F', () => (this.following = true));
    kb.on('keydown-A', () => !this.modalOpen() && !this.isEditingControl() && this.weapons.toggleAuto());
    kb.on('keydown-W', () => !this.modalOpen() && !this.isEditingControl() && this.weapons.toggleVisible());
    kb.on('keydown-ZERO', () => !this.modalOpen() && !this.isEditingControl() && this.weapons.selectWeapon(null));
    kb.on('keydown-E', () => !this.modalOpen() && this.useContext());
    kb.on('keydown-C', () => {
      if (this.animStart !== null || this.isEditingControl()) return;
      this.town.close();
      this.inventory.close();
      this.character.toggle();
    });
    kb.on('keydown-I', () => {
      if (this.animStart !== null || this.isEditingControl()) return;
      this.town.close();
      this.character.close();
      this.inventory.toggle();
    });
    kb.on('keydown-ESC', () => {
      this.town.close();
      this.character.close();
      this.inventory.close();
    });
    ['ONE', 'TWO', 'THREE', 'FOUR'].forEach((key, i) => kb.on(`keydown-${key}`, () => this.selectWeaponIndex(i)));
  }

  private isEditingControl(): boolean {
    return document.activeElement?.matches('input, select, textarea') ?? false;
  }

  private selectWeaponIndex(i: number): void {
    if (this.animStart !== null || this.modalOpen() || this.isEditingControl()) return;
    const all = vehicleStats(this.world, playerVehicle(this.world)).weapons;
    if (i >= all.length) return;
    this.weapons.selectWeapon(this.selected === all[i].part.id ? null : all[i].part.id);
  }

  private onLeftClick(p: Phaser.Input.Pointer): void {
    if (this.animStart !== null || this.modalOpen()) return;
    const picked = this.pickVehicle(p.worldX, p.worldY);
    const me = playerVehicle(this.world);
    if (picked && picked.id !== me.id) return this.targetVehicle(picked);
    if (picked) return this.apply(setMoveOrder(this.world, { kind: 'brake' }));
    const shift = (p.event as MouseEvent).shiftKey;
    this.apply(setMoveOrder(this.world, clickOrder(me, toWorld(p.worldX, p.worldY), shift)));
  }

  private targetVehicle(target: Vehicle): void {
    let w = this.world;
    if (w.player.autoFire) w = setAutoFire(w, false);
    for (const mw of weaponsForClick(w, this.selected)) w = setWeaponOrder(w, mw.part.id, { targetId: target.id, aim: 'hull' });
    this.apply(w);
  }

  private pickVehicle(sx: number, sy: number): Vehicle | null {
    let best: Vehicle | null = null;
    let bestD = PICK_PX;
    for (const v of this.world.vehicles) {
      if (!this.isVehicleVisible(v)) continue;
      const s = toScreen(v.pos.x, v.pos.y);
      const d = Math.hypot(s.x - sx, s.y - VEHICLE_MID_PX - sy);
      if (d < bestD) {
        best = v;
        bestD = d;
      }
    }
    return best;
  }

  private onHover(p: Phaser.Input.Pointer): void {
    const id = this.pickVehicle(p.worldX, p.worldY)?.id ?? null;
    this.hoverGround = id || this.modalOpen() ? null : toWorld(p.worldX, p.worldY);
    if (id === this.hovered) return;
    this.hovered = id;
    this.refreshInfo();
  }

  private onPan(p: Phaser.Input.Pointer): void {
    if (!this.panFrom || !p.rightButtonDown()) return;
    const cam = this.cameras.main;
    cam.scrollX = this.panFrom.sx - (p.x - this.panFrom.x) / cam.zoom;
    cam.scrollY = this.panFrom.sy - (p.y - this.panFrom.y) / cam.zoom;
    this.following = false;
  }

  private onZoom(dy: number): void {
    const cam = this.cameras.main;
    cam.setZoom(Phaser.Math.Clamp(cam.zoom - Math.sign(dy) * ZOOM.step, ZOOM.min, ZOOM.max));
  }

  endTurn(): void {
    if (this.animStart !== null || this.modalOpen()) return;
    this.beforeTurn = this.world;
    this.world = endTurn(this.world);
    this.hasCombat = this.world.events.some((e) => e.t === 'shot' && this.getEventPosition(e.shooter) && this.getEventPosition(e.target));
    this.animStart = this.time.now;
    this.phase = 'Moving';
    this.fxPlayed = false;
    this.impactsPlayed = false;
    this.refreshUi();
  }

  update(time: number): void {
    const elapsed = this.animStart === null ? 0 : time - this.animStart;
    const t = this.animStart === null ? 1 : Math.min(1, elapsed / TURN_ANIM_MS);
    if (this.animStart !== null) {
      if (t === 1 && !this.fxPlayed) {
        this.fxPlayed = true;
        this.playEventFx(this.world);
        this.phase = this.hasCombat ? 'Firing' : 'Results';
        this.weapons.render();
      }
      const impactAt = TURN_ANIM_MS + (this.hasCombat ? CONFIG.combatShotMs : 0);
      if (elapsed >= impactAt && !this.impactsPlayed) {
        this.impactsPlayed = true;
        this.phase = 'Results';
        this.playImpactFx();
        this.syncObstacles();
        this.hud.pushEvents(this.world);
        this.refreshUi();
      }
      if (elapsed >= impactAt + (this.hasCombat ? CONFIG.combatReadMs : 0)) this.finishTurnAnim();
    }
    this.syncVehicles(t);
    this.drawPlan();
    for (const marker of this.targetMarkers.values()) marker.setVisible(this.animStart === null && !this.modalOpen());
    this.followPlayer(t);
  }

  private finishTurnAnim(): void {
    this.animStart = null;
    this.beforeTurn = null;
    this.phase = null;
    this.refreshUi();
  }

  private getEventPosition(id: string): { x: number; y: number } | null {
    const v = this.world.vehicles.find((x) => x.id === id) ?? this.world.removed.find((x) => x.id === id);
    return v && this.canShowCombatVehicle(v) ? toScreen(v.pos.x, v.pos.y) : null;
  }

  private canShowCombatVehicle(v: Vehicle): boolean {
    // Player shots prove sight at firing time, before new wrecks change the fog.
    return this.isVehicleVisible(v) || this.world.events.some((e) =>
      e.t === 'shot' && e.shooter === this.world.player.vehicleId && e.target === v.id);
  }

  private playImpactFx(): void {
    for (const e of this.world.events) {
      if (e.t !== 'destroyed') continue;
      const p = this.getEventPosition(e.vehicle);
      if (p) this.fx.explode(p);
    }
  }

  private playEventFx(w: World): void {
    const rows = new Map<string, number>();
    const weapons = vehicleStats(w, playerVehicle(w)).weapons;
    for (const e of w.events) {
      if (e.t === 'shot') {
        const a = this.getEventPosition(e.shooter);
        const b = this.getEventPosition(e.target);
        const shooter = w.vehicles.find((x) => x.id === e.shooter) ?? w.removed.find((x) => x.id === e.shooter);
        const gun = shooter && mountedParts(shooter).find((p) => p.id === e.weapon);
        const def = gun && partDef(gun.defId);
        const heavy = def?.kind === 'weapon' && def.look === 'cannon';
        if (a && b) {
          const slot = weapons.findIndex((mw) => mw.part.id === e.weapon);
          const label = `${slot >= 0 ? `[${slot + 1}] ` : ''}${heavy ? 'Cannon' : 'MG'} ${e.hit ? `−${e.damage}` : 'miss'}`;
          const row = rows.get(e.target) ?? 0;
          rows.set(e.target, row + 1);
          this.fx.shot(a, b, e.hit, heavy, label, row, CONFIG.combatShotMs, CONFIG.combatReadMs);
        }
      }
      if (e.t === 'collision') {
        const p = this.getEventPosition(e.a);
        if (p) this.fx.crash(p);
      }
    }
  }

  private syncVehicles(t: number): void {
    const shown = [...this.world.vehicles, ...(!this.impactsPlayed ? this.world.removed : [])]
      .filter((v) => this.impactsPlayed ? this.isVehicleVisible(v) : this.canShowCombatVehicle(v));
    const ids = new Set(shown.map((v) => v.id));
    for (const [id, g] of this.vehicleGfx) {
      if (!ids.has(id)) {
        g.destroy();
        this.vehicleGfx.delete(id);
      }
    }
    for (const v of shown) {
      let g = this.vehicleGfx.get(v.id);
      if (!g) {
        g = this.add.graphics();
        this.vehicleGfx.set(v.id, g);
      }
      const pose = poseAt(v, t);
      const before = !this.impactsPlayed && this.beforeTurn?.vehicles.find((x) => x.id === v.id);
      const display = before ? { ...v, hull: before.hull, items: before.items } : v;
      drawVehicle(g, display, pose, this.turretAim(v, pose), this.ringsFor(v));
      g.setDepth(depthOf(pose, vehicleStats(this.world, v).radius));
      this.vehicleParticles(display, pose, t);
    }
  }

  private vehicleParticles(v: Vehicle, pose: Pose, t: number): void {
    const s = toScreen(pose.x, pose.y);
    if (t < 1 && v.speed > 0.5 && Math.random() < 0.5) this.fx.kickDust(toScreen(pose.x - Math.cos(pose.heading) * 0.7, pose.y - Math.sin(pose.heading) * 0.7));
    const hurt = v.hull < vehicleStats(this.world, v).hullMax * 0.35 || mountedParts(v).some((p) => p.hp === 0);
    if (hurt && Math.random() < 0.06) this.fx.smokeFrom(s);
  }

  // Turrets point at their first ordered target.
  private turretAim(v: Vehicle, pose: Pose): number | null {
    const order = Object.values(v.weaponOrders)[0];
    const target = order && this.world.vehicles.find((x) => x.id === order.targetId);
    return target ? Math.atan2(target.pos.y - pose.y, target.pos.x - pose.x) : null;
  }

  private syncObstacles(): void {
    const ids = new Set(this.world.obstacles.map((o) => o.id));
    for (const [id, g] of this.obstacleGfx) {
      if (ids.has(id)) continue;
      g.destroy();
      this.obstacleGfx.delete(id);
    }
    for (const o of this.world.obstacles) {
      if (!this.obstacleGfx.has(o.id)) this.obstacleGfx.set(o.id, drawObstacle(this, o));
    }
  }

  private followPlayer(t: number): void {
    if (!this.following) return;
    const pose = poseAt(playerVehicle(this.world), t);
    const s = toScreen(pose.x, pose.y);
    const cam = this.cameras.main;
    const target = { x: s.x - cam.width / 2, y: s.y - cam.height / 2 };
    cam.scrollX += (target.x - cam.scrollX) * CAMERA_LERP;
    cam.scrollY += (target.y - cam.scrollY) * CAMERA_LERP;
  }

  // Rings under vehicles: red for hostiles, bright for my targets, range ring for the selected weapon.
  // Rings under vehicles: red for hostiles, bright for my targets, gold for my truck and the hovered one.
  private ringsFor(v: Vehicle): Ring[] {
    const me = playerVehicle(this.world);
    const r = vehicleStats(this.world, v).radius + 0.25;
    if (v.id === me.id) return [{ r: r + 0.05, width: 2, color: PAL.select, alpha: 0.45 }];
    const rings: Ring[] = [];
    if (Object.values(me.weaponOrders).some((o) => o.targetId === v.id)) rings.push({ r: r + 0.1, width: 3, color: PAL.target, alpha: 1 });
    else if (hostileToPlayer(this.world, v)) rings.push({ r, width: 2, color: PAL.target, alpha: 0.55 });
    if (v.id === this.hovered) rings.push({ r: r + 0.2, width: 1.5, color: PAL.select, alpha: 0.9 });
    return rings;
  }

  private refreshTargetMarkers(): void {
    for (const label of this.targetMarkers.values()) label.destroy();
    this.targetMarkers.clear();
    if (this.animStart !== null) return;
    const me = playerVehicle(this.world);
    const targets = new Map<string, { vehicle: Vehicle; lines: string[] }>();
    vehicleStats(this.world, me).weapons.forEach((mw, i) => {
      const readout = getWeaponReadout(this.world, mw);
      if (!readout.target) return;
      let marker = targets.get(readout.target.id);
      if (!marker) {
        marker = { vehicle: readout.target, lines: [] };
        targets.set(readout.target.id, marker);
      }
      marker.lines.push(`[${i + 1}] ${mw.def.look === 'cannon' ? 'Cannon' : 'MG'} · ${readout.status}`);
    });
    for (const [id, marker] of targets) {
      const p = toScreen(marker.vehicle.pos.x, marker.vehicle.pos.y);
      const label = this.add.text(p.x, p.y - 40, marker.lines.join('\n'), {
        fontFamily: 'monospace', fontSize: '12px', color: '#f0e0b8', backgroundColor: '#261c14ee',
        padding: { x: 6, y: 4 }, align: 'center',
      }).setOrigin(0.5, 1).setDepth(1e6 + 2).setName(`weapon-target-${id}`).setVisible(!this.modalOpen());
      this.targetMarkers.set(id, label);
    }
  }

  private drawRangeRing(g: Phaser.GameObjects.Graphics): void {
    const me = playerVehicle(this.world);
    const sel = vehicleStats(this.world, me).weapons.find((m) => m.part.id === this.selected);
    if (sel) drawWeaponRange(g, me, sel.def);
  }


  private drawPlan(): void {
    const g = this.planGfx;
    g.clear();
    const me = playerVehicle(this.world);
    if (this.animStart !== null || this.modalOpen()) return;
    this.drawRangeRing(g);
    const s = vehicleStats(this.world, me);
    drawThrottleZones(g, { x: me.pos.x, y: me.pos.y, heading: me.heading }, me.speed, maxTurn(s, me.speed));
    if (this.hoverGround) {
      const t = throttleFor(Math.hypot(this.hoverGround.x - me.pos.x, this.hoverGround.y - me.pos.y), me.speed);
      groundRing(g, this.hoverGround, 0.6, 2, PAL.throttle[t], 0.8);
    }
    if (!me.order && me.speed === 0) return;
    const plans = this.cachedPlan(me);
    const first = me.order?.kind === 'through' ? PAL.throttle[throttleFor(Math.hypot(me.order.dest.x - me.pos.x, me.order.dest.y - me.pos.y), me.speed)] : PAL.plan;
    plans.forEach((plan, i) => {
      const pts = plan.poses.map((p) => toScreen(p.x, p.y));
      strokeLine(g, pts, i === 0 ? 3 : 2, i === 0 ? first : PAL.plan, i === 0 ? 0.95 : 0.45);
      const e = toScreen(plan.end.x, plan.end.y);
      g.fillStyle(i === 0 ? first : PAL.plan, i === 0 ? 1 : 0.5);
      g.fillCircle(e.x, e.y, i === 0 ? 5 : 3);
    });
    if (me.order && me.order.kind !== 'brake') groundRing(g, me.order.dest, me.order.kind === 'stopAt' ? 0.5 : 0.9, 2.5, first, 1);
  }

  // The route preview is recomputed only when the world changes.
  private cachedPlan(me: Vehicle): TurnPlan[] {
    if (this.plan?.world !== this.world) this.plan = { world: this.world, plans: planPath(this.world, vehicleStats(this.world, me), me, me.order, PLAN_TURNS) };
    return this.plan.plans;
  }

  private drawLabels(): void {
    const style = { fontFamily: 'monospace', fontSize: '15px', color: PAL.text, backgroundColor: '#1a1410aa', padding: { x: 6, y: 3 } };
    for (const s of [...REGION.towns, ...REGION.locations]) {
      const p = toScreen(s.pos.x, s.pos.y);
      this.labels.set(s.id, this.add.text(p.x, p.y - 90, '', style).setOrigin(0.5).setDepth(1e6 + 1));
    }
  }

  // Sites under never-seen fog show nothing. Seen but undiscovered sites show question marks.
  private refreshLabels(): void {
    for (const s of [...REGION.towns, ...REGION.locations]) {
      const known = this.world.player.discovered.includes(s.id);
      const label = this.labels.get(s.id)!;
      label.setVisible(playerExplored(this.world, s.pos));
      label.setText(known ? s.name : '???');
    }
  }
}

// Pose along the last turn's trail at animation progress t in [0, 1].
function poseAt(v: Vehicle, t: number): Pose {
  const trail = v.trail;
  if (trail.length < 2) return { x: v.pos.x, y: v.pos.y, heading: v.heading };
  const f = t * (trail.length - 1);
  const i = Math.min(trail.length - 2, Math.floor(f));
  const k = f - i;
  const a = trail[i];
  const b = trail[i + 1];
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, heading: a.heading + (b.heading - a.heading) * k };
}
