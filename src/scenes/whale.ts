// Кит в открытом море: неспешно плавает, иногда ныряет,
// а по нажатию выпускает фонтан из дыхала, иногда с радугой.

import Phaser from 'phaser';
import { anchor, POINTS } from '../game/art';
import { sfx } from '../game/sfx';
import { WHALE_SEA, iso } from '../game/world';
import { D } from './depth';
import type { FarmScene } from './FarmScene';

const SCALE = 1.3;

export class Whale {
  private img: Phaser.GameObjects.Image;
  private ripple: Phaser.GameObjects.Image;
  private jet: Phaser.GameObjects.Particles.ParticleEmitter;
  private drops: Phaser.GameObjects.Particles.ParticleEmitter;
  private wake: Phaser.GameObjects.Particles.ParticleEmitter;
  private x: number;
  private y: number;
  private diving = false;
  private spouting = false;
  private moveTween: Phaser.Tweens.Tween | null = null;

  constructor(private scene: FarmScene) {
    const start = this.randomPoint();
    this.x = start.x;
    this.y = start.y;
    this.ripple = anchor(scene.add.image(this.x, this.y, 'ripple'), 'ripple').setDepth(D.foam + 1).setAlpha(0.55);
    this.img = anchor(scene.add.image(this.x, this.y, 'whale'), 'whale').setDepth(D.foam + 2).setScale(SCALE);
    scene.tweens.add({ targets: this.ripple, scaleX: 1.15, scaleY: 1.2, alpha: 0.3, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.InOut' });

    // струя фонтана: крупные «облачка» воды и мелкие капли
    this.jet = scene.add
      .particles(0, 0, 'soft', {
        emitting: false,
        angle: { min: -96, max: -84 },
        speed: { min: 950, max: 1300 },
        gravityY: 1700,
        lifespan: 1300,
        scale: { start: 1.1, end: 2.6 },
        alpha: { start: 0.95, end: 0, ease: 'Cubic.In' },
        tint: [0xffffff, 0xe6f7ff, 0xbfe8ff],
      })
      .setDepth(D.fx);
    this.drops = scene.add
      .particles(0, 0, 'soft', {
        emitting: false,
        angle: { min: -130, max: -50 },
        speed: { min: 450, max: 1000 },
        gravityY: 1700,
        lifespan: 1400,
        scale: { start: 0.45, end: 0.25 },
        alpha: { start: 1, end: 0, ease: 'Cubic.In' },
        tint: [0xffffff, 0xcdefff, 0x9fdcff],
      })
      .setDepth(D.fx);
    // пенный след за китом
    this.wake = scene.add
      .particles(0, 0, 'soft', {
        frequency: 140,
        lifespan: 1600,
        speedX: { min: -10, max: 10 },
        scale: { start: 0.35, end: 1.2 },
        alpha: { start: 0.45, end: 0 },
        tint: 0xffffff,
      })
      .setDepth(D.foam + 1);

    this.swim();
    this.scheduleDive();
  }

  private randomPoint() {
    const s = WHALE_SEA;
    return iso(Phaser.Math.FloatBetween(s.tx0, s.tx1), Phaser.Math.FloatBetween(s.ty0, s.ty1));
  }

  /** Плывёт к случайной точке, потом выбирает следующую. */
  private swim() {
    const t = this.randomPoint();
    const dist = Phaser.Math.Distance.Between(this.x, this.y, t.x, t.y);
    this.img.setFlipX(t.x < this.x);
    this.moveTween = this.scene.tweens.add({
      targets: this,
      x: t.x,
      y: t.y,
      duration: Math.max(3000, (dist / 55) * 1000),
      ease: 'Sine.InOut',
      onComplete: () => this.scene.time.delayedCall(Phaser.Math.Between(800, 2500), () => this.swim()),
    });
  }

  private scheduleDive() {
    this.scene.time.delayedCall(Phaser.Math.Between(14000, 22000), () => {
      if (!this.spouting) this.dive();
      this.scheduleDive();
    });
  }

  /** Ныряет на несколько секунд и выныривает с брызгами. */
  private dive() {
    this.diving = true;
    this.scene.tweens.add({ targets: [this.img, this.ripple], alpha: 0, duration: 1200, ease: 'Sine.In' });
    this.scene.time.delayedCall(Phaser.Math.Between(2500, 4500), () => this.surface());
  }

  private surface(then?: () => void) {
    if (!this.diving) return then?.();
    this.diving = false;
    this.scene.tweens.killTweensOf(this.img);
    this.scene.tweens.add({ targets: this.img, alpha: 1, duration: 500, ease: 'Sine.Out', onComplete: () => then?.() });
    this.ripple.setAlpha(0.55);
    this.splash(10);
  }

  private splash(n: number) {
    this.drops.explode(n, this.x, this.y - 20);
  }

  private spoutPoint() {
    const p = POINTS.whaleSpout;
    return { x: this.x + (this.img.flipX ? -p.x : p.x) * SCALE, y: this.y + p.y * SCALE };
  }

  /** Фонтан из дыхала — как у настоящих китов. */
  private spout() {
    if (this.spouting) return;
    this.spouting = true;
    sfx.spout();
    // кит чуть приподнимается и сжимается перед выдохом
    this.scene.tweens.add({
      targets: this.img,
      scaleX: SCALE * 1.06,
      scaleY: SCALE * 0.9,
      duration: 160,
      yoyo: true,
      ease: 'Sine.Out',
    });
    let bursts = 0;
    const timer = this.scene.time.addEvent({
      delay: 45,
      repeat: 16,
      callback: () => {
        const p = this.spoutPoint();
        this.jet.explode(bursts < 10 ? 5 : 2, p.x, p.y);
        this.drops.explode(4, p.x, p.y);
        bursts++;
      },
    });
    // иногда в брызгах появляется радуга
    if (Math.random() < 0.5) {
      const p = this.spoutPoint();
      const rb = anchor(this.scene.add.image(p.x, p.y - 120, 'rainbow'), 'rainbow')
        .setDepth(D.fx - 1)
        .setAlpha(0)
        .setScale(2.4)
        .setBlendMode(Phaser.BlendModes.NORMAL);
      this.scene.tweens.add({ targets: rb, alpha: 0.7, duration: 600, delay: 350, yoyo: true, hold: 900, onComplete: () => rb.destroy() });
    }
    this.scene.time.delayedCall(900, () => {
      timer.remove();
      this.splash(14);
      this.spouting = false;
    });
  }

  /** true, если нажали на кита. */
  tap(wx: number, wy: number): boolean {
    const r = Math.max(170, 60 / this.scene.zoomLevel);
    if (Phaser.Math.Distance.Between(wx, wy, this.x, this.y - 30) > r) return false;
    if (this.diving) this.surface(() => this.spout());
    else this.spout();
    return true;
  }

  update() {
    const bobY = Math.sin(performance.now() / 700) * 5;
    this.img.setPosition(this.x, this.y + bobY);
    this.ripple.setPosition(this.x, this.y + 8);
    this.wake.setPosition(this.x + (this.img.flipX ? 150 : -150), this.y + 10);
    this.wake.emitting = !this.diving && (this.moveTween?.isPlaying() ?? false);
  }
}
