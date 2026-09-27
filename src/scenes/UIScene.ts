import Phaser from 'phaser';
import { DPR, FONT, state } from '../game/context';
import { sfx } from '../game/sfx';
import { CROPS, xpForLevel, type CropId } from '../game/state';
import type { FarmScene } from './FarmScene';
import { safeInsets } from '../game/viewport';

// Интерфейс живёт в отдельной сцене поверх мира: его не двигает и не масштабирует
// камера фермы. Координаты здесь — CSS-пиксели, камера увеличивает их в DPR раз.

type Counter = 'coins' | 'wheat' | 'carrot' | 'mushrooms';
type Target = Counter | 'xp' | 'none';

const textStyle = (size: number, color = '#ffffff'): Phaser.Types.GameObjects.Text.TextStyle => ({
  fontFamily: FONT,
  fontStyle: '800',
  fontSize: `${size}px`,
  color,
  stroke: '#4a2a10',
  strokeThickness: Math.max(3, size * 0.22),
  shadow: { offsetX: 0, offsetY: 2, color: 'rgba(0,0,0,0.35)', blur: 0, fill: true, stroke: true },
});

interface CounterView {
  box: Phaser.GameObjects.Container;
  text: Phaser.GameObjects.Text;
  icon: Phaser.GameObjects.Image;
  shown: { v: number };
  pending: number;
}

export class UIScene extends Phaser.Scene {
  /** downTime последнего нажатия, пойманного интерфейсом: ферма его игнорирует. */
  lastUiDown = -1;
  pickerOpen = false;
  /** Подсказка про лес нужна только пока игрок не нашёл первый гриб. */
  foundMushroom = false;

  private farm!: FarmScene;
  private counters = {} as Record<Counter, CounterView>;
  private levelBox!: Phaser.GameObjects.Container;
  private levelText!: Phaser.GameObjects.Text;
  private xpFill!: Phaser.GameObjects.NineSlice;
  private xpText!: Phaser.GameObjects.Text;
  private xpShown = { v: 0 };
  private xpPending = 0;
  private buildBtn!: Phaser.GameObjects.Container;
  private buildCost!: Phaser.GameObjects.Text;
  private cancelBtn!: Phaser.GameObjects.Container;
  private hint!: Phaser.GameObjects.Text;
  private picker: Phaser.GameObjects.Container | null = null;
  private confetti!: Phaser.GameObjects.Particles.ParticleEmitter;
  private sparkle!: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor() {
    super('ui');
  }

  private get W() {
    return this.scale.width / DPR;
  }
  private get H() {
    return this.scale.height / DPR;
  }

  private txt(x: number, y: number, s: string, size: number, color?: string) {
    return this.add.text(x, y, s, textStyle(size, color)).setResolution(DPR).setOrigin(0.5);
  }

  create() {
    this.farm = this.scene.get('farm') as FarmScene;
    const cam = this.cameras.main;
    cam.setOrigin(0, 0);
    cam.setZoom(DPR);

    this.input.on('gameobjectdown', (p: Phaser.Input.Pointer) => (this.lastUiDown = p.downTime));

    this.buildLevel();
    this.buildCounters();
    this.buildButtons();
    this.hint = this.txt(0, 0, '', 17).setAlpha(0);

    this.sparkle = this.add.particles(0, 0, 'spark', {
      emitting: false,
      speed: { min: 60, max: 180 },
      lifespan: 500,
      scale: { start: 0.45, end: 0 },
      blendMode: Phaser.BlendModes.ADD,
    });
    this.confetti = this.add.particles(0, 0, 'confetti', {
      emitting: false,
      speedX: { min: -260, max: 260 },
      speedY: { min: -700, max: -300 },
      gravityY: 520,
      lifespan: 3200,
      rotate: { onEmit: () => Phaser.Math.Between(0, 360), onUpdate: (p) => p.angle + 9 },
      scaleX: { onEmit: () => 1, onUpdate: (_p, _k, t) => Math.cos(t * 40) },
      tint: [0xff5d8a, 0xffd84a, 0x6cd4ff, 0x8fe85a, 0xff9a3a, 0xc08aff],
    });

    this.layout();
    this.scale.on('resize', this.layout, this);

    state.on('coins', () => this.syncCounter('coins'));
    state.on('inventory', () => {
      this.syncCounter('wheat');
      this.syncCounter('carrot');
      this.syncCounter('mushrooms');
      this.updateHint();
    });
    state.on('plot', () => this.updateHint());
    state.on('mushrooms:spawn', () => this.updateHint());
    state.on('xp', () => this.syncXp());
    state.on('levelup', (lvl: number) => this.time.delayedCall(700, () => this.celebrate(lvl)));

    // плавное появление HUD после интро
    const hud = [this.levelBox, ...Object.values(this.counters).map((c) => c.box), this.buildBtn];
    hud.forEach((o, i) => {
      const y = o.y;
      o.setAlpha(0).setY(y - 30);
      this.tweens.add({ targets: o, alpha: 1, y, delay: 1300 + i * 90, duration: 450, ease: 'Back.Out' });
    });
    this.time.delayedCall(2000, () => this.updateHint());
  }

