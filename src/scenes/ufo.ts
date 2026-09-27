// Летающая тарелка: время от времени прилетает, лучом утаскивает одно животное
// (корову, овечку или курицу), а через некоторое время возвращает его на место.

import Phaser from 'phaser';
import { anchor } from '../game/art';
import { sfx } from '../game/sfx';
import { D } from './depth';
import type { FarmScene } from './FarmScene';

type Img = Phaser.GameObjects.Image;

/** Всё, что тарелке нужно знать о животном. */
export interface Abductee {
  ref: { x: number; y: number; lift: number; away: boolean; img: Img };
  kind: 'cow' | 'sheep' | 'chicken';
  /** Можно ли утащить прямо сейчас (не ест, не занято). */
  free(): boolean;
  /** Остановить собственное движение животного. */
  freeze(): void;
  /** Вернуть животному обычное поведение после приземления. */
  release(): void;
  /** Куда опустить при возвращении. */
  landingSpot(): { x: number; y: number };
}

/** Высота, на которой тарелка висит над животным. */
const HOVER = 520;
/** Докуда животное поднимается в луче перед тем, как исчезнуть в люке. */
const LIFT = 440;

export class Ufo {
  private img: Img;
  private beam: Img;
  private glow: Img;
  private motes: Phaser.GameObjects.Particles.ParticleEmitter;
  private x = 0;
  private y = 0;
  private busy = false;
  private visible = false;

  constructor(
    private scene: FarmScene,
    private candidates: () => Abductee[],
  ) {
    this.beam = anchor(scene.add.image(0, 0, 'beam'), 'beam').setDepth(D.fx - 5).setVisible(false).setBlendMode(Phaser.BlendModes.ADD);
    this.glow = scene.add.image(0, 0, 'soft').setTint(0xd8ffb0).setScale(4, 1.3).setAlpha(0).setDepth(D.decal + 1).setBlendMode(Phaser.BlendModes.ADD);
    this.img = anchor(scene.add.image(0, 0, 'ufo'), 'ufo').setDepth(D.sky - 5).setVisible(false);
    // искры, которые поднимаются по лучу
    this.motes = scene.add
      .particles(0, 0, 'spark', {
        emitting: false,
        frequency: 60,
        x: { min: -80, max: 80 },
        y: { min: -30, max: 10 },
        lifespan: 900,
        speedY: { min: -420, max: -260 },
        speedX: { min: -30, max: 30 },
        scale: { start: 0.5, end: 0 },
        tint: [0xe6ffb8, 0xffffff],
        blendMode: Phaser.BlendModes.ADD,
      })
      .setDepth(D.fx - 3);
    // первый визит — вскоре после запуска, чтобы игрок увидел тарелку
    this.schedule(Phaser.Math.Between(25_000, 40_000));
  }

  private schedule(ms: number) {
    this.scene.time.delayedCall(ms, () => this.visit());
  }

  // ---------------------------------------------------------------- полёт

  private flyIn(x: number, y: number, done: () => void) {
    const dir = Math.random() < 0.5 ? -1 : 1;
    this.x = x + dir * 1800;
    this.y = y - HOVER - 1200;
    this.visible = true;
    this.img.setVisible(true).setAngle(dir * -18);
    sfx.ufo();
    this.scene.tweens.add({ targets: this.img, angle: 0, duration: 1700, ease: 'Sine.Out' });
    this.scene.tweens.add({ targets: this, x, y: y - HOVER, duration: 1700, ease: 'Sine.Out', onComplete: done });
  }

  private flyAway(done: () => void) {
    const dir = Math.random() < 0.5 ? -1 : 1;
    sfx.ufo();
    this.scene.tweens.add({ targets: this.img, angle: dir * 20, duration: 400 });
    this.scene.tweens.add({
      targets: this,
      x: this.x + dir * 2000,
      y: this.y - 1400,
      duration: 1300,
      ease: 'Back.In',
      onComplete: () => {
        this.visible = false;
        this.img.setVisible(false);
        done();
      },
    });
  }

  /** Луч включается (раскрывается вниз) или гаснет. */
  private setBeam(on: boolean, groundX: number, groundY: number, done?: () => void) {
    this.beam.setPosition(groundX, groundY - HOVER + 40);
    this.glow.setPosition(groundX, groundY);
    if (on) {
      this.beam.setVisible(true).setScale(0.3, 0);
      this.motes.setPosition(groundX, groundY);
      this.motes.start();
      this.scene.tweens.add({ targets: this.beam, scaleX: 1, scaleY: 1, duration: 450, ease: 'Back.Out', onComplete: done });
      this.scene.tweens.add({ targets: this.glow, alpha: 0.8, duration: 450 });
      this.scene.tweens.add({ targets: this.beam, alpha: { from: 1, to: 0.7 }, duration: 260, yoyo: true, repeat: 5 });
    } else {
      this.motes.stop();
      this.scene.tweens.add({ targets: this.beam, scaleX: 0.3, scaleY: 0, duration: 350, ease: 'Back.In', onComplete: () => (this.beam.setVisible(false), done?.()) });
      this.scene.tweens.add({ targets: this.glow, alpha: 0, duration: 350 });
    }
  }

