// The 3D game: wires input to the sim, the sim and physics to the Three.js view, and the HTML UI.
// Time only moves while a turn plays. The path preview runs the same physics the turn will run.

import * as THREE from 'three';
import { CONFIG } from '../config';
import { partDef } from '../data/parts';
import { PHYSICS } from '../data/physics';
import { buildDrive, freeDrive, restFrame, simulateTurn, syncDrive, TURN_STEPS, type Drive, type TurnResult } from '../phys/drive';
import { groundPoint, type TurnFrames, type V3, type VehicleFrame } from '../phys/frames';
import { applyTurn, physicsMove } from '../phys/turn';
import { playerVehicle } from '../sim/damage';
import { mountedParts } from '../sim/grid';
import { canScavenge, scavenge } from '../sim/locations';
import { locationAt, townAt } from '../sim/sites';
import { maxTurn, vehicleStats } from '../sim/stats';
import { clickOrder, throttleFor } from '../sim/steering';
import type { Vehicle, World } from '../sim/types';
import type { Vec } from '../sim/vec';
import { playerSees } from '../sim/vision';
import { endTurn, hostileToPlayer, newWorld, setAutoFire, setMoveOrder, setWeaponOrder } from '../sim/world';
import { PAL } from '../render/palette';
import { CharacterScreen } from '../ui/character';
import type { UiHost } from '../ui/host';
import { Hud } from '../ui/hud';
import { InventoryScreen } from '../ui/inventory';
import { TownScreen } from '../ui/town';
import { WeaponPanel, weaponsForClick } from '../ui/weapons';
import { CameraRig } from './render/camera';
import { FogView } from './render/fog';
import { Fx3D } from './render/fx';
import { Labels } from './render/labels';
import { ObstacleViews } from './render/obstacles';
import { PathView } from './render/path';
import { buildSites } from './render/sites';
import { terrainMesh } from './render/terrain';
import { VehicleView, type Ring3 } from './render/vehicle';
import { ZonesView } from './render/zones';

const PLAN_TURNS = 3; // turns of path preview
const PICK_PX = 30; // click radius around a vehicle's screen position
const MIN_ZONE_HALF_ANGLE = Math.PI / 12; // zones stay visible for trucks that barely turn
const DUST_CHANCE = 0.3; // per moving vehicle per frame while a turn plays
const SMOKE_CHANCE = 0.05; // per hurt vehicle per frame
const HURT_HULL = 0.35; // hull share under which a vehicle smokes
const GUN_HEIGHT = 1.6; // meters above the body center where shots start and land

export class Game {
  private world: World;
  private drive: Drive;
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  private readonly scene = new THREE.Scene();
  private readonly sun = new THREE.DirectionalLight(0xfff0d0, 2.2);
  private readonly rig: CameraRig;
  private readonly ground: THREE.Mesh;
  private readonly obstacles: ObstacleViews;
  private readonly fog: FogView;
  private readonly labels: Labels;
  private readonly zones = new ZonesView();
  private readonly path = new PathView();
  private readonly fx: Fx3D;
  private readonly views = new Map<string, VehicleView>();
  private frames: Record<string, VehicleFrame> = {}; // last shown pose per vehicle
  private anim: { result: TurnResult; start: number | null } | null = null;
  private hoverGround: Vec | null = null;
  private hovered: string | null = null;
  private selected: string | null = null;
  private following = true;
  private panFrom: { x: number; y: number } | null = null;
  private planFor: World | null = null;
  private last = performance.now();

  private readonly hud = new Hud();
  private readonly weapons: WeaponPanel;
  private readonly town: TownScreen;
  private readonly character: CharacterScreen;
  private readonly inventory: InventoryScreen;

