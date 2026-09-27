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
import { applyTurn, type PreparedTurn } from "../phys/turn";
import { playerVehicle, vehicleById } from "../sim/damage";
import { corePart, mountedParts } from "../sim/grid";
import { applySiteAction, canLoot, salvageHere } from "../sim/locations";
import { getContextAction } from "../ui/hud-readout";
import { townAt } from "../sim/sites";
import { isStranded, maxTurn, vehicleStats } from "../sim/stats";
import { clickOrder, parkedVehicles, throttleFor } from "../sim/steering";
import { route, warmRoutes } from "../sim/path";
import { CHASSIS } from "../data/chassis";
import type { ShotRound, Vehicle, World } from "../sim/types";
import type { Vec } from "../sim/vec";
import { grayRadius, playerSees, tileOf, visibleTiles } from "../sim/vision";
import { DEG, dist } from "../sim/vec";
import { TERRAIN } from "../data/terrain";
import { isTowed, setBeacon, unhitch } from "../sim/tow";
import {
  autoRuns,
  cloneWorld,
  hostileToPlayer,
  newWorld,
  playerCanAct,
  setAutoRepair,
  setDirect,
  setMoveOrder,
} from "../sim/world";
import { PAL } from "../render/palette";
import { timed } from "../perf";
import { CharacterScreen } from "../ui/character";
import { HitCard } from "../ui/hitCard";
import type { UiHost } from "../ui/host";
import { Hud } from "../ui/hud";
import { InventoryScreen } from "../ui/inventory";
import { TownScreen } from "../ui/town";
import { toggleTarget, vehicleMarks, WeaponPanel, weaponsForClick } from "../ui/weapons";
import { CameraRig, KeyPan, TruckFollow } from "./render/camera";
import { addScatter } from "./render/scatter";
import { FogView } from "./render/fog";
import { Fx3D } from "./render/fx";
import { Labels, VehicleMarkers } from "./render/labels";
import { ObstacleViews } from "./render/obstacles";
import { PathView } from "./render/path";
import { RenderScope, SightLimit } from "./render/scope";
import { addSites } from "./render/sites";
import { terrainMesh } from "./render/terrain";
import { VehicleView } from "./render/vehicle";
import { WeaponRangeView } from "./render/weaponRange";
import { WeatherView } from "./render/weather";
import { ZonesView } from "./render/zones";
import { REGION } from "../data/region";
import { TERRAIN_TYPES } from "../data/terrain";
import { bodyOf } from "../sim/body";
import { headingOf } from "../phys/frames";
import { isBusy } from "../sim/jobs";
import { daylightAt, lightScene, sunLight } from "./render/daylight";
import { sunAt } from "../sim/sun";
import { tileAt } from "../sim/terrain";
import { ContactsView } from "./render/contacts";
import { DustCloudsView } from "./render/dust";
import { ShadeView } from "./render/shade";
import { SoundRingView } from "./render/soundRing";
import { clearSave, hasSave, loadWorld, saveWorld, writeSave } from "./save";
import { GameMenu } from "../ui/game-menu";
import { DeathScreen } from "../ui/death";
import { MIX } from "../data/sounds";
import { computeEngineGlide, SoundDirector, SoundLoops, stingOf } from "./sound";
import type { SoundPlayer } from "../audio/player";
import { uiRoot } from "../ui/dom";
import { Travel, type Playback, type LiveVision } from "./travel";
import { computeRoundPoint } from "../phys/frames";

const PLAN_TURNS = 3; // turns of path preview

const HONK_REPLY_MS = 500; // a driver takes a moment to answer a horn
const PICK_PX = 30; // click radius around a vehicle's screen position
const MIN_ZONE_HALF_ANGLE = Math.PI / 12; // zones stay visible for trucks that barely turn
const DUST_CHANCE = 0.3; // per moving vehicle per frame while a turn plays, times the ground's dust value
const DUST_BEHIND_M = 0.4; // meters behind the body's rear where wheel dust rises
const SMOKE_CHANCE = 0.05; // per hurt vehicle per frame
const HURT_CAB = 0.35; // cab hp share under which a vehicle smokes
const LIVE_VISION_STEP = 0.35; // tiles the truck moves before its sight is recomputed during a turn
// The circle under the hovered vehicle, which a click targets. Sizes are in tiles.
const PICK_RING = { gap: 0.45, width: 0.06, alpha: 0.9, lift: 0.02 };