  // ---------------------------------------------------------------- HUD

  private buildLevel() {
    const bg = this.add.nineslice(34, 0, 'bar_bg', undefined, 320, 44, 22, 22, 0, 0).setScale(0.5).setOrigin(0, 0.5);
    this.xpFill = this.add.nineslice(36, 0, 'bar_fill', undefined, 80, 44, 22, 22, 0, 0).setScale(0.46, 0.4).setOrigin(0, 0.5);
    this.xpText = this.txt(118, 1, '', 13);
    const star = this.add.image(0, 0, 'i_star').setScale(0.56);
    this.levelText = this.txt(0, 3, String(state.level), 20);
    this.levelBox = this.add.container(0, 0, [bg, this.xpFill, this.xpText, star, this.levelText]);
    this.xpShown.v = state.xp;
    this.drawXp();
  }

  private drawXp() {
    const need = xpForLevel(state.level);
    const frac = Phaser.Math.Clamp(this.xpShown.v / need, 0, 1);
    const w = 44 + frac * (310 - 44);
    this.xpFill.setSize(w, 44);
    this.xpFill.setVisible(this.xpShown.v > 0);
    this.xpText.setText(`${Math.round(this.xpShown.v)} / ${need}`);
    this.levelText.setText(String(state.level));
  }

  private syncXp() {
    if (this.xpPending > 0) return;
    const target = state.xp;
    if (target < this.xpShown.v) this.xpShown.v = 0; // новый уровень — полоса с нуля
    this.tweens.add({ targets: this.xpShown, v: target, duration: 500, ease: 'Cubic.Out', onUpdate: () => this.drawXp() });
  }

  private buildCounters() {
    const defs: Array<[Counter, string]> = [
      ['coins', 'i_coin'],
      ['wheat', 'i_wheat'],
      ['carrot', 'i_carrot'],
      ['mushrooms', 'i_mush'],
    ];
    for (const [key, icon] of defs) {
      const pill = this.add.nineslice(0, 0, 'pill', undefined, 250, 80, 40, 40, 0, 0).setScale(0.5).setOrigin(1, 0.5);
      const ic = this.add.image(-125, 0, icon).setScale(0.5);
      const value = this.counterValue(key);
      const t = this.txt(-18, 1, String(value), 20).setOrigin(1, 0.5);
      const box = this.add.container(0, 0, [pill, ic, t]);
      this.counters[key] = { box, text: t, icon: ic, shown: { v: value }, pending: 0 };
    }
  }

  private counterValue(key: Counter) {
    if (key === 'coins') return state.coins;
    if (key === 'mushrooms') return state.mushroomCount;
    return state.inventory[key];
  }

  /** Предмет вылетел в мире и летит в хранилище: счётчик ждёт его прилёта. */
  expect(key: Counter) {
    this.counters[key].pending += 1;
  }

