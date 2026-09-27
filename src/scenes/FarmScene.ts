import Phaser from 'phaser';
import { anchor, generateArt, POINTS } from '../game/art';
import { DPR, state } from '../game/context';
import { sfx } from '../game/sfx';
import { CROPS, ITEM_IDS, type CropId, type ItemId, type Mushroom, type Plot } from '../game/state';
import {
  BRIDGES,
  MEADOW_PATH,
  BUILDINGS,
  CLEARING,
  DECOR,
  FOREST,
  FOREST_DECOR,
  FOREST_PATH,
  MEADOW_DECOR,
  ISLANDS,
  N,
  PATH,
  POND,
  TH,
  isClearingTile,
  randomMushroomSpot,
  inBounds,
  iso,
  staticBlocked,
  unIso,
  type BuildingKind,
} from '../game/world';
import type { Counter, UIScene } from './UIScene';
import { D } from './depth';
import { Meadow } from './meadow';
import { Whale } from './whale';

type Img = Phaser.GameObjects.Image;
type Emitter = Phaser.GameObjects.Particles.ParticleEmitter;



interface PlotView {
  plot: Plot;
  base: Img;
  /** Покачивающийся колосок над пустой грядкой: «сажай сюда». */
  cue: Img;
  crop: Img | null;
  stageKey: string;
  tweens: Phaser.Tweens.Tween[];
}

interface MushroomView {
  m: Mushroom;
  img: Img;
  stage: number;
  idle: Phaser.Tweens.Tween | null;
}

const mushroomStage = (p: number) => (p >= 1 ? 3 : p >= 0.35 ? 2 : 1);

/** Иконка товара для анимации продажи. */
const itemIcon = (item: ItemId) =>
  `i_${item}`;

interface Chicken {
  img: Img;
  shadow: Img;
  x: number;
  y: number;
  hop: number;
  busy: boolean;
}

const tileCenter = (tx: number, ty: number) => iso(tx + 0.5, ty + 0.5);

/** Куда может смотреть центр камеры: прямоугольник вокруг обоих островов. */
const WORLD_BOUNDS = (() => {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const i of ISLANDS)
    for (const [u, v] of [
      [i.tx, i.ty],
      [i.tx + i.w, i.ty],
      [i.tx + i.w, i.ty + i.h],
      [i.tx, i.ty + i.h],
    ]) {
      const p = iso(u, v);
      xs.push(p.x);
      ys.push(p.y);
    }
  const m = 0.85;
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const hw = ((Math.max(...xs) - Math.min(...xs)) / 2) * m;
  return { x0: cx - hw, x1: cx + hw, y0: Math.min(...ys) + 100, y1: Math.max(...ys) - 150 };
})();

function stageOf(p: number) {
  return p >= 1 ? 3 : p >= 0.4 ? 2 : 1;
}

export class FarmScene extends Phaser.Scene {
  ui!: UIScene;
  private blocked!: Set<string>;
  private plotViews = new Map<number, PlotView>();
  private mushViews = new Map<number, MushroomView>();
  private meadow!: Meadow;
  private whale!: Whale;
  private barn!: Img;
  private highlight!: Img;
  private ghost!: Img;
  private buildMode = false;
  private blades!: Img;
  private bladeSpeed = 0.9;
  private chickens: Chicken[] = [];
  private clouds: Array<{ cloud: Img; shadow: Img; speed: number }> = [];
  private water: Phaser.GameObjects.TileSprite[] = [];
  fx!: Record<'leaves' | 'grain' | 'carrot' | 'stars' | 'dust' | 'hearts' | 'feathers' | 'seeds', Emitter>;
  private growthTimer = 0;

  // камера
  zoomLevel = 0.5;
  private dragging = false;
  private downAt = { x: 0, y: 0 };
  private velocity = { x: 0, y: 0 };
  private pinchDist = 0;
  intro = true;

  constructor() {
    super('farm');
  }

  create() {
    generateArt(this);
    this.blocked = staticBlocked();

    this.buildSea();
    const groundTweens = this.buildIsland();
    this.buildPondAndPaths();
    const objects = [...this.buildBuildings(), ...this.buildDecor()];
    for (const plot of state.plots) this.addPlotView(plot, false);
    this.buildEffects();
    this.buildAmbient();
    this.buildForestAmbient();
    this.meadow = new Meadow(this);
    this.buildCues();
    this.whale = new Whale(this);
    this.setupCamera();
    this.setupInput();

    this.scene.launch('ui');
    this.ui = this.scene.get('ui') as UIScene;

    state.on('plot', (plot: Plot) => {
      const view = this.plotViews.get(plot.id);
      if (view) this.refreshPlot(view, true);
    });

    // грибы: сначала уже выросшие (из сохранения), потом новые по таймеру
    for (const m of state.mushrooms) this.addMushroomView(m, false);
    state.on('mushrooms:spawn', (ms: Mushroom[]) => ms.forEach((m) => this.addMushroomView(m, !this.intro)));
    state.tickMushrooms(randomMushroomSpot);

    this.playIntro(groundTweens, [...objects, ...[...this.mushViews.values()].map((v) => v.img), ...this.meadow.introObjects()]);
  }

  // ---------------------------------------------------------------- мир

  private buildSea() {
    const size = 12000;
    const a = this.add.tileSprite(0, N * 64, size, size, 'water').setDepth(D.water);
    const b = this.add
      .tileSprite(0, N * 64, size, size, 'water')
      .setDepth(D.water + 1)
      .setAlpha(0.35)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTileScale(1.6, 1.6);
    this.water = [a, b];
    ISLANDS.forEach((isl, i) => {
      const p = iso(isl.tx, isl.ty);
      const foam = anchor(this.add.image(p.x, p.y, `foam${i}`), `foam${i}`).setScale(2).setDepth(D.foam);
      this.tweens.add({ targets: foam, alpha: 0.65, duration: 1800, yoyo: true, repeat: -1, ease: 'Sine.InOut', delay: i * 600 });
    });
  }

