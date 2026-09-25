import Phaser from 'phaser';
import { DPR, state } from './game/context';
import { FarmScene } from './scenes/FarmScene';
import { UIScene } from './scenes/UIScene';
import { applyFrame, lockPortrait } from './game/viewport';

async function start() {
  // Ждём шрифт, иначе Phaser успеет нарисовать текст системным шрифтом.
  await Promise.race([
    document.fonts?.load('800 24px Rubik').catch(() => undefined),
    new Promise((r) => setTimeout(r, 2500)),
  ]);

  // Канвас в физических пикселях + zoom 1/DPR: картинка остаётся чёткой на Retina.
  const frame = applyFrame();
  const game = new Phaser.Game({
    type: Phaser.WEBGL,
    parent: 'game',
    width: frame.w * DPR,
    height: frame.h * DPR,
    backgroundColor: '#2f8fb3',
    antialias: true,
    scale: { mode: Phaser.Scale.NONE, zoom: 1 / DPR },
    input: { activePointers: 3 },
    scene: [FarmScene, UIScene],
  });

  if (import.meta.env.DEV) Object.assign(window, { game, state });

  const onResize = () => {
    const f = applyFrame();
    game.scale.resize(f.w * DPR, f.h * DPR);
    game.scale.setZoom(1 / DPR);
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(onResize, 200));
  window.addEventListener('pointerdown', lockPortrait, { once: true });
}

void start();