  /** Предмет долетел: счётчик «подпрыгивает» и докручивает число. */
  arrive(key: Counter) {
    const c = this.counters[key];
    c.pending = Math.max(0, c.pending - 1);
    this.sparkle.explode(6, c.box.x + c.icon.x, c.box.y);
    this.tweens.killTweensOf(c.icon);
    c.icon.setScale(0.7);
    this.tweens.add({ targets: c.icon, scale: 0.5, duration: 350, ease: 'Back.Out' });
    if (c.pending === 0) this.syncCounter(key);
  }

  private syncCounter(key: Counter, force = false) {
    const c = this.counters[key];
    if (c.pending > 0 && !force) return;
    const target = this.counterValue(key);
    this.tweens.killTweensOf(c.shown);
    this.tweens.add({
      targets: c.shown,
      v: target,
      duration: 450,
      ease: 'Cubic.Out',
      onUpdate: () => c.text.setText(String(Math.round(c.shown.v))),
    });
    this.updateBuildCost();
  }

  shakeCounter(key: Counter) {
    const c = this.counters[key];
    this.tweens.add({ targets: c.box, x: c.box.x + 8, duration: 50, yoyo: true, repeat: 3 });
    c.text.setColor('#ff8a7a');
    this.time.delayedCall(500, () => c.text.setColor('#ffffff'));
  }

  private punch(obj: Phaser.GameObjects.Container, s = 1.18) {
    this.tweens.killTweensOf(obj);
    obj.setScale(s);
    this.tweens.add({ targets: obj, scale: 1, duration: 350, ease: 'Back.Out' });
  }

  // ---------------------------------------------------------------- кнопки

  private makeButton(tex: string, w: number, h: number, children: Phaser.GameObjects.GameObject[], onClick: () => void) {
    const bg = this.add.nineslice(0, 0, tex, undefined, w * 2, h * 2, 44, 44, 44, 44).setScale(0.5);
    const box = this.add.container(0, 0, [bg, ...children]);
    box.setSize(w, h).setInteractive({ useHandCursor: true });
    box.on('pointerdown', () => {
      sfx.unlock();
      this.tweens.add({ targets: box, scale: 0.9, duration: 70 });
    });
    box.on('pointerup', () => {
      this.tweens.add({ targets: box, scale: 1, duration: 300, ease: 'Back.Out' });
      onClick();
    });
    box.on('pointerout', () => this.tweens.add({ targets: box, scale: 1, duration: 200 }));
    return box;
  }

  private buildButtons() {
    const icon = this.add.image(-62, -4, 'i_plot').setScale(0.55);
    const label = this.txt(4, -9, 'Грядка', 20);
    const coin = this.add.image(-6, 15, 'i_coin').setScale(0.24);
    this.buildCost = this.txt(18, 15, String(state.plotCost), 15, '#ffe066').setOrigin(0, 0.5);
    this.buildBtn = this.makeButton('btn_green', 180, 64, [icon, label, coin, this.buildCost], () => {
      if (state.coins < state.plotCost) {
        sfx.error();
        this.shakeCounter('coins');
        this.floatText(this.buildBtn.x, this.buildBtn.y - 50, 'Не хватает монет', '#ff8a7a');
        return;
      }
      sfx.click();
      this.setBuildMode(true);
      this.farm.enterBuild();
    });

    const x = this.txt(0, 0, 'Отмена', 20);
    this.cancelBtn = this.makeButton('btn_red', 150, 58, [x], () => {
      sfx.click();
      this.farm.exitBuild();
    }).setVisible(false);
  }

  private updateBuildCost() {
    this.buildCost?.setText(String(state.plotCost)).setColor(state.coins >= state.plotCost ? '#ffe066' : '#ff9a8a');
  }

  setBuildMode(on: boolean) {
    this.buildBtn.setVisible(!on);
    this.cancelBtn.setVisible(on);
    if (on) {
      this.cancelBtn.setScale(0.6);
      this.tweens.add({ targets: this.cancelBtn, scale: 1, duration: 300, ease: 'Back.Out' });
      this.showHint('Выберите свободную клетку для новой грядки');
    } else {
      this.updateHint();
    }
    this.updateBuildCost();
  }

