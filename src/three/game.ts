import { startKit } from "../data/start";
// The 3D game: wires input to the sim, the sim and physics to the Three.js view, and the HTML UI.
// Sim time only moves while a turn plays. The path preview runs the same physics the turn will run.

import * as THREE from "three";
import { CONFIG } from "../config";
import { partDef } from "../data/parts";
import { PHYSICS } from "../data/physics";
import {
  buildDrive,
  freeDrive,
  restFrame,
  simulateTurn,
  syncDrive,
  TURN_STEPS,
  type Drive,
  type TurnResult,
} from "../phys/drive";
import {
  groundPoint,
  toMap,
  type TurnFrames,
  type V3,
  type VehicleFrame,
} from "../phys/frames";
import { applyTurn, physicsMove } from "../phys/turn";
import { playerVehicle } from "../sim/damage";
import { corePart, mountedParts } from "../sim/grid";
import { canScavenge, scavenge } from "../sim/locations";
import { locationAt, townAt } from "../sim/sites";
import { maxTurn, vehicleStats } from "../sim/stats";
import { clickOrder, throttleFor } from "../sim/steering";
import { warmRoutes } from "../sim/path";
import { CHASSIS } from "../data/chassis";
import type { ShotRound, Vehicle, World } from "../sim/types";
import type { Vec } from "../sim/vec";
import { playerSees, tileOf, visibleTiles } from "../sim/vision";
import { DEG, dist } from "../sim/vec";
import { TERRAIN } from "../data/terrain";
import {
  cloneWorld,
  endTurn,
  hostileToPlayer,
  newWorld,
  setAutoFire,
  setDirect,
  setMoveOrder,
  setWeaponOrder,
} from "../sim/world";
import { PAL } from "../render/palette";
import { timed } from "../perf";
import { CharacterScreen } from "../ui/character";
import { HitCard } from "../ui/hitCard";
import type { UiHost } from "../ui/host";
import { Hud } from "../ui/hud";
import { InventoryScreen } from "../ui/inventory";
import { TownScreen } from "../ui/town";
import { getWeaponReadout, WeaponPanel, weaponsForClick } from "../ui/weapons";
import { CameraRig } from "./render/camera";
import { FogView } from "./render/fog";
import { Fx3D } from "./render/fx";
import { Labels } from "./render/labels";
import { ObstacleViews } from "./render/obstacles";
import { PathView } from "./render/path";
import { RenderScope } from "./render/scope";
import { addSites } from "./render/sites";
import { terrainMesh } from "./render/terrain";
import { VehicleView, type Ring3 } from "./render/vehicle";
import { WeaponRangeView } from "./render/weaponRange";
import { WeatherView } from "./render/weather";
import { ZonesView } from "./render/zones";
import { REGION } from '../data/region';
import { TERRAIN_TYPES } from '../data/terrain';
import { bodyOf } from '../sim/body';
import { headingOf } from '../phys/frames';
import { canLoot, salvageHere } from '../sim/locations';
import { daylightAt } from './render/daylight';
import { sunAt } from '../sim/sun';
import { tileAt } from '../sim/terrain';
import { ContactsView } from './render/contacts';
import { DustCloudsView } from './render/dust';
import { ShadeView } from './render/shade';
import { SoundRingView } from './render/soundRing';
import { clearSave, hasSave, loadWorld, saveWorld, writeSave } from "./save";
import { GameMenu } from "../ui/game-menu";
import { MIX } from "../data/sounds";
import { engineGlide, SoundDirector, SoundLoops, stingOf } from "./sound";
import type { SoundPlayer } from "../audio/player";
import { uiRoot } from "../ui/dom";

const PLAN_TURNS = 3; // turns of path preview

// Ground speed in m/s at one physics step of a vehicle's turn frames.
function stepSpeed(frames: VehicleFrame[] | undefined, step: number): number {
  if (!frames || step < 1 || step >= frames.length) return 0;
  const a = frames[step - 1].pos;
  const b = frames[step].pos;
  return Math.hypot(b.x - a.x, b.z - a.z) * PHYSICS.stepsPerSecond;
}
const PICK_PX = 30; // click radius around a vehicle's screen position
const MIN_ZONE_HALF_ANGLE = Math.PI / 12; // zones stay visible for trucks that barely turn
const DUST_CHANCE = 0.3; // per moving vehicle per frame while a turn plays, times the ground's dust value
const DUST_BEHIND_M = 0.4; // meters behind the body's rear where wheel dust rises
const SMOKE_CHANCE = 0.05; // per hurt vehicle per frame
const HURT_CAB = 0.35; // cab hp share under which a vehicle smokes
const LIVE_VISION_STEP = 0.35; // tiles the truck moves before its sight is recomputed during a turn
const SUN_RADIUS = 150; // meters from the focus to the sun light
// The player's headlight beam. Only the player gets one, since each light costs every lit pixel.
const BEAM_COLOR = 0xfff2c8;
const BEAM_INTENSITY = 25; // lit only at night
const BEAM_DECAY = 0.4; // below the physical 2, so the ground by the nose does not burn white
const BEAM_RANGE = 70; // meters where the light fades to nothing
const BEAM_ANGLE = 42 * DEG; // half-angle of the cone
const BEAM_PENUMBRA = 0.6; // soft share of the cone edge
const BEAM_HEIGHT = 4; // meters above the truck center where the beam starts
const BEAM_AIM = { ahead: 30, down: 6 }; // meters ahead of the nose and below the truck center the beam points at

