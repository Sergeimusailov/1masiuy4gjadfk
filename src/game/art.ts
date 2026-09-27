// Процедурная графика: все текстуры рисуются в <canvas> через Canvas 2D
// и регистрируются в Phaser как обычные картинки. В настоящей игре
// здесь были бы PNG/атласы от художника — остальной код от этого не зависит.

import Phaser from 'phaser';
import { TW, TH, ISLANDS } from './world';

type Ctx = CanvasRenderingContext2D;
type Pt = { x: number; y: number };

/** Высота обрыва острова. */
export const CLIFF = 90;

/**
 * Точка привязки текстуры: пиксель, который совпадает с позицией объекта
 * в мире (центр основания здания, верхний угол тайла и т. п.).
 */
export const ANCHORS: Record<string, { x: number; y: number }> = {};
/** Дополнительные точки внутри текстуры относительно якоря (труба, ступица мельницы). */
export const POINTS: Record<string, Pt> = {};

let seed = 1;
function rnd() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const rr = (a: number, b: number) => a + rnd() * (b - a);

function make(
  scene: Phaser.Scene,
  key: string,
  w: number,
  h: number,
  anchor: Pt | null,
  draw: (ctx: Ctx) => void,
) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  seed = key.split('').reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7);
  draw(ctx);
  if (scene.textures.exists(key)) scene.textures.remove(key);
  scene.textures.addCanvas(key, c);
  if (anchor) ANCHORS[key] = { x: anchor.x / w, y: anchor.y / h };
}

/** Ставит origin объекта по якорю текстуры. */
export function anchor<T extends Phaser.GameObjects.Components.Origin>(obj: T, key: string): T {
  const a = ANCHORS[key];
  if (a) obj.setOrigin(a.x, a.y);
  return obj;
}

// ---------- примитивы ----------

function poly(ctx: Ctx, pts: Pt[], fill?: string | CanvasGradient, stroke?: string, lw = 3) {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
}

function rrect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function circle(ctx: Ctx, x: number, y: number, r: number, fill: string | CanvasGradient) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

function ellipse(ctx: Ctx, x: number, y: number, rx: number, ry: number, fill: string | CanvasGradient, rot = 0) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

function softShadow(ctx: Ctx, x: number, y: number, rx: number, ry: number, alpha = 0.28) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, `rgba(20,40,10,${alpha})`);
  g.addColorStop(0.6, `rgba(20,40,10,${alpha * 0.6})`);
  g.addColorStop(1, 'rgba(20,40,10,0)');
  circle(ctx, 0, 0, rx, g);
  ctx.restore();
}

/** Трансформация «плоско на земле»: (u, v) в тайлах → пиксели изометрии. */
function ground(ctx: Ctx, ox: number, oy: number) {
  ctx.setTransform(TW / 2, TH / 2, -TW / 2, TH / 2, ox, oy);
}

function lingrad(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, stops: string[]) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
  return g;
}

function radgrad(ctx: Ctx, x: number, y: number, r0: number, r1: number, stops: string[], fx = x, fy = y) {
  const g = ctx.createRadialGradient(fx, fy, r0, x, y, r1);
  stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
  return g;
}

/** Лист: основание в (x, y), направлен под углом a (0 — вверх). */
function leaf(ctx: Ctx, x: number, y: number, a: number, len: number, wid: number, fill: string, bend = 0.25) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(wid + len * bend, -len * 0.5, len * bend * 1.6, -len);
  ctx.quadraticCurveTo(-wid + len * bend, -len * 0.5, 0, 0);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();
}

// ---------- земля ----------

const GRASS = '#7cc444'; // трава фермы (подложка тропинки)

interface GrassStyle {
  base: string;
  blades: string[];
  flowers: string[];
  litter?: string[];
}

const FARM_GRASS: GrassStyle = {
  base: '#7cc444',
  blades: ['#8fd352', '#6bb536', '#9ada5c', '#62a832'],
  flowers: ['#fff7e0', '#ffd84a', '#ff9ec7'],
};
const FOREST_GRASS: GrassStyle = {
  base: '#4d9434',
  blades: ['#3f7f2a', '#5aa33c', '#36722a', '#61ad42'],
  flowers: [],
  litter: ['#8a5a2b', '#b07a3a', '#6e4a22', '#c9913f'],
};
const MEADOW_GRASS: GrassStyle = {
  base: '#94d152',
  blades: ['#a6de62', '#80c142', '#b4e874', '#77b83c'],
  flowers: ['#ffffff', '#ffe066', '#ffffff'],
};
const CLEARING_GRASS: GrassStyle = {
  base: '#86c94a',
  blades: ['#9ad65a', '#74b83c', '#a6e064', '#6aad38'],
  flowers: ['#ffffff', '#fff27a', '#c9a7ff'],
};

function drawGrass(ctx: Ctx, variant: number, style: GrassStyle = FARM_GRASS) {
  ground(ctx, 130, 2);
  poly(ctx, [
    { x: -0.012, y: -0.012 },
    { x: 1.012, y: -0.012 },
    { x: 1.012, y: 1.012 },
    { x: -0.012, y: 1.012 },
  ]);
  ctx.fillStyle = style.base;
  ctx.fill();
  ctx.clip();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // мелкая фактура: травинки и пятнышки
  const blades = style.blades;
  for (let i = 0; i < 70 + variant * 10; i++) {
    const u = rnd();
    const v = rnd();
    const x = 130 + (u - v) * 128;
    const y = 2 + (u + v) * 64;
    ctx.strokeStyle = blades[(rnd() * blades.length) | 0];
    ctx.lineWidth = rr(1.5, 3);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + rr(-3, 3), y - rr(4, 9));
    ctx.stroke();
  }
  // опавшие листья и хвоя в лесу
  if (style.litter) {
    for (let i = 0; i < 14; i++) {
      const u = rnd();
      const v = rnd();
      const x = 130 + (u - v) * 128;
      const y = 2 + (u + v) * 64;
      ellipse(ctx, x, y, rr(3, 6), rr(1.6, 3), style.litter[(rnd() * style.litter.length) | 0], rr(0, Math.PI));
    }
  }
  if (variant === 2 && style.flowers.length) {
    // пара цветочков
    for (let i = 0; i < 4; i++) {
      const u = rr(0.15, 0.85);
      const v = rr(0.15, 0.85);
      const x = 130 + (u - v) * 128;
      const y = 2 + (u + v) * 64;
      const col = style.flowers[i % style.flowers.length];
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        ellipse(ctx, x + Math.cos(a) * 3.2, y + Math.sin(a) * 2, 2.6, 2, col);
      }
      circle(ctx, x, y, 1.8, '#f4a300');
    }
  }
}

function drawPath(ctx: Ctx) {
  ground(ctx, 130, 2);
  poly(ctx, [
    { x: -0.012, y: -0.012 },
    { x: 1.012, y: -0.012 },
    { x: 1.012, y: 1.012 },
    { x: -0.012, y: 1.012 },
  ]);
  ctx.fillStyle = GRASS;
  ctx.fill();
  ctx.clip();
  // песчаная дорожка на всю клетку; края с травой получаются из соседних тайлов
  ground(ctx, 130, 2);
  ctx.fillStyle = '#e3c58d';
  ctx.fillRect(-0.05, -0.05, 1.1, 1.1);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (let i = 0; i < 26; i++) {
    const u = rnd();
    const v = rnd();
    const x = 130 + (u - v) * 128;
    const y = 2 + (u + v) * 64;
    ellipse(ctx, x, y, rr(2, 5), rr(1.5, 3), rnd() > 0.5 ? '#cfae74' : '#f0d9a8');
  }
}

function drawCliff(ctx: Ctx, right: boolean) {
  // грань от левого угла к нижнему (right=false) или от нижнего к правому
  const top = right ? [{ x: 1, y: 65 }, { x: 129, y: 1 }] : [{ x: 1, y: 1 }, { x: 129, y: 65 }];
  const pts = [top[0], top[1], { x: top[1].x, y: top[1].y + CLIFF }, { x: top[0].x, y: top[0].y + CLIFF }];
  ctx.save();
  poly(ctx, pts, lingrad(ctx, 0, 0, 0, 65 + CLIFF, ['#a8733f', '#8a5a30', '#6a4224']));
  ctx.clip();
  const yAt = (x: number) => top[0].y + ((top[1].y - top[0].y) * (x - 1)) / 128;
  // слои породы
  for (let k = 1; k <= 3; k++) {
    ctx.strokeStyle = 'rgba(60,35,15,0.25)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = 0; x <= 130; x += 8) {
      const y = yAt(x) + k * 24 + Math.sin(x * 0.09 + k) * 3;
      x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
  }
  // камни
  for (let i = 0; i < 9; i++) {
    const x = rr(6, 124);
    const y = yAt(x) + rr(22, CLIFF - 8);
    ellipse(ctx, x, y + 2, rr(6, 11), rr(4, 7), 'rgba(50,30,15,0.35)');
    ellipse(ctx, x, y, rr(6, 10), rr(4, 6), rnd() > 0.5 ? '#b99a7a' : '#9d8266');
    ellipse(ctx, x - 2, y - 2, 3, 1.6, 'rgba(255,255,255,0.3)');
  }
  // травяной «козырёк» с подтёками
  ctx.beginPath();
  ctx.moveTo(0, yAt(0) - 2);
  ctx.lineTo(130, yAt(130) - 2);
  for (let x = 130; x >= 0; x -= 10) {
    const drip = 10 + (Math.sin(x * 0.7) + 1) * 5 + rnd() * 6;
    ctx.quadraticCurveTo(x + 5, yAt(x) + drip + 6, x, yAt(x) + 10);
  }
  ctx.closePath();
  ctx.fillStyle = '#5ea72f';
  ctx.fill();
  if (right) {
    ctx.fillStyle = 'rgba(20,10,40,0.2)';
    ctx.fillRect(0, 0, 130, 200);
  }
  ctx.restore();
}

