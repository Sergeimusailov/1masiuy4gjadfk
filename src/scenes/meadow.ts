// Луг: пастбища с травой, коровы и овечки.
// Животные сами идут к спелой траве, едят её и после этого дают молоко или шерсть.

import Phaser from 'phaser';
import { anchor } from '../game/art';
import { state } from '../game/context';
import { sfx } from '../game/sfx';
import { ANIMALS, SOW_COST, type Animal, type Pasture } from '../game/state';
import { MEADOW_WALK, iso } from '../game/world';
import { D } from './depth';
import type { FarmScene } from './FarmScene';

type Img = Phaser.GameObjects.Image;

interface PastureView {
  p: Pasture;
  base: Img;
  grass: Img | null;
  stage: number;
  /** Животное, которое уже идёт есть эту траву. */
  claimedBy: number | null;
  /** Подсветка «посейте здесь», пока животные голодные, а грядка пустая. */
  sowHint: Phaser.GameObjects.Container;
}

interface AnimalView {
  a: Animal;
  img: Img;
  shadow: Img;
  bubble: Phaser.GameObjects.Container;
  glow: Phaser.Filters.Glow;
  glowTween: Phaser.Tweens.Tween | null;
  x: number;
  y: number;
  hop: number;
  mode: 'idle' | 'walk' | 'eat' | 'react';
  /** Текущая стадия шерсти (для овец), чтобы менять текстуру только при переходе. */
  wool: number;
  ready: boolean;
  /** Чем сейчас подсвечено: красноватым (голодное) или золотым (готово). */
  glowMode: 'none' | 'hungry' | 'ready';
}

const grassStage = (g: number) => (g >= 1 ? 3 : g >= 0.45 ? 2 : g > 0 ? 1 : 0);

/** Стадия шерсти: голодная или только что остриженная овца — 0, пушистая — 3. */
const woolStage = (a: Animal, produce: number) => (a.fedAt === null ? 0 : produce >= 1 ? 3 : produce >= 0.5 ? 2 : 1);

const tileCenter = (tx: number, ty: number) => iso(tx + 0.5, ty + 0.5);

/** Животные рисуются крупнее базовой текстуры, чтобы на лугу они читались издалека. */
const BASE_SCALE = { cow: 1.3, sheep: 1.4 } as const;

function randomWalkPoint() {
  const w = MEADOW_WALK;
  return iso(Phaser.Math.FloatBetween(w.tx0, w.tx1), Phaser.Math.FloatBetween(w.ty0, w.ty1));
}

export class Meadow {
  private pastures = new Map<number, PastureView>();
  private animals: AnimalView[] = [];

  constructor(private scene: FarmScene) {
    for (const p of state.pastures) this.addPasture(p);
    for (const a of state.animals) this.addAnimal(a);
    state.on('pasture', (p: Pasture) => this.refreshPasture(this.pastures.get(p.id)!, true));

    // искорки вокруг животных, у которых готово молоко или шерсть
    scene.add
      .particles(0, 0, 'spark', {
        lifespan: 900,
        frequency: 160,
        speedY: { min: -50, max: -15 },
        scale: { onEmit: () => 0, onUpdate: (_p, _k, t) => Math.sin(t * Math.PI) * 0.55 },
        tint: [0xffffff, 0xfff3a0],
        blendMode: Phaser.BlendModes.ADD,
        emitZone: {
          type: 'random',
          source: {
            getRandomPoint: (pt: Phaser.Types.Math.Vector2Like) => {
              const ready = this.animals.filter((v) => v.ready);
              const v = ready.length ? Phaser.Utils.Array.GetRandom(ready) : null;
              pt.x = v ? v.x + Phaser.Math.Between(-60, 60) : -99999;
              pt.y = v ? v.y - Phaser.Math.Between(20, 110) : -99999;
              return pt;
            },
          },
        },
      })
      .setDepth(D.fx);
  }