type LiveVision = {
  visible: Set<number>;
  explored: Uint8Array;
  from: Vec | null;
};
type TurnPhase = ReturnType<UiHost["getTurnPhase"]>;
// before is the world at the turn's start: panels and vehicles show it until the shots land.
type Playback = {
  result: TurnResult;
  before: World;
  start: number | null;
  moved: boolean;
  impacts: boolean;
  combat: boolean;
};

const MOVE_MS = (TURN_STEPS / PHYSICS.stepsPerSecond) * 1000; // real time the movement plays over
const MOVED_BY_RULES = 0.5; // tiles between a vehicle's drawn spot and its sim spot that mean the rules moved it
const MARKER_LIFT = 3.5; // meters above a target where its weapon marker sits

const GUN_HEIGHT = 1.6; // meters above the body center where shots start and land
const ROUND_STAGGER = 0.4; // share of the shot time over which a burst's rounds leave the gun

// Where a round lands: `offset` meters from target point b, across the line of fire from a, positive to the
// shooter's right. A hit lands on the target at its offset, a miss beside it.
// 3D x is map x and 3D z is map y, so the right-hand normal matches the sim's.
function besideTarget(a: V3, b: V3, offset: number): V3 {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (!(len > 0)) throw new Error("Shot from its own target point");
  return { x: b.x - (dz / len) * offset, y: b.y, z: b.z + (dx / len) * offset };
}

export class Game {
  private world: World;
  private drive: Drive;
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  private readonly scene = new THREE.Scene();
  private readonly sun = new THREE.DirectionalLight();
  private readonly sky = new THREE.HemisphereLight();
  private readonly beam = new THREE.SpotLight(BEAM_COLOR, 0, BEAM_RANGE, BEAM_ANGLE, BEAM_PENUMBRA, BEAM_DECAY);
  private readonly stormTint = Object.assign(document.createElement('div'), { className: 'storm-tint' }); // dust haze while inside a storm
  private readonly rig: CameraRig;
  private readonly ground = new THREE.Group(); // terrain chunks near the view, for ground picking
  private readonly props = new THREE.Group(); // sites and obstacles near the view
  private readonly scopes: RenderScope[];
  private readonly obstacles: ObstacleViews;
  private readonly fog: FogView;
  private readonly lastSeen = new Map<string, number>(); // vehicle id to the turn the player last saw it
  private readonly shade: ShadeView;
  private readonly weather: WeatherView;
  private readonly labels: Labels;
  private readonly zones = new ZonesView();
  private readonly contacts = new ContactsView();
  private readonly dust = new DustCloudsView();
  private readonly soundRing = new SoundRingView();
  private readonly path: PathView;
  private readonly fx: Fx3D;
  readonly sound: SoundDirector;
  private panelOpen = false; // last frame's panel state, for open and close sounds
  private readonly loops: SoundLoops;
  private lastDangerTurn = -Infinity; // last turn a hostile was in sight, for the combat music hold
  private readonly views = new Map<string, VehicleView>();
  private frames: Record<string, VehicleFrame> = {}; // last shown pose per vehicle
  // A played turn: physics movement, then shots in flight when there was combat, then time to read results.
  private anim: Playback | null = null;
  private phase: TurnPhase = null;
  private readonly weaponRange = new WeaponRangeView();
  private readonly markers = new Map<string, HTMLDivElement>(); // weapon markers above targets, by target id
  private readonly overlay: HTMLElement;
  private live: LiveVision | null = null; // the player's view while a turn plays
  private hoverGround: Vec | null = null;
  private hovered: string | null = null;
  private selected: string | null = null;
  private following = true;
  private panFrom: { x: number; y: number } | null = null;
  private planFor: World | null = null;
  private last = performance.now();

  private readonly hud: Hud;
  private readonly hitCard: HitCard;
  private readonly weapons: WeaponPanel;
  private readonly town: TownScreen;
  private readonly character: CharacterScreen;
  private readonly inventory: InventoryScreen;
  private readonly menu: GameMenu;

  constructor(container: HTMLElement, overlay: HTMLElement, player: SoundPlayer, private toggleMute: () => void) {
    this.world =
      loadWorld(window.localStorage) ??
      newWorld(CONFIG.seed, startKit(CONFIG.startKit));
    this.drive = buildDrive(this.world);
    warmRoutes(this.world, [...new Set(Object.values(CHASSIS).map((c) => c.radius))]);

    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    this.rig = new CameraRig(container);

    this.scene.background = new THREE.Color(PAL.bg);
    this.scene.add(this.sky);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, {
      left: -80,
      right: 80,
      top: 80,
      bottom: -80,
      near: 1,
      far: 500,
    });
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(this.beam, this.beam.target);