function drawPlot(ctx: Ctx) {
  const shape = () => {
    rrect(ctx, 0.08, 0.08, 0.84, 0.84, 0.14);
  };
  // бортик (сдвиг вниз)
  ground(ctx, 130, 12);
  shape();
  ctx.fillStyle = '#5d3a1c';
  ctx.fill();
  ground(ctx, 130, 2);
  shape();
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = lingrad(ctx, 0, 10, 0, 130, ['#a4703f', '#86552d', '#744624']);
  ctx.fill();
  ctx.clip();
  ground(ctx, 130, 2);
  for (const v of [0.26, 0.42, 0.58, 0.74]) {
    ctx.lineWidth = 0.05;
    ctx.strokeStyle = 'rgba(70,38,14,0.55)';
    ctx.beginPath();
    ctx.moveTo(0.1, v + 0.015);
    ctx.lineTo(0.9, v + 0.015);
    ctx.stroke();
    ctx.lineWidth = 0.03;
    ctx.strokeStyle = 'rgba(255,215,160,0.22)';
    ctx.beginPath();
    ctx.moveTo(0.1, v - 0.035);
    ctx.lineTo(0.9, v - 0.035);
    ctx.stroke();
  }
  ctx.restore();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function drawTileHL(ctx: Ctx) {
  ground(ctx, 130, 2);
  poly(ctx, [
    { x: 0.03, y: 0.03 },
    { x: 0.97, y: 0.03 },
    { x: 0.97, y: 0.97 },
    { x: 0.03, y: 0.97 },
  ]);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 6;
  ctx.stroke();
}

function drawPond(ctx: Ctx, w: number, h: number) {
  const ox = h * (TW / 2) + 10;
  ground(ctx, ox, 10);
  rrect(ctx, 0.1, 0.12, w - 0.2, h - 0.24, 0.8);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#d8bf8a';
  ctx.fill();
  ctx.restore();
  ground(ctx, ox, 10);
  rrect(ctx, 0.28, 0.3, w - 0.56, h - 0.6, 0.65);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const c = { x: ox + ((w - h) * TW) / 4, y: 10 + ((w + h) * TH) / 4 };
  ctx.fillStyle = radgrad(ctx, c.x, c.y, 10, 260, ['#2a86b8', '#3aa7d4', '#72d0ec']);
  ctx.fill();
  ctx.clip();
  // блики на воде
  for (let i = 0; i < 12; i++) {
    const x = c.x + rr(-200, 200);
    const y = c.y + rr(-70, 70);
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(x, y, rr(10, 22), rr(3, 6), 0, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
  }
  // кувшинки
  for (const [dx, dy, r] of [
    [-120, 10, 16],
    [-90, 30, 11],
    [110, -10, 15],
    [60, 40, 12],
  ]) {
    ctx.save();
    ctx.translate(c.x + dx, c.y + dy);
    ctx.scale(1, 0.55);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r, 0.3, Math.PI * 2 - 0.1);
    ctx.closePath();
    ctx.fillStyle = '#4fa83a';
    ctx.fill();
    ctx.restore();
    if (r > 14) {
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        ellipse(ctx, c.x + dx + Math.cos(a) * 4, c.y + dy - 3 + Math.sin(a) * 2.4, 4, 2.4, '#ffc1dc');
      }
      circle(ctx, c.x + dx, c.y + dy - 3, 2.4, '#ffd84a');
    }
  }
  ctx.restore();
  // камыши по краям
  const reeds = [
    [c.x - 250, c.y + 15],
    [c.x - 235, c.y + 25],
    [c.x + 215, c.y - 55],
    [c.x + 228, c.y - 45],
    [c.x + 30, c.y + 110],
  ];
  for (const [x, y] of reeds) {
    for (let k = 0; k < 4; k++) {
      const bx = x + k * 5 - 8;
      const len = rr(28, 44);
      const tip = bx + rr(-6, 6);
      ctx.strokeStyle = '#4c8d2a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(bx, y);
      ctx.quadraticCurveTo(bx, y - len * 0.6, tip, y - len);
      ctx.stroke();
      if (k % 2 === 0) {
        ellipse(ctx, tip, y - len + 6, 3.2, 8, '#8a5a2b');
      }
    }
  }
}

// ---------- постройки ----------

type Fn = (u: number, v: number, z?: number) => Pt;
const isoP =
  (cx: number, cy: number): Fn =>
  (u, v, z = 0) => ({ x: cx + (u - v) * (TW / 2), y: cy + (u + v) * (TH / 2) - z });

interface RoofOpts {
  H: number;
  R: number;
  over: number;
  wallL: [string, string];
  wallR: [string, string];
  roof: string[];
  roofBack: string;
  trim: string;
}

/**
 * Коробка-дом w×h тайлов с двускатной крышей (конёк вдоль оси u).
 * Возвращает функции для рисования на левой/правой стене.
 */
function gableHouse(ctx: Ctx, P: Fn, w: number, h: number, o: RoofOpts, decorate: (face: 'L' | 'R' | 'G') => void) {
  const { H, R, over } = o;
  const hu = w / 2;
  const hv = h / 2;
  const ev = hv + over;
  const eu = hu + over;
  const e = 12;

  // стены
  const W0 = P(-hu, hv, 0);
  const S0 = P(hu, hv, 0);
  const E0 = P(hu, -hv, 0);
  poly(ctx, [W0, S0, P(hu, hv, H), P(-hu, hv, H)], lingrad(ctx, 0, W0.y, 0, W0.y - H, o.wallL));
  poly(ctx, [S0, E0, P(hu, -hv, H), P(hu, hv, H)], lingrad(ctx, 0, S0.y, 0, S0.y - H, o.wallR));

  ctx.save();
  ctx.setTransform(TW / 2, TH / 2, 0, -1, W0.x, W0.y);
  decorate('L');
  ctx.restore();
  ctx.save();
  ctx.setTransform(TW / 2, -TH / 2, 0, -1, S0.x, S0.y);
  decorate('R');
  ctx.restore();

  // задний скат
  poly(ctx, [P(-eu, 0, H + R), P(eu, 0, H + R), P(eu, -ev, H - e), P(-eu, -ev, H - e)], o.roofBack);
  // фронтон
  poly(ctx, [P(hu, -hv, H), P(hu, hv, H), P(hu, 0, H + R - 6)], lingrad(ctx, 0, S0.y - H, 0, S0.y - H - R, o.wallR));
  ctx.save();
  ctx.setTransform(TW / 2, -TH / 2, 0, -1, S0.x, S0.y);
  decorate('G');
  ctx.restore();
  // край кровли над фронтоном
  poly(ctx, [P(eu, 0, H + R + 4), P(eu, ev, H - e), P(eu, ev, H - e - 10), P(eu, 0, H + R - 8)], o.trim);
  poly(ctx, [P(eu, 0, H + R + 4), P(eu, -ev, H - e), P(eu, -ev, H - e - 10), P(eu, 0, H + R - 8)], o.trim);
  // передний скат
  const front = [P(-eu, 0, H + R), P(eu, 0, H + R), P(eu, ev, H - e), P(-eu, ev, H - e)];
  const fg = lingrad(ctx, 0, front[0].y, 0, front[3].y, o.roof);
  poly(ctx, front, fg);
  ctx.save();
  poly(ctx, front);
  ctx.clip();
  // черепица
  for (let t = 0.12; t < 1; t += 0.13) {
    const a = P(-eu, ev * t, H + R - (R + e) * t);
    const b = P(eu, ev * t, H + R - (R + e) * t);
    ctx.strokeStyle = 'rgba(0,0,0,0.16)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y - 4);
    ctx.lineTo(b.x, b.y - 4);
    ctx.stroke();
  }
  ctx.restore();
  // свес
  poly(ctx, [P(-eu, ev, H - e), P(eu, ev, H - e), P(eu, ev, H - e - 10), P(-eu, ev, H - e - 10)], o.trim);
  // конёк
  const r0 = P(-eu, 0, H + R);
  const r1 = P(eu, 0, H + R);
  ctx.strokeStyle = o.trim;
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(r0.x, r0.y);
  ctx.lineTo(r1.x, r1.y);
  ctx.stroke();
}

/** Линия на грани постройки постоянной толщины (в экранных пикселях). */
function faceLine(ctx: Ctx, s0: number, z0: number, s1: number, z1: number, color: string, width: number) {
  const m = ctx.getTransform();
  const a = m.transformPoint(new DOMPoint(s0, z0));
  const b = m.transformPoint(new DOMPoint(s1, z1));
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.restore();
}

function faceRect(ctx: Ctx, s: number, z: number, ds: number, dz: number, fill: string | CanvasGradient) {
  ctx.fillStyle = fill;
  ctx.fillRect(s, z, ds, dz);
}

/** Окно на грани (координаты в тайлах по горизонтали и пикселях по вертикали). */
function faceWindow(ctx: Ctx, s: number, z: number, ds: number, dz: number, box = true) {
  const f = 0.035;
  faceRect(ctx, s - f, z - 6, ds + 2 * f, dz + 12, '#ffffff');
  const g = ctx.createLinearGradient(0, z + dz, 0, z);
  g.addColorStop(0, '#5fc1ef');
  g.addColorStop(1, '#bdeeff');
  faceRect(ctx, s, z, ds, dz, g);
  faceRect(ctx, s + ds / 2 - 0.012, z, 0.024, dz, '#ffffff');
  faceRect(ctx, s, z + dz / 2 - 2, ds, 4, '#ffffff');
  faceRect(ctx, s + 0.02, z + dz * 0.55, ds * 0.18, dz * 0.4, 'rgba(255,255,255,0.55)');
  if (box) {
    faceRect(ctx, s - f * 1.5, z - 18, ds + 3 * f, 12, '#8b5a2b');
    for (let i = 0; i < 6; i++) {
      const cx = s - f + (i + 0.5) * ((ds + 2 * f) / 6);
      faceRect(ctx, cx - 0.012, z - 10, 0.024, 7, ['#ff5d8a', '#ffd84a', '#ffffff'][i % 3]);
    }
  }
}

function drawHouse(ctx: Ctx, cx: number, cy: number) {
  const P = isoP(cx, cy);
  softShadow(ctx, cx + 30, cy + 10, 270, 130, 0.3);
  const H = 120;
  gableHouse(
    ctx,
    P,
    2,
    2,
    {
      H,
      R: 100,
      over: 0.14,
      wallL: ['#f0dcb4', '#fbeed3'],
      wallR: ['#d4bb8f', '#e2cba2'],
      roof: ['#ff8a4c', '#e6583a', '#c9432c'],
      roofBack: '#a8392a',
      trim: '#7a3b22',
    },
    (face) => {
      if (face === 'L') {
        faceRect(ctx, 0, 0, 2, 14, '#b98d5a');
        faceRect(ctx, 0, 0, 0.05, H, '#9b6b3d');
        faceRect(ctx, 1.95, 0, 0.05, H, '#9b6b3d');
        // дверь
        faceRect(ctx, 0.3, 0, 0.36, 82, '#ffffff');
        faceRect(ctx, 0.33, 0, 0.3, 76, lingrad(ctx, 0, 0, 0, 76, ['#7a4623', '#a4643a']));
        faceRect(ctx, 0.36, 36, 0.24, 3, 'rgba(0,0,0,0.25)');
        faceRect(ctx, 0.56, 36, 0.03, 6, '#ffd84a');
        faceWindow(ctx, 1.05, 44, 0.6, 46);
      } else if (face === 'R') {
        faceRect(ctx, 0, 0, 2, 14, '#9f7a4c');
        faceRect(ctx, 1.95, 0, 0.05, H, '#7f5530');
        faceWindow(ctx, 0.3, 44, 0.48, 46);
        faceWindow(ctx, 1.15, 44, 0.48, 46);
      } else {
        // круглое окошко на фронтоне
        ctx.save();
        ctx.translate(1, H + 40);
        ctx.scale(1 / 128, 1);
        circle(ctx, 0, 0, 20, '#ffffff');
        circle(ctx, 0, 0, 15, '#8ad8f5');
        ctx.restore();
      }
    },
  );
  // труба
  const base = P(-0.4, -0.35, 0);
  const cxp = base.x;
  const top = base.y - H - 120;
  poly(ctx, [
    { x: cxp - 18, y: top + 70 },
    { x: cxp, y: top + 79 },
    { x: cxp, y: top },
    { x: cxp - 18, y: top - 9 },
  ], '#b0543a');
  poly(ctx, [
    { x: cxp, y: top + 79 },
    { x: cxp + 18, y: top + 70 },
    { x: cxp + 18, y: top - 9 },
    { x: cxp, y: top },
  ], '#8c3f2c');
  poly(ctx, [
    { x: cxp - 22, y: top - 9 },
    { x: cxp, y: top + 2 },
    { x: cxp + 22, y: top - 9 },
    { x: cxp, y: top - 20 },
  ], '#5a2a1e');
  POINTS.houseChimney = { x: cxp - cx, y: top - 12 - cy };
}