// Headlight beams at night for every vehicle within gray vision, also one the player cannot see.
const BEAM_COLOR = 0xfff2c8;
const BEAM_INTENSITY = 25; // lit only at night
const BEAM_DECAY = 0.4; // below the physical 2, so the ground by the nose does not burn white
const BEAM_RANGE = 70; // meters where the light fades to nothing
const BEAM_ANGLE = 42 * DEG; // half-angle of the cone
const BEAM_PENUMBRA = 0.6; // soft share of the cone edge
const BEAM_HEIGHT = 4; // meters above the truck center where the beam starts
const BEAM_AIM = { ahead: 30, down: 6 }; // meters ahead of the nose and below the truck center the beam points at

type TurnPhase = ReturnType<UiHost["getTurnPhase"]>;

const MOVE_MS = (TURN_STEPS / PHYSICS.stepsPerSecond) * 1000; // real time the movement plays over
const MOVED_BY_RULES = 0.5; // tiles between a vehicle's drawn spot and its sim spot that mean the rules moved it

const GUN_HEIGHT = 1.6; // meters above the body center where shots start and land
const ROUND_STAGGER = 0.4; // share of the shot time over which a burst's rounds leave the gun

export class Game {
  private world: World;
  private drive: Drive;
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true });
  private readonly scene = new THREE.Scene();
  private readonly sun = sunLight();
  private readonly sky = new THREE.HemisphereLight();
  private readonly beams: THREE.SpotLight[] = [];
  private readonly vignette = Object.assign(document.createElement("div"), {
    className: "vignette",
  });
  private readonly stormTint = Object.assign(document.createElement("div"), {
    className: "storm-tint",
  }); // dust haze while inside a storm
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
  private readonly follow: TruckFollow;
  private planFor: World | null = null;
  private last = performance.now();
  private idleSince = performance.now(); // when the last turn's playback ended, for the auto turn pace
  // A rescue button pressed while a turn plays runs once the playback ends.
  private pending: ((w: World) => World | null) | null = null;

  private readonly hud: Hud;
  private readonly hitCard: HitCard;
  private readonly weapons: WeaponPanel;
  private readonly town: TownScreen;
  private readonly character: CharacterScreen;
  private readonly inventory: InventoryScreen;
  private readonly menu: GameMenu;
  private readonly death: DeathScreen;

  constructor(
    container: HTMLElement,
    overlay: HTMLElement,
    player: SoundPlayer,
    private toggleMute: () => void,
  ) {
    this.world =
      loadWorld(window.localStorage) ??
      newWorld(CONFIG.seed, startKit(CONFIG.startKit));
    this.drive = buildDrive(this.world);
    warmRoutes(this.world, [
      ...new Set(Object.values(CHASSIS).map((c) => c.radius)),
    ]);

    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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

    // Ground and props cull separately, so ground picking only hits terrain.
    this.sightLimit = new SightLimit(this.world.size);
    const groundScope = new RenderScope(this.ground, this.world.size, this.sightLimit, false);
    const propScope = new RenderScope(this.props, this.world.size, this.sightLimit, true);
    this.scopes = [groundScope, propScope];
    const groundChunks = terrainMesh(this.world, groundScope);
    addSites(this.world.terrain, propScope);
    this.obstacles = new ObstacleViews(propScope, this.world.terrain);
    this.obstacles.sync(this.world.obstacles, this.world.salvage);
    addScatter(this.world.terrain, this.world.obstacles, propScope);
    this.fog = new FogView(this.world, groundChunks, this.sightLimit);
    this.path = new PathView(this.world.terrain);
    this.shade = new ShadeView(this.world);
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
    this.sound = new SoundDirector(player, this.rig);
    this.loops = new SoundLoops(player);
    uiRoot().addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("button"))
        this.sound.ui("ui-click");
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
      toggleAutoRepair: () => {
        if (!this.anim && !this.modalOpen()) this.toggleAutoRepair();
      },
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
      dialogue: { world: () => this.world, hovered: () => this.hovered, busy: () => this.anim !== null, talk: (next) => this.runRescue(() => next), honked: () => this.playHonks() },
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
    return this.town.isOpen() || this.character.isOpen() || this.inventory.isOpen() || this.world.player.call !== null;
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
    this.character.render();
    this.inventory.render();
    this.hud.renderAction(
      getContextAction(this.world, this.anim !== null),
      playerVehicle(this.displayWorld()).job,
      () => this.useContext(),
    );
    this.refreshInfo();
    this.refreshTargetMarkers();
  }

  private useContext(): void {
    if (this.anim || !playerCanAct(this.world)) return;
    if (townAt(this.world)) return this.town.open();
    if (isBusy(playerVehicle(this.world))) return;
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
    this.markers.refresh(this.anim ? null : vehicleMarks(this.world, this.hovered));
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
      if (e.code === "KeyF") this.follow.recenter();
      if (e.code === "KeyM") this.toggleMute();
      if (e.code === "KeyQ" && !modal) this.weapons.toggleAuto();
      if (e.code === "KeyX" && !modal) this.weapons.toggleVisible();
      if (e.code === "Digit0" && !modal) this.weapons.selectWeapon(null);
      if (e.code === "KeyE" && !modal) this.useContext();
      if (e.code === "KeyR" && !modal && !playing) this.toggleManual();
      if (e.code === "KeyP" && !modal && !playing) this.toggleAutoRepair();
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
    if (!playerCanAct(this.world)) return;
    this.apply(setDirect(this.world, !playerVehicle(this.world).direct));
    this.refreshPlan();
  }

  private toggleAutoRepair(): void {
    this.apply(setAutoRepair(this.world, !this.world.player.autoRepair));
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
    if (!autoRuns(this.world) || now - this.idleSince < CONFIG.autoTurnMs)
      return;
    this.endTurn();
  }

  // Explosions and broken parts where they happen, then one result sting for the turn.
  // The player's horn at once, then each answer a beat later, nearest first. Answers come only from earshot, so unseen trucks are heard.
  private playHonks(): void {
    this.world.events.filter((e) => e.t === "honk").forEach((e, i) => {
      const v = vehicleById(this.world, e.vehicle), f = this.frames[v.id] ?? restFrame(this.world, v);
      this.sound.honk({ x: f.pos.x, y: f.pos.y + GUN_HEIGHT, z: f.pos.z }, i * HONK_REPLY_MS, v.chassisId);
    });
  }

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
    const g = computeEngineGlide(frames, MOVE_MS / 1000, MIX);
    if (!g) return;
    this.loops.drive(g, playerVehicle(this.world).chassisId);
    if (g.brake) this.sound.at("air-brake", frames[0].pos, 0);
  }

  private updateLoops(): void {
    const me = playerVehicle(this.world);
    const f = this.frames[me.id];
    const at = f ? toMap(f.pos) : me.pos;
    if (
      this.world.vehicles.some(
        (v) => hostileToPlayer(this.world, v) && this.isVehicleVisible(v),
      )
    )
      this.lastDangerTurn = this.world.turn;
    this.loops.update({
      stormTiles: this.weather.stormTilesFrom(at.x, at.y),
      turnsSinceDanger: this.world.turn - this.lastDangerTurn,
    });
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
        const a = {
          x: g.x,
          y:
            g.y +
            (REGION.settlement.guardTowerHeight + 0.2) * PHYSICS.metersPerTile,
          z: g.z,
        };
        const hits = e.rounds.filter((r) => r.hit).length;
        const dealt = e.rounds
          .flatMap((r) => r.hits)
          .reduce((sum, h) => sum + h.damage, 0);
        this.playVolley(
          a,
          b,
          e.rounds,
          false,
          `Guards ${hits}/${e.rounds.length}${dealt > 0 ? ` −${dealt}` : ""}`,
          e.target,
          rows,
        );
      }
      if (e.t === "collision") {
        const p = this.eventPoint(e.a);
        if (p) this.fx.crash(p);
        if (p) this.sound.at("crash", p, 0);
      }
    }
  }

  // Plays one volley's bolts and sounds from a to b, then its result label over the target.
  private playVolley(
    a: V3,
    b: V3,
    rounds: ShotRound[],
    heavy: boolean,
    label: string,
    targetId: string,
    rows: Map<string, number>,
  ): void {
    const hits = rounds.filter((r) => r.hit).length;
    const row = rows.get(targetId) ?? 0;
    rows.set(targetId, row + 1);
    // Round starts spread over the first part of the shot time, so every bolt lands before the results show.
    const flight = CONFIG.combatShotMs * (1 - ROUND_STAGGER);
    rounds.forEach((r, k) => {
      const delay =
        rounds.length > 1
          ? (k / (rounds.length - 1)) * CONFIG.combatShotMs * ROUND_STAGGER
          : 0;
      const land = computeRoundPoint(a, b, r.offset);
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
    this.aimBeams(!sunAt(this.world.turn));
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
      // Between turns, a vehicle moved outside a turn, such as by a debug script, jumps to its new spot.
      const stale =
        !this.anim && kept && dist(toMap(kept.pos), v.pos) > MOVED_BY_RULES;
      const f =
        frames?.[v.id]?.[step!] ??
        (kept && !stale ? kept : restFrame(this.world, v));
      this.frames[v.id] = f;
      const seen = landed
        ? this.isVehicleVisible(v)
        : this.canShowCombatVehicle(v);
      if (seen) this.lastSeen.set(v.id, this.world.turn);
      if (!seen && !this.lingers(v)) continue;
      const before =
        !landed && this.anim!.before.vehicles.find((x) => x.id === v.id);
      const display = before ? { ...v, items: before.items } : v;
      ids.add(v.id);
      let view = this.views.get(v.id);
      if (!view) {
        view = new VehicleView(v, seen);
        this.views.set(v.id, view);
        this.scene.add(view.root);
      }
      view.update(display, seen);
      view.lamps(night);
      view.pose(f, dt);
      view.aim(this.turretAim(v, f));
      this.vehicleParticles(display, f, frames !== null);
    }
    for (const [id, view] of this.views) {
      if (ids.has(id)) continue;
      this.scene.remove(view.root);
      view.dispose();
      this.views.delete(id);
    }
  }

  // A change in light count recompiles every material. So beams exist only at night, and through the night
  // the pool only grows, to the most vehicles seen at once. Unused beams stay at zero until dawn.
  private aimBeams(night: boolean): void {
    if (!night) {
      for (const beam of this.beams.splice(0)) {
        this.scene.remove(beam, beam.target);
        beam.dispose();
      }
      return;
    }
    const lit = this.world.vehicles.filter((v) => this.frames[v.id] && this.sightLimit.reaches(this.frames[v.id].pos));
    while (this.beams.length < lit.length) {
      const beam = new THREE.SpotLight(
        BEAM_COLOR,
        0,
        BEAM_RANGE,
        BEAM_ANGLE,
        BEAM_PENUMBRA,
        BEAM_DECAY,
      );
      this.beams.push(beam);
      this.scene.add(beam, beam.target);
    }
    this.beams.forEach((beam, i) => {
      const v = lit[i];
      const f = v && this.frames[v.id];
      beam.intensity = f ? BEAM_INTENSITY : 0;
      if (!f) return;
      const rot = new THREE.Quaternion(f.rot.x, f.rot.y, f.rot.z, f.rot.w);
      const at = new THREE.Vector3(f.pos.x, f.pos.y, f.pos.z);
      const nose = bodyOf(v.chassisId).half.x;
      beam.position.copy(
        new THREE.Vector3(nose, BEAM_HEIGHT, 0).applyQuaternion(rot).add(at),
      );
      beam.target.position.copy(
        new THREE.Vector3(nose + BEAM_AIM.ahead, -BEAM_AIM.down, 0)
          .applyQuaternion(rot)
          .add(at),
      );
    });
  }

  // Wheel dust rises from the ground just behind the rear wheels, so it never reads as exhaust.
  private dustPoint(v: Vehicle, f: VehicleFrame): V3 {
    const at = toMap(f.pos);
    const h = headingOf(f.rot);
    const back =
      (bodyOf(v.chassisId).half.x + DUST_BEHIND_M) / PHYSICS.metersPerTile;
    return groundPoint(this.world.terrain, {
      x: at.x - Math.cos(h) * back,
      y: at.y - Math.sin(h) * back,
    });
  }

  private vehicleParticles(v: Vehicle, f: VehicleFrame, moving: boolean): void {
    const ground =
      TERRAIN_TYPES[
        this.world.terrain.types[tileAt(this.world.terrain, v.pos)]
      ];
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
    this.markers.place(this.frames, hide);
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

