// The 3D game: wires input to the sim, the sim and physics to the Three.js view, and the HTML UI.
// Sim time only moves while a turn plays. The path preview runs the same physics the turn will run.

import * as THREE from "three";
import { CONFIG } from "../config";
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
import { applyTurn, type PreparedTurn } from "../phys/turn";
import { playerVehicle, vehicleById } from "../sim/damage";
import { mountedParts } from "../sim/grid";
import { applySiteAction, canLoot, salvageHere } from "../sim/locations";
import { getContextAction } from "../ui/hud-readout";
import { shopAt } from "../sim/market";
import { isStranded, maxTurn, vehicleStats } from "../sim/stats";
import { clickOrder, parkedVehicles, throttleFor } from "../sim/steering";
import { route } from "../sim/path";
import type { ShotRound, Vehicle, World } from "../sim/types";
import { grayRadius, playerSees, tileOf, visibleTiles } from "../sim/vision";
import { dist, type Vec } from "../sim/vec";
import { TERRAIN } from "../data/terrain";
import { isTowed, setBeacon, unhitch } from "../sim/tow";
import { cloneWorld, hostileToPlayer, playerCanAct, setMoveOrder } from "../sim/world";
import { TruckControls } from "./truck-controls";
import { PAL } from "../render/palette";
import { timed } from "../perf";
import { CharacterScreen } from "../ui/character";
import { HitCard } from "../ui/hitCard";
import type { UiHost } from "../ui/host";
import { COMBAT_BLOCKED, Hud } from "../ui/hud";
import { InventoryScreen } from "../ui/inventory";
import { TownScreen, TruckTradeScreen } from "../ui/town";
import { toggleTarget, vehicleMarks, WeaponPanel, weaponsForClick } from "../ui/weapons";
import { CameraRig, KeyPan, TruckFollow } from "./render/camera";
import { addScatter } from "./render/scatter";
import { FogView } from "./render/fog";
import { Fx3D, TruckFx } from "./render/fx";
import { planVolley, projectileOf, towardFrom, type Muzzle } from "./render/projectiles";
import { Labels, VehicleMarkers } from "./render/labels";
import { ObstacleViews } from "./render/obstacles";
import { PathView } from "./render/path";
import { RenderScope, SightLimit } from "./render/scope";
import { addSites } from "./render/sites";
import { terrainMesh } from "./render/terrain";
import { VehicleView, viewOf } from "./render/vehicle";
import { WeaponRangeView } from "./render/weaponRange";
import { WeatherView } from "./render/weather";
import { ZonesView } from "./render/zones";
import { REGION } from "../data/region";
import { isBusy } from "../sim/jobs";
import { daylightAt, lampsOn, lightScene, NightLights, sunLight } from "./render/daylight";
import { sunAt } from "../sim/sun";
import { markError, markVehicle } from "../sim/detect";
import { ContactsView } from "./render/contacts";
import { DustCloudsView } from "./render/dust";
import { ShadeView } from "./render/shade";
import { SoundRingView } from "./render/soundRing";
import { clearSave, hasSave, saveInTown, saveWorld, writeSave } from "./save";
import { GameMenu } from "../ui/game-menu";
import { roundLabel } from "../ui/format";
import { DeathScreen } from "../ui/death";
import { MIX } from "../data/sounds";
import { CombatScore, CombatWatch, computeEngineGlide, SoundDirector, SoundLoops, stingOf } from "./sound";
import type { SoundPlayer } from "../audio/player";
import { uiRoot } from "../ui/dom";
import { Travel, type Playback, type LiveVision } from "./travel";

const PLAN_TURNS = 3; // turns of path preview

const PICK_PX = 30; // click radius around a vehicle's screen position
const MIN_ZONE_HALF_ANGLE = Math.PI / 12; // zones stay visible for trucks that barely turn
const LIVE_VISION_STEP = 0.35; // tiles the truck moves before its sight is recomputed during a turn
// The circle under the hovered vehicle, which a click targets. Sizes are in tiles.
const PICK_RING = { gap: 0.45, width: 0.06, alpha: 0.9, lift: 0.02 };

type TurnPhase = ReturnType<UiHost["getTurnPhase"]>;

const MOVE_MS = (TURN_STEPS / PHYSICS.stepsPerSecond) * 1000; // real time the movement plays over
const MOVED_BY_RULES = 0.5; // tiles between a vehicle's drawn spot and its sim spot that mean the rules moved it

const GUN_HEIGHT = 1.6; // meters above the body center where shots start and land