function drawBarn(ctx: Ctx, cx: number, cy: number) {
  const P = isoP(cx, cy);
  softShadow(ctx, cx + 30, cy + 10, 270, 130, 0.3);
  const H = 130;
  const white = '#fff8ec';
  gableHouse(
    ctx,
    P,
    2,
    2,
    {
      H,
      R: 110,
      over: 0.12,
      wallL: ['#c9412f', '#e45a3d'],
      wallR: ['#a33327', '#bd4232'],
      roof: ['#8b5e4a', '#6f4636', '#5a382b'],
      roofBack: '#4a2e24',
      trim: white,
    },
    (face) => {
      if (face === 'L') {
        // доски
        for (let s = 0.12; s < 2; s += 0.12) faceRect(ctx, s, 0, 0.012, H, 'rgba(0,0,0,0.12)');
        faceRect(ctx, 0, 0, 0.06, H, white);
        faceRect(ctx, 1.94, 0, 0.06, H, white);
        faceRect(ctx, 0, H - 8, 2, 8, white);
        // ворота с крестом
        const s0 = 0.5;
        const ds = 1.0;
        const dz = 100;
        faceRect(ctx, s0 - 0.05, 0, ds + 0.1, dz + 8, white);
        faceRect(ctx, s0, 0, ds, dz, '#8e2c22');
        for (const [a, b] of [
          [s0, s0 + ds / 2],
          [s0 + ds / 2, s0 + ds],
        ]) {
          faceLine(ctx, a, 0, b, dz, white, 6);
          faceLine(ctx, a, dz, b, 0, white, 6);
        }
        faceRect(ctx, s0 + ds / 2 - 0.02, 0, 0.04, dz, white);
      } else if (face === 'R') {
        for (let s = 0.12; s < 2; s += 0.12) faceRect(ctx, s, 0, 0.012, H, 'rgba(0,0,0,0.14)');
        faceRect(ctx, 1.94, 0, 0.06, H, white);
        faceRect(ctx, 0, H - 8, 2, 8, white);
        faceWindow(ctx, 0.7, 50, 0.6, 44, false);
      } else {
        // сеновал на фронтоне
        faceRect(ctx, 0.78, H + 18, 0.44, 56, white);
        faceRect(ctx, 0.82, H + 22, 0.36, 48, '#3a2419');
        faceRect(ctx, 0.84, H + 22, 0.32, 22, '#f2c94c');
        faceRect(ctx, 0.84, H + 40, 0.32, 5, '#e0b13a');
      }
    },
  );
}

function drawWindmill(ctx: Ctx, cx: number, cy: number) {
  softShadow(ctx, cx + 30, cy + 10, 170, 80, 0.32);
  // каменное основание
  ellipse(ctx, cx, cy, 100, 48, '#9c8a6e');
  ellipse(ctx, cx, cy - 8, 96, 44, '#c7b48f');
  const baseY = cy - 8;
  const Hh = 230;
  const topY = baseY - Hh;
  const bw = 72;
  const tw = 46;
  const body = [
    { x: cx - bw, y: baseY },
    { x: cx + bw, y: baseY },
    { x: cx + tw, y: topY },
    { x: cx - tw, y: topY },
  ];
  ctx.save();
  poly(ctx, body, lingrad(ctx, cx - bw, 0, cx + bw, 0, ['#fff4dc', '#f2e1bd', '#d4bd92', '#a88f68']));
  ctx.clip();
  for (let y = baseY - 22; y > topY; y -= 26) {
    ctx.strokeStyle = 'rgba(120,95,60,0.22)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - bw, y);
    ctx.quadraticCurveTo(cx, y + 12, cx + bw, y);
    ctx.stroke();
  }
  ctx.restore();
  // дверь
  ctx.beginPath();
  ctx.moveTo(cx - 18, baseY + 4);
  ctx.lineTo(cx - 18, baseY - 40);
  ctx.arc(cx - 2, baseY - 40, 16, Math.PI, 0);
  ctx.lineTo(cx + 14, baseY + 6);
  ctx.closePath();
  ctx.fillStyle = '#7a4623';
  ctx.fill();
  ctx.strokeStyle = '#5a3218';
  ctx.lineWidth = 3;
  ctx.stroke();
  // окошко
  circle(ctx, cx - 6, baseY - 120, 15, '#ffffff');
  circle(ctx, cx - 6, baseY - 120, 11, '#7fd0f0');
  circle(ctx, cx - 9, baseY - 124, 4, 'rgba(255,255,255,0.7)');
  // купол
  ctx.beginPath();
  ctx.moveTo(cx - tw - 12, topY + 6);
  ctx.quadraticCurveTo(cx - tw, topY - 70, cx, topY - 78);
  ctx.quadraticCurveTo(cx + tw, topY - 70, cx + tw + 12, topY + 6);
  ctx.closePath();
  ctx.fillStyle = lingrad(ctx, cx - tw, 0, cx + tw, 0, ['#ff8a5c', '#e2553a', '#a83424']);
  ctx.fill();
  ellipse(ctx, cx, topY + 5, tw + 14, 10, '#7a3b22');
  circle(ctx, cx, topY - 80, 7, '#ffd84a');
  POINTS.windmillHub = { x: 0, y: topY - 22 - cy };
}

function drawBlades(ctx: Ctx) {
  const c = 170;
  for (let i = 0; i < 4; i++) {
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate((i * Math.PI) / 2);
    // лонжерон
    ctx.fillStyle = '#6b4424';
    ctx.fillRect(-4, -165, 8, 165);
    // парус-решётка
    ctx.fillStyle = 'rgba(255,250,235,0.95)';
    ctx.fillRect(4, -160, 38, 125);
    ctx.strokeStyle = '#8b5a2b';
    ctx.lineWidth = 3;
    ctx.strokeRect(4, -160, 38, 125);
    for (let y = -145; y < -35; y += 16) {
      ctx.beginPath();
      ctx.moveTo(4, y);
      ctx.lineTo(42, y);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(23, -160);
    ctx.lineTo(23, -35);
    ctx.stroke();
    ctx.restore();
  }
  circle(ctx, c, c, 18, '#5a3218');
  circle(ctx, c, c, 11, '#8b5a2b');
  circle(ctx, c - 3, c - 3, 4, 'rgba(255,255,255,0.4)');
}

// ---------- растительность ----------

function blob(ctx: Ctx, x: number, y: number, r: number, light: string, mid: string, dark: string) {
  circle(ctx, x + r * 0.08, y + r * 0.1, r, dark);
  circle(ctx, x, y, r * 0.96, radgrad(ctx, x, y, r * 0.1, r, [light, mid, dark], x - r * 0.4, y - r * 0.45));
}

function drawTree(ctx: Ctx, cx: number, cy: number) {
  softShadow(ctx, cx + 22, cy - 4, 80, 32);
  ctx.fillStyle = lingrad(ctx, cx - 12, 0, cx + 12, 0, ['#9a6a3e', '#7a4f2c', '#5a3a1f']);
  ctx.beginPath();
  ctx.moveTo(cx - 13, cy);
  ctx.lineTo(cx - 8, cy - 90);
  ctx.lineTo(cx + 8, cy - 90);
  ctx.lineTo(cx + 13, cy);
  ctx.closePath();
  ctx.fill();
  const fy = cy - 128;
  const blobs: Array<[number, number, number]> = [
    [-44, 10, 38],
    [44, 12, 38],
    [0, 24, 42],
    [-24, -16, 40],
    [26, -14, 40],
    [0, -32, 42],
    [0, 2, 46],
  ];
  for (const [dx, dy, r] of blobs) blob(ctx, cx + dx, fy + dy, r, '#b4ec6a', '#6fbf3a', '#3f8a26');
  for (let i = 0; i < 14; i++) {
    circle(ctx, cx + rr(-60, 40), fy + rr(-60, 20), rr(3, 6), 'rgba(220,255,160,0.55)');
  }
  // яблоки
  for (let i = 0; i < 6; i++) {
    const x = cx + rr(-55, 55);
    const y = fy + rr(-35, 40);
    circle(ctx, x, y, 7, radgrad(ctx, x, y, 1, 7, ['#ff9a8a', '#e53b2c', '#a8231a'], x - 2, y - 2));
  }
}

function drawPine(ctx: Ctx, cx: number, cy: number) {
  softShadow(ctx, cx + 20, cy - 4, 64, 26);
  ctx.fillStyle = '#6e4526';
  ctx.fillRect(cx - 9, cy - 40, 18, 40);
  const layers = [
    [cy - 20, 78],
    [cy - 80, 64],
    [cy - 135, 50],
    [cy - 185, 36],
  ];
  layers.forEach(([by, w], i) => {
    const ty = by - 110 + i * 8;
    ctx.beginPath();
    ctx.moveTo(cx, ty);
    ctx.quadraticCurveTo(cx + w * 0.5, by - 50, cx + w, by);
    for (let k = 0; k <= 6; k++) {
      const x = cx + w - (k * 2 * w) / 6;
      ctx.quadraticCurveTo(x + w / 6, by + 12, x, by);
    }
    ctx.quadraticCurveTo(cx - w * 0.5, by - 50, cx, ty);
    ctx.closePath();
    ctx.fillStyle = lingrad(ctx, cx - w, 0, cx + w, 0, ['#5cb85a', '#2f8a4a', '#1f6438']);
    ctx.fill();
    ctx.strokeStyle = 'rgba(10,50,25,0.35)';
    ctx.lineWidth = 3;
    ctx.stroke();
  });
  for (let i = 0; i < 10; i++) circle(ctx, cx + rr(-40, 10), cy - rr(40, 220), rr(2, 4), 'rgba(200,255,200,0.4)');
}

function drawBush(ctx: Ctx, cx: number, cy: number) {
  softShadow(ctx, cx + 10, cy - 4, 62, 22);
  for (const [dx, dy, r] of [
    [-30, -24, 26],
    [30, -22, 26],
    [0, -40, 32],
    [0, -18, 30],
  ])
    blob(ctx, cx + dx, cy + dy, r, '#a8e663', '#5cae33', '#357a22');
  for (let i = 0; i < 8; i++) {
    const x = cx + rr(-45, 45);
    const y = cy + rr(-60, -14);
    circle(ctx, x, y, 5, '#ff5577');
    circle(ctx, x - 1.5, y - 1.5, 1.6, 'rgba(255,255,255,0.8)');
  }
}

function drawRock(ctx: Ctx, cx: number, cy: number) {
  softShadow(ctx, cx + 8, cy - 2, 58, 20);
  const pts = [
    { x: cx - 48, y: cy - 6 },
    { x: cx - 36, y: cy - 38 },
    { x: cx - 6, y: cy - 54 },
    { x: cx + 30, y: cy - 44 },
    { x: cx + 48, y: cy - 12 },
    { x: cx + 30, y: cy + 4 },
    { x: cx - 20, y: cy + 6 },
  ];
  poly(ctx, pts, lingrad(ctx, cx - 40, cy - 50, cx + 40, cy, ['#e0dbd2', '#aaa296', '#7a7266']), '#5f574c', 3);
  poly(ctx, [pts[1], pts[2], pts[3], { x: cx - 2, y: cy - 26 }], 'rgba(255,255,255,0.35)');
  ellipse(ctx, cx - 26, cy - 8, 16, 7, 'rgba(110,170,60,0.75)');
}

// ---------- культуры ----------

const cropPos = (u: number, v: number) => ({ x: 130 + (u - v) * 128, y: 120 + (u + v) * 64 });

function plantSpots() {
  const spots: Pt[] = [];
  for (const u of [0.27, 0.5, 0.73]) for (const v of [0.27, 0.5, 0.73]) {
    const p = cropPos(u + rr(-0.03, 0.03), v + rr(-0.03, 0.03));
    spots.push(p);
  }
  return spots.sort((a, b) => a.y - b.y);
}

function drawWheat(ctx: Ctx, stage: number) {
  for (const p of plantSpots()) {
    ellipse(ctx, p.x, p.y + 2, 14, 5, 'rgba(50,25,5,0.3)');
    if (stage === 1) {
      for (let k = 0; k < 3; k++) leaf(ctx, p.x, p.y, (k - 1) * 0.5, rr(12, 18), 3, '#8fd650');
    } else if (stage === 2) {
      for (let k = 0; k < 6; k++) leaf(ctx, p.x, p.y, (k - 2.5) * 0.22, rr(30, 44), 4, k % 2 ? '#79c043' : '#5ba02e', 0.12);
    } else {
      for (let k = 0; k < 2; k++) leaf(ctx, p.x, p.y, (k ? 1 : -1) * 0.7, 28, 4, '#b7a543', 0.2);
      for (let k = 0; k < 6; k++) {
        const a = (k - 2.5) * 0.13 + rr(-0.04, 0.04);
        const L = rr(56, 70);
        const tx = p.x + Math.sin(a) * L;
        const ty = p.y - Math.cos(a) * L;
        ctx.strokeStyle = '#c99a3c';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.quadraticCurveTo(p.x + Math.sin(a) * L * 0.4, p.y - L * 0.6, tx, ty);
        ctx.stroke();
        // колос
        for (let g = 0; g < 7; g++) {
          const gy = ty - g * 5;
          const gx = tx + Math.sin(a) * g * 4;
          const side = g % 2 ? 1 : -1;
          ellipse(ctx, gx + side * 3, gy, 3.6, 6, g % 2 ? '#ffd65a' : '#f0b83a', side * 0.4 + a);
        }
        ctx.strokeStyle = 'rgba(255,240,180,0.8)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(tx + Math.sin(a) * 28, ty - 34);
        ctx.lineTo(tx + Math.sin(a) * 34 + 3, ty - 48);
        ctx.stroke();
      }
    }
  }
}

function drawCarrot(ctx: Ctx, stage: number) {
  for (const p of plantSpots()) {
    ellipse(ctx, p.x, p.y + 2, 14, 5, 'rgba(50,25,5,0.3)');
    if (stage === 1) {
      leaf(ctx, p.x, p.y, -0.6, 12, 5, '#4fa83a', 0.1);
      leaf(ctx, p.x, p.y, 0.6, 12, 5, '#62c043', 0.1);
      continue;
    }
    const big = stage === 3;
    if (big) {
      ellipse(ctx, p.x, p.y - 3, 13, 8, radgrad(ctx, p.x, p.y - 3, 1, 13, ['#ffc070', '#ff8a2a', '#d45f10'], p.x - 4, p.y - 6));
      ctx.strokeStyle = 'rgba(150,60,0,0.45)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(p.x - 7, p.y - 3);
      ctx.lineTo(p.x - 2, p.y - 2);
      ctx.moveTo(p.x + 3, p.y - 5);
      ctx.lineTo(p.x + 8, p.y - 4);
      ctx.stroke();
    }
    const stalks = big ? 6 : 4;
    for (let k = 0; k < stalks; k++) {
      const a = (k - (stalks - 1) / 2) * 0.32;
      const L = big ? rr(36, 46) : rr(22, 30);
      const tx = p.x + Math.sin(a) * L;
      const ty = p.y - 6 - Math.cos(a) * L;
      ctx.strokeStyle = '#3f8a2a';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 6);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      for (let j = 0; j < 4; j++) {
        const t = 0.45 + j * 0.18;
        const lx = p.x + (tx - p.x) * t;
        const ly = p.y - 6 + (ty - p.y + 6) * t;
        circle(ctx, lx - 4, ly, big ? 5 : 4, j % 2 ? '#56b03a' : '#3f9a2e');
        circle(ctx, lx + 4, ly - 1, big ? 5 : 4, j % 2 ? '#6cc84a' : '#4aa634');
      }
    }
  }
}