  // ---------------------------------------------------------------- подсказки

  private showHint(text: string) {
    if (this.hint.text === text && this.hint.alpha > 0) return;
    this.tweens.killTweensOf(this.hint);
    if (!text) {
      this.tweens.add({ targets: this.hint, alpha: 0, duration: 200 });
      return;
    }
    this.hint.setText(text).setAlpha(0).setScale(0.8);
    this.tweens.add({ targets: this.hint, alpha: 1, scale: 1, duration: 350, ease: 'Back.Out' });
  }

  updateHint() {
    if (this.cancelBtn?.visible) return;
    const anyPlanted = state.plots.some((p) => p.crop);
    const anyRipe = state.plots.some((p) => p.crop && state.growth(p) >= 1);
    const stock = state.inventory.wheat + state.inventory.carrot + state.mushroomCount;
    const ripeMushrooms = state.mushrooms.some((m) => state.mushroomGrowth(m) >= 1);
    let text = '';
    if (!anyPlanted && stock === 0) text = 'Нажмите на пустую грядку, чтобы посадить';
    else if (anyRipe) text = 'Урожай созрел — нажмите на грядку!';
    else if (stock > 0) text = 'Нажмите на амбар, чтобы продать урожай';
    else if (ripeMushrooms && !this.foundMushroom) text = 'За мостиком в лесу выросли грибы — поищите!';
    this.showHint(text);
  }

  // ---------------------------------------------------------------- выбор культуры

  showPicker(x: number, y: number, onPick: (crop: CropId) => void) {
    this.closePicker(true);
    const items: Phaser.GameObjects.Container[] = [];
    const crops: CropId[] = ['wheat', 'carrot'];
    crops.forEach((crop, i) => {
      const def = CROPS[crop];
      const unlocked = state.isUnlocked(crop);
      const bubble = this.add.image(0, 0, 'bubble').setScale(0.5);
      const icon = this.add.image(0, -4, crop === 'wheat' ? 'i_wheat' : 'i_carrot').setScale(0.5);
      const parts: Phaser.GameObjects.GameObject[] = [bubble, icon];
      if (unlocked) {
        const coin = this.add.image(-12, 38, 'i_coin').setScale(0.22);
        const cost = this.txt(4, 38, String(def.seedCost), 15, state.coins >= def.seedCost ? '#ffe066' : '#ff8a7a').setOrigin(0, 0.5);
        const time = this.txt(0, -40, `${def.growMs / 1000}с`, 12);
        parts.push(coin, cost, time);
      } else {
        icon.setTint(0x777777).setAlpha(0.7);
        parts.push(this.add.image(16, 14, 'i_lock').setScale(0.5), this.txt(0, 38, `Ур. ${def.unlockLevel}`, 13));
      }
      const box = this.add.container(x + (i - 0.5) * 84, y - 70, parts);
      box.setSize(70, 70).setInteractive({ useHandCursor: true });
      box.on('pointerdown', () => {
        if (!unlocked) {
          sfx.error();
          this.tweens.add({ targets: box, angle: { from: -8, to: 8 }, duration: 60, yoyo: true, repeat: 2, onComplete: () => box.setAngle(0) });
          return;
        }
        onPick(crop);
        this.closePicker();
      });
      box.on('pointerover', () => this.tweens.add({ targets: box, scale: 1.1, duration: 120 }));
      box.on('pointerout', () => this.tweens.add({ targets: box, scale: 1, duration: 120 }));
      box.setScale(0);
      this.tweens.add({ targets: box, scale: 1, duration: 320, delay: i * 70, ease: 'Back.Out' });
      items.push(box);
    });
    this.picker = this.add.container(0, 0, items);
    this.pickerOpen = true;
    sfx.pop();
  }

  closePicker(instant = false) {
    const p = this.picker;
    if (!p) return;
    this.picker = null;
    this.pickerOpen = false;
    if (instant) {
      p.destroy();
      return;
    }
    this.tweens.add({
      targets: p.list,
      scale: 0,
      duration: 140,
      ease: 'Back.In',
      onComplete: () => p.destroy(),
    });
  }