  constructor(container: HTMLElement, overlay: HTMLElement) {
    this.world = newWorld(CONFIG.seed);
    this.drive = buildDrive(this.world);

    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    this.rig = new CameraRig(container);

    this.scene.background = new THREE.Color(PAL.bg);
    this.scene.add(new THREE.HemisphereLight(0xfff0d8, 0x6a5038, 1.4));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -80, right: 80, top: 80, bottom: -80, near: 1, far: 500 });
    this.scene.add(this.sun, this.sun.target);

    this.ground = terrainMesh(this.world);
    this.scene.add(this.ground, buildSites(this.world.terrain));
    this.obstacles = new ObstacleViews(this.scene, this.world.terrain);
    this.obstacles.sync(this.world.obstacles);
    this.fog = new FogView(this.world);
    this.scene.add(this.fog.mesh, this.zones.root, this.path.root);
    this.labels = new Labels(overlay);
    this.fx = new Fx3D(this.scene, overlay, this.rig);

    const host = this.uiHost();
    this.weapons = new WeaponPanel(host);
    this.town = new TownScreen(host);
    this.character = new CharacterScreen(host);
    this.inventory = new InventoryScreen(host);

    this.bindInput();
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.refreshUi();
    requestAnimationFrame((t) => this.tick(t));
  }

  private uiHost(): UiHost {
    return {
      world: () => this.world,
      apply: (next) => this.apply(next),
      selectedWeapon: () => this.selected,
      selectWeapon: (id) => {
        this.selected = id;
        this.refreshUi();
      },
      endTurn: () => this.endTurn(),
    };
  }

  // Screen point of a map point on the ground, for browser test scripts.
  debugScreenOf(x: number, y: number): { x: number; y: number } {
    return this.rig.screenOf(groundPoint(this.world.terrain, { x, y }));
  }

  get state(): World {
    return this.world;
  }

  apply(next: World): void {
    this.world = next;
    syncDrive(this.drive, this.world);
    this.refreshUi();
  }

  private resize(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.rig.resize();
  }

  private modalOpen(): boolean {
    return this.town.isOpen() || this.character.isOpen() || this.inventory.isOpen();
  }

  private refreshUi(): void {
    this.fog.update(this.world);
    this.obstacles.sync(this.world.obstacles);
    this.hud.renderTop(this.world);
    this.weapons.render();
    this.town.render();
    this.character.render();
    this.inventory.render();
    this.hud.renderAction(this.contextLabel(), () => this.useContext());
    this.refreshInfo();
  }

  private contextLabel(): string | null {
    if (this.anim) return null;
    const town = townAt(this.world);
    if (town) return `Enter ${town.name}`;
    if (canScavenge(this.world)) return `Search ${locationAt(this.world)!.name}`;
    return null;
  }

  private useContext(): void {
    if (this.anim) return;
    if (townAt(this.world)) return this.town.open();
    if (canScavenge(this.world)) {
      this.apply(scavenge(this.world));
      this.hud.pushEvents(this.world);
    }
  }

  private refreshInfo(): void {
    const v = this.hovered ? this.world.vehicles.find((x) => x.id === this.hovered) ?? null : null;
    this.hud.showInfo(this.world, v, v ? hostileToPlayer(this.world, v) : false);
  }

  // Input: left click orders or targets, right drag pans, wheel zooms, keys like the 2D game.
  private bindInput(): void {
    const canvas = this.renderer.domElement;
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 2) this.panFrom = { x: e.clientX, y: e.clientY };
      if (e.button === 0) this.onLeftClick(e);
    });
    window.addEventListener('pointermove', (e) => {
      if (this.panFrom) {
        this.rig.panBy(e.clientX - this.panFrom.x, e.clientY - this.panFrom.y);
        this.panFrom = { x: e.clientX, y: e.clientY };
        this.following = false;
      }
      if (e.target === canvas) this.onHover(e);
    });
    window.addEventListener('pointerup', () => (this.panFrom = null));
    canvas.addEventListener('wheel', (e) => this.rig.zoomBy(e.deltaY), { passive: true });
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      const modal = this.modalOpen();
      if (e.code === 'Space' && !modal) {
        e.preventDefault();
        this.endTurn();
      }
      if (e.code === 'KeyF') this.following = true;
      if (e.code === 'KeyA' && !modal) this.weapons.toggleAuto();
      if (e.code === 'KeyE' && !modal) this.useContext();
      if (e.code === 'KeyC') {
        this.town.close();
        this.inventory.close();
        this.character.toggle();
      }
      if (e.code === 'KeyI') {
        this.town.close();
        this.character.close();
        this.inventory.toggle();
      }
      if (e.code === 'Escape') {
        this.town.close();
        this.character.close();
        this.inventory.close();
      }
      const digit = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
      if (digit >= 0) this.selectWeaponIndex(digit);
    });
  }

  private selectWeaponIndex(i: number): void {
    const all = vehicleStats(this.world, playerVehicle(this.world)).weapons;
    if (i >= all.length) return;
    this.selected = this.selected === all[i].part.id ? null : all[i].part.id;
    this.refreshUi();
  }

  private onLeftClick(e: MouseEvent): void {
    if (this.anim || this.modalOpen()) return;
    const picked = this.pickVehicle(e.clientX, e.clientY);
    const me = playerVehicle(this.world);
    if (picked && picked.id !== me.id) return this.targetVehicle(picked);
    if (picked) return this.apply(setMoveOrder(this.world, { kind: 'brake' }));
    const p = this.rig.groundUnder(e.clientX, e.clientY, this.ground);
    if (p) this.apply(setMoveOrder(this.world, clickOrder(me, p, e.shiftKey)));
  }

  private targetVehicle(target: Vehicle): void {
    let w = this.world;
    if (w.player.autoFire) w = setAutoFire(w, false);
    for (const mw of weaponsForClick(w, this.selected)) w = setWeaponOrder(w, mw.part.id, { targetId: target.id, aim: 'hull' });
    this.apply(w);
  }

  private isVehicleVisible(v: Vehicle): boolean {
    return v.id === playerVehicle(this.world).id || playerSees(this.world, v.pos);
  }

  private pickVehicle(cx: number, cy: number): Vehicle | null {
    let best: Vehicle | null = null;
    let bestD = PICK_PX;
    for (const v of this.world.vehicles) {
      const f = this.frames[v.id];
      if (!f || !this.isVehicleVisible(v)) continue;
      const s = this.rig.screenOf(f.pos);
      const d = Math.hypot(s.x - cx, s.y - cy);
      if (d < bestD) {
        best = v;
        bestD = d;
      }
    }
    return best;
  }

  private onHover(e: MouseEvent): void {
    const id = this.pickVehicle(e.clientX, e.clientY)?.id ?? null;
    this.hoverGround = id || this.modalOpen() ? null : this.rig.groundUnder(e.clientX, e.clientY, this.ground);
    if (id === this.hovered) return;
    this.hovered = id;
    this.refreshInfo();
  }

  endTurn(): void {
    if (this.anim) return;
    let result: TurnResult | null = null;
    this.world = endTurn(this.world, physicsMove(this.drive, (r) => (result = r)));
    if (!result) throw new Error('Turn ran without physics');
    this.anim = { result, start: null };
    this.path.clear();
    this.hud.pushEvents(this.world);
    this.refreshUi();
  }

  private finishTurn(): void {
    if (!this.anim) throw new Error('No turn is playing');
    const { result } = this.anim;
    freeDrive(this.drive);
    this.drive = result.next;
    syncDrive(this.drive, this.world);
    for (const [id, fs] of Object.entries(result.frames)) this.frames[id] = fs[fs.length - 1];
    this.anim = null;
    this.playEventFx();
    this.refreshUi();
  }

  private playEventFx(): void {
    const w = this.world;
    const at = (id: string): V3 | null => {
      const f = this.frames[id];
      return f ? { x: f.pos.x, y: f.pos.y + GUN_HEIGHT, z: f.pos.z } : null;
    };
    for (const e of w.events) {
      if (e.t === 'shot') {
        const a = at(e.shooter);
        const b = at(e.target);
        const shooter = w.vehicles.find((x) => x.id === e.shooter) ?? w.removed.find((x) => x.id === e.shooter);
        const gun = shooter && mountedParts(shooter).find((p) => p.id === e.weapon);
        const def = gun && partDef(gun.defId);
        const heavy = def?.kind === 'weapon' && def.look === 'cannon';
        if (a && b) this.fx.shot(a, b, e.hit, e.damage, heavy);
      }
      if (e.t === 'destroyed') {
        const p = at(e.vehicle);
        if (p) this.fx.explode(p);
      }
      if (e.t === 'collision') {
        const p = at(e.a);
        if (p) this.fx.crash(p);
      }
    }
  }

  // The path preview chains physics turns from the current state, so it shows what will happen.
  private refreshPlan(): void {
    if (this.anim || this.planFor === this.world) return;
    this.planFor = this.world;
    const me = playerVehicle(this.world);
    if (!me.order && me.speed === 0) return this.path.clear();
    const turns: VehicleFrame[][] = [];
    let w = structuredClone(this.world);
    let d = this.drive;
    for (let i = 0; i < PLAN_TURNS; i++) {
      const r = simulateTurn(d, w);
      turns.push(r.frames[me.id]);
      w.events = [];
      applyTurn(w, r);
      if (d !== this.drive) freeDrive(d);
      d = r.next;
      const v = w.vehicles.find((x) => x.id === me.id)!;
      if (!v.order && v.speed < 0.05) break;
    }
    if (d !== this.drive) freeDrive(d);
    const first = me.order?.kind === 'through' ? PAL.throttle[throttleFor(Math.hypot(me.order.dest.x - me.pos.x, me.order.dest.y - me.pos.y), me.speed)] : PAL.plan;
    this.path.set(turns, first);
  }

  private tick(now: number): void {
    const dt = now - this.last;
    this.last = now;
    const step = this.animStep(now);
    this.syncVehicles(step);
    this.drawOverlays();
    const me = this.frames[playerVehicle(this.world).id];
    if (this.following && me) this.rig.follow(me.pos);
    this.rig.tick(dt);
    const focus = this.rig.camera.position.clone();
    this.sun.target.position.copy(me ? new THREE.Vector3(me.pos.x, me.pos.y, me.pos.z) : focus);
    this.sun.position.copy(this.sun.target.position).add(new THREE.Vector3(-60, 120, -30));
    this.fx.tick(dt);
    this.labels.update(this.world, this.rig);
    this.renderer.render(this.scene, this.rig.camera);
    // The preview runs after the frame is drawn, so a click shows at once.
    this.refreshPlan();
    requestAnimationFrame((t) => this.tick(t));
  }

  // Physics step shown now while a turn plays, or null between turns.
  private animStep(now: number): number | null {
    if (!this.anim) return null;
    if (this.anim.start === null) this.anim.start = now;
    const i = Math.floor(((now - this.anim.start) / 1000) * PHYSICS.stepsPerSecond);
    if (i < TURN_STEPS) return i;
    this.finishTurn();
    return null;
  }

  private syncVehicles(step: number | null): void {
    const frames: TurnFrames | null = step === null || !this.anim ? null : this.anim.result.frames;
    const shown = [...this.world.vehicles, ...(frames ? this.world.removed : [])];
    const ids = new Set<string>();
    for (const v of shown) {
      const f = frames?.[v.id]?.[step!] ?? this.frames[v.id] ?? restFrame(this.world, v);
      this.frames[v.id] = f;
      if (!this.isVehicleVisible(v)) continue;
      ids.add(v.id);
      let view = this.views.get(v.id);
      if (!view) {
        view = new VehicleView(v);
        this.views.set(v.id, view);
        this.scene.add(view.root, view.ground);
      }
      view.update(v);
      view.pose(f);
      view.aim(this.turretAim(v, f));
      view.rings(this.ringsFor(v));
      this.vehicleParticles(v, f, frames !== null);
    }
    for (const [id, view] of this.views) {
      if (ids.has(id)) continue;
      this.scene.remove(view.root, view.ground);
      view.dispose();
      this.views.delete(id);
    }
  }

  private vehicleParticles(v: Vehicle, f: VehicleFrame, moving: boolean): void {
    if (moving && v.speed > 0.5 && Math.random() < DUST_CHANCE) this.fx.dust(f.pos);
    const hurt = v.hull < vehicleStats(this.world, v).hullMax * HURT_HULL || mountedParts(v).some((p) => p.hp === 0);
    if (hurt && Math.random() < SMOKE_CHANCE) this.fx.smoke(f.pos);
  }

  // Turrets point at their first ordered target.
  private turretAim(v: Vehicle, f: VehicleFrame): number | null {
    const order = Object.values(v.weaponOrders)[0];
    const target = order && this.frames[order.targetId];
    return target ? Math.atan2(target.pos.z - f.pos.z, target.pos.x - f.pos.x) : null;
  }

  // Rings under vehicles: red for hostiles, bright for my targets, gold for my truck and the hovered one,
  // and the selected weapon's range around my truck.
  private ringsFor(v: Vehicle): Ring3[] {
    const me = playerVehicle(this.world);
    const r = vehicleStats(this.world, v).radius + 0.25;
    if (v.id === me.id) {
      const rings: Ring3[] = [{ r: r + 0.05, width: 0.08, color: PAL.select, alpha: 0.45 }];
      const sel = vehicleStats(this.world, me).weapons.find((m) => m.part.id === this.selected);
      if (sel && !this.anim) rings.push({ r: sel.def.range, width: 0.06, color: PAL.select, alpha: 0.6 });
      return rings;
    }
    const rings: Ring3[] = [];
    if (Object.values(me.weaponOrders).some((o) => o.targetId === v.id)) rings.push({ r: r + 0.1, width: 0.12, color: PAL.target, alpha: 1 });
    else if (hostileToPlayer(this.world, v)) rings.push({ r, width: 0.08, color: PAL.target, alpha: 0.55 });
    if (v.id === this.hovered) rings.push({ r: r + 0.2, width: 0.06, color: PAL.select, alpha: 0.9 });
    return rings;
  }

  private drawOverlays(): void {
    const hide = this.anim !== null || this.modalOpen();
    this.zones.root.visible = !hide;
    this.path.root.visible = !hide;
    if (hide) return;
    const me = playerVehicle(this.world);
    const s = vehicleStats(this.world, me);
    this.zones.update(this.world.terrain, me.pos, me.heading, me.speed, Math.max(MIN_ZONE_HALF_ANGLE, maxTurn(s, me.speed) / 2));
    const hover = this.hoverGround;
    const color = hover ? PAL.throttle[throttleFor(Math.hypot(hover.x - me.pos.x, hover.y - me.pos.y), me.speed)] : PAL.plan;
    this.zones.hover(this.world.terrain, hover, color);
  }
}