// ---------- живность и атмосфера ----------

function drawChicken(ctx: Ctx) {
  // хвост
  for (let i = 0; i < 3; i++) leaf(ctx, 22, 44, -1.2 + i * 0.35, 20, 5, i % 2 ? '#f1ece2' : '#ffffff', 0.05);
  ellipse(ctx, 38, 48, 21, 16, radgrad(ctx, 38, 48, 2, 22, ['#ffffff', '#f4f0e8', '#cfc8ba'], 32, 40));
  ellipse(ctx, 35, 50, 11, 7, '#ebe5d9', -0.2);
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // ноги
  ctx.strokeStyle = '#f0a020';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(34, 62);
  ctx.lineTo(32, 73);
  ctx.moveTo(43, 62);
  ctx.lineTo(45, 73);
  ctx.stroke();
  // голова
  circle(ctx, 56, 30, 11, radgrad(ctx, 56, 30, 1, 11, ['#ffffff', '#f2eee6'], 52, 26));
  circle(ctx, 52, 19, 4.5, '#ff3b3b');
  circle(ctx, 57, 18, 5, '#ff3b3b');
  circle(ctx, 62, 21, 4, '#ff3b3b');
  ellipse(ctx, 61, 41, 3, 5, '#ff3b3b');
  poly(ctx, [
    { x: 65, y: 28 },
    { x: 74, y: 32 },
    { x: 65, y: 35 },
  ], '#ffae1a');
  circle(ctx, 59, 28, 2.4, '#1e1e1e');
  circle(ctx, 59.8, 27.2, 0.9, '#ffffff');
}

function drawButterfly(ctx: Ctx) {
  const wing = (x: number, y: number, rx: number, ry: number, rot: number) => {
    ellipse(ctx, x, y, rx, ry, '#ffffff', rot);
    ctx.strokeStyle = 'rgba(40,20,40,0.6)';
    ctx.lineWidth = 1.6;
    ctx.stroke();
  };
  wing(12, 11, 10, 8, -0.4);
  wing(28, 11, 10, 8, 0.4);
  wing(14, 22, 7, 5, 0.3);
  wing(26, 22, 7, 5, -0.3);
  circle(ctx, 12, 11, 3, 'rgba(0,0,0,0.25)');
  circle(ctx, 28, 11, 3, 'rgba(0,0,0,0.25)');
  ellipse(ctx, 20, 16, 2.2, 9, '#2a1a2a');
}

function drawCloud(ctx: Ctx) {
  const puffs: Array<[number, number, number]> = [
    [110, 130, 60],
    [180, 100, 75],
    [260, 110, 68],
    [320, 138, 50],
    [215, 145, 60],
    [150, 150, 48],
  ];
  ctx.shadowColor = 'rgba(255,255,255,0.9)';
  ctx.shadowBlur = 18;
  for (const [x, y, r] of puffs) circle(ctx, x, y, r, '#ffffff');
  ctx.shadowBlur = 0;
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = lingrad(ctx, 0, 60, 0, 200, ['rgba(255,255,255,0)', 'rgba(200,225,245,0.0)', 'rgba(170,205,235,0.7)']);
  ctx.fillRect(0, 0, 420, 220);
  ctx.globalCompositeOperation = 'source-over';
}

function drawWater(ctx: Ctx) {
  ctx.fillStyle = '#3aaed6';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 14; i++) {
    const x = rr(0, 256);
    const y = rr(0, 256);
    const r = rr(30, 70);
    for (const ox of [-256, 0, 256])
      for (const oy of [-256, 0, 256]) {
        ctx.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,60,120,0.04)';
        ctx.beginPath();
        ctx.ellipse(x + ox, y + oy, r, r * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
  }
  for (let i = 0; i < 16; i++) {
    const x = rr(0, 256);
    const y = rr(0, 256);
    const w = rr(10, 22);
    for (const ox of [-256, 0, 256])
      for (const oy of [-256, 0, 256]) {
        ctx.strokeStyle = 'rgba(255,255,255,0.28)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(x + ox, y + oy, w, w * 0.35, 0, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
      }
  }
}

/** Тень острова и полоса пены у подножия обрыва (в половинном разрешении). */
function drawFoam(ctx: Ctx, pad: number, w: number, h: number) {
  const s = 0.5;
  const off = { x: ((h * TW) / 2 + pad) * s, y: pad * s };
  const P = (tx: number, ty: number, dy = 0) => ({
    x: off.x + (tx - ty) * (TW / 2) * s,
    y: off.y + ((tx + ty) * (TH / 2) + dy) * s,
  });
  const diamond = (dy: number, grow: number) => [
    P(-grow, -grow, dy),
    P(w + grow, -grow, dy),
    P(w + grow, h + grow, dy),
    P(-grow, h + grow, dy),
  ];
  ctx.shadowColor = 'rgba(0,50,80,0.55)';
  ctx.shadowBlur = 60;
  poly(ctx, diamond(CLIFF + 50, 0.1), 'rgba(0,60,90,0.35)');
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'rgba(255,255,255,0.9)';
  ctx.shadowBlur = 16;
  poly(ctx, diamond(CLIFF - 6, 0.12), undefined, 'rgba(255,255,255,0.75)', 10);
  ctx.shadowBlur = 0;
  poly(ctx, diamond(CLIFF + 14, 0.28), undefined, 'rgba(255,255,255,0.25)', 5);
}


// ---------- лес ----------

/** Плоско на земле: x — поперёк моста, y — вдоль. */
function bridgeGround(ctx: Ctx, ox: number, oy: number, axis: 'u' | 'v') {
  if (axis === 'v') ctx.setTransform(TW / 2, TH / 2, -TW / 2, TH / 2, ox, oy);
  else ctx.setTransform(-TW / 2, TH / 2, TW / 2, TH / 2, ox, oy);
}