export class Game {
  private world: World;
  private drive: Drive;
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true });
  private readonly scene = new THREE.Scene();
  private readonly sun = sunLight();
  private readonly sky = new THREE.HemisphereLight();
  private readonly nightLights = new NightLights(this.scene);
  private readonly vignette = Object.assign(document.createElement("div"), {
    className: "vignette",
  });
  private readonly stormTint = Object.assign(document.createElement("div"), {
    className: "storm-tint",
  }); // dust haze while inside a storm
  readonly rig: CameraRig;
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
  private readonly truckFx: TruckFx;
  private readonly controls: TruckControls;
  readonly sound: SoundDirector;
  private panelOpen = false; // last frame's panel state, for open and close sounds
  private readonly loops: SoundLoops;
  private readonly combatWatch = new CombatWatch();
  private readonly views = new Map<string, VehicleView>();
  private frames: Record<string, VehicleFrame> = {}; // last shown pose per vehicle
  // A played turn: physics movement, then shots in flight when there was combat, then time to read results.
  private anim: Playback | null = null;
  private readonly travel = new Travel(CONFIG.travelHoldMs);
  private phase: TurnPhase = null;
  private readonly weaponRange = new WeaponRangeView();
  private readonly markers: VehicleMarkers;
  private readonly overlay: HTMLElement;
  private live: LiveVision | null = null; // the player's view while a turn plays
  private hoverGround: Vec | null = null;
  private hovered: string | null = null;
  private readonly pickRing = new THREE.Mesh(
    new THREE.RingGeometry(1, 1, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      color: PAL.select,
      transparent: true,
      opacity: PICK_RING.alpha,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  private selected: string | null = null;
  private readonly sightLimit: SightLimit;
  readonly follow: TruckFollow;
  private planFor: World | null = null;
  private last = performance.now();
  private idleSince = performance.now(); // when the last turn's playback ended, for the auto turn pace
  // A rescue button pressed while a turn plays runs once the playback ends.
  private pending: ((w: World) => World | null) | null = null;

  private readonly hud: Hud;
  private readonly hitCard: HitCard;
  private readonly weapons: WeaponPanel;
  private readonly town: TownScreen;
  private readonly trade: TruckTradeScreen;
  private readonly character: CharacterScreen;
  private readonly inventory: InventoryScreen;
  private readonly menu: GameMenu;
  private readonly death: DeathScreen;

  constructor(
    world: World,
    container: HTMLElement,
    overlay: HTMLElement,
    player: SoundPlayer,
    private toggleMute: () => void,
  ) {
    this.world = world;
    this.drive = buildDrive(this.world);
    setTimeout(() => this.travel.warm(this.world, this.drive));

    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);
    this.rig = new CameraRig(container);
    this.follow = new TruckFollow(this.rig, new KeyPan(() => this.isEditingControl()), this.renderer.domElement);

    this.scene.background = new THREE.Color(PAL.bg);
    this.renderer.domElement.classList.add("view");
    this.scene.add(this.sky);
    this.scene.add(this.sun, this.sun.target);
    this.pickRing.renderOrder = 5;
    this.scene.add(this.pickRing);

    // Ground and props cull separately, so ground picking only hits terrain and the bridge deck.
    this.sightLimit = new SightLimit(this.world.size);
    const groundScope = new RenderScope(this.ground, this.world.size, this.sightLimit, false, false);
    const propScope = new RenderScope(this.props, this.world.size, this.sightLimit, true, true);
    this.scopes = [groundScope, propScope];
    const groundChunks = terrainMesh(this.world, groundScope);
    addSites(this.world.terrain, propScope);
    this.obstacles = new ObstacleViews(propScope, this.world.terrain);
    this.obstacles.sync(this.world.obstacles, this.world.salvage);
    addScatter(this.world.terrain, this.world.obstacles, propScope);
    this.fog = new FogView(this.world, groundChunks, this.sightLimit);
    this.path = new PathView(this.world.terrain);
    this.shade = new ShadeView(this.world, groundChunks);
    this.weather = new WeatherView(this.world);
    this.scene.add(
      this.ground,
      this.props,
      this.shade.mesh,
      this.weather.root,
      this.zones.root,
      this.path.root,
      this.weaponRange.root,
      this.contacts.root,
      this.dust.root,
      this.soundRing.root,
    );
    this.overlay = overlay;
    this.markers = new VehicleMarkers(overlay, this.rig);
    overlay.append(this.vignette, this.stormTint);
    this.labels = new Labels(overlay);
    this.fx = new Fx3D(this.scene, overlay, this.rig);
    this.truckFx = new TruckFx(this.fx);
    this.controls = new TruckControls({ world: () => this.world, apply: (next) => this.apply(next), refreshPlan: () => this.refreshPlan(), doused: () => { this.truckFx.douse(); this.hud.pushEvents(this.world); }, revved: () => this.loops.rev(playerVehicle(this.world).chassisId) });
    const score = new CombatScore(player, Math.random);
    this.sound = new SoundDirector(player, this.rig, score);
    this.loops = new SoundLoops(player, score);
    uiRoot().addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("button"))
        this.sound.ui("ui-click");
    });

    const host = this.uiHost();
    this.weapons = new WeaponPanel(host);
    this.town = new TownScreen(host);
    this.trade = new TruckTradeScreen(host);
    this.character = new CharacterScreen(host);
    this.inventory = new InventoryScreen(host);
    this.hud = new Hud({
      openInventory: () => this.toggleScreen(this.inventory),
      openCharacter: () => this.toggleScreen(this.character),
      toggleManual: this.whenIdle(() => this.controls.toggleManual()),
      toggleAutoRepair: this.whenIdle(() => this.controls.toggleAutoRepair()),
      toggleOverdrive: this.whenIdle(() => this.controls.toggleOverdrive()),
      douseEngine: this.whenIdle(() => this.controls.douseEngine()),
      unhitch: () =>
        this.rescueCommand((w) =>
          w.player.state === "active" && isTowed(w) ? unhitch(w) : null,
        ),
      setBeacon: (on) =>
        this.rescueCommand((w) =>
          playerCanAct(w) && (!on || isStranded(w, playerVehicle(w)))
            ? setBeacon(w, on)
            : null,
        ),
      isBusy: () => this.anim !== null,
      dialogue: { world: () => this.world, hovered: () => this.hovered, busy: () => this.anim !== null, talk: (next) => this.runRescue(() => next), commit: (next) => { this.world = next; this.refreshUi(); }, log: (next) => this.hud.pushEvents(next), playHorn: (id, delayMs) => this.playHorn(id, delayMs) },
      recenter: () => this.follow.recenter(),
    });
    this.hitCard = new HitCard(this.hud.getInspectionRoot());
    this.menu = new GameMenu({
      save: () => writeSave(window.localStorage, this.world),
      hasSave: () => hasSave(window.localStorage),
      clearSave: () => clearSave(window.localStorage),
      isBusy: () => this.anim !== null,
    });
    this.death = new DeathScreen({
      hasSave: () => hasSave(window.localStorage),
      clearSave: () => clearSave(window.localStorage),
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
      apply: (next) => { this.apply(next); saveInTown(window.localStorage, next); },
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
    this.follow.release();
    this.rig.setZoom(zoom);
    // An infinite step moves the smoothed follow all the way in one tick.
    this.rig.follow(groundPoint(this.world.terrain, { x, y }));
    this.rig.tick(Number.POSITIVE_INFINITY);
    this.rig.follow(null);
  }

  get state(): World { return this.world; }

  // Whether a turn is playing, so the debug console waits instead of changing the world under it.
  get busy(): boolean { return this.anim !== null; }

  apply(next: World): void {
    this.travel.pause();
    this.world = next;
    syncDrive(this.drive, this.world);
    this.refreshUi();
  }

  private resize(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.rig.resize();
  }

  private modalOpen(): boolean {
    return this.town.isOpen() || this.trade.isOpen() || this.character.isOpen() || this.inventory.isOpen() || this.world.player.call !== null;
  }

  // Until a turn's shots land, the panels show the world as it was when the turn began.
  private displayWorld(): World {
    return this.anim && !this.anim.impacts ? this.anim.before : this.world;
  }

  private refreshUi(): void {
    this.menu.refresh();
    const me = playerVehicle(this.world);
    if (
      this.selected &&
      !vehicleStats(this.world, me).weapons.some(
        (mw) => mw.part.id === this.selected,
      )
    )
      this.selected = null;
    if (!this.anim) {
      timed("fog", () => this.fog.update(this.world));
      this.shade.update(this.world);
    }
    if (!this.anim || this.anim.impacts)
      this.obstacles.sync(this.world.obstacles, this.world.salvage);
    this.hud.renderTop(this.displayWorld());
    this.hud.renderRescue(this.displayWorld());
    if (!this.anim && this.world.player.state === "dead") this.death.show();
    this.weapons.render();
    this.town.render();
    this.trade.render();
    this.character.render();
    this.inventory.render();
    this.hud.renderAction(
      getContextAction(this.world, this.anim !== null),
      this.displayWorld(),
      () => this.useContext(),
    );
    this.refreshInfo();
    this.refreshTargetMarkers();
  }

  private useContext(): void {
    if (this.anim || !playerCanAct(this.world)) return;
    if (this.trade.openIfReady()) return;
    return shopAt(this.world) ? this.town.open() : this.useSite();
  }

  // A search that a hostile in sight blocks says so in the log.
  private noteCombatBlock(): boolean {
    if (!getContextAction(this.world, false)?.combat) return false;
    this.hud.note(this.world, COMBAT_BLOCKED, "bad");
    return true;
  }

  private useSite(): void {
    if (this.inventory.openDowned(this.world) || isBusy(playerVehicle(this.world)) || this.noteCombatBlock()) return;
    const after = applySiteAction(this.world);
    if (after) {
      this.apply(after);
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

  // Ground point of the order the truck drives, or null without one. While a turn plays, the order
  // is the one the turn started with, since the turn may have finished it.
  private orderPoint(): V3 | null {
    const order = playerVehicle(this.anim ? this.anim.before : this.world).order;
    return order === null || order.kind === "brake" ? null : groundPoint(this.world.terrain, order.dest);
  }

  private refreshTargetMarkers(): void {
    this.markers.refresh(vehicleMarks(this.displayWorld(), this.hovered));
  }

  private isEditingControl(): boolean {
    return document.activeElement?.matches("input, select, textarea") ?? false;
  }

  // Input: left click orders or targets, wheel zooms, keys like the 2D game.
  private bindInput(): void {
    const canvas = this.renderer.domElement;
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("pointerdown", (e) => {
      if (e.button === 0) this.onLeftClick(e);
    });
    window.addEventListener("pointermove", (e) => {
      if (e.target === canvas) this.onHover(e);
    });
    canvas.addEventListener("wheel", (e) => this.rig.zoomBy(e.deltaY), { passive: true });
    window.addEventListener("keyup", (e) => {
      if (e.code === "Space") this.travel.release();
    });
    window.addEventListener("blur", () => this.travel.pause());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.travel.pause();
    });
    window.addEventListener("keydown", (e) => {
      if (this.isEditingControl() || this.death.isShown()) return;
      const modal = this.modalOpen();
      const playing = this.travel.isPlaying(this.anim);
      if (e.code === "Space") {
        if (!modal && this.travel.handleSpace(e, playing, this.world)) this.endTurn();
      }
      const key = this.keys[e.code];
      if (key && !(key.noModal && modal) && !(key.idle && playing)) key.run();
      const digit = ["Digit1", "Digit2", "Digit3", "Digit4"].indexOf(e.code);
      if (digit >= 0) this.selectWeaponIndex(digit);
    });
  }

  // Single-key actions. noModal keys wait for panels and calls to close, idle keys wait for the turn to finish playing.
  private readonly keys: Record<string, { run: () => void; noModal?: true; idle?: true }> = {
    KeyF: { run: () => this.follow.recenter() },
    KeyM: { run: () => this.toggleMute() },
    KeyQ: { run: () => this.weapons.toggleAuto(), noModal: true },
    KeyX: { run: () => this.weapons.toggleVisible(), noModal: true },
    Digit0: { run: () => this.weapons.selectWeapon(null), noModal: true },
    KeyE: { run: () => this.useContext(), noModal: true },
    KeyR: { run: () => this.controls.toggleManual(), noModal: true, idle: true },
    KeyP: { run: () => this.controls.toggleAutoRepair(), noModal: true, idle: true },
    KeyO: { run: () => this.controls.toggleOverdrive(), noModal: true, idle: true },
    KeyG: { run: () => this.controls.douseEngine(), noModal: true, idle: true },
    KeyN: { run: () => this.hovered && !markError(this.world, this.hovered) && this.apply(markVehicle(this.world, this.hovered)), noModal: true, idle: true },
    KeyC: { run: () => this.toggleScreen(this.character), idle: true },
    KeyI: { run: () => this.toggleScreen(this.inventory), idle: true },
    Escape: { run: () => this.closeScreens(null) },
  };

  private closeScreens(keep: CharacterScreen | InventoryScreen | null): void {
    for (const s of [this.town, this.trade, this.character, this.inventory]) if (s !== keep) s.close();
  }

  private toggleScreen(screen: CharacterScreen | InventoryScreen): void {
    if (this.anim) return;
    this.closeScreens(screen);
    screen.toggle();
  }

  // A HUD button action that waits for the turn to finish playing and for panels and calls to close.
  private whenIdle(run: () => void): () => void {
    return () => void (!this.anim && !this.modalOpen() && run());
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
    if (this.anim || this.modalOpen() || !playerCanAct(this.world)) return;
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
    if (p) this.apply(setMoveOrder(this.world, clickOrder(p, e.shiftKey, playerVehicle(this.world))));
  }

  private targetVehicle(target: Vehicle): void {
    this.apply(toggleTarget(this.world, weaponsForClick(this.world, this.selected), target));
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
    return (
      seen !== undefined && this.world.turn - seen <= TERRAIN.vision.lingerTurns
    );
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
    this.hoverGround =
      id || this.modalOpen()
        ? null
        : this.rig.groundUnder(e.clientX, e.clientY, this.ground);
    if (id === this.hovered) return;
    this.hovered = id;
    this.refreshInfo();
    this.refreshTargetMarkers();
  }

  endTurn(): void {
    if (this.travel.isPlaying(this.anim) || this.modalOpen() || this.world.player.state === "dead") return;
    this.travel.request(this.world, this.drive);
  }

  private updateTravel(): void {
    const danger = this.world.vehicles.some(
      (v) => hostileToPlayer(this.world, v) && this.isVehicleVisible(v),
    );
    this.follow.noteDanger(danger);
    this.travel.updateWorld(this.world, danger);
  }

  private beginTurn(
    prepared: PreparedTurn,
    now: number,
    elapsed: number,
  ): void {
    const { world, playback, towed } = this.travel.beginPlayback(this.world, prepared, now, elapsed);
    this.world = world;
    this.anim = playback;
    this.live = {
      visible: new Set(this.world.player.visible),
      explored: playback.before.player.explored.slice(),
      from: null,
    };
    playback.combat = this.world.events.some(
      (e) =>
        (e.t === "shot" &&
          this.eventPoint(e.shooter) !== null &&
          this.eventPoint(e.target) !== null) ||
        (e.t === "guardShot" && this.eventPoint(e.target) !== null),
    );
    // Crashes are known now, so the score can time its accent's peak onto the impact at the end of movement.
    this.sound.accents(world.events, world.player.vehicleId, (e) => (e.t === "collision" ? Math.max(0, MOVE_MS - elapsed) : null));
    // A towed truck's engine is off.
    if (!towed) this.playDriveSound(playback.result);
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
    this.phase = a.combat ? "Firing" : "Results";
    timed("fog", () => this.fog.update(this.combatFogWorld()));
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
    const searched = this.world.events.find((e) => e.t === "searched");
    if (searched) this.inventory.openLoot(searched.stock);
    this.refreshUi();
  }

  private finishPlayback(): void {
    this.anim = null;
    this.phase = null;
    this.idleSince = performance.now();
    saveWorld(window.localStorage, this.world, CONFIG.saveTurns);
    const pending = this.pending;
    this.pending = null;
    if (pending) this.runRescue(pending);
    this.hud.flushHorn();
    this.refreshUi();
  }

  // Tow and beacon buttons stay live while turns run on their own. A press during playback waits for its end.
  private rescueCommand(fn: (w: World) => World | null): void {
    if (this.modalOpen()) return;
    if (this.anim) {
      this.pending = fn;
      return;
    }
    this.runRescue(fn);
  }

  // The command returns null when the world changed since the press and it no longer applies.
  private runRescue(fn: (w: World) => World | null): void {
    const next = fn(this.world);
    if (!next) return this.refreshUi();
    this.apply(next);
    this.hud.pushEvents(this.world);
  }

  // Turns run on their own while the player is knocked out, towed or waiting on the beacon.
  private autoTurn(now: number): void {
    if (this.anim || this.modalOpen() || this.world.player.state === "dead")
      return;
    if (!this.travel.autoAllowed(this.world) || now - this.idleSince < CONFIG.autoTurnMs)
      return;
    this.endTurn();
  }

  private playHorn(id: string, delayMs: number): void {
    const v = vehicleById(this.world, id), f = this.frames[v.id] ?? restFrame(this.world, v);
    this.sound.honk({ x: f.pos.x, y: f.pos.y + GUN_HEIGHT, z: f.pos.z }, delayMs, v.chassisId);
  }

  // Explosions and broken parts where they happen, then one result sting for the turn.
  private playImpactSounds(): void {
    for (const e of this.world.events) {
      const id =
        e.t === "destroyed" || e.t === "partDisabled" ? e.vehicle : null;
      const p = id && this.eventPoint(id);
      if (p)
        this.sound.at(e.t === "destroyed" ? "explosion" : "part-broken", p, 0);
    }
    const sting = stingOf(this.world.events, playerVehicle(this.world).id);
    if (sting) this.sound.ui(sting);
  }

  private playDriveSound(result: TurnResult): void {
    const frames = result.frames[playerVehicle(this.world).id];
    const g = computeEngineGlide(frames, MOVE_MS / 1000, MIX, this.world.player.overdrive);
    if (!g) return;
    this.loops.drive(g, playerVehicle(this.world).chassisId);
    if (g.brake) this.sound.at("air-brake", frames[0].pos, 0);
  }

  private updateLoops(): void {
    const me = playerVehicle(this.world);
    const f = this.frames[me.id];
    const at = f ? toMap(f.pos) : me.pos;
    const signs = this.combatWatch.observe(this.world.turn, this.world.vehicles.filter((v) => hostileToPlayer(this.world, v) && this.isVehicleVisible(v)).map((v) => v.id));
    this.loops.update({ stormTiles: this.weather.stormTilesFrom(at.x, at.y), ...signs, paused: !this.anim && performance.now() - this.idleSince > MIX.music.pauseDelayMs });
    if (signs.sighted) this.sound.accent("accent-sighted", 0);
  }

  private playPanelSounds(): void {
    const open = this.modalOpen();
    if (open !== this.panelOpen) this.sound.ui(open ? (this.world.player.call ? "radio" : "ui-open") : "ui-close");
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
    for (const e of w.events) {
      if (e.t === "shot") {
        const a = this.eventPoint(e.shooter);
        const b = this.eventPoint(e.target);
        if (!a || !b) continue;
        const shooter =
          w.vehicles.find((x) => x.id === e.shooter) ??
          w.removed.find((x) => x.id === e.shooter);
        const gun = shooter && mountedParts(shooter).find((p) => p.id === e.weapon);
        if (!gun) throw new Error(`Shot from ${e.shooter} names no mounted weapon ${e.weapon}`);
        const view = viewOf(this.views, e.shooter);
        const landMs = this.playVolley(a, () => view.muzzle(e.weapon), b, e.rounds, gun.defId, e.target, rows);
        this.sound.accents([e], w.player.vehicleId, () => landMs);
      }
      if (e.t === "guardShot") {
        const b = this.eventPoint(e.target);
        if (!b) continue;
        const g = groundPoint(this.world.terrain, e.from);
        const a = {
          x: g.x,
          y:
            g.y +
            (REGION.settlement.guardTowerHeight + 0.2) * PHYSICS.metersPerTile,
          z: g.z,
        };
        const landMs = this.playVolley(a, () => towardFrom(a, b), b, e.rounds, "guard", e.target, rows);
        this.sound.accents([e], w.player.vehicleId, () => landMs);
      }
      if (e.t === "collision") {
        const p = this.eventPoint(e.a);
        if (p) this.fx.crash(p);
        if (p) this.sound.at("crash", p, 0);
      }
    }
  }

  // Plays one volley's bolts from the muzzle and sounds from a to b. Each round that damages parts shows its
  // damage over the target as it lands.
  private playVolley(
    a: V3,
    muzzle: () => Muzzle,
    b: V3,
    rounds: ShotRound[],
    weapon: string,
    targetId: string,
    rows: Map<string, number>,
  ): number {
    // Every round lands within the shot time, before the results show.
    const spec = projectileOf(weapon);
    const ground = (p: V3) => groundPoint(this.world.terrain, toMap(p)).y;
    const plans = planVolley(spec, a, b, rounds, CONFIG.combatShotMs, ground);
    plans.forEach((plan, k) => {
      this.fx.shot(spec, muzzle, plan);
      this.sound.at(spec.look === "tracer" ? "mg-fire" : "cannon-fire", a, plan.delayMs);
      this.sound.at(plan.struck ? "hit-metal" : "miss", plan.land, plan.delayMs + plan.flightMs);
      const label = roundLabel(this.world, targetId, rounds[k]);
      if (!label) return;
      const row = rows.get(targetId) ?? 0;
      rows.set(targetId, row + 1);
      this.fx.label(b, label, PAL.damageText, row, plan.delayMs + plan.flightMs, CONFIG.combatReadMs);
    });
    return Math.min(...plans.map((plan) => plan.delayMs + plan.flightMs)); // when the first round lands
  }

  // The path preview chains physics turns from the current state, so it shows what will happen.
  private refreshPlan(): void {
    if (
      this.travel.isAdvancing(this.anim, this.last) ||
      this.planFor === this.world
    )
      return;
    this.planFor = this.world;
    // A knocked-out or towed truck takes no orders, and a towed one has no body to preview.
    if (!playerCanAct(this.world)) return this.path.clear();
    const me = playerVehicle(this.world);
    if (!me.order && me.speed === 0) return this.path.clear();
    timed("preview", () => this.planPath(me));
  }

  private planPath(me: Vehicle): void {
    const turns: VehicleFrame[][] = [];
    const w = cloneWorld(this.world);
    let d = this.drive;
    let v = me;
    for (let i = 0; i < PLAN_TURNS; i++) {
      const r = simulateTurn(d, w);
      turns.push(r.frames[me.id]);
      w.events = [];
      applyTurn(w, r);
      if (d !== this.drive) freeDrive(d);
      d = r.next;
      v = w.vehicles.find((x) => x.id === me.id)!;
      if (!v.order && v.speed < 0.05) break;
    }
    if (d !== this.drive) freeDrive(d);
    // A course longer than the simulated turns continues as the route the driver will take.
    const order = v.order?.kind === "brake" ? null : v.order;
    const course = order
      ? v.direct
        ? [v.pos, order.dest]
        : [
            v.pos,
            ...route(w, v.pos, order.dest, vehicleStats(w, v).radius, parkedVehicles(w, v.id), v),
          ]
      : null;
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
    this.path.set(turns, first, course, !v.direct);
  }

  private advanceTurn(now: number): { step: number | null; speed: number } {
    if (this.modalOpen() || this.isEditingControl() || document.hidden)
      this.travel.pause();
    const speed = this.travel.getSpeed(now, CONFIG.travelFastSpeed);
    const wasPlaying = this.anim !== null;
    let step = this.animStep(now, speed);
    this.updateLiveVision();
    this.updateTravel();
    const prepared = this.anim ? null : this.travel.takeReady(this.world, this.drive, now);
    if (prepared) {
      this.beginTurn(prepared, now, this.travel.getRemainder(wasPlaying));
      step = this.animStep(now, speed);
      this.updateTravel();
    }
    this.travel.prepareNext(this.world, this.anim, now);
    return { step, speed };
  }

  private tick(now: number): void {
    // Outside dev the next frame is booked first, so an error in this frame does not stop the game.
    if (!import.meta.env.DEV) requestAnimationFrame((t) => this.tick(t));
    this.frame(now);
    if (import.meta.env.DEV) requestAnimationFrame((t) => this.tick(t));
  }

  private frame(now: number): void {
    const dt = now - this.last;
    this.last = now;
    const { step, speed } = this.advanceTurn(now);
    // The first frame's rAF time can come before the performance.now() the clock started from.
    this.syncVehicles(step, Math.max(0, dt) / 1000);
    this.drawOverlays();
    // syncVehicles gives every vehicle a frame, the player's included.
    const truck = this.frames[playerVehicle(this.world).id].pos;
    // Gray vision centers on the drawn truck, so its edge moves with the truck while a turn plays. The
    // camera cannot pan past it.
    const sightRadius = grayRadius(this.world, playerVehicle(this.world).pos) * PHYSICS.metersPerTile;
    this.sightLimit.set(truck, sightRadius);
    this.rig.leash(truck, sightRadius);
    this.follow.update(truck, this.hud.cameraMode === "auto" ? this.orderPoint() : null, this.anim !== null, dt);
    this.hud.showRecenter(!this.follow.isFollowing());
    lightScene(this.sun, this.sky, truck, daylightAt(this.lightTurn()));
    const lit = this.world.vehicles
      .filter((v) => this.frames[v.id] && this.sightLimit.reaches(this.frames[v.id].pos))
      .map((v) => ({ chassisId: v.chassisId, frame: this.frames[v.id], on: lampsOn(v.id, this.lightTurn()) }));
    // At dawn lamps switch off one by one, so the night lights stay until the last one is off.
    this.nightLights.update(!sunAt(this.world.turn) || lit.some((v) => v.on), truck, lit);
    const at = playerVehicle(this.world).pos;
    this.stormTint.style.display = this.world.weather.some(
      (e) => e.kind === "storm" && dist(at, e.pos) <= e.radius,
    )
      ? ""
      : "none";
    this.fx.tick(dt * speed);
    this.playPanelSounds();
    this.updateLoops();
    this.weather.advance(dt);
    this.weather.sync(this.world);
    this.labels.update(this.world, this.rig, this.sightLimit);
    for (const scope of this.scopes) scope.update(this.rig.camera);
    this.renderer.render(this.scene, this.rig.camera);
    // The preview runs after the frame is drawn, so a click shows at once.
    this.refreshPlan();
    this.autoTurn(now);
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
    const player = {
      ...this.world.player,
      visible: [...live.visible].sort((a, b) => a - b),
      explored: live.explored,
    };
    timed("fog", () => this.fog.update({ ...this.world, player }));
  }

  // The clock the light shows. While a turn's movement plays it glides from the previous turn to this one,
  // so the sun moves and changes color continuously instead of once per turn.
  private lightTurn(): number {
    const a = this.anim;
    if (!a) return this.world.turn;
    return this.world.turn - 1 + Math.min(1, a.elapsed / MOVE_MS);
  }

  // Physics step shown now while the movement plays, or null otherwise. Advances the playback phases.
  private animStep(now: number, speed: number): number | null {
    const a = this.anim;
    if (!a) return null;
    const elapsed = this.travel.advanceClock(a, now, speed);
    if (elapsed < MOVE_MS)
      return Math.floor((elapsed / 1000) * PHYSICS.stepsPerSecond);
    if (!a.moved) this.finishMovement(a);
    const impactAt = MOVE_MS + (a.combat ? CONFIG.combatShotMs : 0);
    if (elapsed >= impactAt && !a.impacts) this.landImpacts(a);
    const finishAt = impactAt + (a.combat ? CONFIG.combatReadMs : 0);
    if (elapsed >= finishAt) {
      this.travel.finishClock(elapsed, finishAt);
      this.finishPlayback();
    }
    return null;
  }

  // dt: seconds since the last drawn frame.
  private syncVehicles(step: number | null, dt: number): void {
    const frames: TurnFrames | null = step === null || !this.anim ? null : this.anim.result.frames;
    const landed = !this.anim || this.anim.impacts;
    const glass = daylightAt(this.lightTurn()).glass;
    const shown = [...this.world.vehicles, ...(landed ? [] : this.world.removed)];
    const ids = new Set<string>();
    for (const v of shown) {
      const kept = this.frames[v.id];
      // Between turns, a vehicle moved outside a turn, such as by a debug script, jumps to its new spot.
      const stale = !this.anim && kept && dist(toMap(kept.pos), v.pos) > MOVED_BY_RULES;
      const f = frames?.[v.id]?.[step!] ?? (kept && !stale ? kept : restFrame(this.world, v));
      this.frames[v.id] = f;
      const seen = landed ? this.isVehicleVisible(v) : this.canShowCombatVehicle(v);
      if (seen) this.lastSeen.set(v.id, this.world.turn);
      const look = this.lookOf(v, f, seen);
      if (!look) continue;
      const before = !landed && this.anim!.before.vehicles.find((x) => x.id === v.id);
      const display = before ? { ...v, items: before.items } : v;
      ids.add(v.id);
      let view = this.views.get(v.id);
      if (!view) {
        view = new VehicleView(v, seen);
        this.views.set(v.id, view);
        this.scene.add(view.root);
      }
      view.update(display, seen);
      view.lamps(lampsOn(v.id, this.lightTurn()));
      view.outline(look === "dark");
      view.windows(glass);
      view.pose(f, dt);
      view.aim((partId) => this.turretAim((before || v).weaponOrders, f, partId));
      this.truckFx.emit(this.world, display, f, frames !== null, dt);
    }
    for (const [id, view] of this.views) {
      if (ids.has(id)) continue;
      this.scene.remove(view.root);
      view.dispose();
      this.views.delete(id);
    }
  }

  // Out of sight at night, a truck in gray vision shows its lit lamps on a black shape.
  private lookOf(v: Vehicle, f: VehicleFrame, seen: boolean): "full" | "dark" | null {
    if (seen || this.lingers(v)) return "full";
    return lampsOn(v.id, this.lightTurn()) && this.sightLimit.reaches(f.pos) ? "dark" : null;
  }

  // A turret points at its own ordered target, else at the first ordered target. While a turn plays,
  // orders come from the turn's start, so turrets keep aim at what they fire on.
  private turretAim(orders: Vehicle["weaponOrders"], f: VehicleFrame, partId: string): number | null {
    const order = orders[partId] ?? Object.values(orders)[0];
    const target = order && this.frames[order.targetId];
    return target
      ? Math.atan2(target.pos.z - f.pos.z, target.pos.x - f.pos.x)
      : null;
  }

  // The ring is rebuilt only when the hovered vehicle's radius changes.
  private placePickRing(hide: boolean): void {
    const v =
      this.hovered && this.hovered !== playerVehicle(this.world).id
        ? this.world.vehicles.find((x) => x.id === this.hovered)
        : undefined;
    const f = v && this.frames[v.id];
    this.pickRing.visible = !hide && !!f;
    if (!v || !f || hide) return;
    const S = PHYSICS.metersPerTile;
    const r = vehicleStats(this.world, v).radius + PICK_RING.gap;
    const geo = this.pickRing.geometry;
    if (geo.parameters.outerRadius !== (r + PICK_RING.width / 2) * S) {
      geo.dispose();
      this.pickRing.geometry = new THREE.RingGeometry(
        (r - PICK_RING.width / 2) * S,
        (r + PICK_RING.width / 2) * S,
        48,
      ).rotateX(-Math.PI / 2);
    }
    const p = groundPoint(this.world.terrain, toMap(f.pos));
    this.pickRing.position.set(p.x, p.y + PICK_RING.lift * S, p.z);
  }

  private drawOverlays(): void {
    const hide =
      this.travel.isAdvancing(this.anim, this.last) || this.modalOpen();
    // Steering zones and the path preview only help a driver who can give orders.
    const steer = !hide && playerCanAct(this.world);
    this.zones.root.visible = steer;
    this.path.show(steer, this.displayWorld(), this.modalOpen());
    this.weaponRange.root.visible = false;
    this.markers.place(this.frames, hide, this.modalOpen());
    this.placeHitCard();
    this.placePickRing(hide);
    this.contacts.update(
      this.world.terrain,
      this.world.player.contacts,
      playerVehicle(this.world).pos,
      this.world.turn,
      performance.now(),
    );
    this.dust.update(this.world, this.world.terrain, performance.now());
    const meFrame = this.frames[playerVehicle(this.world).id];
    this.soundRing.update(
      this.world.terrain,
      this.world.player.contacts,
      meFrame ? toMap(meFrame.pos) : playerVehicle(this.world).pos,
      this.world.turn,
      performance.now(),
    );
    if (hide) return;
    const me = playerVehicle(this.world);
    const s = vehicleStats(this.world, me);
    const sel = s.weapons.filter((m) => m.part.id === this.selected);
    this.weaponRange.set(this.world.terrain, me.pos, me.heading, sel);
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