    // Ground and props cull separately, so ground picking only hits terrain.
    const groundScope = new RenderScope(this.ground, this.world.size);
    const propScope = new RenderScope(this.props, this.world.size);
    this.scopes = [groundScope, propScope];
    const groundChunks = terrainMesh(this.world, groundScope);
    addSites(this.world.terrain, propScope);
    this.obstacles = new ObstacleViews(propScope, this.world.terrain);
    this.obstacles.sync(this.world.obstacles);
    this.fog = new FogView(this.world, groundChunks);
    this.path = new PathView(this.world.terrain);
    this.shade = new ShadeView(this.world);
    this.weather = new WeatherView(this.world);
    this.scene.add(this.ground, this.props, this.shade.mesh, this.weather.root, this.zones.root, this.path.root, this.weaponRange.root, this.contacts.root, this.dust.root, this.soundRing.root);
    this.overlay = overlay;
    overlay.append(this.stormTint);
    this.labels = new Labels(overlay);
    this.fx = new Fx3D(this.scene, overlay, this.rig);
    this.sound = new SoundDirector(player, this.rig);
    this.loops = new SoundLoops(player);
    uiRoot().addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("button")) this.sound.ui("ui-click");
    });

    const host = this.uiHost();
    this.weapons = new WeaponPanel(host);
    this.town = new TownScreen(host);
    this.character = new CharacterScreen(host);
    this.inventory = new InventoryScreen(host);
    this.hud = new Hud({
      openInventory: () => this.toggleInventory(),
      openCharacter: () => this.toggleCharacter(),
      toggleManual: () => {
        if (!this.anim && !this.modalOpen()) this.toggleManual();
      },
      isBusy: () => this.anim !== null,
    });
    this.hitCard = new HitCard(this.hud.getInspectionRoot());
    this.menu = new GameMenu({
      save: () => writeSave(window.localStorage, this.world),
      hasSave: () => hasSave(window.localStorage),
      clearSave: () => clearSave(window.localStorage),
      isBusy: () => this.anim !== null,
    });

    this.bindInput();
    window.addEventListener("resize", () => this.resize());
    this.resize();
    this.refreshUi();
    requestAnimationFrame((t) => this.tick(t));
  }

  private uiHost(): UiHost {
    return {
      world: () => this.displayWorld(),
      apply: (next) => this.apply(next),
      selectedWeapon: () => this.selected,
      selectWeapon: (id) => {
        if (this.anim) return;
        this.selected = id;
        this.refreshUi();
      },
      endTurn: () => this.endTurn(),
      getTurnPhase: () => this.phase,
    };
  }

  // Screen point of a map point on the ground, for browser test scripts.
  debugScreenOf(x: number, y: number): { x: number; y: number } {
    return this.rig.screenOf(groundPoint(this.world.terrain, { x, y }));
  }

  // Centers the camera on map point x, y at the given zoom and stops following, for browser scripts.
  debugView(x: number, y: number, zoom: number): void {
    this.following = false;
    this.rig.setZoom(zoom);
    // An infinite step moves the smoothed follow all the way in one tick.
    this.rig.follow(groundPoint(this.world.terrain, { x, y }));
    this.rig.tick(Number.POSITIVE_INFINITY);
    this.rig.follow(null);
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
    return (
      this.town.isOpen() || this.character.isOpen() || this.inventory.isOpen()
    );
  }

  // Until a turn's shots land, the panels show the world as it was when the turn began.
  private displayWorld(): World {
    return this.anim && !this.anim.impacts ? this.anim.before : this.world;
  }

  private refreshUi(): void {
    this.menu.refresh();
    const me = playerVehicle(this.world);
    if (this.selected && !vehicleStats(this.world, me).weapons.some((mw) => mw.part.id === this.selected)) this.selected = null;
    if (!this.anim) {
      timed('fog', () => this.fog.update(this.world));
      this.shade.update(this.world);
    }
    if (!this.anim || this.anim.impacts) this.obstacles.sync(this.world.obstacles);
    this.hud.renderTop(this.displayWorld());
    this.weapons.render();
    this.town.render();
    this.character.render();
    this.inventory.render();
    this.hud.renderAction(this.contextLabel(), () => this.useContext());
    this.refreshInfo();
    this.refreshTargetMarkers();
  }

  private contextLabel(): string | null {
    if (this.anim) return null;
    const town = townAt(this.world);
    if (town) return `Enter ${town.name}`;
    if (playerVehicle(this.world).job) return null;
    if (canScavenge(this.world)) return `Search ${salvageName(this.world)}`;
    if (canLoot(this.world)) return `Loot ${salvageName(this.world)}`;
    return null;
  }

  private useContext(): void {
    if (this.anim) return;
    if (townAt(this.world)) return this.town.open();
    if (playerVehicle(this.world).job) return;
    if (canScavenge(this.world)) {
      this.apply(scavenge(this.world));
      this.hud.pushEvents(this.world);
    } else if (canLoot(this.world)) {
      this.inventory.openLoot(salvageHere(this.world)!.id);
    }
  }

  private refreshInfo(): void {
    const w = this.displayWorld();
    const v = this.hovered
      ? (w.vehicles.find(
          (x) => x.id === this.hovered && playerSees(w, x.pos),
        ) ?? null)
      : null;
    this.hud.showInfo(w, v, v ? hostileToPlayer(w, v) : false);
    this.hitCard.render(w, v ? v.id : null);
  }

  // Combat details stay in the fixed inspection panel and hide during playback.
  private placeHitCard(): void {
    const f = this.hovered ? this.frames[this.hovered] : undefined;
    if (this.anim !== null || this.modalOpen() || !f)
      return this.hitCard.hide();
    this.hitCard.show();
  }

  // Numbered labels above each target listing the weapons aimed at it and whether they can fire now.
  private refreshTargetMarkers(): void {
    for (const el of this.markers.values()) el.remove();
    this.markers.clear();
    if (this.anim) return;
    const lines = new Map<string, string[]>();
    vehicleStats(this.world, playerVehicle(this.world)).weapons.forEach(
      (mw, i) => {
        const readout = getWeaponReadout(this.world, mw);
        if (!readout.target) return;
        const list = lines.get(readout.target.id) ?? [];
        list.push(
          `[${i + 1}] ${mw.def.look === "cannon" ? "Cannon" : "MG"} · ${readout.status}`,
        );
        lines.set(readout.target.id, list);
      },
    );
    for (const [id, list] of lines) {
      const el = document.createElement("div");
      el.className = "weapon-marker";
      el.textContent = list.join("\n");
      this.overlay.appendChild(el);
      this.markers.set(id, el);
    }
  }

  private placeTargetMarkers(): void {
    const hide = this.anim !== null || this.modalOpen();
    for (const [id, el] of this.markers) {
      const f = this.frames[id];
      el.style.display = hide || !f ? "none" : "block";
      if (hide || !f) continue;
      const p = this.rig.screenOf({
        x: f.pos.x,
        y: f.pos.y + MARKER_LIFT,
        z: f.pos.z,
      });
      el.style.left = `${p.x}px`;
      el.style.top = `${p.y}px`;
    }
  }

  private isEditingControl(): boolean {
    return document.activeElement?.matches("input, select, textarea") ?? false;
  }

  // Input: left click orders or targets, right drag pans, wheel zooms, keys like the 2D game.
  private bindInput(): void {
    const canvas = this.renderer.domElement;
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("pointerdown", (e) => {
      if (e.button === 2) this.panFrom = { x: e.clientX, y: e.clientY };
      if (e.button === 0) this.onLeftClick(e);
    });
    window.addEventListener("pointermove", (e) => {
      if (this.panFrom) {
        this.rig.panBy(e.clientX - this.panFrom.x, e.clientY - this.panFrom.y);
        this.panFrom = { x: e.clientX, y: e.clientY };
        this.following = false;
      }
      if (e.target === canvas) this.onHover(e);
    });
    window.addEventListener("pointerup", () => (this.panFrom = null));
    canvas.addEventListener("wheel", (e) => this.rig.zoomBy(e.deltaY), {
      passive: true,
    });
    window.addEventListener("keydown", (e) => {
      if (this.isEditingControl()) return;
      const modal = this.modalOpen();
      const playing = this.anim !== null;
      if (e.code === "Space") {
        e.preventDefault();
        if (!e.repeat && !modal) this.endTurn();
      }
      if (e.code === "KeyF") this.following = true;
      if (e.code === "KeyM") this.toggleMute();
      if (e.code === "KeyA" && !modal) this.weapons.toggleAuto();
      if (e.code === "KeyW" && !modal) this.weapons.toggleVisible();
      if (e.code === "Digit0" && !modal) this.weapons.selectWeapon(null);
      if (e.code === "KeyE" && !modal) this.useContext();
      if (e.code === "KeyR" && !modal && !playing) this.toggleManual();
      if (e.code === "KeyC" && !playing) this.toggleCharacter();
      if (e.code === "KeyI" && !playing) this.toggleInventory();
      if (e.code === "Escape") {
        this.town.close();
        this.character.close();
        this.inventory.close();
      }
      const digit = ["Digit1", "Digit2", "Digit3", "Digit4"].indexOf(e.code);
      if (digit >= 0) this.selectWeaponIndex(digit);
    });
  }

  private toggleInventory(): void {
    if (this.anim) return;
    this.town.close();
    this.character.close();
    this.inventory.toggle();
  }

  private toggleCharacter(): void {
    if (this.anim) return;
    this.town.close();
    this.inventory.close();
    this.character.toggle();
  }

  // Manual mode drives straight at the click, so the preview must rerun with the new driver.
  private toggleManual(): void {
    this.apply(setDirect(this.world, !playerVehicle(this.world).direct));
    this.refreshPlan();
  }

  private selectWeaponIndex(i: number): void {
    if (this.anim || this.modalOpen()) return;
    const all = vehicleStats(this.world, playerVehicle(this.world)).weapons;
    if (i >= all.length) return;
    this.weapons.selectWeapon(
      this.selected === all[i].part.id ? null : all[i].part.id,
    );
  }

  private onLeftClick(e: MouseEvent): void {
    if (this.anim || this.modalOpen()) return;
    const picked = this.pickVehicle(e.clientX, e.clientY);
    const me = playerVehicle(this.world);
    if (picked && picked.id !== me.id) return this.targetVehicle(picked);
    const myView = this.views.get(me.id);
    if (
      picked &&
      myView &&
      this.rig.hitsObject(e.clientX, e.clientY, myView.root)
    )
      return this.apply(setMoveOrder(this.world, { kind: "brake" }));
    const p = this.rig.groundUnder(e.clientX, e.clientY, this.ground);
    if (p) this.apply(setMoveOrder(this.world, clickOrder(p, e.shiftKey)));
  }

  private targetVehicle(target: Vehicle): void {
    let w = this.world;
    if (w.player.autoFire) w = setAutoFire(w, false);
    for (const mw of weaponsForClick(w, this.selected))
      w = setWeaponOrder(w, mw.part.id, { targetId: target.id, aim: "body" });
    this.apply(w);
  }

  // While a turn plays, visibility follows the truck's current spot, not the end of the turn.
  // Player shots prove sight at firing time, so their targets stay shown until the shots land,
  // even when a new wreck changes the fog.
  private canShowCombatVehicle(v: Vehicle): boolean {
    return (
      this.isVehicleVisible(v) ||
      this.world.events.some(
        (e) =>
          e.t === "shot" &&
          e.shooter === this.world.player.vehicleId &&
          e.target === v.id,
      )
    );
  }

  // A vehicle out of sight stays drawn for a few turns after the player last saw it, so it does not
  // blink out behind a rock. Display only: it cannot be picked or targeted while lingering.
  private lingers(v: Vehicle): boolean {
    const seen = this.lastSeen.get(v.id);
    return seen !== undefined && this.world.turn - seen <= TERRAIN.vision.lingerTurns;
  }

  private isVehicleVisible(v: Vehicle): boolean {
    if (v.id === playerVehicle(this.world).id) return true;
    const f = this.frames[v.id];
    if (this.live && f)
      return this.live.visible.has(tileOf(this.world, toMap(f.pos)));
    return playerSees(this.world, v.pos);
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
    if (this.anim || this.modalOpen()) return;
    const before = this.world;
    let result: TurnResult | null = null;
    this.world = endTurn(
      this.world,
      physicsMove(this.drive, (r) => (result = r)),
    );
    if (!result) throw new Error("Turn ran without physics");
    this.live = {
      visible: new Set(this.world.player.visible),
      explored: before.player.explored.slice(),
      from: null,
    };
    const combat = this.world.events.some(
      (e) =>
        (e.t === "shot" && this.eventPoint(e.shooter) !== null && this.eventPoint(e.target) !== null) ||
        (e.t === "guardShot" && this.eventPoint(e.target) !== null),
    );
    this.anim = {
      result,
      before,
      start: null,
      moved: false,
      impacts: false,
      combat,
    };
    this.playDriveSound(result);
    this.phase = "Moving";
    this.path.clear();
    this.refreshUi();
  }

  // Movement is over: adopt the physics state, fire the volley.
  private finishMovement(a: Playback): void {
    a.moved = true;
    freeDrive(this.drive);
    this.drive = a.result.next;
    syncDrive(this.drive, this.world);
    for (const [id, fs] of Object.entries(a.result.frames))
      this.frames[id] = fs[fs.length - 1];
    this.live = null;
    this.phase = a.combat ? 'Firing' : 'Results';
    timed('fog', () => this.fog.update(this.combatFogWorld()));
    this.playShotFx();
    this.weapons.render();
  }

  // Shots land: explosions, new wrecks, the log and the new part values.
  private landImpacts(a: Playback): void {
    a.impacts = true;
    this.phase = "Results";
    for (const e of this.world.events) {
      if (e.t !== "destroyed") continue;
      const p = this.eventPoint(e.vehicle);
      if (p) this.fx.explode(p);
    }
    this.playImpactSounds();
    this.hud.pushEvents(this.world);
    // A finished search opens the loot beside the truck's grid.
    const searched = this.world.events.find((e) => e.t === 'searched');
    if (searched) this.inventory.openLoot(searched.stock);
    this.refreshUi();
  }

  private finishPlayback(): void {
    this.anim = null;
    this.phase = null;
    saveWorld(window.localStorage, this.world, CONFIG.saveTurns);
    this.refreshUi();
  }

  // Explosions and broken parts where they happen, then one result sting for the turn.
  private playImpactSounds(): void {
    for (const e of this.world.events) {
      const id = e.t === "destroyed" || e.t === "partDisabled" ? e.vehicle : null;
      const p = id && this.eventPoint(id);
      if (p) this.sound.at(e.t === "destroyed" ? "explosion" : "part-broken", p, 0);
    }
    const sting = stingOf(this.world.events, playerVehicle(this.world).id);
    if (sting) this.sound.ui(sting);
  }

  private playDriveSound(result: TurnResult): void {
    const frames = result.frames[playerVehicle(this.world).id];
    const g = engineGlide(stepSpeed(frames, 1), stepSpeed(frames, frames.length - 1), MOVE_MS / 1000, MIX);
    if (!g) return;
    this.loops.drive(g);
    if (g.brake) this.sound.at("air-brake", frames[0].pos, 0);
  }

  private updateLoops(): void {
    const me = playerVehicle(this.world);
    const f = this.frames[me.id];
    const at = f ? toMap(f.pos) : me.pos;
    if (this.world.vehicles.some((v) => hostileToPlayer(this.world, v) && this.isVehicleVisible(v))) this.lastDangerTurn = this.world.turn;
    this.loops.update({
      stormTiles: this.weather.stormTilesFrom(at.x, at.y),
      turnsSinceDanger: this.world.turn - this.lastDangerTurn,
    });
  }

  private playPanelSounds(): void {
    const open = this.modalOpen();
    if (open !== this.panelOpen) this.sound.ui(open ? "ui-open" : "ui-close");
    this.panelOpen = open;
  }

  // The fog while shots fly also shows the tiles of vehicles the volley involves.
  private combatFogWorld(): World {
    const visible = new Set(this.world.player.visible);
    for (const v of [...this.world.vehicles, ...this.world.removed]) {
      if (this.canShowCombatVehicle(v)) visible.add(tileOf(this.world, v.pos));
    }
    return {
      ...this.world,
      player: {
        ...this.world.player,
        visible: [...visible].sort((a, b) => a - b),
      },
    };
  }

  // Where effects for a vehicle play, or null when the player may not see it.
  private eventPoint(id: string): V3 | null {
    const v =
      this.world.vehicles.find((x) => x.id === id) ??
      this.world.removed.find((x) => x.id === id);
    const f = this.frames[id] ?? (v ? restFrame(this.world, v) : null);
    if (!v || !f || !this.canShowCombatVehicle(v)) return null;
    return { x: f.pos.x, y: f.pos.y + GUN_HEIGHT, z: f.pos.z };
  }

  private playShotFx(): void {
    const w = this.world;
    const rows = new Map<string, number>();
    const mine = vehicleStats(w, playerVehicle(w)).weapons;
    for (const e of w.events) {
      if (e.t === "shot") {
        const a = this.eventPoint(e.shooter);
        const b = this.eventPoint(e.target);
        if (!a || !b) continue;
        const shooter =
          w.vehicles.find((x) => x.id === e.shooter) ??
          w.removed.find((x) => x.id === e.shooter);
        const gun =
          shooter && mountedParts(shooter).find((p) => p.id === e.weapon);
        const def = gun && partDef(gun.defId);
        const heavy = def?.kind === "weapon" && def.look === "cannon";
        const slot = mine.findIndex((mw) => mw.part.id === e.weapon);
        const hits = e.rounds.filter((r) => r.hit).length;
        const dealt = e.rounds
          .flatMap((r) => r.hits)
          .reduce((sum, h) => sum + h.damage, 0);
        const label = `${slot >= 0 ? `[${slot + 1}] ` : ""}${heavy ? "Cannon" : "MG"} ${hits}/${e.rounds.length}${e.rounds.some((r) => r.crit) ? " crit" : ""}${dealt > 0 ? ` −${dealt}` : ""}`;
        this.playVolley(a, b, e.rounds, heavy, label, e.target, rows);
      }
      if (e.t === "guardShot") {
        const b = this.eventPoint(e.target);
        if (!b) continue;
        const g = groundPoint(this.world.terrain, e.from);
        const a = { x: g.x, y: g.y + (REGION.settlement.guardTowerHeight + 0.2) * PHYSICS.metersPerTile, z: g.z };
        const hits = e.rounds.filter((r) => r.hit).length;
        const dealt = e.rounds.flatMap((r) => r.hits).reduce((sum, h) => sum + h.damage, 0);
        this.playVolley(a, b, e.rounds, false, `Guards ${hits}/${e.rounds.length}${dealt > 0 ? ` −${dealt}` : ""}`, e.target, rows);
      }
      if (e.t === "collision") {
        const p = this.eventPoint(e.a);
        if (p) this.fx.crash(p);
        if (p) this.sound.at("crash", p, 0);
      }
    }
  }

  // Plays one volley's bolts and sounds from a to b, then its result label over the target.
  private playVolley(a: V3, b: V3, rounds: ShotRound[], heavy: boolean, label: string, targetId: string, rows: Map<string, number>): void {
    const hits = rounds.filter((r) => r.hit).length;
    const row = rows.get(targetId) ?? 0;
    rows.set(targetId, row + 1);
    // Round starts spread over the first part of the shot time, so every bolt lands before the results show.
    const flight = CONFIG.combatShotMs * (1 - ROUND_STAGGER);
    rounds.forEach((r, k) => {
      const delay =
        rounds.length > 1
          ? (k / (rounds.length - 1)) *
            CONFIG.combatShotMs *
            ROUND_STAGGER
          : 0;
      const land = besideTarget(a, b, r.offset);
      const struck = r.hit || r.hits.length > 0;
      this.fx.shot(a, land, struck, heavy, delay, flight);
      this.sound.at(heavy ? "cannon-fire" : "mg-fire", a, delay);
      this.sound.at(struck ? "hit-metal" : "miss", land, delay + flight);
    });
    this.fx.label(
      b,
      label,
      hits > 0 ? "#ffb070" : "#c8b898",
      row,
      CONFIG.combatShotMs,
      CONFIG.combatReadMs,
    );
  }

  // The path preview chains physics turns from the current state, so it shows what will happen.
  private refreshPlan(): void {
    if (this.anim || this.planFor === this.world) return;
    this.planFor = this.world;
    const me = playerVehicle(this.world);
    if (!me.order && me.speed === 0) return this.path.clear();
    timed('preview', () => this.planPath(me));
  }

  private planPath(me: Vehicle): void {
    const turns: VehicleFrame[][] = [];
    let w = cloneWorld(this.world);
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
    const first =
      me.order?.kind === "through"
        ? PAL.throttle[
            throttleFor(
              Math.hypot(
                me.order.dest.x - me.pos.x,
                me.order.dest.y - me.pos.y,
              ),
              me.speed,
            )
          ]
        : PAL.plan;
    this.path.set(turns, first);
  }

  private tick(now: number): void {
    const dt = now - this.last;
    this.last = now;
    const step = this.animStep(now);
    this.updateLiveVision();
    this.syncVehicles(step);
    this.drawOverlays();
    const me = this.frames[playerVehicle(this.world).id];
    if (this.following && me) this.rig.follow(me.pos);
    this.rig.tick(dt);
    const focus = this.rig.camera.position.clone();
    this.sun.target.position.copy(me ? new THREE.Vector3(me.pos.x, me.pos.y, me.pos.z) : focus);
    const light = daylightAt(this.lightTurn(now));
    const horiz = Math.cos(light.elevation) * SUN_RADIUS;
    this.sun.position.copy(this.sun.target.position).add(new THREE.Vector3(light.dir.x * horiz, Math.sin(light.elevation) * SUN_RADIUS, light.dir.y * horiz));
    this.sun.color.copy(light.sun);
    this.sun.intensity = light.sunIntensity;
    this.sky.color.copy(light.sky);
    this.sky.groundColor.copy(light.ground);
    this.sky.intensity = light.skyIntensity;
    this.aimBeam(me, !sunAt(this.world.turn));
    const at = playerVehicle(this.world).pos;
    this.stormTint.style.display = this.world.weather.some((e) => e.kind === 'storm' && dist(at, e.pos) <= e.radius) ? '' : 'none';
    this.fx.tick(dt);
    this.playPanelSounds();
    this.updateLoops();
    this.weather.advance(dt);
    this.weather.sync(this.world);
    this.labels.update(this.world, this.rig);
    for (const scope of this.scopes) scope.update(this.rig.camera);
    this.renderer.render(this.scene, this.rig.camera);
    // The preview runs after the frame is drawn, so a click shows at once.
    this.refreshPlan();
    requestAnimationFrame((t) => this.tick(t));
  }

  // Recomputes the player's sight from the truck's current spot once it has moved far enough.
  private updateLiveVision(): void {
    const live = this.live;
    const f = this.frames[playerVehicle(this.world).id];
    if (!live || !this.anim || !f) return;
    const at = toMap(f.pos);
    if (live.from && dist(live.from, at) < LIVE_VISION_STEP) return;
    live.from = at;
    live.visible = visibleTiles(this.world, at);
    for (const t of live.visible) live.explored[t] = 1;
    const player = { ...this.world.player, visible: [...live.visible].sort((a, b) => a - b), explored: live.explored };
    timed('fog', () => this.fog.update({ ...this.world, player }));
  }

  // The clock the light shows. While a turn's movement plays it glides from the previous turn to this one,
  // so the sun moves and changes color continuously instead of once per turn.
  private lightTurn(now: number): number {
    const a = this.anim;
    if (!a || a.start === null) return this.world.turn - (a ? 1 : 0);
    return this.world.turn - 1 + Math.min(1, (now - a.start) / MOVE_MS);
  }

  // Physics step shown now while the movement plays, or null otherwise. Advances the playback phases.
  private animStep(now: number): number | null {
    const a = this.anim;
    if (!a) return null;
    if (a.start === null) a.start = now;
    const elapsed = now - a.start;
    if (elapsed < MOVE_MS)
      return Math.floor((elapsed / 1000) * PHYSICS.stepsPerSecond);
    if (!a.moved) this.finishMovement(a);
    const impactAt = MOVE_MS + (a.combat ? CONFIG.combatShotMs : 0);
    if (elapsed >= impactAt && !a.impacts) this.landImpacts(a);
    if (elapsed >= impactAt + (a.combat ? CONFIG.combatReadMs : 0))
      this.finishPlayback();
    return null;
  }

  private syncVehicles(step: number | null): void {
    const frames: TurnFrames | null =
      step === null || !this.anim ? null : this.anim.result.frames;
    const landed = !this.anim || this.anim.impacts;
    const night = !sunAt(this.world.turn);
    const shown = [
      ...this.world.vehicles,
      ...(landed ? [] : this.world.removed),
    ];
    const ids = new Set<string>();
    for (const v of shown) {
      const kept = this.frames[v.id];
      // Between turns, a vehicle the rules moved, such as a defeated player waking in town, jumps to its new spot.
      const stale =
        !this.anim && kept && dist(toMap(kept.pos), v.pos) > MOVED_BY_RULES;
      const f =
        frames?.[v.id]?.[step!] ??
        (kept && !stale ? kept : restFrame(this.world, v));
      this.frames[v.id] = f;
      const seen = landed ? this.isVehicleVisible(v) : this.canShowCombatVehicle(v);
      if (seen) this.lastSeen.set(v.id, this.world.turn);
      if (!seen && !this.lingers(v)) continue;
      const before =
        !landed && this.anim!.before.vehicles.find((x) => x.id === v.id);
      const display = before ? { ...v, items: before.items } : v;
      ids.add(v.id);
      let view = this.views.get(v.id);
      if (!view) {
        view = new VehicleView(v);
        this.views.set(v.id, view);
        this.scene.add(view.root, view.ground);
      }
      view.update(display);
      view.lamps(night);
      view.pose(f);
      view.aim(this.turretAim(v, f));
      view.rings(this.ringsFor(v));
      this.vehicleParticles(display, f, frames !== null);
    }
    for (const [id, view] of this.views) {
      if (ids.has(id)) continue;
      this.scene.remove(view.root, view.ground);
      view.dispose();
      this.views.delete(id);
    }
  }

  // The beam stays in the scene by day at zero intensity. Adding and removing it would recompile every material.
  private aimBeam(me: VehicleFrame | undefined, night: boolean): void {
    this.beam.intensity = night && me ? BEAM_INTENSITY : 0;
    if (!me) return;
    const rot = new THREE.Quaternion(me.rot.x, me.rot.y, me.rot.z, me.rot.w);
    const at = new THREE.Vector3(me.pos.x, me.pos.y, me.pos.z);
    const nose = bodyOf(playerVehicle(this.world).chassisId).half.x;
    this.beam.position.copy(new THREE.Vector3(nose, BEAM_HEIGHT, 0).applyQuaternion(rot).add(at));
    this.beam.target.position.copy(new THREE.Vector3(nose + BEAM_AIM.ahead, -BEAM_AIM.down, 0).applyQuaternion(rot).add(at));
  }

  // Wheel dust rises from the ground just behind the rear wheels, so it never reads as exhaust.
  private dustPoint(v: Vehicle, f: VehicleFrame): V3 {
    const at = toMap(f.pos);
    const h = headingOf(f.rot);
    const back = (bodyOf(v.chassisId).half.x + DUST_BEHIND_M) / PHYSICS.metersPerTile;
    return groundPoint(this.world.terrain, { x: at.x - Math.cos(h) * back, y: at.y - Math.sin(h) * back });
  }

  private vehicleParticles(v: Vehicle, f: VehicleFrame, moving: boolean): void {
    const ground = TERRAIN_TYPES[this.world.terrain.types[tileAt(this.world.terrain, v.pos)]];
    if (moving && v.speed > 0.5 && Math.random() < DUST_CHANCE * ground.dust)
      this.fx.dust(this.dustPoint(v, f));
    const cab = corePart(v, "cab");
    const hurt =
      cab.hp < partDef(cab.defId).hp * HURT_CAB ||
      mountedParts(v).some((p) => p.hp === 0);
    if (hurt && Math.random() < SMOKE_CHANCE) this.fx.smoke(f.pos);
  }

  // Turrets point at their first ordered target.
  private turretAim(v: Vehicle, f: VehicleFrame): number | null {
    const order = Object.values(v.weaponOrders)[0];
    const target = order && this.frames[order.targetId];
    return target
      ? Math.atan2(target.pos.z - f.pos.z, target.pos.x - f.pos.x)
      : null;
  }

  // Rings under other vehicles: red for hostiles, bright for my targets, gold for the hovered one.
  // My own truck has none.
  private ringsFor(v: Vehicle): Ring3[] {
    const me = playerVehicle(this.world);
    const r = vehicleStats(this.world, v).radius + 0.25;
    if (v.id === me.id) return [];
    const rings: Ring3[] = [];
    if (Object.values(me.weaponOrders).some((o) => o.targetId === v.id))
      rings.push({ r: r + 0.1, width: 0.12, color: PAL.target, alpha: 1 });
    else if (hostileToPlayer(this.world, v))
      rings.push({ r, width: 0.08, color: PAL.target, alpha: 0.55 });
    if (v.id === this.hovered)
      rings.push({ r: r + 0.2, width: 0.06, color: PAL.select, alpha: 0.9 });
    return rings;
  }

  private drawOverlays(): void {
    const hide = this.anim !== null || this.modalOpen();
    this.zones.root.visible = !hide;
    this.path.root.visible = !hide;
    this.weaponRange.root.visible = false;
    this.placeTargetMarkers();
    this.placeHitCard();
    this.contacts.update(this.world.terrain, this.world.player.contacts, playerVehicle(this.world).pos, this.world.turn, performance.now());
    this.dust.update(this.world, this.world.terrain, performance.now());
    const meFrame = this.frames[playerVehicle(this.world).id];
    this.soundRing.update(this.world.terrain, this.world.player.contacts, meFrame ? toMap(meFrame.pos) : playerVehicle(this.world).pos, this.world.turn, performance.now());
    if (hide) return;
    const me = playerVehicle(this.world);
    const s = vehicleStats(this.world, me);
    const sel = s.weapons.find((m) => m.part.id === this.selected);
    this.weaponRange.set(
      this.world.terrain,
      me.pos,
      me.heading,
      sel ? sel.def : null,
    );
    this.zones.update(
      this.world.terrain,
      me.pos,
      me.heading,
      me.speed,
      Math.max(MIN_ZONE_HALF_ANGLE, maxTurn(s, me.speed) / 2),
    );
    const hover = this.hoverGround;
    const color = hover
      ? PAL.throttle[
          throttleFor(
            Math.hypot(hover.x - me.pos.x, hover.y - me.pos.y),
            me.speed,
          )
        ]
      : PAL.plan;
    this.zones.hover(this.world.terrain, hover, color);
  }
}

// A salvage stock's display name: its site, or a wreck.
function salvageName(world: World): string {
  const stock = salvageHere(world);
  if (!stock) throw new Error('No salvage in reach');
  return REGION.locations.find((l) => l.id === stock.id)?.name ?? 'the wreck';
}