function drawBridge(ctx: Ctx, ox: number, oy: number, axis: 'u' | 'v') {
  const pt = (across: number, along: number, z = 0) => {
    const [u, v] = axis === 'v' ? [across, along] : [along, across];
    return { x: ox + (u - v) * (TW / 2), y: oy + (u + v) * (TH / 2) - z };
  };
  // толщина настила
  bridgeGround(ctx, ox, oy + 10, axis);
  ctx.fillStyle = '#5a3a1c';
  ctx.fillRect(0.14, -0.05, 0.72, 2.1);
  // доски поперёк пролёта
  for (let v = -0.05; v < 2.05; v += 0.21) {
    bridgeGround(ctx, ox, oy, axis);
    ctx.fillStyle = Math.round(v / 0.21) % 2 ? '#b98552' : '#a8743f';
    ctx.fillRect(0.14, v, 0.72, 0.18);
    ctx.fillStyle = 'rgba(255,230,180,0.18)';
    ctx.fillRect(0.14, v, 0.72, 0.035);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // перила: столбики и поручни с обеих сторон
  for (const u of [0.16, 0.84]) {
    const posts = [0, 0.7, 1.4, 2.05].map((v) => ({ b: pt(u, v), t: pt(u, v, 30) }));
    ctx.strokeStyle = '#6e4624';
    ctx.lineWidth = 7;
    for (const p of posts) {
      ctx.beginPath();
      ctx.moveTo(p.b.x, p.b.y);
      ctx.lineTo(p.t.x, p.t.y);
      ctx.stroke();
    }
    ctx.strokeStyle = '#94643a';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(posts[0].t.x, posts[0].t.y);
    ctx.lineTo(posts[3].t.x, posts[3].t.y);
    ctx.stroke();
  }
}

function drawFern(ctx: Ctx, cx: number, cy: number) {
  softShadow(ctx, cx + 6, cy - 2, 46, 14, 0.22);
  const fronds = 7;
  for (let i = 0; i < fronds; i++) {
    const a = -1.25 + (i / (fronds - 1)) * 2.5;
    const len = rr(38, 52);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(a);
    ctx.strokeStyle = '#2f6e25';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(len * 0.25, -len * 0.6, len * 0.45, -len);
    ctx.stroke();
    for (let k = 1; k < 8; k++) {
      const t = k / 8;
      const x = len * 0.45 * t * t + len * 0.1 * t;
      const y = -len * t;
      const w = (1 - t) * 11 + 3;
      leaf(ctx, x, y, -1.2, w, 3, k % 2 ? '#4fa83a' : '#3d9030', 0.1);
      leaf(ctx, x, y, 1.2, w, 3, k % 2 ? '#5cb847' : '#46a035', 0.1);
    }
    ctx.restore();
  }
}

function drawStump(ctx: Ctx, cx: number, cy: number) {
  softShadow(ctx, cx + 8, cy - 2, 44, 16, 0.26);
  ctx.fillStyle = lingrad(ctx, cx - 26, 0, cx + 26, 0, ['#9a6a3e', '#7a4f2c', '#553519']);
  ctx.beginPath();
  ctx.moveTo(cx - 30, cy);
  ctx.lineTo(cx - 24, cy - 34);
  ctx.lineTo(cx + 24, cy - 34);
  ctx.lineTo(cx + 30, cy);
  ctx.quadraticCurveTo(cx, cy + 10, cx - 30, cy);
  ctx.fill();
  // корни
  for (const [dx, a] of [
    [-26, -0.9],
    [22, 0.9],
  ])
    leaf(ctx, cx + dx, cy - 4, a, 20, 6, '#6a4424', 0);
  ellipse(ctx, cx, cy - 34, 24, 10, '#d9b27a');
  ctx.strokeStyle = 'rgba(120,80,40,0.6)';
  ctx.lineWidth = 1.6;
  for (const r of [6, 12, 18]) {
    ctx.beginPath();
    ctx.ellipse(cx, cy - 34, r, r * 0.42, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ellipse(ctx, cx - 16, cy - 16, 8, 5, 'rgba(110,170,60,0.8)');
}

/** Мордочка коровы для указателя на луг. */
function drawCowFace(ctx: Ctx, x: number, y: number, k: number) {
  ellipse(ctx, x - 14 * k, y - 8 * k, 7 * k, 3.5 * k, '#e6d8cc', -0.4);
  ellipse(ctx, x + 14 * k, y - 8 * k, 7 * k, 3.5 * k, '#e6d8cc', 0.4);
  ellipse(ctx, x, y, 14 * k, 16 * k, '#ffffff');
  ellipse(ctx, x - 5 * k, y - 6 * k, 6 * k, 5 * k, '#2e2622');
  ellipse(ctx, x, y + 9 * k, 12 * k, 8 * k, '#ffb3c1');
  circle(ctx, x - 4 * k, y + 9 * k, 1.8 * k, '#b8586a');
  circle(ctx, x + 4 * k, y + 9 * k, 1.8 * k, '#b8586a');
  circle(ctx, x - 5 * k, y - 3 * k, 2.4 * k, '#1e1e1e');
  circle(ctx, x + 6 * k, y - 3 * k, 2.4 * k, '#1e1e1e');
}

function drawSign(ctx: Ctx, cx: number, cy: number, label = 'Лес', right = false) {
  softShadow(ctx, cx + 6, cy - 2, 26, 9, 0.28);
  ctx.fillStyle = lingrad(ctx, cx - 5, 0, cx + 5, 0, ['#9a6a3e', '#6e4526']);
  ctx.fillRect(cx - 5, cy - 104, 10, 104);
  // доска-стрелка, указывает влево-вниз, к мосту
  ctx.save();
  ctx.translate(cx, cy - 90);
  ctx.rotate(right ? -0.08 : 0.12);
  if (right) ctx.scale(-1, 1);
  ctx.beginPath();
  ctx.moveTo(-54, 0);
  ctx.lineTo(-38, -22);
  ctx.lineTo(48, -22);
  ctx.lineTo(48, 22);
  ctx.lineTo(-38, 22);
  ctx.closePath();
  ctx.fillStyle = lingrad(ctx, 0, -22, 0, 22, ['#e0b074', '#c08a4c']);
  ctx.fill();
  ctx.strokeStyle = '#6e4526';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = '#5a3218';
  ctx.font = '800 20px Rubik, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (right) ctx.scale(-1, 1);
  // на доске рисунок вместо слова: гриб — лес, мордочка коровы — луг
  const ix = right ? -12 : 12;
  if (label === 'Лес') drawMushroom(ctx, 'porcini', 3, ix, 17, false);
  else drawCowFace(ctx, ix, 1, 0.8);
  ctx.restore();
  // у столбика: гриб (лес) или клевер (луг)
  if (!right) drawMushroom(ctx, 'chanterelle', 2, cx + 18, cy + 2, false);
  else for (const [dx, col] of [[16, '#ffffff'], [24, '#ff9ec7'], [10, '#ffffff']] as const) circle(ctx, cx + dx, cy - 4 - (dx % 7), 4, col);
}

type MushKind = 'champignon' | 'chanterelle' | 'porcini';

/** Гриб на стадии роста 1–3, основание в (cx, by). */
function drawMushroom(ctx: Ctx, kind: MushKind, stage: number, cx: number, by: number, tufts = true) {
  const s = stage === 1 ? 0.4 : stage === 2 ? 0.7 : 1;
  ellipse(ctx, cx + 3, by, 26 * s + 4, 7 * s + 2, 'rgba(20,40,10,0.3)');

  const champ = (x: number, k: number) => {
    const w = 8 * k;
    ctx.fillStyle = lingrad(ctx, x - w, 0, x + w, 0, ['#fffaf0', '#efe4cf', '#cdbd9e']);
    rrect(ctx, x - w, by - 20 * k, w * 2, 20 * k, 4 * k);
    ctx.fill();
    ellipse(ctx, x, by - 18 * k, 21 * k, 7 * k, '#d9c9a6');
    ctx.beginPath();
    ctx.ellipse(x, by - 19 * k, 22 * k, 20 * k, 0, Math.PI, 0);
    ctx.closePath();
    ctx.fillStyle = radgrad(ctx, x, by - 22 * k, 2, 24 * k, ['#ffffff', '#f6f0e4', '#d8ccb4'], x - 8 * k, by - 32 * k);
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,100,70,0.35)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    for (let i = 0; i < 5; i++) circle(ctx, x + rr(-12, 12) * k, by - rr(24, 34) * k, 1.3 * k + 0.4, 'rgba(150,120,80,0.45)');
  };

  const chant = (x: number, y: number, k: number) => {
    ctx.fillStyle = lingrad(ctx, x - 6 * k, 0, x + 6 * k, 0, ['#ffc14a', '#f29a1a']);
    ctx.beginPath();
    ctx.moveTo(x - 3 * k, y);
    ctx.lineTo(x - 13 * k, y - 22 * k);
    ctx.lineTo(x + 13 * k, y - 22 * k);
    ctx.lineTo(x + 3 * k, y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(190,100,10,0.45)';
    ctx.lineWidth = 1.2;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(x + i * 1.2 * k, y - 3 * k);
      ctx.lineTo(x + i * 5 * k, y - 21 * k);
      ctx.stroke();
    }
    // волнистая шляпка-воронка
    ctx.beginPath();
    for (let i = 0; i <= 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const r = 1 + Math.sin(a * 5) * 0.08;
      const px = x + Math.cos(a) * 15 * k * r;
      const py = y - 23 * k + Math.sin(a) * 6 * k * r;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = radgrad(ctx, x, y - 23 * k, 1, 15 * k, ['#e07d0e', '#ffb830', '#ffd466']);
    ctx.fill();
    ctx.strokeStyle = '#d27a0c';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  };

  const porcini = (x: number, k: number) => {
    ctx.beginPath();
    ctx.moveTo(x - 10 * k, by - 22 * k);
    ctx.bezierCurveTo(x - 20 * k, by - 12 * k, x - 16 * k, by, x, by);
    ctx.bezierCurveTo(x + 16 * k, by, x + 20 * k, by - 12 * k, x + 10 * k, by - 22 * k);
    ctx.closePath();
    ctx.fillStyle = lingrad(ctx, x - 18 * k, 0, x + 18 * k, 0, ['#fff6e0', '#eadbb8', '#c4ad82']);
    ctx.fill();
    ctx.strokeStyle = 'rgba(150,120,70,0.3)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(x - 8 * k + i * 5 * k, by - 18 * k);
      ctx.lineTo(x - 9 * k + i * 5 * k, by - 6 * k);
      ctx.stroke();
    }
    ellipse(ctx, x, by - 22 * k, 25 * k, 7 * k, '#e6d49a');
    ctx.beginPath();
    ctx.ellipse(x, by - 23 * k, 27 * k, 22 * k, 0, Math.PI, 0);
    ctx.quadraticCurveTo(x, by - 18 * k, x - 27 * k, by - 23 * k);
    ctx.closePath();
    ctx.fillStyle = radgrad(ctx, x, by - 28 * k, 2, 28 * k, ['#c07a3e', '#8e4f22', '#5e3014'], x - 9 * k, by - 38 * k);
    ctx.fill();
    ellipse(ctx, x - 9 * k, by - 36 * k, 8 * k, 4 * k, 'rgba(255,230,200,0.45)', -0.4);
  };

  if (kind === 'champignon') {
    if (stage === 3) champ(cx + 14, 0.62);
    champ(cx - (stage === 3 ? 6 : 0), s);
  } else if (kind === 'chanterelle') {
    if (stage >= 2) chant(cx - 13 * s, by + 1, s * 0.8);
    chant(cx + 2 * s, by - 2 * s, s);
    if (stage === 3) chant(cx + 16, by + 2, 0.7);
  } else {
    porcini(cx, s);
  }

  if (tufts) {
    // травинки перед грибом: он чуть прячется, его нужно высмотреть
    for (let i = 0; i < 7; i++) {
      const x = cx + rr(-26, 26);
      ctx.strokeStyle = i % 2 ? '#4fa83a' : '#3d8c2c';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(x, by + 3);
      ctx.quadraticCurveTo(x + rr(-3, 3), by - 6, x + rr(-6, 6), by - rr(9, 16));
      ctx.stroke();
    }
  }
}


// ---------- луг ----------

function drawPasture(ctx: Ctx) {
  const shape = () => rrect(ctx, 0.08, 0.08, 0.84, 0.84, 0.2);
  ground(ctx, 130, 10);
  shape();
  ctx.fillStyle = '#5f5226';
  ctx.fill();
  ground(ctx, 130, 2);
  shape();
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = lingrad(ctx, 0, 10, 0, 130, ['#9c8a4a', '#86733a', '#6f5f2e']);
  ctx.fill();
  ctx.clip();
  for (let i = 0; i < 30; i++) {
    const u = rr(0.1, 0.9);
    const v = rr(0.1, 0.9);
    ellipse(ctx, 130 + (u - v) * 128, 2 + (u + v) * 64, rr(2, 4), rr(1.4, 2.4), rnd() > 0.5 ? 'rgba(60,45,15,0.35)' : 'rgba(255,240,190,0.25)');
  }
  ctx.restore();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/** Трава на пастбище: 1 — ростки, 2 — кустики, 3 — сочная с клевером. */
function drawMeadowGrass(ctx: Ctx, stage: number) {
  const spots: Pt[] = [];
  for (const u of [0.22, 0.4, 0.58, 0.76]) for (const v of [0.22, 0.4, 0.58, 0.76]) spots.push(cropPos(u + rr(-0.03, 0.03), v + rr(-0.03, 0.03)));
  spots.sort((a, b) => a.y - b.y);
  const len = stage === 1 ? 12 : stage === 2 ? 26 : 40;
  for (const p of spots) {
    const n = stage === 1 ? 3 : 6;
    for (let k = 0; k < n; k++) {
      const a = (k - (n - 1) / 2) * 0.28 + rr(-0.08, 0.08);
      leaf(ctx, p.x, p.y, a, len * rr(0.8, 1.15), stage === 1 ? 2.5 : 3.5, k % 2 ? '#6cc23e' : '#56ab30', 0.12);
    }
    if (stage === 3 && rnd() < 0.5) {
      const fx = p.x + rr(-8, 8);
      const fy = p.y - len * 0.7;
      const col = rnd() > 0.5 ? '#ffffff' : '#ff9ec7';
      for (let i = 0; i < 6; i++) circle(ctx, fx + Math.cos(i) * 3.5, fy + Math.sin(i) * 3.5, 3, col);
      circle(ctx, fx, fy, 2, '#ffd84a');
    }
  }
}

function drawHay(ctx: Ctx, cx: number, cy: number) {
  softShadow(ctx, cx + 8, cy - 2, 56, 18, 0.26);
  // рулон сена лёжа
  ctx.fillStyle = lingrad(ctx, 0, cy - 60, 0, cy, ['#ffe08a', '#e6b84a', '#b8872a']);
  rrect(ctx, cx - 44, cy - 58, 70, 56, 26);
  ctx.fill();
  ctx.strokeStyle = 'rgba(150,100,20,0.5)';
  ctx.lineWidth = 2;
  for (let y = cy - 50; y < cy - 6; y += 8) {
    ctx.beginPath();
    ctx.moveTo(cx - 36, y);
    ctx.lineTo(cx + 18, y + rr(-2, 2));
    ctx.stroke();
  }
  ellipse(ctx, cx + 26, cy - 30, 18, 28, '#f2cf6a');
  ctx.strokeStyle = '#c59a3a';
  ctx.lineWidth = 2;
  for (const r of [6, 11, 16]) {
    ctx.beginPath();
    ctx.ellipse(cx + 26, cy - 30, r * 0.62, r, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = '#c0392b';
  ctx.fillRect(cx - 10, cy - 58, 6, 56);
}

function drawCow(ctx: Ctx, cx: number, cy: number, eating: boolean) {
  softShadow(ctx, cx, cy - 2, 62, 14, 0.3);
  const x0 = cx - 70;
  const y0 = cy - 124;
  const X = (x: number) => x0 + x;
  const Y = (y: number) => y0 + y;
  // ноги
  for (const lx of [44, 58, 102, 116]) {
    ctx.fillStyle = lx === 58 || lx === 116 ? '#e9e4dc' : '#d8d2c8';
    rrect(ctx, X(lx), Y(92), 11, 30, 4);
    ctx.fill();
    ctx.fillStyle = '#3a2e28';
    ctx.fillRect(X(lx), Y(116), 11, 7);
  }
  // хвост
  ctx.strokeStyle = '#e4ded4';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(X(34), Y(64));
  ctx.quadraticCurveTo(X(22), Y(80), X(26), Y(100));
  ctx.stroke();
  ellipse(ctx, X(26), Y(103), 5, 7, '#2e2622');
  // туловище с пятнами
  ctx.save();
  rrect(ctx, X(30), Y(48), 104, 56, 26);
  ctx.fillStyle = lingrad(ctx, 0, Y(48), 0, Y(104), ['#ffffff', '#f3efe8', '#d9d2c6']);
  ctx.fill();
  ctx.clip();
  for (const [sx, sy, rx, ry, r] of [
    [52, 58, 16, 11, 0.3],
    [96, 72, 14, 12, -0.4],
    [70, 94, 12, 8, 0.1],
    [122, 56, 10, 9, 0],
  ])
    ellipse(ctx, X(sx), Y(sy), rx, ry, '#2e2622', r);
  ctx.restore();
  // вымя
  ellipse(ctx, X(70), Y(104), 13, 8, '#ffb3c1');
  for (const tx of [64, 70, 76]) ellipse(ctx, X(tx), Y(111), 2.4, 4, '#ff8fa6');
  // голова
  const hx = eating ? 142 : 138;
  const hy = eating ? 100 : 50;
  if (eating) {
    // шея наклонена к траве
    ctx.fillStyle = '#efe9e0';
    ctx.beginPath();
    ctx.moveTo(X(122), Y(54));
    ctx.lineTo(X(140), Y(86));
    ctx.lineTo(X(152), Y(92));
    ctx.lineTo(X(134), Y(56));
    ctx.fill();
  }
  // уши и рожки
  ellipse(ctx, X(hx - 16), Y(hy - 12), 10, 5, '#e6d8cc', -0.4);
  ellipse(ctx, X(hx + 16), Y(hy - 14), 10, 5, '#e6d8cc', 0.4);
  ellipse(ctx, X(hx - 15), Y(hy - 12), 6, 2.6, '#ffb3c1', -0.4);
  ctx.strokeStyle = '#f2e3b8';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(X(hx - 7), Y(hy - 16));
  ctx.quadraticCurveTo(X(hx - 12), Y(hy - 28), X(hx - 4), Y(hy - 30));
  ctx.moveTo(X(hx + 7), Y(hy - 17));
  ctx.quadraticCurveTo(X(hx + 12), Y(hy - 29), X(hx + 4), Y(hy - 31));
  ctx.stroke();
  ellipse(ctx, X(hx), Y(hy), 17, 20, radgrad(ctx, X(hx), Y(hy), 2, 20, ['#ffffff', '#f2ece2'], X(hx - 5), Y(hy - 8)));
  ellipse(ctx, X(hx - 6), Y(hy - 8), 7, 6, '#2e2622');
  // морда
  ellipse(ctx, X(hx + 2), Y(hy + 13), 14, 10, '#ffb3c1');
  ellipse(ctx, X(hx - 3), Y(hy + 13), 2.4, 3, '#b8586a');
  ellipse(ctx, X(hx + 7), Y(hy + 13), 2.4, 3, '#b8586a');
  if (!eating) {
    circle(ctx, X(hx - 6), Y(hy - 4), 3.2, '#1e1e1e');
    circle(ctx, X(hx + 7), Y(hy - 4), 3.2, '#1e1e1e');
    circle(ctx, X(hx - 5), Y(hy - 5), 1.1, '#ffffff');
    circle(ctx, X(hx + 8), Y(hy - 5), 1.1, '#ffffff');
    // колокольчик
    ctx.fillStyle = '#c0392b';
    ctx.fillRect(X(hx - 12), Y(hy + 22), 18, 4);
    circle(ctx, X(hx - 3), Y(hy + 31), 6, radgrad(ctx, X(hx - 3), Y(hy + 31), 1, 6, ['#fff3a8', '#f2b82e', '#c4860a'], X(hx - 5), Y(hy + 29)));
  } else {
    // глаза прикрыты: жуёт
    ctx.strokeStyle = '#1e1e1e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(X(hx - 6), Y(hy - 5), 3, 0.1, Math.PI - 0.1);
    ctx.moveTo(X(hx + 10), Y(hy - 5));
    ctx.arc(X(hx + 7), Y(hy - 5), 3, 0.1, Math.PI - 0.1);
    ctx.stroke();
  }
}

/** Овечка: 0 — только что острижена, 3 — пушистое облако шерсти. */
function drawSheep(ctx: Ctx, cx: number, cy: number, stage: number) {
  softShadow(ctx, cx, cy - 2, 46 + stage * 4, 11, 0.3);
  const bx = cx - 4;
  const by = cy - 44;
  for (const lx of [-22, -10, 14, 26]) {
    ctx.fillStyle = '#3b302b';
    rrect(ctx, bx + lx, by + 14, 7, 28, 3);
    ctx.fill();
  }
  const rx = 28 + stage * 6;
  const ry = 17 + stage * 4.5;
  if (stage === 0) {
    ellipse(ctx, bx, by, rx, ry, radgrad(ctx, bx, by, 2, rx, ['#fff1e6', '#f2d9c8', '#dcbfae'], bx - 8, by - 8));
    ctx.strokeStyle = 'rgba(180,140,120,0.35)';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.arc(bx + rr(-18, 18), by + rr(-8, 8), 4, 0, Math.PI);
      ctx.stroke();
    }
  } else {
    // шерсть — облако из кружков по контуру
    const puffs = 10 + stage * 4;
    const pr = 7 + stage * 2.5;
    ellipse(ctx, bx, by + 2, rx, ry, '#d9d2c8');
    for (let i = 0; i < puffs; i++) {
      const a = (i / puffs) * Math.PI * 2;
      const px = bx + Math.cos(a) * (rx - pr * 0.5);
      const py = by + Math.sin(a) * (ry - pr * 0.5);
      circle(ctx, px, py + 1.5, pr, '#d6cfc4');
      circle(ctx, px, py, pr, radgrad(ctx, px, py, 1, pr, ['#ffffff', '#f5f1ea', '#e2dbd0'], px - pr * 0.3, py - pr * 0.4));
    }
    ellipse(ctx, bx, by, rx - pr * 0.6, ry - pr * 0.6, radgrad(ctx, bx, by, 2, rx, ['#ffffff', '#f3eee6'], bx - 10, by - 10));
    for (let i = 0; i < stage * 5; i++) {
      ctx.strokeStyle = 'rgba(200,190,175,0.6)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(bx + rr(-rx * 0.6, rx * 0.6), by + rr(-ry * 0.5, ry * 0.5), rr(3, 5), 0.3, Math.PI * 1.6);
      ctx.stroke();
    }
  }
  // голова
  const hx = bx + rx - 2;
  const hy = by - ry * 0.35 - 2;
  ellipse(ctx, hx - 8, hy - 4, 9, 4.5, '#2f2622', -0.5);
  ellipse(ctx, hx + 12, hy - 4, 9, 4.5, '#2f2622', 0.5);
  ellipse(ctx, hx + 2, hy + 4, 12, 14, radgrad(ctx, hx + 2, hy + 4, 1, 14, ['#5a4a42', '#3b302b'], hx - 2, hy - 2));
  circle(ctx, hx - 3, hy + 1, 3.4, '#ffffff');
  circle(ctx, hx + 7, hy + 1, 3.4, '#ffffff');
  circle(ctx, hx - 2.4, hy + 1.6, 1.8, '#1e1e1e');
  circle(ctx, hx + 7.6, hy + 1.6, 1.8, '#1e1e1e');
  ellipse(ctx, hx + 2, hy + 12, 4, 2, '#ff9fb0');
  if (stage > 0) {
    // чубчик
    for (let i = 0; i < 3 + stage; i++) circle(ctx, hx - 4 + i * 3.5, hy - 10 - (i % 2) * 2, 4 + stage * 0.6, '#f7f3ec');
  }
}

function drawMilkIcon(ctx: Ctx) {
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowOffsetY = 3;
  ctx.beginPath();
  ctx.moveTo(38, 18);
  ctx.lineTo(58, 18);
  ctx.lineTo(58, 30);
  ctx.quadraticCurveTo(72, 38, 72, 52);
  ctx.lineTo(72, 80);
  ctx.quadraticCurveTo(72, 88, 64, 88);
  ctx.lineTo(32, 88);
  ctx.quadraticCurveTo(24, 88, 24, 80);
  ctx.lineTo(24, 52);
  ctx.quadraticCurveTo(24, 38, 38, 30);
  ctx.closePath();
  ctx.fillStyle = lingrad(ctx, 24, 0, 72, 0, ['#ffffff', '#f4f7fb', '#d5dde8']);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = '#9fb3c8';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = '#3d8be0';
  rrect(ctx, 35, 10, 26, 12, 4);
  ctx.fill();
  ctx.fillStyle = '#5fb0ff';
  rrect(ctx, 26, 56, 44, 20, 4);
  ctx.fill();
  // капля молока на этикетке
  ctx.beginPath();
  ctx.moveTo(48, 58);
  ctx.quadraticCurveTo(55, 67, 48, 73);
  ctx.quadraticCurveTo(41, 67, 48, 58);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ellipse(ctx, 32, 46, 3, 9, 'rgba(255,255,255,0.9)');
}

function drawWoolIcon(ctx: Ctx) {
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowOffsetY = 3;
  circle(ctx, 48, 50, 34, radgrad(ctx, 48, 50, 3, 34, ['#fff2f7', '#f5c6d8', '#d98aac'], 38, 38));
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = 'rgba(160,60,100,0.45)';
  ctx.lineWidth = 3;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.ellipse(48, 50, 30, 12 + i * 3, -0.6 + i * 0.35, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.strokeStyle = '#d98aac';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(74, 70);
  ctx.quadraticCurveTo(90, 78, 82, 90);
  ctx.stroke();
}

// ---------- море ----------

function drawWhale(ctx: Ctx) {
  const cy = 100;
  // тело: голова справа, хвост слева
  ctx.beginPath();
  ctx.moveTo(300, cy);
  ctx.bezierCurveTo(300, 40, 200, 34, 150, 44);
  ctx.bezierCurveTo(100, 54, 70, 80, 44, 92);
  ctx.lineTo(44, 108);
  ctx.bezierCurveTo(90, 126, 200, 132, 260, 126);
  ctx.bezierCurveTo(290, 122, 300, 112, 300, cy);
  ctx.closePath();
  ctx.fillStyle = lingrad(ctx, 0, 40, 0, 130, ['#6d93c9', '#4a6fa8', '#2f4f82']);
  ctx.fill();
  // светлое брюхо
  ctx.save();
  ctx.clip();
  ellipse(ctx, 210, 128, 90, 18, '#cfe1f2');
  for (let i = 0; i < 6; i++) {
    ctx.strokeStyle = 'rgba(80,110,150,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(150 + i * 20, 116);
    ctx.lineTo(160 + i * 20, 130);
    ctx.stroke();
  }
  // блик на спине
  ellipse(ctx, 210, 58, 60, 8, 'rgba(255,255,255,0.3)', -0.05);
  ctx.restore();
  // хвостовой плавник
  ctx.beginPath();
  ctx.moveTo(52, 96);
  ctx.quadraticCurveTo(20, 60, 6, 70);
  ctx.quadraticCurveTo(24, 92, 18, 98);
  ctx.quadraticCurveTo(24, 106, 6, 128);
  ctx.quadraticCurveTo(24, 134, 52, 106);
  ctx.closePath();
  ctx.fillStyle = '#3f6199';
  ctx.fill();
  // боковой плавник
  ellipse(ctx, 196, 112, 22, 8, '#3a5a8e', 0.5);
  // глаз и улыбка
  circle(ctx, 268, 92, 5, '#1b2438');
  circle(ctx, 269.5, 90.5, 1.8, '#ffffff');
  ctx.strokeStyle = '#243553';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(296, 104);
  ctx.quadraticCurveTo(270, 110, 250, 104);
  ctx.stroke();
  // дыхало
  ellipse(ctx, 236, 48, 7, 3, '#243553');
  // нижняя часть тела уходит под воду
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = lingrad(ctx, 0, 100, 0, 140, ['rgba(0,0,0,0)', 'rgba(0,0,0,0.75)', 'rgba(0,0,0,1)']);
  ctx.fillRect(0, 100, 340, 70);
  ctx.globalCompositeOperation = 'source-over';
  POINTS.whaleSpout = { x: 236 - 170, y: 44 - 110 };
}

function drawRipple(ctx: Ctx) {
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 5;
  ctx.shadowColor = 'rgba(255,255,255,0.9)';
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.ellipse(150, 45, 140, 36, 0, 0, Math.PI * 2);
  ctx.stroke();
}

function drawRainbow(ctx: Ctx) {
  const cols = ['#ff5d5d', '#ffa24a', '#ffe066', '#7ee05a', '#5ac8ff', '#9a7bff'];
  cols.forEach((c, i) => {
    ctx.strokeStyle = c;
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(130, 130, 118 - i * 8, Math.PI, 0);
    ctx.stroke();
  });
  ctx.globalAlpha = 1;
}

// ---------- частицы ----------

function drawSoft(ctx: Ctx) {
  circle(ctx, 32, 32, 32, radgrad(ctx, 32, 32, 0, 32, ['rgba(255,255,255,1)', 'rgba(255,255,255,0.5)', 'rgba(255,255,255,0)']));
}

function drawStar4(ctx: Ctx) {
  const c = 32;
  circle(ctx, c, c, 30, radgrad(ctx, c, c, 0, 30, ['rgba(255,255,255,0.6)', 'rgba(255,255,255,0)']));
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 - Math.PI / 2;
    const px = c + Math.cos(a) * 30;
    const py = c + Math.sin(a) * 30;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.quadraticCurveTo(c, c, px, py);
  }
  ctx.quadraticCurveTo(c, c, c, c - 30);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
}

function star5(ctx: Ctx, cx: number, cy: number, R: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 ? r : R;
    const x = cx + Math.cos(a) * rad;
    const y = cy + Math.sin(a) * rad;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.closePath();
}

function heart(ctx: Ctx, cx: number, cy: number, s: number) {
  ctx.beginPath();
  ctx.moveTo(cx, cy + s * 0.9);
  ctx.bezierCurveTo(cx - s * 1.4, cy - s * 0.1, cx - s * 0.6, cy - s * 1.1, cx, cy - s * 0.35);
  ctx.bezierCurveTo(cx + s * 0.6, cy - s * 1.1, cx + s * 1.4, cy - s * 0.1, cx, cy + s * 0.9);
  ctx.closePath();
}

// ---------- иконки интерфейса (в 2× разрешении) ----------

function drawCoin(ctx: Ctx, c: number, R: number) {
  circle(ctx, c, c + R * 0.08, R, '#b86e0c');
  circle(ctx, c, c, R, radgrad(ctx, c, c, R * 0.1, R, ['#fff3a8', '#ffcf3a', '#e79a12'], c - R * 0.4, c - R * 0.45));
  ctx.lineWidth = R * 0.08;
  ctx.strokeStyle = '#c47a0a';
  ctx.beginPath();
  ctx.arc(c, c, R * 0.96, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,245,190,0.9)';
  ctx.lineWidth = R * 0.06;
  ctx.beginPath();
  ctx.arc(c, c, R * 0.72, 0, Math.PI * 2);
  ctx.stroke();
  star5(ctx, c, c + R * 0.04, R * 0.46, R * 0.2);
  ctx.fillStyle = '#e8960f';
  ctx.fill();
  ctx.strokeStyle = '#c47a0a';
  ctx.lineWidth = R * 0.05;
  ctx.stroke();
  ellipse(ctx, c - R * 0.35, c - R * 0.45, R * 0.25, R * 0.12, 'rgba(255,255,255,0.7)', -0.6);
}

function drawXpStar(ctx: Ctx, c: number, R: number) {
  ctx.shadowColor = 'rgba(0,0,0,0.3)';
  ctx.shadowOffsetY = R * 0.08;
  star5(ctx, c, c, R, R * 0.48);
  ctx.fillStyle = radgrad(ctx, c, c, R * 0.1, R, ['#fff7b0', '#ffd23a', '#f39c12'], c - R * 0.2, c - R * 0.3);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = '#c96a00';
  ctx.lineWidth = R * 0.08;
  ctx.stroke();
}

function drawWheatIcon(ctx: Ctx) {
  const bx = 48;
  const by = 86;
  for (let k = 0; k < 5; k++) {
    const a = (k - 2) * 0.22;
    const L = 66;
    const tx = bx + Math.sin(a) * L;
    const ty = by - Math.cos(a) * L;
    ctx.strokeStyle = '#c28a2c';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    for (let g = 0; g < 6; g++) {
      const t = g / 6;
      const gx = tx - Math.sin(a) * (1 - t) * 22;
      const gy = ty + Math.cos(a) * (1 - t) * 22;
      const side = g % 2 ? 1 : -1;
      ellipse(ctx, gx + side * 4, gy, 5, 8, g % 2 ? '#ffd65a' : '#f2b633', a + side * 0.5);
    }
  }
  ctx.fillStyle = '#e0453a';
  rrect(ctx, bx - 14, by - 30, 28, 11, 4);
  ctx.fill();
}

function drawCarrotIcon(ctx: Ctx) {
  ctx.save();
  ctx.translate(48, 52);
  ctx.rotate(0.6);
  for (let k = 0; k < 3; k++) leaf(ctx, 0, -18, (k - 1) * 0.45, 30, 8, k % 2 ? '#5bbd3a' : '#3f9a2e', 0.05);
  ctx.beginPath();
  ctx.moveTo(-16, -18);
  ctx.quadraticCurveTo(-14, 20, 0, 40);
  ctx.quadraticCurveTo(14, 20, 16, -18);
  ctx.quadraticCurveTo(0, -26, -16, -18);
  ctx.fillStyle = lingrad(ctx, -16, 0, 16, 0, ['#ffb35a', '#ff8a2a', '#d4610f']);
  ctx.fill();
  ctx.strokeStyle = 'rgba(150,60,0,0.5)';
  ctx.lineWidth = 2.5;
  for (const y of [-4, 10, 22]) {
    ctx.beginPath();
    ctx.moveTo(-10 + y * 0.2, y);
    ctx.lineTo(-2, y + 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPlotIcon(ctx: Ctx) {
  const tmp = document.createElement('canvas');
  tmp.width = 260;
  tmp.height = 152;
  drawPlot(tmp.getContext('2d')!);
  ctx.drawImage(tmp, 4, 30, 88, 51);
  leaf(ctx, 44, 54, -0.5, 22, 6, '#6cc84a', 0.1);
  leaf(ctx, 48, 54, 0.5, 24, 6, '#4fa83a', 0.1);
}

function drawLock(ctx: Ctx) {
  ctx.strokeStyle = '#8a8f99';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(32, 26, 13, Math.PI, 0);
  ctx.lineTo(45, 34);
  ctx.moveTo(19, 26);
  ctx.lineTo(19, 34);
  ctx.stroke();
  ctx.fillStyle = lingrad(ctx, 0, 30, 0, 60, ['#ffd65a', '#e79a12']);
  rrect(ctx, 12, 30, 40, 28, 7);
  ctx.fill();
  circle(ctx, 32, 42, 4.5, '#8a5a10');
}

function drawButton(ctx: Ctx, top: string, bottom: string, lip: string, border: string) {
  // 9-slice: 120×120, скругление 40
  rrect(ctx, 4, 10, 112, 106, 40);
  ctx.fillStyle = lip;
  ctx.fill();
  rrect(ctx, 4, 4, 112, 100, 40);
  ctx.fillStyle = lingrad(ctx, 0, 4, 0, 104, [top, bottom]);
  ctx.fill();
  ctx.strokeStyle = border;
  ctx.lineWidth = 4;
  ctx.stroke();
  rrect(ctx, 16, 12, 88, 34, 17);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fill();
}

function drawPill(ctx: Ctx) {
  rrect(ctx, 3, 3, 114, 74, 37);
  ctx.fillStyle = 'rgba(58,38,22,0.62)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,240,210,0.45)';
  ctx.lineWidth = 4;
  ctx.stroke();
}

function drawBubble(ctx: Ctx) {
  circle(ctx, 70, 76, 62, 'rgba(0,0,0,0.25)');
  circle(ctx, 70, 70, 62, radgrad(ctx, 70, 70, 10, 62, ['#ffffff', '#fff6e2', '#f1dcb4'], 55, 50));
  ctx.strokeStyle = '#c99a5a';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(70, 70, 60, 0, Math.PI * 2);
  ctx.stroke();
}

function drawBar(ctx: Ctx, fill: boolean) {
  rrect(ctx, 2, 2, 76, 40, 20);
  if (fill) {
    ctx.fillStyle = lingrad(ctx, 0, 2, 0, 42, ['#c9ff7a', '#7ed63a', '#4da81f']);
    ctx.fill();
    rrect(ctx, 10, 6, 60, 12, 6);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fill();
  } else {
    ctx.fillStyle = 'rgba(40,26,14,0.7)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,240,210,0.5)';
    ctx.lineWidth = 3;
    ctx.stroke();
  }
}

// ---------- регистрация ----------

export function generateArt(scene: Phaser.Scene) {
  // земля: текстура 260×132, верхний угол ромба в (130, 2)
  for (let v = 0; v < 3; v++) make(scene, `grass${v}`, 260, 132, { x: 130, y: 2 }, (c) => drawGrass(c, v));
  make(scene, 'path', 260, 132, { x: 130, y: 2 }, drawPath);
  make(scene, 'tileHL', 260, 132, { x: 130, y: 2 }, drawTileHL);
  make(scene, 'plot', 260, 152, { x: 130, y: 2 }, drawPlot);
  for (let v = 0; v < 2; v++) {
    make(scene, `cliffL${v}`, 130, 66 + CLIFF + 4, { x: 1, y: 1 }, (c) => drawCliff(c, false));
    make(scene, `cliffR${v}`, 130, 66 + CLIFF + 4, { x: 1, y: 65 }, (c) => drawCliff(c, true));
  }
  make(scene, 'water', 256, 256, null, drawWater);
  const pad = 260;
  ISLANDS.forEach((isl, i) => {
    const fw = Math.ceil((((isl.w + isl.h) * TW) / 2 + pad * 2) * 0.5);
    const fh = Math.ceil((((isl.w + isl.h) * TH) / 2 + pad * 2) * 0.5);
    make(scene, `foam${i}`, fw, fh, { x: ((isl.h * TW) / 2 + pad) * 0.5, y: pad * 0.5 }, (c) => drawFoam(c, pad, isl.w, isl.h));
  });
  for (let v = 0; v < 3; v++) {
    make(scene, `fgrass${v}`, 260, 132, { x: 130, y: 2 }, (c) => drawGrass(c, v, FOREST_GRASS));
    make(scene, `cgrass${v}`, 260, 132, { x: 130, y: 2 }, (c) => drawGrass(c, v, CLEARING_GRASS));
  }
  make(scene, 'bridge_v', 3 * 128 + 20, 3 * 64 + 50, { x: 2 * 128 + 10, y: 30 }, (c) => drawBridge(c, 2 * 128 + 10, 30, 'v'));
  make(scene, 'bridge_u', 3 * 128 + 20, 3 * 64 + 50, { x: 128 + 10, y: 30 }, (c) => drawBridge(c, 128 + 10, 30, 'u'));
  make(scene, 'fern', 130, 90, { x: 65, y: 80 }, (c) => drawFern(c, 65, 80));
  make(scene, 'stump', 100, 90, { x: 50, y: 74 }, (c) => drawStump(c, 50, 74));
  make(scene, 'sign', 130, 150, { x: 60, y: 138 }, (c) => drawSign(c, 60, 138));
  make(scene, 'signMeadow', 130, 150, { x: 70, y: 138 }, (c) => drawSign(c, 70, 138, 'Луг', true));
  for (let v = 0; v < 3; v++) make(scene, `mgrass${v}`, 260, 132, { x: 130, y: 2 }, (c) => drawGrass(c, v, MEADOW_GRASS));
  make(scene, 'pasture', 260, 152, { x: 130, y: 2 }, drawPasture);
  for (const st of [1, 2, 3]) make(scene, `meadow${st}`, 260, 260, { x: 130, y: 120 }, (c) => drawMeadowGrass(c, st));
  make(scene, 'hay', 130, 100, { x: 65, y: 84 }, (c) => drawHay(c, 65, 84));
  make(scene, 'cow', 170, 140, { x: 85, y: 124 }, (c) => drawCow(c, 85, 124, false));
  make(scene, 'cow_eat', 170, 140, { x: 85, y: 124 }, (c) => drawCow(c, 85, 124, true));
  for (const st of [0, 1, 2, 3]) make(scene, `sheep${st}`, 150, 130, { x: 70, y: 116 }, (c) => drawSheep(c, 70, 116, st));
  make(scene, 'i_milk', 96, 96, null, drawMilkIcon);
  make(scene, 'i_grass', 96, 96, null, (c) => {
    for (let k = 0; k < 7; k++) leaf(c, 48 + (k - 3) * 4, 84, (k - 3) * 0.22, rr(46, 62), 7, k % 2 ? '#5cbf38' : '#3f9a2e', 0.1);
    for (const [x, y] of [[34, 36], [62, 30]]) {
      for (let i = 0; i < 6; i++) circle(c, x + Math.cos(i) * 5, y + Math.sin(i) * 5, 4.5, '#ffffff');
      circle(c, x, y, 3, '#ffd84a');
    }
  });
  make(scene, 'i_wool', 96, 96, null, drawWoolIcon);
  make(scene, 'whale', 340, 170, { x: 170, y: 110 }, drawWhale);
  make(scene, 'ripple', 300, 90, { x: 150, y: 45 }, drawRipple);
  make(scene, 'rainbow', 260, 140, { x: 130, y: 130 }, drawRainbow);
  for (const k of ['champignon', 'chanterelle', 'porcini'] as const)
    for (const st of [1, 2, 3])
      make(scene, `mush_${k}${st}`, 160, 150, { x: 80, y: 132 }, (c) => {
        // грибы рисуются крупнее базового размера, чтобы их было видно на обычном масштабе
        c.translate(80, 132);
        c.scale(1.6, 1.6);
        c.translate(-50, -86);
        drawMushroom(c, k, st, 50, 86);
      });
  // иконки грибов для интерфейса (счётчик и продажа)
  for (const [key, kind] of [
    ['i_mush', 'porcini'],
    ['i_champignon', 'champignon'],
    ['i_chanterelle', 'chanterelle'],
    ['i_porcini', 'porcini'],
  ] as const)
    make(scene, key, 96, 96, null, (c) => {
      c.translate(48, 86);
      c.scale(1.25, 1.25);
      c.translate(-50, -86);
      drawMushroom(c, kind, 3, 50, 86, false);
    });
  make(scene, 'pond', 5 * 128 + 20, 5 * 64 + 20, { x: 2 * 128 + 10, y: 10 }, (c) => drawPond(c, 3, 2));

  // постройки: якорь — центр основания
  make(scene, 'house', 620, 560, { x: 310, y: 400 }, (c) => drawHouse(c, 310, 400));
  make(scene, 'barn', 620, 560, { x: 310, y: 400 }, (c) => drawBarn(c, 310, 400));
  make(scene, 'windmill', 360, 420, { x: 180, y: 380 }, (c) => drawWindmill(c, 180, 380));
  make(scene, 'blades', 340, 340, { x: 170, y: 170 }, drawBlades);
  make(scene, 'tree', 240, 280, { x: 120, y: 258 }, (c) => drawTree(c, 120, 258));
  make(scene, 'pine', 200, 330, { x: 100, y: 310 }, (c) => drawPine(c, 100, 310));
  make(scene, 'bush', 160, 110, { x: 80, y: 96 }, (c) => drawBush(c, 80, 96));
  make(scene, 'rock', 130, 90, { x: 65, y: 76 }, (c) => drawRock(c, 65, 76));

  // культуры: верхний угол грядки в (130, 120)
  for (const s of [1, 2, 3]) {
    make(scene, `wheat${s}`, 260, 260, { x: 130, y: 120 }, (c) => drawWheat(c, s));
    make(scene, `carrot${s}`, 260, 260, { x: 130, y: 120 }, (c) => drawCarrot(c, s));
  }

  make(scene, 'chicken', 80, 80, { x: 40, y: 73 }, drawChicken);
  make(scene, 'butterfly', 40, 32, { x: 20, y: 16 }, drawButterfly);
  make(scene, 'cloud', 420, 220, { x: 210, y: 130 }, drawCloud);

  // частицы
  make(scene, 'soft', 64, 64, null, drawSoft);
  make(scene, 'spark', 64, 64, null, drawStar4);
  make(scene, 'leafP', 28, 18, null, (c) => leaf(c, 4, 9, Math.PI / 2, 22, 6, '#6cc84a', 0.1));
  make(scene, 'grain', 16, 20, null, (c) => ellipse(c, 8, 10, 5, 8, '#ffd24a'));
  make(scene, 'confetti', 18, 10, null, (c) => {
    rrect(c, 0, 0, 18, 10, 3);
    c.fillStyle = '#ffffff';
    c.fill();
  });
  make(scene, 'heart', 48, 48, null, (c) => {
    heart(c, 24, 24, 20);
    c.fillStyle = radgrad(c, 24, 24, 2, 26, ['#ffb0c4', '#ff4f7b', '#d62d5a'], 16, 14);
    c.fill();
  });
  make(scene, 'feather', 26, 14, null, (c) => {
    ellipse(c, 13, 7, 12, 5, '#ffffff', 0.2);
    c.strokeStyle = 'rgba(0,0,0,0.2)';
    c.lineWidth = 1.5;
    c.stroke();
  });

  // интерфейс
  make(scene, 'i_coin', 96, 96, null, (c) => drawCoin(c, 48, 42));
  make(scene, 'i_star', 110, 110, null, (c) => drawXpStar(c, 55, 50));
  make(scene, 'i_wheat', 96, 96, null, drawWheatIcon);
  make(scene, 'i_carrot', 96, 96, null, drawCarrotIcon);
  make(scene, 'i_plot', 96, 96, null, drawPlotIcon);
  make(scene, 'i_lock', 64, 64, null, drawLock);
  // «нельзя»: красный круг с косой чертой
  make(scene, 'i_no', 96, 96, null, (c) => {
    c.strokeStyle = '#e8322a';
    c.lineWidth = 10;
    c.shadowColor = 'rgba(0,0,0,0.35)';
    c.shadowBlur = 4;
    c.beginPath();
    c.arc(48, 48, 36, 0, Math.PI * 2);
    c.moveTo(22, 22);
    c.lineTo(74, 74);
    c.stroke();
  });
  // крестик «отмена»
  make(scene, 'i_close', 96, 96, null, (c) => {
    c.strokeStyle = '#ffffff';
    c.lineWidth = 14;
    c.lineCap = 'round';
    c.shadowColor = 'rgba(90,20,15,0.6)';
    c.shadowOffsetY = 3;
    c.beginPath();
    c.moveTo(28, 28);
    c.lineTo(68, 68);
    c.moveTo(68, 28);
    c.lineTo(28, 68);
    c.stroke();
  });
  make(scene, 'btn_green', 120, 120, null, (c) => drawButton(c, '#8fe85a', '#42ab2c', '#2a7a1b', '#1f5d14'));
  make(scene, 'btn_orange', 120, 120, null, (c) => drawButton(c, '#ffc15a', '#f58a1f', '#b8580d', '#8a410a'));
  make(scene, 'btn_red', 120, 120, null, (c) => drawButton(c, '#ff8a7a', '#e2453a', '#a82a22', '#7a1d18'));
  make(scene, 'pill', 120, 80, null, drawPill);
  make(scene, 'bubble', 140, 140, null, drawBubble);
  make(scene, 'bar_bg', 80, 44, null, (c) => drawBar(c, false));
  make(scene, 'bar_fill', 80, 44, null, (c) => drawBar(c, true));
}