  // ---------------------------------------------------------------- летящие иконки

  private targetPos(t: Target) {
    if (t === 'xp') return { x: this.levelBox.x, y: this.levelBox.y };
    if (t === 'none') return null;
    const c = this.counters[t];
    return { x: c.box.x + c.icon.x, y: c.box.y };
  }

  /** Иконки вылетают из точки и по дуге летят к счётчику (как в Township). */
  flyIcons(x: number, y: number, icon: string, target: Target, count: number, delay = 0, toBarn = false) {
    const to = this.targetPos(target);
    if (target !== 'none' && target !== 'xp') this.counters[target].pending += 1;
    if (target === 'xp') this.xpPending += 1;
    let arrived = 0;
    for (let i = 0; i < count; i++) {
      const img = this.add.image(x, y, icon).setScale(0);
      const start = { x: x + Phaser.Math.Between(-50, 50), y: y + Phaser.Math.Between(-60, -20) };
      // сначала «выпрыгивает», потом летит
      this.tweens.add({
        targets: img,
        x: start.x,
        y: start.y,
        scale: 0.55,
        duration: 320,
        delay: delay + i * 70,
        ease: 'Back.Out',
        onComplete: () => {
          if (toBarn || !to) {
            this.tweens.add({ targets: img, y: img.y + 50, scale: 0, alpha: 0, duration: 380, delay: 200, ease: 'Back.In', onComplete: () => img.destroy() });
            return;
          }
          const ctrl = { x: (start.x + to.x) / 2 + Phaser.Math.Between(-80, 80), y: Math.min(start.y, to.y) - 80 };
          const path = { t: 0 };
          this.tweens.add({
            targets: path,
            t: 1,
            duration: 650,
            delay: 120,
            ease: 'Cubic.In',
            onUpdate: () => {
              const t = path.t;
              const u = 1 - t;
              img.setPosition(u * u * start.x + 2 * u * t * ctrl.x + t * t * to.x, u * u * start.y + 2 * u * t * ctrl.y + t * t * to.y);
              img.setScale(0.55 - t * 0.15);
              img.setAngle(t * 20);
            },
            onComplete: () => {
              img.destroy();
              arrived++;
              this.sparkle.explode(6, to.x, to.y);
              if (target === 'xp') {
                this.punch(this.levelBox, 1.12);
                if (arrived === count) {
                  this.xpPending -= 1;
                  this.syncXp();
                }
              } else if (target !== 'none') {
                const c = this.counters[target];
                this.tweens.killTweensOf(c.icon);
                c.icon.setScale(0.7);
                this.tweens.add({ targets: c.icon, scale: 0.5, duration: 350, ease: 'Back.Out' });
                if (arrived === count) {
                  c.pending -= 1;
                  this.syncCounter(target);
                }
              }
            },
          });
        },
      });
    }
  }

  /** Монеты летят к счётчику, сумма зачисляется в состояние по мере прилёта. */
  flyCoins(x: number, y: number, total: number, delay = 0) {
    const n = Phaser.Math.Clamp(Math.ceil(total / 5), 3, 12);
    const to = this.targetPos('coins')!;
    let given = 0;
    for (let i = 0; i < n; i++) {
      const img = this.add.image(x, y, 'i_coin').setScale(0);
      const start = { x: x + Phaser.Math.Between(-70, 70), y: y + Phaser.Math.Between(-70, 10) };
      this.tweens.add({
        targets: img,
        x: start.x,
        y: start.y,
        scale: 0.42,
        duration: 300,
        delay: delay + i * 55,
        ease: 'Back.Out',
        onComplete: () => {
          const ctrl = { x: start.x + Phaser.Math.Between(-60, 60), y: Math.min(start.y, to.y) - 60 };
          const path = { t: 0 };
          this.tweens.add({
            targets: path,
            t: 1,
            duration: 600,
            delay: 80,
            ease: 'Cubic.In',
            onUpdate: () => {
              const t = path.t;
              const u = 1 - t;
              img.setPosition(u * u * start.x + 2 * u * t * ctrl.x + t * t * to.x, u * u * start.y + 2 * u * t * ctrl.y + t * t * to.y);
              img.scaleX = 0.42 * Math.cos(t * 12);
            },
            onComplete: () => {
              img.destroy();
              const portion = i === n - 1 ? total - given : Math.floor(total / n);
              given += portion;
              state.addCoins(portion);
              sfx.coin();
              this.sparkle.explode(5, to.x, to.y);
              const c = this.counters.coins;
              c.icon.setScale(0.65);
              this.tweens.add({ targets: c.icon, scale: 0.5, duration: 300, ease: 'Back.Out' });
            },
          });
        },
      });
    }
  }