  /** Тайлы земли и обрывы. Возвращает объекты для анимации появления. */
  private buildIsland() {
    const items: Array<{ obj: Img; delay: number }> = [];
    for (const isl of ISLANDS) {
      const mx = isl.tx + (isl.w - 1) / 2;
      const my = isl.ty + (isl.h - 1) / 2;
      const base = isl.kind === 'farm' ? 0 : 350;
      for (let ty = isl.ty; ty < isl.ty + isl.h; ty++)
        for (let tx = isl.tx; tx < isl.tx + isl.w; tx++) {
          const p = iso(tx, ty);
          const v = (tx * 7 + ty * 13) % 3;
          const key =
            isl.kind === 'farm'
              ? PATH.has(`${tx},${ty}`)
                ? 'path'
                : `grass${v}`
              : isl.kind === 'meadow'
                ? MEADOW_PATH.has(`${tx},${ty}`)
                  ? 'path'
                  : `mgrass${v}`
                : FOREST_PATH.has(`${tx},${ty}`)
                ? 'path'
                : isClearingTile(tx, ty)
                  ? `cgrass${v}`
                  : `fgrass${v}`;
          const t = anchor(this.add.image(p.x, p.y, key), key).setDepth(D.ground + tx + ty);
          const delay = base + Math.hypot(tx - mx, ty - my) * 45;
          items.push({ obj: t, delay });
          if (ty === isl.ty + isl.h - 1) {
            const k = `cliffL${(tx + ty) % 2}`;
            const c = anchor(this.add.image(iso(tx, ty + 1).x, iso(tx, ty + 1).y, k), k).setDepth(D.cliff);
            items.push({ obj: c, delay });
          }
          if (tx === isl.tx + isl.w - 1) {
            const k = `cliffR${(tx + ty) % 2}`;
            const c = anchor(this.add.image(iso(tx + 1, ty + 1).x, iso(tx + 1, ty + 1).y, k), k).setDepth(D.cliff);
            items.push({ obj: c, delay });
          }
        }
    }
    for (const br of BRIDGES) {
      const b = iso(br.tx, br.ty);
      const key = `bridge_${br.axis}`;
      items.push({ obj: anchor(this.add.image(b.x, b.y, key), key).setDepth(D.decal), delay: 300 });
    }

    // в лесу темнее, а на поляну падает солнечный свет
    for (let i = 0; i < 10; i++) {
      const p = iso(FOREST.tx + Phaser.Math.FloatBetween(0.5, FOREST.w - 0.5), FOREST.ty + Phaser.Math.FloatBetween(0.5, FOREST.h - 0.5));
      const s = this.add.image(p.x, p.y, 'soft').setScale(Phaser.Math.FloatBetween(5, 8), Phaser.Math.FloatBetween(2.5, 3.5));
      items.push({ obj: s.setTint(0x0c2a10).setAlpha(0.14).setDepth(D.ground + 100), delay: 700 });
    }
    const cl = iso(CLEARING.cx, CLEARING.cy);
    const sun = this.add
      .image(cl.x, cl.y, 'soft')
      .setScale(11, 5.5)
      .setTint(0xfff0a0)
      .setAlpha(0.22)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(D.ground + 101);
    items.push({ obj: sun, delay: 800 });
    // крупные пятна света и тени на траве — ломают «шахматку» тайлов
    for (let i = 0; i < 26; i++) {
      const p = iso(Phaser.Math.FloatBetween(0.5, N - 0.5), Phaser.Math.FloatBetween(0.5, N - 0.5));
      const light = i % 2 === 0;
      if (!light && p.y > (N - 1.5) * TH) continue;
      const s = this.add
        .image(p.x, p.y, 'soft')
        .setScale(Phaser.Math.FloatBetween(5, 9), Phaser.Math.FloatBetween(2.5, 4))
        .setTint(light ? 0xeaffb0 : 0x2f6b12)
        .setAlpha(light ? 0.09 : 0.1)
        .setDepth(D.ground + 100);
      items.push({ obj: s, delay: 400 });
    }
    return items;
  }

  private buildPondAndPaths() {
    const p = iso(POND.tx, POND.ty);
    anchor(this.add.image(p.x, p.y, 'pond'), 'pond').setDepth(D.decal);
    const c = iso(POND.tx + POND.w / 2, POND.ty + POND.h / 2);
    this.add
      .particles(0, 0, 'spark', {
        x: { min: c.x - 190, max: c.x + 190 },
        y: { min: c.y - 45, max: c.y + 45 },
        lifespan: 1100,
        frequency: 260,
        scale: { onEmit: () => 0, onUpdate: (_p, _k, t) => Math.sin(t * Math.PI) * 0.45 },
        blendMode: Phaser.BlendModes.ADD,
      })
      .setDepth(D.decal + 1);
  }

  private buildingHitboxes = new Map<Img, BuildingKind | 'tree' | 'chicken'>();

  private buildBuildings() {
    const objs: Img[] = [];
    for (const b of BUILDINGS) {
      const c = iso(b.tx + b.w / 2, b.ty + b.h / 2);
      const img = anchor(this.add.image(c.x, c.y, b.kind), b.kind).setDepth(c.y);
      this.makeTappable(img, b.kind);
      if (b.kind === 'barn') this.barn = img;
      objs.push(img);
      if (b.kind === 'windmill') {
        const hub = POINTS.windmillHub;
        this.blades = anchor(this.add.image(c.x + hub.x, c.y + hub.y, 'blades'), 'blades')
          .setDepth(c.y + 1)
          .setScale(0.92, 0.85);
        objs.push(this.blades);
      }
      if (b.kind === 'house') {
        const ch = POINTS.houseChimney;
        this.add
          .particles(c.x + ch.x, c.y + ch.y, 'soft', {
            lifespan: 3200,
            frequency: 420,
            speedY: { min: -70, max: -45 },
            speedX: { min: 8, max: 30 },
            scale: { start: 0.45, end: 2.2 },
            alpha: { start: 0.55, end: 0 },
            tint: 0xf2eee8,
          })
          .setDepth(D.fx);
      }
    }
    return objs;
  }

  private buildDecor() {
    const objs: Img[] = [];
    const all = [...DECOR.map((d) => ({ ...d, dx: 0, dy: 0 })), ...FOREST_DECOR, ...MEADOW_DECOR];
    for (const d of all) {
      const c = tileCenter(d.tx + d.dx, d.ty + d.dy);
      const img = anchor(this.add.image(c.x, c.y, d.kind), d.kind).setDepth(c.y);
      objs.push(img);
      if (d.kind === 'tree' || d.kind === 'pine' || d.kind === 'fern') {
        // деревья и папоротники слегка покачиваются от ветра
        this.tweens.add({
          targets: img,
          angle: { from: d.kind === 'fern' ? -3 : -1.2, to: d.kind === 'fern' ? 3 : 1.2 },
          duration: Phaser.Math.Between(1800, 2600),
          yoyo: true,
          repeat: -1,
          ease: 'Sine.InOut',
          delay: Phaser.Math.Between(0, 1500),
        });
        if (d.kind !== 'fern') this.makeTappable(img, 'tree');
      }
    }
    return objs;
  }

  // ---------------------------------------------------------------- подсказки на объектах

  private cues!: { barn: Phaser.GameObjects.Container; forest: Phaser.GameObjects.Container; meadow: Phaser.GameObjects.Container };
  private meadowIcon!: Img;
  private meadowHalo!: Img;