  // ---------------------------------------------------------------- похищение и возвращение

  private visit() {
    const list = this.candidates().filter((c) => c.free());
    if (this.busy || !list.length) {
      this.schedule(8_000);
      return;
    }
    this.busy = true;
    const t = Phaser.Utils.Array.GetRandom(list);
    t.freeze();
    const { ref } = t;
    this.flyIn(ref.x, ref.y, () => {
      // животное вздрагивает: заметило тарелку
      this.scene.tweens.add({ targets: ref.img, angle: { from: -10, to: 10 }, duration: 70, yoyo: true, repeat: 3, onComplete: () => ref.img.setAngle(0) });
      this.voice(t);
      this.setBeam(true, ref.x, ref.y, () => {
        sfx.beam(true);
        const baseScale = ref.img.scaleX;
        this.scene.tweens.add({
          targets: ref,
          lift: LIFT,
          duration: 1800,
          ease: 'Sine.In',
          onUpdate: (tw) => {
            const k = tw.progress;
            ref.img.setAngle(k * 540).setScale(baseScale * (1 - k * 0.55));
          },
          onComplete: () => {
            ref.away = true;
            ref.img.setAngle(0).setScale(baseScale);
            this.scene.fx.stars.explode(10, this.x, this.y + 30);
            this.setBeam(false, ref.x, ref.y, () =>
              this.flyAway(() => this.scene.time.delayedCall(Phaser.Math.Between(25_000, 45_000), () => this.bringBack(t))),
            );
          },
        });
      });
    });
  }

  private bringBack(t: Abductee) {
    const { ref } = t;
    const spot = t.landingSpot();
    ref.x = spot.x;
    ref.y = spot.y;
    this.flyIn(spot.x, spot.y, () => {
      this.setBeam(true, spot.x, spot.y, () => {
        sfx.beam(false);
        const baseScale = ref.img.scaleX;
        ref.lift = LIFT;
        ref.away = false;
        ref.img.setScale(baseScale * 0.45);
        this.scene.tweens.add({
          targets: ref,
          lift: 0,
          duration: 1800,
          ease: 'Sine.Out',
          onUpdate: (tw) => {
            const k = tw.progress;
            ref.img.setAngle((1 - k) * 360).setScale(baseScale * (0.45 + k * 0.55));
          },
          onComplete: () => {
            ref.img.setAngle(0).setScale(baseScale);
            this.landed(t);
            this.setBeam(false, spot.x, spot.y, () =>
              this.flyAway(() => {
                this.busy = false;
                this.schedule(Phaser.Math.Between(70_000, 130_000));
              }),
            );
          },
        });
      });
    });
  }

  /** Приземлилось: пыль, «голова кружится» — звёздочки по кругу, и голос. */
  private landed(t: Abductee) {
    const { ref } = t;
    this.scene.fx.dust.explode(10, ref.x, ref.y);
    const head = t.kind === 'chicken' ? 70 : t.kind === 'cow' ? 190 : 150;
    const stars: Img[] = [];
    for (let i = 0; i < 3; i++) {
      const s = this.scene.add.image(ref.x, ref.y - head, 'spark').setScale(0.55).setTint(0xffe066).setDepth(D.fx);
      stars.push(s);
    }
    const spin = { a: 0 };
    this.scene.tweens.add({
      targets: spin,
      a: Math.PI * 6,
      duration: 2400,
      onUpdate: () => {
        stars.forEach((s, i) => {
          const a = spin.a + (i * Math.PI * 2) / 3;
          s.setPosition(ref.x + Math.cos(a) * 45, ref.y - head + Math.sin(a) * 14);
        });
      },
      onComplete: () => stars.forEach((s) => s.destroy()),
    });
    this.scene.tweens.add({ targets: ref.img, angle: { from: -8, to: 8 }, duration: 300, yoyo: true, repeat: 3, onComplete: () => ref.img.setAngle(0) });
    this.voice(t);
    this.scene.time.delayedCall(2400, () => t.release());
  }

  private voice(t: Abductee) {
    if (t.kind === 'cow') sfx.moo();
    else if (t.kind === 'sheep') sfx.baa();
    else sfx.cluck();
  }

  /** Нажали на тарелку: она покачивается и пищит. */
  tap(wx: number, wy: number): boolean {
    if (!this.visible) return false;
    const r = Math.max(150, 60 / this.scene.zoomLevel);
    if (Phaser.Math.Distance.Between(wx, wy, this.x, this.y) > r) return false;
    sfx.ufoBeep();
    this.scene.tweens.add({ targets: this.img, angle: { from: -12, to: 12 }, duration: 90, yoyo: true, repeat: 2, onComplete: () => this.img.setAngle(0) });
    this.scene.fx.stars.explode(8, this.x, this.y);
    return true;
  }

  update() {
    if (!this.visible) return;
    // лёгкое покачивание в воздухе
    const bob = Math.sin(performance.now() / 300) * 8;
    this.img.setPosition(this.x, this.y + bob);
  }
}