  /** Объекты для анимации появления при запуске игры. */
  introObjects(): Img[] {
    const out: Img[] = [];
    for (const v of this.pastures.values()) {
      out.push(v.base);
      if (v.grass) out.push(v.grass);
    }
    return out;
  }

  // ---------------------------------------------------------------- пастбища

  private addPasture(p: Pasture) {
    const pos = iso(p.tx, p.ty);
    const base = anchor(this.scene.add.image(pos.x, pos.y, 'pasture'), 'pasture').setDepth(D.plot + pos.y);
    const c = tileCenter(p.tx, p.ty);
    const ring = anchor(this.scene.add.image(pos.x, pos.y, 'tileHL'), 'tileHL').setTint(0x9dff7a);
    const icon = this.scene.add.image(c.x, c.y - 120, 'i_grass').setScale(0.9);
    const arrow = this.scene.add.image(c.x, c.y - 60, 'spark').setScale(0.5).setTint(0xd8ffb0);
    const sowHint = this.scene.add.container(0, 0, [ring, arrow, icon]).setDepth(D.fx - 3).setVisible(false);
    sowHint.setData('icon', icon);
    this.scene.tweens.add({ targets: ring, alpha: { from: 0.9, to: 0.3 }, duration: 650, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    this.scene.tweens.add({ targets: [icon, arrow], y: '-=22', duration: 520, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    const view: PastureView = { p, base, grass: null, stage: 0, claimedBy: null, sowHint };
    this.pastures.set(p.id, view);
    this.refreshPasture(view, false);
  }

  private refreshPasture(view: PastureView, animate: boolean) {
    const stage = grassStage(state.grassGrowth(view.p));
    if (stage === view.stage) return;
    const prev = view.stage;
    view.stage = stage;
    const pos = iso(view.p.tx, view.p.ty);
    const c = tileCenter(view.p.tx, view.p.ty);
    if (stage === 0) {
      // траву съели: она «сжимается» в землю
      const g = view.grass;
      view.grass = null;
      if (g) this.scene.tweens.add({ targets: g, scaleY: 0, alpha: 0, duration: animate ? 600 : 1, onComplete: () => g.destroy() });
      return;
    }
    const key = `meadow${stage}`;
    if (!view.grass) view.grass = anchor(this.scene.add.image(pos.x, pos.y, key), key).setDepth(c.y);
    else anchor(view.grass.setTexture(key), key);
    if (animate) {
      view.grass.setScale(1, prev === 0 ? 0.2 : 0.6);
      this.scene.tweens.add({ targets: view.grass, scaleY: 1, duration: 450, ease: 'Back.Out' });
      if (stage === 3) this.scene.fx.stars.explode(5, c.x, c.y - 30);
    }
  }

  private tapPasture(view: PastureView) {
    const { p } = view;
    const c = tileCenter(p.tx, p.ty);
    const s = this.scene.toScreen(c.x, c.y);
    const ui = this.scene.ui;
    if (p.sownAt === null) {
      if (!state.sow(p)) {
        sfx.error();
        ui.shakeCounter('coins');
        ui.floatText(s.x, s.y - 60, 'Не хватает монет', '#ff8a7a');
        return;
      }
      ui.visitedMeadow = true;
      ui.updateHint();
      sfx.plant();
      this.scene.fx.seeds.explode(16, c.x, c.y - 10);
      this.scene.fx.dust.explode(6, c.x, c.y);
      ui.floatText(s.x, s.y - 60, `−${SOW_COST}`, '#ffe066', 'i_coin');
      this.scene.tweens.add({ targets: view.base, scaleX: 1.06, scaleY: 1.06, duration: 90, yoyo: true });
      return;
    }
    const left = state.grassMsLeft(p);
    sfx.click();
    if (left > 0) ui.floatText(s.x, s.y - 60, `Трава растёт · ${fmt(left)}`, '#ffffff');
    else ui.floatText(s.x, s.y - 60, 'Трава готова — скоро придут поесть', '#ffffff');
  }

  // ---------------------------------------------------------------- животные

  private addAnimal(a: Animal) {
    const start = randomWalkPoint();
    const key = a.kind === 'cow' ? 'cow' : 'sheep0';
    const img = anchor(this.scene.add.image(start.x, start.y, key), key).setScale(BASE_SCALE[a.kind]);
    img.enableFilters();
    const glow = img.filters!.internal.addGlow(0xfff3b0, 0, 0, 1, false, 8, 10);
    const shadow = this.scene.add.image(start.x, start.y, 'soft').setTint(0x1a2a0a).setAlpha(0.28);
    shadow.setScale(a.kind === 'cow' ? 2.3 : 1.9, 0.55);
    // пузырь с травинкой над голодным животным
    const halo = this.scene.add.image(0, 0, 'soft').setScale(2.4).setTint(0xff3b2f);
    const bubble = this.scene.add
      .container(0, 0, [halo, this.scene.add.image(0, 0, 'bubble').setScale(0.55), this.scene.add.image(0, -2, 'i_grass').setScale(0.7)])
      .setDepth(D.fx - 2)
      .setVisible(false);
    // пузырь «хочу есть» пульсирует, а красноватый ореол вокруг него дышит
    this.scene.tweens.add({ targets: bubble, scale: { from: 1, to: 1.14 }, duration: 480, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    this.scene.tweens.add({ targets: halo, alpha: { from: 0.75, to: 0.2 }, duration: 480, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    const view: AnimalView = {
      a,
      img,
      shadow,
      bubble,
      glow,
      glowTween: null,
      x: start.x,
      y: start.y,
      hop: 0,
      mode: 'idle',
      wool: -1,
      ready: false,
      glowMode: 'none',
    };
    this.animals.push(view);
    this.refreshAnimal(view, false);
    this.scene.time.delayedCall(Phaser.Math.Between(600, 2500), () => this.think(view));
  }

  /** Главное решение животного: идти есть, погулять или постоять. */
  private think(v: AnimalView) {
    if (v.mode !== 'idle') return;
    if (v.a.fedAt === null) {
      const food = [...this.pastures.values()].find((p) => p.claimedBy === null && state.grassGrowth(p.p) >= 1);
      if (food) {
        food.claimedBy = v.a.id;
        const c = tileCenter(food.p.tx, food.p.ty);
        // встаёт рядом с грядкой, мордой к траве
        const side = Math.random() < 0.5 ? -1 : 1;
        this.walkTo(v, c.x + side * 70, c.y + 10, () => this.eat(v, food));
        return;
      }
    }
    // гуляет; готовое к сбору животное ходит реже
    if (Math.random() < (v.ready ? 0.3 : 0.75)) {
      const t = randomWalkPoint();
      this.walkTo(v, t.x, t.y, () => this.rest(v));
    } else this.rest(v);
  }

  private rest(v: AnimalView) {
    v.mode = 'idle';
    this.scene.time.delayedCall(Phaser.Math.Between(1500, 4000), () => this.think(v));
  }

  private walkTo(v: AnimalView, x: number, y: number, done: () => void) {
    v.mode = 'walk';
    const dist = Phaser.Math.Distance.Between(v.x, v.y, x, y);
    if (Math.abs(x - v.x) > 4) v.img.setFlipX(x < v.x);
    const dur = Math.max(500, (dist / (v.a.kind === 'cow' ? 60 : 75)) * 1000);
    const hops = Math.max(2, Math.round(dur / 380));
    this.scene.tweens.add({ targets: v, hop: v.a.kind === 'cow' ? 5 : 8, duration: dur / hops / 2, yoyo: true, repeat: hops - 1 });
    this.scene.tweens.add({ targets: v, x, y, duration: dur, ease: 'Sine.InOut', onComplete: done });
  }

  private eat(v: AnimalView, food: PastureView) {
    if (state.grassGrowth(food.p) < 1) {
      food.claimedBy = null;
      this.rest(v);
      return;
    }
    v.mode = 'eat';
    const c = tileCenter(food.p.tx, food.p.ty);
    v.img.setFlipX(c.x < v.x);
    if (v.a.kind === 'cow') anchor(v.img.setTexture('cow_eat'), 'cow_eat');
    // жуёт: голова ходит вверх-вниз
    const chew = this.scene.tweens.add({
      targets: v.img,
      angle: { from: 0, to: v.img.flipX ? -5 : 5 },
      duration: 220,
      yoyo: true,
      repeat: -1,
    });
    this.scene.fx.leaves.explode(6, c.x, c.y - 20);
    this.scene.time.delayedCall(2400, () => {
      chew.remove();
      v.img.setAngle(0);
      if (v.a.kind === 'cow') anchor(v.img.setTexture('cow'), 'cow');
      food.claimedBy = null;
      if (state.feed(v.a, food.p)) {
        this.scene.fx.hearts.explode(3, v.x, v.y - 110);
        sfx.pop();
      }
      this.refreshAnimal(v, true);
      this.rest(v);
    });
  }

  /** Обновляет внешний вид: стадию шерсти, сияние готового животного, пузырь голода. */
  private refreshAnimal(v: AnimalView, animate: boolean) {
    const p = state.produce(v.a);
    const ready = p >= 1;
    if (v.a.kind === 'sheep') {
      const st = woolStage(v.a, p);
      if (st !== v.wool) {
        v.wool = st;
        anchor(v.img.setTexture(`sheep${st}`), `sheep${st}`);
        if (animate) {
          const b = BASE_SCALE.sheep;
          v.img.setScale(b * 0.85, b * 1.15);
          this.scene.tweens.add({ targets: v.img, scaleX: b, scaleY: b, duration: 400, ease: 'Back.Out' });
        }
      }
    }
    const hungry = v.a.fedAt === null && v.mode !== 'eat';
    if (ready && !v.ready && animate) this.scene.fx.stars.explode(8, v.x, v.y - 70);
    v.ready = ready;
    // сияние: золотое — можно собирать, красноватое пульсирующее — голодное
    const mode = ready ? 'ready' : hungry ? 'hungry' : 'none';
    if (mode !== v.glowMode) {
      v.glowMode = mode;
      v.glowTween?.remove();
      v.glowTween = null;
      if (mode === 'none') v.glow.outerStrength = 0;
      else {
        v.glow.color = mode === 'ready' ? 0xfff3b0 : 0xff3b2f;
        const [lo, hi, dur] = mode === 'ready' ? [2, 5, 800] : [2, 6, 520];
        v.glowTween = this.scene.tweens.add({ targets: v.glow, outerStrength: { from: lo, to: hi }, duration: dur, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
      }
    }
    v.bubble.setVisible(hungry);
  }

  /** Коротко «вспыхивают» пустые пастбища: подсказка, куда сеять. */
  private flashSowHints() {
    for (const p of this.pastures.values()) {
      if (!p.sowHint.visible) continue;
      const icon = p.sowHint.getData('icon') as Img;
      icon.setScale(1.5);
      this.scene.tweens.add({ targets: icon, scale: 0.9, duration: 500, ease: 'Back.Out' });
      const c = tileCenter(p.p.tx, p.p.ty);
      this.scene.fx.stars.explode(6, c.x, c.y - 20);
    }
  }

  private animalAt(wx: number, wy: number) {
    const radius = Math.max(90, 45 / this.scene.zoomLevel);
    let best: AnimalView | null = null;
    let bestD = radius;
    for (const v of this.animals) {
      const d = Phaser.Math.Distance.Between(wx, wy, v.x, v.y - (v.a.kind === 'cow' ? 80 : 60));
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    return best;
  }

  private tapAnimal(v: AnimalView) {
    const def = ANIMALS[v.a.kind];
    const s = this.scene.toScreen(v.x, v.y - 120);
    const ui = this.scene.ui;
    const voice = v.a.kind === 'cow' ? sfx.moo : sfx.baa;
    voice();
    // животное подпрыгивает от радости
    if (v.mode === 'idle' || v.mode === 'walk') {
      this.scene.tweens.add({ targets: v, hop: 30, duration: 180, yoyo: true, ease: 'Quad.Out' });
    }
    const product = state.collect(v.a);
    if (!product) {
      if (v.a.fedAt === null) {
        // голодное: пузырь с травой вздрагивает, пустые пастбища вспыхивают
        this.scene.tweens.add({ targets: v.bubble, angle: { from: -14, to: 14 }, duration: 70, yoyo: true, repeat: 3, onComplete: () => v.bubble.setAngle(0) });
        this.flashSowHints();
      } else ui.floatText(s.x, s.y, `${def.productName} через ${fmt(state.produceMsLeft(v.a))}`, '#ffffff');
      return;
    }
    ui.visitedMeadow = true;
    ui.updateHint();
    ui.floatText(s.x, s.y - 10, `${def.productName}!`, '#ffffff');
    ui.flyIcons(s.x, s.y + 30, 'i_star', 'xp', 1, 200);
    this.scene.fx.stars.explode(14, v.x, v.y - 70);
    if (v.a.kind === 'sheep') {
      // стрижка: клочья шерсти разлетаются
      this.scene.fx.feathers.explode(16, v.x, v.y - 50);
    } else {
      this.scene.fx.hearts.explode(4, v.x, v.y - 100);
    }
    const icon = this.scene.add.image(v.x, v.y - 60, `i_${product}`).setScale(0.2);
    this.scene.tweens.add({ targets: icon, scale: 1.1, duration: 200, ease: 'Back.Out' });
    this.scene.flyToBarn(icon, product);
    this.refreshAnimal(v, true);
  }

  // ---------------------------------------------------------------- внешние вызовы

  /** Обрабатывает нажатие, если оно пришлось на животное или пастбище. */
  tap(wx: number, wy: number, tx: number, ty: number): boolean {
    const animal = this.animalAt(wx, wy);
    if (animal) {
      this.tapAnimal(animal);
      return true;
    }
    const pasture = [...this.pastures.values()].find((v) => v.p.tx === tx && v.p.ty === ty);
    if (pasture) {
      this.tapPasture(pasture);
      return true;
    }
    return false;
  }

  /** Раз в 250 мс: рост травы и продукции. */
  tick() {
    for (const v of this.pastures.values()) this.refreshPasture(v, true);
    for (const v of this.animals) this.refreshAnimal(v, true);
    // пустые пастбища подсвечиваются, пока хоть одно животное голодное
    const hungry = this.animals.some((v) => v.a.fedAt === null);
    for (const v of this.pastures.values()) v.sowHint.setVisible(hungry && v.p.sownAt === null);
  }

  /** Каждый кадр: позиции, тени, глубина, покачивание пузыря голода. */
  update() {
    for (const v of this.animals) {
      v.img.setPosition(v.x, v.y - v.hop).setDepth(v.y);
      v.shadow.setPosition(v.x, v.y).setDepth(v.y - 1);
      const top = v.a.kind === 'cow' ? 215 : 190;
      v.bubble.setPosition(v.x + (v.img.flipX ? -30 : 30), v.y - v.hop - top + bob(v.a.id));
    }
  }
}

/** Лёгкое покачивание пузыря без отдельного твина на каждое животное. */
function bob(seed: number) {
  return Math.sin(performance.now() / 350 + seed) * 6;
}

function fmt(ms: number) {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