  floatText(x: number, y: number, s: string, color: string, icon?: string) {
    const t = this.txt(0, 0, s, 20, color);
    const parts: Phaser.GameObjects.GameObject[] = [t];
    if (icon) {
      t.setOrigin(1, 0.5).setX(-2);
      parts.push(this.add.image(16, 0, icon).setScale(0.3));
    }
    const box = this.add.container(x, y, parts).setScale(0.3);
    this.tweens.add({ targets: box, scale: 1, duration: 300, ease: 'Back.Out' });
    this.tweens.add({ targets: box, y: y - 60, alpha: 0, duration: 700, delay: 700, ease: 'Cubic.In', onComplete: () => box.destroy() });
  }

  // ---------------------------------------------------------------- новый уровень

  private celebrate(level: number) {
    sfx.levelUp();
    const cx = this.W / 2;
    const cy = this.H * 0.42;
    const rays = this.add.image(cx, cy, 'spark').setScale(0).setTint(0xfff3a0).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: rays, scale: 9, alpha: { from: 1, to: 0.6 }, angle: 90, duration: 900, ease: 'Cubic.Out' });
    const star = this.add.image(0, -20, 'i_star').setScale(1.4);
    const num = this.txt(0, -14, String(level), 44);
    const ribbon = this.add.nineslice(0, 52, 'btn_orange', undefined, 560, 110, 44, 44, 44, 44).setScale(0.5);
    const title = this.txt(0, 50, 'Новый уровень!', 26);
    const banner = this.add.container(cx, cy, [ribbon, title, star, num]).setScale(0);
    this.tweens.add({ targets: banner, scale: 1, duration: 600, ease: 'Back.Out' });
    this.tweens.add({ targets: star, angle: { from: -10, to: 10 }, duration: 600, yoyo: true, repeat: 2, ease: 'Sine.InOut' });
    for (let i = 0; i < 3; i++) this.time.delayedCall(i * 220, () => this.confetti.explode(60, cx + (i - 1) * this.W * 0.3, this.H + 10));
    this.time.delayedCall(2600, () => {
      this.tweens.add({ targets: [banner, rays], scale: 0, alpha: 0, duration: 350, ease: 'Back.In', onComplete: () => (banner.destroy(), rays.destroy()) });
      this.drawXp();
      const unlocked = (Object.values(CROPS) as Array<(typeof CROPS)[CropId]>).filter((c) => c.unlockLevel === level);
      for (const c of unlocked) this.floatText(cx, cy, `Открыто: ${c.name}!`, '#b8ff8a');
    });
  }

  // ---------------------------------------------------------------- раскладка

  private layout() {
    const W = this.W;
    const H = this.H;
    const safe = safeInsets();
    const top = 40 + safe.top;
    const bottom = H - 52 - Math.max(0, safe.bottom - 10);
    this.levelBox.setPosition(34, top);
    // счётчики колонкой в правом верхнем углу
    (['coins', 'wheat', 'carrot', 'mushrooms'] as Counter[]).forEach((k, i) => this.counters[k].box.setPosition(W - 14, top + i * 48));
    this.buildBtn.setPosition(W / 2, bottom);
    this.cancelBtn.setPosition(W / 2, bottom);
    this.hint.setPosition(W / 2, bottom - 62);
    this.hint.setWordWrapWidth(W - 40);
    this.hint.setAlign('center');
  }
}