  /** Пузырь-подсказка над объектом: пульсирует и покачивается. */
  private makeCue(x: number, y: number, icon: string, halo: number) {
    const h = this.add.image(0, 0, 'soft').setScale(3).setTint(halo).setAlpha(0.6);
    const b = this.add.image(0, 0, 'bubble').setScale(0.75);
    const i = this.add.image(0, -2, icon).setScale(0.9);
    const c = this.add.container(x, y, [h, b, i]).setDepth(D.fx - 2).setVisible(false);
    this.tweens.add({ targets: c, y: y - 24, duration: 650, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    this.tweens.add({ targets: h, alpha: 0.2, duration: 650, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    return { c, h, i };
  }

  private buildCues() {
    const sign = (kind: string) => {
      const d = DECOR.find((x) => x.kind === kind)!;
      return tileCenter(d.tx, d.ty);
    };
    const barn = this.makeCue(this.barn.x - 170, this.barn.y - 290, 'i_coin', 0xffd84a);
    const f = sign('sign');
    const forest = this.makeCue(f.x, f.y - 230, 'i_mush', 0xfff3a0);
    const m = sign('signMeadow');
    const meadow = this.makeCue(m.x, m.y - 230, 'i_grass', 0xff3b2f);
    this.meadowIcon = meadow.i;
    this.meadowHalo = meadow.h;
    this.cues = { barn: barn.c, forest: forest.c, meadow: meadow.c };
  }

  private showCue(c: Phaser.GameObjects.Container, on: boolean) {
    if (c.visible === on) return;
    c.setVisible(on);
    if (on) {
      c.setScale(0);
      this.tweens.add({ targets: c, scale: 1, duration: 400, ease: 'Back.Out' });
    }
  }

  /**
   * Подсказки без слов: что можно сделать, видно прямо на объектах.
   * Амбар — монетка, если есть что продать; пустые грядки — колосок;
   * указатель в лес — гриб, если грибы выросли; указатель на луг — трава
   * (животные голодные) или бутылка молока (продукция готова).
   */
  private updateCues() {
    if (!this.cues) return;
    const stock = ITEM_IDS.reduce((a, k) => a + state.inventory[k], 0);
    this.showCue(this.cues.barn, stock > 0 && !this.buildMode);
    for (const v of this.plotViews.values()) v.cue.setVisible(!v.plot.crop && !this.buildMode && !this.intro);
    this.showCue(this.cues.forest, state.mushrooms.some((m) => state.mushroomGrowth(m) >= 1));
    const ready = state.animals.find((a) => state.produce(a) >= 1);
    const hungry = state.animals.some((a) => a.fedAt === null);
    if (ready) {
      this.meadowIcon.setTexture(ready.kind === 'cow' ? 'i_milk' : 'i_wool');
      this.meadowHalo.setTint(0xffd84a);
    } else {
      this.meadowIcon.setTexture('i_grass');
      this.meadowHalo.setTint(0xff3b2f);
    }
    this.showCue(this.cues.meadow, !!ready || hungry);
  }

  // ---------------------------------------------------------------- грибы

  private addMushroomView(m: Mushroom, animate: boolean) {
    const p = iso(m.tx, m.ty);
    const stage = mushroomStage(state.mushroomGrowth(m));
    const key = `mush_${m.kind}${stage}`;
    const img = anchor(this.add.image(p.x, p.y, key), key).setDepth(p.y);
    const view: MushroomView = { m, img, stage, idle: null };
    this.mushViews.set(m.id, view);
    if (animate) {
      // гриб тихо вылезает из земли — без звука, его ещё нужно найти
      img.setScale(0.2, 0);
      this.tweens.add({ targets: img, scaleX: 1, scaleY: 1, duration: 500, ease: 'Back.Out' });
      this.fx.dust.explode(3, p.x, p.y);
    }
    if (stage === 3) {
      if (this.intro) this.time.delayedCall(3500, () => this.mushViews.has(m.id) && this.startIdle(view));
      else this.startIdle(view);
    }
  }

  /** Спелый гриб время от времени «подпрыгивает» — так его легче заметить. */
  private startIdle(view: MushroomView) {
    view.idle?.remove();
    view.idle = this.tweens.add({
      targets: view.img,
      scaleY: { from: 1, to: 0.86 },
      scaleX: { from: 1, to: 1.1 },
      duration: 110,
      yoyo: true,
      repeat: -1,
      repeatDelay: Phaser.Math.Between(2200, 4200),
      delay: Phaser.Math.Between(0, 2000),
      ease: 'Sine.Out',
    });
  }

  private refreshMushroom(view: MushroomView) {
    const stage = mushroomStage(state.mushroomGrowth(view.m));
    if (stage === view.stage) return;
    view.stage = stage;
    const key = `mush_${view.m.kind}${stage}`;
    anchor(view.img.setTexture(key), key);
    view.img.setScale(0.7, 0.5);
    this.tweens.add({ targets: view.img, scaleX: 1, scaleY: 1, duration: 420, ease: 'Back.Out' });
    if (stage === 3) this.time.delayedCall(450, () => this.startIdle(view));
  }

  /** Ближайший к точке касания гриб: грибы маленькие, поэтому зона нажатия шире картинки. */
  private mushroomAt(wx: number, wy: number) {
    const radius = Math.max(80, 40 / this.zoomLevel);
    let best: MushroomView | null = null;
    let bestD = radius;
    for (const v of this.mushViews.values()) {
      const d = Phaser.Math.Distance.Between(wx, wy, v.img.x, v.img.y - 36 * (v.stage / 3));
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    return best;
  }

  private tapMushroom(view: MushroomView) {
    const { m, img } = view;
    const screen = this.toScreen(img.x, img.y - 40);
    if (state.mushroomGrowth(m) < 1) {
      this.ui.progress(screen.x, screen.y - 40, state.mushroomGrowth(m), `i_${m.kind}`);
      this.tweens.add({ targets: img, angle: { from: -8, to: 8 }, duration: 60, yoyo: true, repeat: 2, onComplete: () => img.setAngle(0) });
      sfx.click();
      return;
    }
    if (!state.pickMushroom(m.id)) return;
    this.mushViews.delete(m.id);
    view.idle?.remove();

    const rare = m.kind === 'porcini';
    sfx.mushroom(rare);
    this.fx.stars.explode(rare ? 22 : 12, img.x, img.y - 30);
    this.fx.leaves.explode(6, img.x, img.y - 10);
    this.ui.flyIcons(screen.x, screen.y, 'i_star', 'xp', 1, 200);
    this.flyToBarn(img, 'mushrooms', rare);
  }

  /** Предмет подпрыгивает, крутится и по высокой дуге улетает в амбар. */
  flyToBarn(img: Img, counter: Counter, rare = false) {
    this.ui.expect(counter);
    img.setDepth(D.sky - 1);
    const start = { x: img.x, y: img.y - 90 };
    const door = { x: this.barn.x - 70, y: this.barn.y - 60 };
    const dist = Phaser.Math.Distance.Between(start.x, start.y, door.x, door.y);
    const ctrl = { x: (start.x + door.x) / 2 + 200, y: Math.min(start.y, door.y) - 350 - dist * 0.25 };
    const trail = this.add
      .particles(0, 0, 'spark', {
        lifespan: 450,
        frequency: 28,
        scale: { start: rare ? 0.6 : 0.4, end: 0 },
        alpha: { start: 0.9, end: 0 },
        tint: rare ? 0xffe066 : 0xffffff,
        blendMode: Phaser.BlendModes.ADD,
      })
      .setDepth(D.sky - 2);
    trail.startFollow(img);

    // 1) подпрыгивает из земли
    this.tweens.add({
      targets: img,
      y: start.y,
      scaleX: 1.35,
      scaleY: 1.35,
      duration: 260,
      ease: 'Back.Out',
      onComplete: () => {
        // 2) летит по дуге Безье к воротам амбара, вращаясь и уменьшаясь
        const path = { t: 0 };
        this.tweens.add({
          targets: path,
          t: 1,
          delay: 120,
          duration: Phaser.Math.Clamp(dist / 2.2, 750, 1500),
          ease: 'Sine.In',
          onUpdate: () => {
            const t = path.t;
            const u = 1 - t;
            img.setPosition(
              u * u * start.x + 2 * u * t * ctrl.x + t * t * door.x,
              u * u * start.y + 2 * u * t * ctrl.y + t * t * door.y,
            );
            img.setScale(1.35 - t * 0.85);
            img.setAngle(t * 540);
          },
          onComplete: () => {
            img.destroy();
            trail.stopFollow();
            trail.stop();
            this.time.delayedCall(500, () => trail.destroy());
            sfx.stash();
            this.fx.dust.explode(6, door.x, door.y + 40);
            this.fx.stars.explode(8, door.x, door.y);
            this.tweens.add({
              targets: this.barn,
              scaleX: 1.05,
              scaleY: 0.95,
              duration: 90,
              yoyo: true,
              onComplete: () => this.barn.setScale(1),
            });
            this.ui.arrive(counter);
          },
        });
      },
    });
  }

  private makeTappable(img: Img, kind: BuildingKind | 'tree' | 'chicken') {
    img.setInteractive({ pixelPerfect: true, alphaTolerance: 110, useHandCursor: true });
    this.buildingHitboxes.set(img, kind);
    if (kind === 'tree' || kind === 'chicken') return;
    img.enableFilters();
    const glow = img.filters!.internal.addGlow(0xfff6c8, 0, 0, 1, false, 8, 8);
    img.on('pointerover', () => {
      if (!this.buildMode) this.tweens.add({ targets: glow, outerStrength: 3, duration: 180 });
    });
    img.on('pointerout', () => this.tweens.add({ targets: glow, outerStrength: 0, duration: 250 }));
  }

  // ---------------------------------------------------------------- грядки

  private addPlotView(plot: Plot, animate: boolean) {
    const p = iso(plot.tx, plot.ty);
    const base = anchor(this.add.image(p.x, p.y, 'plot'), 'plot').setDepth(D.plot + p.y);
    const cc = tileCenter(plot.tx, plot.ty);
    const cue = this.add.image(cc.x, cc.y - 70, 'i_wheat').setScale(0.62).setAlpha(0.85).setDepth(D.fx - 4).setVisible(false);
    this.tweens.add({ targets: cue, y: cc.y - 95, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.InOut', delay: Phaser.Math.Between(0, 600) });
    const view: PlotView = { plot, base, cue, crop: null, stageKey: '', tweens: [] };
    this.plotViews.set(plot.id, view);
    this.refreshPlot(view, false);
    if (animate) {
      base.y -= 220;
      base.setAlpha(0);
      this.tweens.add({
        targets: base,
        y: p.y,
        alpha: 1,
        duration: 520,
        ease: 'Bounce.Out',
        onComplete: () => {
          const c = tileCenter(plot.tx, plot.ty);
          this.fx.dust.explode(18, c.x, c.y);
          this.cameras.main.shake(140, 0.0025);
          sfx.build();
        },
      });
    }
    return view;
  }

  private refreshPlot(view: PlotView, animate: boolean) {
    const { plot } = view;
    const key = plot.crop ? `${plot.crop}${stageOf(state.growth(plot))}` : '';
    if (key === view.stageKey) return;
    const wasEmpty = !view.stageKey;
    view.stageKey = key;
    view.tweens.forEach((t) => t.remove());
    view.tweens = [];
    const old = view.crop;
    view.crop = null;
    if (old) {
      if (animate && !key) {
        // сбор урожая: растения «выпрыгивают» и исчезают
        this.tweens.add({
          targets: old,
          scaleY: 1.35,
          scaleX: 0.7,
          alpha: 0,
          y: old.y - 60,
          duration: 260,
          ease: 'Back.In',
          onComplete: () => old.destroy(),
        });
      } else old.destroy();
    }
    if (!key) return;

    const p = iso(plot.tx, plot.ty);
    const c = tileCenter(plot.tx, plot.ty);
    const img = anchor(this.add.image(p.x, p.y, key), key).setDepth(c.y);
    view.crop = img;
    if (animate) {
      img.setScale(wasEmpty ? 0.2 : 0.75, wasEmpty ? 0.2 : 0.6);
      this.tweens.add({ targets: img, scaleX: 1, scaleY: 1, duration: 480, ease: 'Back.Out' });
      if (!wasEmpty) this.fx.stars.explode(6, c.x, c.y - 30);
    }
    if (key.endsWith('3')) {
      // созрело: мягкое свечение и «дыхание»
      img.enableFilters();
      const glow = img.filters!.internal.addGlow(0xffe27a, 1, 0, 1, false, 8, 8);
      view.tweens.push(
        this.tweens.add({ targets: glow, outerStrength: 3, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.InOut' }),
        this.tweens.add({
          targets: img,
          scaleY: 1.05,
          duration: 1100,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.InOut',
          delay: animate ? 500 : Phaser.Math.Between(0, 800),
        }),
      );
      if (animate) sfx.pop();
    }
  }

  // ---------------------------------------------------------------- эффекты

  private buildEffects() {
    const burst = (tex: string, cfg: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig) =>
      this.add.particles(0, 0, tex, { emitting: false, ...cfg }).setDepth(D.fx);

    this.fx = {
      leaves: burst('leafP', {
        speedX: { min: -260, max: 260 },
        speedY: { min: -520, max: -220 },
        gravityY: 900,
        rotate: { min: 0, max: 360 },
        lifespan: 1000,
        scale: { start: 1.1, end: 0.5 },
        alpha: { start: 1, end: 0, ease: 'Cubic.In' },
        tint: [0x6cc84a, 0x8fe060, 0x4fa83a],
      }),
      grain: burst('grain', {
        speedX: { min: -300, max: 300 },
        speedY: { min: -600, max: -250 },
        gravityY: 1000,
        rotate: { min: 0, max: 360 },
        lifespan: 1000,
        scale: { start: 1.2, end: 0.6 },
        alpha: { start: 1, end: 0, ease: 'Cubic.In' },
      }),
      carrot: burst('grain', {
        speedX: { min: -300, max: 300 },
        speedY: { min: -600, max: -250 },
        gravityY: 1000,
        rotate: { min: 0, max: 360 },
        lifespan: 1000,
        scale: { start: 1.3, end: 0.6 },
        tint: 0xff8a2a,
        alpha: { start: 1, end: 0, ease: 'Cubic.In' },
      }),
      stars: burst('spark', {
        speed: { min: 120, max: 380 },
        lifespan: 700,
        scale: { start: 0.9, end: 0 },
        rotate: { min: 0, max: 180 },
        tint: [0xffffff, 0xfff3a0, 0xffe066],
        blendMode: Phaser.BlendModes.ADD,
      }),
      dust: burst('soft', {
        speedX: { min: -260, max: 260 },
        speedY: { min: -90, max: 60 },
        lifespan: 800,
        scale: { start: 0.9, end: 2.4 },
        alpha: { start: 0.65, end: 0 },
        tint: 0xdcc39a,
      }),
      hearts: burst('heart', {
        speedX: { min: -120, max: 120 },
        speedY: { min: -320, max: -180 },
        lifespan: 1400,
        scale: { start: 0.4, end: 1.1 },
        alpha: { start: 1, end: 0, ease: 'Cubic.In' },
      }),
      feathers: burst('feather', {
        speedX: { min: -200, max: 200 },
        speedY: { min: -260, max: -60 },
        gravityY: 180,
        rotate: { min: 0, max: 360 },
        lifespan: 1300,
        scale: { start: 1.2, end: 0.8 },
        alpha: { start: 1, end: 0, ease: 'Cubic.In' },
      }),
      seeds: burst('grain', {
        speedX: { min: -140, max: 140 },
        speedY: { min: -380, max: -200 },
        gravityY: 1100,
        lifespan: 520,
        scale: 0.6,
        tint: 0x7a4a22,
      }),
    };

    // искорки над спелыми грядками
    this.add
      .particles(0, 0, 'spark', {
        lifespan: 900,
        frequency: 180,
        speedY: { min: -60, max: -20 },
        scale: { onEmit: () => 0, onUpdate: (_p, _k, t) => Math.sin(t * Math.PI) * 0.5 },
        blendMode: Phaser.BlendModes.ADD,
        emitZone: {
          type: 'random',
          source: {
            getRandomPoint: (pt: Phaser.Types.Math.Vector2Like) => {
              const ripe = [...this.plotViews.values()].filter((v) => v.stageKey.endsWith('3'));
              if (!ripe.length) {
                pt.x = -99999;
                pt.y = -99999;
                return pt;
              }
              const v = Phaser.Utils.Array.GetRandom(ripe);
              const c = iso(v.plot.tx + Phaser.Math.FloatBetween(0.15, 0.85), v.plot.ty + Phaser.Math.FloatBetween(0.15, 0.85));
              pt.x = c.x;
              pt.y = c.y - Phaser.Math.Between(20, 70);
              return pt;
            },
          },
        },
      })
      .setDepth(D.fx);
  }

  // ---------------------------------------------------------------- атмосфера

  private buildAmbient() {
    // облака и их тени
    for (let i = 0; i < 3; i++) {
      const y = Phaser.Math.Between(-200, N * 128 - 300);
      const x = Phaser.Math.Between(-N * 128, N * 128);
      const s = Phaser.Math.FloatBetween(1.3, 2.1);
      const cloud = anchor(this.add.image(x, y - 700, 'cloud'), 'cloud').setScale(s).setAlpha(0.88).setDepth(D.sky);
      const shadow = anchor(this.add.image(x + 120, y, 'cloud'), 'cloud')
        .setScale(s, s * 0.55)
        .setTint(0x0a2a10)
        .setAlpha(0.1)
        .setDepth(D.cloudShadow);
      this.clouds.push({ cloud, shadow, speed: Phaser.Math.FloatBetween(18, 34) });
    }

    // бабочки
    const colors = [0xffd84a, 0xff8ac2, 0x8ad8ff, 0xffffff, 0xffa24a];
    for (let i = 0; i < 6; i++) {
      const start = tileCenter(Phaser.Math.Between(2, N - 3), Phaser.Math.Between(2, N - 3));
      const b = anchor(this.add.image(start.x, start.y - 80, 'butterfly'), 'butterfly')
        .setTint(colors[i % colors.length])
        .setDepth(D.fx - 1)
        .setScale(1.3);
      this.tweens.add({ targets: b, scaleX: 0.25, duration: 110, yoyo: true, repeat: -1 });
      const wander = () => {
        const t = tileCenter(Phaser.Math.FloatBetween(1, N - 2), Phaser.Math.FloatBetween(1, N - 2));
        this.tweens.add({
          targets: b,
          x: t.x,
          y: t.y - Phaser.Math.Between(60, 160),
          duration: Phaser.Math.Between(2500, 4500),
          ease: 'Sine.InOut',
          onComplete: wander,
        });
      };
      wander();
    }

    // куры
    const spots = [
      [9, 4],
      [10, 5],
      [8, 4],
    ];
    for (const [tx, ty] of spots) {
      const c = tileCenter(tx, ty);
      const shadow = this.add.image(c.x, c.y, 'soft').setTint(0x1a2a0a).setAlpha(0.3).setScale(0.8, 0.28);
      const img = anchor(this.add.image(c.x, c.y, 'chicken'), 'chicken');
      const ch: Chicken = { img, shadow, x: c.x, y: c.y, hop: 0, busy: false };
      this.chickens.push(ch);
      this.makeTappable(img, 'chicken');
      img.setData('chicken', ch);
      this.time.delayedCall(Phaser.Math.Between(300, 2000), () => this.chickenWander(ch));
    }
  }

  /** Лес: светлячки над поляной, падающие листья и редкие искорки у спелых грибов. */
  private buildForestAmbient() {
    const cl = iso(CLEARING.cx, CLEARING.cy);
    this.add
      .particles(0, 0, 'soft', {
        x: { min: cl.x - 300, max: cl.x + 300 },
        y: { min: cl.y - 200, max: cl.y + 80 },
        lifespan: 4200,
        frequency: 260,
        speedX: { min: -14, max: 14 },
        speedY: { min: -22, max: -6 },
        scale: { onEmit: () => 0, onUpdate: (_p, _k, t) => Math.sin(t * Math.PI) * 0.22 },
        tint: [0xfff3a0, 0xd8ff9a],
        blendMode: Phaser.BlendModes.ADD,
      })
      .setDepth(D.fx);
    this.add
      .particles(0, 0, 'leafP', {
        emitZone: {
          type: 'random',
          source: {
            getRandomPoint: (pt: Phaser.Types.Math.Vector2Like) => {
              const p = iso(FOREST.tx + Math.random() * FOREST.w, FOREST.ty + Math.random() * FOREST.h);
              pt.x = p.x;
              pt.y = p.y - 260;
              return pt;
            },
          },
        },
        lifespan: 3200,
        frequency: 700,
        speedX: { min: -30, max: 30 },
        speedY: { min: 30, max: 60 },
        rotate: { start: 0, end: 540 },
        scale: { min: 0.7, max: 1.1 },
        alpha: { start: 1, end: 0, ease: 'Cubic.In' },
        tint: [0xd9a441, 0xb5652a, 0x9ccf4a],
      })
      .setDepth(D.fx);
    // едва заметная искорка у спелого гриба — подсказка для внимательных
    this.add
      .particles(0, 0, 'spark', {
        lifespan: 800,
        frequency: 900,
        speedY: { min: -40, max: -15 },
        scale: { onEmit: () => 0, onUpdate: (_p, _k, t) => Math.sin(t * Math.PI) * 0.35 },
        blendMode: Phaser.BlendModes.ADD,
        emitZone: {
          type: 'random',
          source: {
            getRandomPoint: (pt: Phaser.Types.Math.Vector2Like) => {
              const ripe = [...this.mushViews.values()].filter((v) => v.stage === 3);
              const v = ripe.length ? Phaser.Utils.Array.GetRandom(ripe) : null;
              pt.x = v ? v.img.x + Phaser.Math.Between(-18, 18) : -99999;
              pt.y = v ? v.img.y - Phaser.Math.Between(20, 50) : -99999;
              return pt;
            },
          },
        },
      })
      .setDepth(D.fx);
  }

  private chickenWander(ch: Chicken) {
    if (ch.busy) {
      this.time.delayedCall(800, () => this.chickenWander(ch));
      return;
    }
    const cur = unIso(ch.x, ch.y);
    let tx = 0;
    let ty = 0;
    for (let i = 0; i < 10; i++) {
      tx = Phaser.Math.Clamp(Math.floor(cur.tx) + Phaser.Math.Between(-2, 2), 4, N - 2);
      ty = Phaser.Math.Clamp(Math.floor(cur.ty) + Phaser.Math.Between(-2, 2), 3, N - 2);
      const k = `${tx},${ty}`;
      const isBuilding = BUILDINGS.some((b) => tx >= b.tx && tx < b.tx + b.w && ty >= b.ty && ty < b.ty + b.h);
      const isDecor = DECOR.some((d) => d.tx === tx && d.ty === ty);
      if (!isBuilding && !isDecor && !(this.blocked.has(k) && !PATH.has(k))) break;
    }
    const target = iso(tx + Phaser.Math.FloatBetween(0.25, 0.75), ty + Phaser.Math.FloatBetween(0.25, 0.75));
    const dist = Phaser.Math.Distance.Between(ch.x, ch.y, target.x, target.y);
    ch.img.setFlipX(target.x < ch.x);
    const dur = Math.max(400, (dist / 90) * 1000);
    const hops = Math.max(2, Math.round(dur / 260));
    this.tweens.add({ targets: ch, hop: 10, duration: dur / hops / 2, yoyo: true, repeat: hops - 1, ease: 'Sine.Out' });
    this.tweens.add({
      targets: ch,
      x: target.x,
      y: target.y,
      duration: dur,
      ease: 'Linear',
      onComplete: () => {
        // иногда клюёт зёрнышки
        if (Math.random() < 0.6)
          this.tweens.add({ targets: ch.img, angle: ch.img.flipX ? -25 : 25, duration: 120, yoyo: true, repeat: 2 });
        this.time.delayedCall(Phaser.Math.Between(700, 2600), () => this.chickenWander(ch));
      },
    });
  }

  // ---------------------------------------------------------------- камера и ввод

  private setupCamera() {
    const cam = this.cameras.main;
    const cssW = this.scale.width / DPR;
    // портретный экран: масштаб подбираем по ширине
    this.zoomLevel = Phaser.Math.Clamp(cssW / 1150, 0.26, 0.6);
    const focus = iso(6.2, 5.6);
    cam.centerOn(focus.x, focus.y);
    cam.setZoom(this.zoomLevel * DPR * 0.62);

    // «кинематографичная» постобработка: bloom + виньетка
    Phaser.Actions.AddEffectBloom(cam, { threshold: 0.86, blurRadius: 2, blurSteps: 3, blendAmount: 0.45 });
    cam.filters.external.addVignette(0.5, 0.5, 0.95, 0.35, 0x103040);
  }

  private setupInput() {
    this.input.addPointer(1);
    this.highlight = anchor(this.add.image(0, 0, 'tileHL'), 'tileHL').setDepth(D.highlight).setVisible(false);
    this.tweens.add({ targets: this.highlight, alpha: 0.45, duration: 600, yoyo: true, repeat: -1 });
    this.ghost = anchor(this.add.image(0, 0, 'plot'), 'plot').setDepth(D.highlight + 1).setAlpha(0.8).setVisible(false);

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      sfx.unlock();
      this.downAt = { x: p.x, y: p.y };
      this.dragging = false;
      this.velocity = { x: 0, y: 0 };
      this.pinchDist = 0;
    });

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      const cam = this.cameras.main;
      const p1 = this.input.pointer1;
      const p2 = this.input.pointer2;
      if (p1.isDown && p2.isDown) {
        // щипок двумя пальцами
        const d = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
        if (this.pinchDist) this.zoomAt((p1.x + p2.x) / 2, (p1.y + p2.y) / 2, d / this.pinchDist);
        this.pinchDist = d;
        this.dragging = true;
        return;
      }
      if (p.isDown && !this.intro && this.ui.lastUiDown !== p.downTime) {
        if (!this.dragging && Phaser.Math.Distance.Between(p.x, p.y, this.downAt.x, this.downAt.y) > 10 * DPR) {
          this.dragging = true;
          this.ui.closePicker();
        }
        if (this.dragging) {
          const dx = (p.x - p.prevPosition.x) / cam.zoom;
          const dy = (p.y - p.prevPosition.y) / cam.zoom;
          cam.scrollX -= dx;
          cam.scrollY -= dy;
          this.velocity = { x: dx, y: dy };
          this.clampCamera();
        }
      }
      this.updateHover(p);
    });

    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (this.dragging || this.intro) return;
      if (this.ui.lastUiDown === p.downTime) return;
      this.onTap(p);
    });

    this.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      this.zoomAt(p.x, p.y, dy > 0 ? 0.9 : 1.1);
    });
  }

  private zoomAt(px: number, py: number, factor: number) {
    const cam = this.cameras.main;
    const z1 = cam.zoom;
    this.zoomLevel = Phaser.Math.Clamp(this.zoomLevel * factor, 0.2, 1.1);
    const z2 = this.zoomLevel * DPR;
    const w = cam.width;
    const h = cam.height;
    const wx = cam.scrollX + w / 2 + (px - w / 2) / z1;
    const wy = cam.scrollY + h / 2 + (py - h / 2) / z1;
    cam.setZoom(z2);
    cam.scrollX = wx - w / 2 - (px - w / 2) / z2;
    cam.scrollY = wy - h / 2 - (py - h / 2) / z2;
    this.clampCamera();
    this.ui.closePicker();
  }

  private clampCamera() {
    const cam = this.cameras.main;
    const cx = Phaser.Math.Clamp(cam.scrollX + cam.width / 2, WORLD_BOUNDS.x0, WORLD_BOUNDS.x1);
    const cy = Phaser.Math.Clamp(cam.scrollY + cam.height / 2, WORLD_BOUNDS.y0, WORLD_BOUNDS.y1);
    cam.scrollX = cx - cam.width / 2;
    cam.scrollY = cy - cam.height / 2;
  }

  private pointerTile(p: Phaser.Input.Pointer) {
    const w = this.cameras.main.getWorldPoint(p.x, p.y);
    const t = unIso(w.x, w.y);
    return { tx: Math.floor(t.tx), ty: Math.floor(t.ty) };
  }

  private canPlace(tx: number, ty: number) {
    return inBounds(tx, ty) && !this.blocked.has(`${tx},${ty}`) && !state.plotAt(tx, ty);
  }

  private updateHover(p: Phaser.Input.Pointer) {
    const { tx, ty } = this.pointerTile(p);
    const pos = iso(tx, ty);
    if (this.buildMode) {
      const ok = this.canPlace(tx, ty);
      this.ghost.setVisible(inBounds(tx, ty)).setPosition(pos.x, pos.y).setTint(ok ? 0xb8ffb0 : 0xff8080);
      this.highlight.setVisible(false);
      return;
    }
    const plot = state.plotAt(tx, ty);
    const mouse = !p.wasTouch;
    this.highlight.setVisible(mouse && !!plot && !p.isDown).setPosition(pos.x, pos.y);
  }

  toScreen(wx: number, wy: number) {
    const cam = this.cameras.main;
    return {
      x: ((wx - cam.worldView.x) * cam.zoom) / DPR,
      y: ((wy - cam.worldView.y) * cam.zoom) / DPR,
    };
  }

  // ---------------------------------------------------------------- действия игрока

  private onTap(p: Phaser.Input.Pointer) {
    if (this.ui.pickerOpen) {
      this.ui.closePicker();
      return;
    }
    const { tx, ty } = this.pointerTile(p);

    if (this.buildMode) {
      this.tryBuild(tx, ty);
      return;
    }

    const w = this.cameras.main.getWorldPoint(p.x, p.y);
    const mush = this.mushroomAt(w.x, w.y);
    if (mush) {
      this.tapMushroom(mush);
      return;
    }
    if (this.whale.tap(w.x, w.y)) return;
    if (this.meadow.tap(w.x, w.y, tx, ty)) return;

    const plot = state.plotAt(tx, ty);
    if (plot) {
      this.tapPlot(plot);
      return;
    }

    // объекты выше земли (здания, деревья, куры): берём самый верхний
    const hits = this.input
      .hitTestPointer(p)
      .filter((o): o is Img => this.buildingHitboxes.has(o as Img))
      .sort((a, b) => b.depth - a.depth);
    if (hits.length) this.tapObject(hits[0], this.buildingHitboxes.get(hits[0])!);
  }

  private tapPlot(plot: Plot) {
    const view = this.plotViews.get(plot.id)!;
    const c = tileCenter(plot.tx, plot.ty);
    const screen = this.toScreen(c.x, c.y);
    if (!plot.crop) {
      sfx.click();
      this.tweens.add({ targets: view.base, scaleX: 1.06, scaleY: 1.06, duration: 90, yoyo: true });
      this.ui.showPicker(screen.x, screen.y - 30, (crop) => this.plant(plot, crop));
      return;
    }
    if (state.growth(plot) < 1) {
      this.ui.progress(screen.x, screen.y - 80, state.growth(plot), plot.crop === 'wheat' ? 'i_wheat' : 'i_carrot');
      if (view.crop) this.tweens.add({ targets: view.crop, angle: { from: -4, to: 4 }, duration: 70, yoyo: true, repeat: 2, onComplete: () => view.crop?.setAngle(0) });
      sfx.click();
      return;
    }
    this.harvest(plot);
  }

  private plant(plot: Plot, crop: CropId) {
    const c = tileCenter(plot.tx, plot.ty);
    const screen = this.toScreen(c.x, c.y);
    if (!state.plant(plot, crop)) {
      sfx.error();
      this.ui.shakeCounter('coins');
      this.ui.noMoney(screen.x, screen.y - 60);
      return;
    }
    sfx.plant();
    this.fx.seeds.explode(14, c.x, c.y - 10);
    this.fx.dust.explode(6, c.x, c.y);
    this.ui.floatText(screen.x, screen.y - 60, `−${CROPS[crop].seedCost}`, '#ffe066', 'i_coin');
  }

  private harvest(plot: Plot) {
    const crop = plot.crop!;
    const got = state.harvest(plot);
    if (!got) return;
    const c = tileCenter(plot.tx, plot.ty);
    sfx.harvest();
    this.fx.leaves.explode(16, c.x, c.y - 20);
    (crop === 'wheat' ? this.fx.grain : this.fx.carrot).explode(14, c.x, c.y - 30);
    this.fx.stars.explode(10, c.x, c.y - 40);
    const s = this.toScreen(c.x, c.y - 40);
    this.ui.flyIcons(s.x, s.y, crop === 'wheat' ? 'i_wheat' : 'i_carrot', crop, 1);
    this.ui.flyIcons(s.x, s.y, 'i_star', 'xp', 1, 150);
  }

  private tapObject(img: Img, kind: BuildingKind | 'tree' | 'chicken') {
    const sq = (target: Img, amt = 0.06) =>
      this.tweens.add({
        targets: target,
        scaleX: 1 + amt,
        scaleY: 1 - amt,
        duration: 110,
        yoyo: true,
        ease: 'Sine.Out',
        onComplete: () => target.setScale(1),
      });
    const top = this.toScreen(img.x, img.y - img.displayHeight * 0.55);

    if (kind === 'barn') {
      sq(img);
      const sold = state.sellAll();
      if (!sold.length) {
        // пусто: амбар просто вздрагивает, продавать нечего
        sfx.click();
        return;
      }
      sfx.whoosh();
      let delay = 0;
      for (const s of sold) {
        this.ui.flyIcons(top.x, top.y + 40, itemIcon(s.item), 'none', Math.min(4, s.count), delay, true);
        delay += 120;
      }
      const total = sold.reduce((a, s) => a + s.coins, 0);
      this.ui.floatText(top.x, top.y - 20, `+${total}`, '#ffe066', 'i_coin');
      this.ui.flyCoins(top.x, top.y + 40, total, 350);
      this.fx.stars.explode(16, img.x, img.y - 200);
    } else if (kind === 'house') {
      sq(img);
      sfx.pop();
      this.fx.hearts.explode(7, img.x, img.y - 200);
    } else if (kind === 'windmill') {
      sfx.whoosh();
      this.bladeSpeed = 9;
      this.fx.leaves.explode(10, this.blades.x, this.blades.y);
    } else if (kind === 'tree') {
      sfx.click();
      this.tweens.add({ targets: img, angle: { from: -5, to: 5 }, duration: 80, yoyo: true, repeat: 3 });
      this.fx.leaves.explode(12, img.x, img.y - 150);
    } else if (kind === 'chicken') {
      const ch = img.getData('chicken') as Chicken;
      sfx.cluck();
      ch.busy = true;
      this.fx.feathers.explode(8, ch.x, ch.y - 40);
      this.tweens.add({
        targets: ch,
        hop: 70,
        duration: 260,
        yoyo: true,
        ease: 'Quad.Out',
        onComplete: () => (ch.busy = false),
      });
    }
  }

  // ---------------------------------------------------------------- строительство

  enterBuild() {
    this.buildMode = true;
    this.ui.closePicker();
    const cam = this.cameras.main;
    const center = unIso(cam.midPoint.x, cam.midPoint.y);
    const t = { tx: Math.floor(center.tx), ty: Math.floor(center.ty) };
    const pos = iso(t.tx, t.ty);
    this.ghost.setVisible(true).setPosition(pos.x, pos.y).setTint(this.canPlace(t.tx, t.ty) ? 0xb8ffb0 : 0xff8080);
    this.tweens.add({ targets: this.ghost, alpha: { from: 0.5, to: 0.9 }, duration: 500, yoyo: true, repeat: -1 });
    // подсвечиваем все свободные клетки
    this.freeMarks = [];
    for (let ty = 0; ty < N; ty++)
      for (let tx = 0; tx < N; tx++)
        if (this.canPlace(tx, ty)) {
          const p = iso(tx, ty);
          const m = anchor(this.add.image(p.x, p.y, 'tileHL'), 'tileHL').setDepth(D.highlight - 1).setAlpha(0);
          this.tweens.add({ targets: m, alpha: 0.28, duration: 250, delay: (tx + ty) * 12 });
          this.freeMarks.push(m);
        }
  }

  private freeMarks: Img[] = [];

  exitBuild() {
    this.buildMode = false;
    this.ghost.setVisible(false);
    this.tweens.killTweensOf(this.ghost);
    for (const m of this.freeMarks) this.tweens.add({ targets: m, alpha: 0, duration: 200, onComplete: () => m.destroy() });
    this.freeMarks = [];
    this.ui.setBuildMode(false);
  }

  private tryBuild(tx: number, ty: number) {
    const c = tileCenter(tx, ty);
    const screen = this.toScreen(c.x, c.y);
    if (!this.canPlace(tx, ty)) {
      sfx.error();
      this.tweens.add({ targets: this.ghost, x: this.ghost.x + 10, duration: 50, yoyo: true, repeat: 2 });
      return;
    }
    const cost = state.plotCost;
    const plot = state.buyPlot(tx, ty);
    if (!plot) {
      sfx.error();
      this.ui.shakeCounter('coins');
      this.ui.noMoney(screen.x, screen.y - 60);
      return;
    }
    this.ui.floatText(screen.x, screen.y - 80, `−${cost}`, '#ffe066', 'i_coin');
    this.addPlotView(plot, true);
    this.exitBuild();
  }

  // ---------------------------------------------------------------- интро

  private playIntro(ground: Array<{ obj: Img; delay: number }>, objects: Img[]) {
    for (const { obj, delay } of ground) {
      const y = obj.y;
      const a = obj.alpha;
      obj.setAlpha(0);
      obj.y = y - 90;
      this.tweens.add({ targets: obj, y, alpha: a, delay, duration: 520, ease: 'Back.Out' });
    }
    const plotsAndCrops: Img[] = [];
    for (const v of this.plotViews.values()) {
      plotsAndCrops.push(v.base);
      if (v.crop) plotsAndCrops.push(v.crop);
    }
    [...objects, ...plotsAndCrops].forEach((o) => {
      const sx = o.scaleX;
      const sy = o.scaleY;
      o.setScale(0);
      this.tweens.add({
        targets: o,
        scaleX: sx,
        scaleY: sy,
        delay: 500 + (o.y + 1000) * 0.25,
        duration: 520,
        ease: 'Back.Out',
      });
    });
    const cam = this.cameras.main;
    this.tweens.add({
      targets: cam,
      zoom: this.zoomLevel * DPR,
      duration: 1900,
      ease: 'Cubic.InOut',
      onComplete: () => (this.intro = false),
    });
  }

  // ---------------------------------------------------------------- кадр

  update(_time: number, delta: number) {
    const dt = delta / 1000;
    const cam = this.cameras.main;

    // инерция камеры после перетаскивания
    if (!this.input.activePointer.isDown && (Math.abs(this.velocity.x) > 0.05 || Math.abs(this.velocity.y) > 0.05)) {
      cam.scrollX -= this.velocity.x;
      cam.scrollY -= this.velocity.y;
      this.velocity.x *= 0.9;
      this.velocity.y *= 0.9;
      this.clampCamera();
    }

    for (const w of this.water) {
      w.tilePositionX += dt * (w === this.water[0] ? 6 : -9);
      w.tilePositionY += dt * (w === this.water[0] ? 3 : 5);
    }

    if (this.blades) {
      this.blades.rotation += this.bladeSpeed * dt;
      this.bladeSpeed += (0.9 - this.bladeSpeed) * Math.min(1, dt * 0.8);
    }

    // облака прозрачнеют ближе к центру экрана, чтобы не закрывать ферму
    const mid = cam.midPoint;
    const reach = (Math.min(cam.width, cam.height) / cam.zoom) * 0.55;
    for (const c of this.clouds) {
      c.cloud.x += c.speed * dt;
      c.shadow.x += c.speed * dt;
      const d = Phaser.Math.Distance.Between(c.cloud.x, c.cloud.y, mid.x, mid.y);
      c.cloud.setAlpha(Phaser.Math.Clamp((d - reach * 0.5) / reach, 0, 0.9));
      if (c.cloud.x > N * 128 + 900) {
        c.cloud.x -= N * 256 + 1800;
        c.shadow.x -= N * 256 + 1800;
      }
    }

    this.meadow.update();
    this.whale.update();

    for (const ch of this.chickens) {
      ch.img.setPosition(ch.x, ch.y - ch.hop).setDepth(ch.y);
      ch.shadow.setPosition(ch.x, ch.y).setDepth(ch.y - 1).setScale(0.8 - ch.hop * 0.004, 0.28 - ch.hop * 0.001);
    }

    this.growthTimer += delta;
    if (this.growthTimer > 250) {
      this.growthTimer = 0;
      for (const v of this.plotViews.values()) this.refreshPlot(v, true);
      if (!this.intro) state.tickMushrooms(randomMushroomSpot);
      for (const v of this.mushViews.values()) this.refreshMushroom(v);
      this.meadow.tick();
      this.updateCues();
    }
  }
}

