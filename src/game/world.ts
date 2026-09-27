// Изометрическая сетка и раскладка острова.

export const TW = 256; // ширина тайла в мировых единицах
export const TH = 128; // высота тайла (проекция 2:1)
export const N = 12; // остров N×N тайлов

/** Мировая точка угла тайла (tx, ty). Дробные значения дают точки внутри тайла. */
export function iso(tx: number, ty: number) {
  return { x: (tx - ty) * (TW / 2), y: (tx + ty) * (TH / 2) };
}

/** Обратное преобразование: мировая точка → дробные координаты тайла. */
export function unIso(x: number, y: number) {
  const a = x / (TW / 2);
  const b = y / (TH / 2);
  return { tx: (a + b) / 2, ty: (b - a) / 2 };
}

export interface Island {
  kind: 'farm' | 'forest' | 'meadow';
  tx: number;
  ty: number;
  w: number;
  h: number;
}

/** Ферма и лесной остров к юго-западу от неё (на экране — ниже и левее). */
export const ISLANDS: Island[] = [
  { kind: 'farm', tx: 0, ty: 0, w: N, h: N },
  { kind: 'forest', tx: 1, ty: 14, w: 8, h: 8 },
  { kind: 'meadow', tx: 14, ty: 2, w: 8, h: 8 },
];
export const FOREST = ISLANDS[1];
export const MEADOW = ISLANDS[2];

/** Мостики через проливы: в лес (вдоль оси ty) и на луг (вдоль оси tx). */
export const BRIDGES: Array<{ tx: number; ty: number; axis: 'u' | 'v' }> = [
  { tx: 4, ty: 12, axis: 'v' },
  { tx: 12, ty: 6, axis: 'u' },
];

/** Поляна в центре леса, где растут грибы (в координатах тайлов). */
export const CLEARING = { cx: 4.9, cy: 18.1, r: 2.35 };

export const inBounds = (tx: number, ty: number) => tx >= 0 && ty >= 0 && tx < N && ty < N;

export const onIsland = (tx: number, ty: number) =>
  ISLANDS.some((i) => tx >= i.tx && ty >= i.ty && tx < i.tx + i.w && ty < i.ty + i.h);


export type BuildingKind = 'house' | 'barn' | 'windmill';
export interface BuildingDef {
  kind: BuildingKind;
  tx: number;
  ty: number;
  w: number;
  h: number;
}

export const BUILDINGS: BuildingDef[] = [
  { kind: 'house', tx: 2, ty: 1, w: 2, h: 2 },
  { kind: 'barn', tx: 7, ty: 1, w: 2, h: 2 },
  { kind: 'windmill', tx: 10, ty: 2, w: 2, h: 2 },
];

export const POND = { tx: 1, ty: 8, w: 3, h: 2 };

export type DecorKind = 'tree' | 'pine' | 'bush' | 'rock' | 'sign' | 'signMeadow' | 'fern' | 'stump' | 'hay';
export const DECOR: Array<{ kind: DecorKind; tx: number; ty: number }> = [
  { kind: 'pine', tx: 0, ty: 0 },
  { kind: 'tree', tx: 1, ty: 0 },
  { kind: 'pine', tx: 0, ty: 2 },
  { kind: 'tree', tx: 0, ty: 4 },
  { kind: 'tree', tx: 5, ty: 0 },
  { kind: 'pine', tx: 11, ty: 0 },
  { kind: 'tree', tx: 10, ty: 0 },
  { kind: 'pine', tx: 11, ty: 8 },
  { kind: 'tree', tx: 9, ty: 11 },
  { kind: 'tree', tx: 11, ty: 5 },
  { kind: 'pine', tx: 0, ty: 7 },
  { kind: 'tree', tx: 0, ty: 11 },
  { kind: 'pine', tx: 2, ty: 11 },
  { kind: 'tree', tx: 11, ty: 11 },
  { kind: 'pine', tx: 7, ty: 11 },
  { kind: 'bush', tx: 4, ty: 1 },
  { kind: 'bush', tx: 9, ty: 1 },
  { kind: 'bush', tx: 2, ty: 6 },
  { kind: 'bush', tx: 11, ty: 7 },
  { kind: 'rock', tx: 6, ty: 10 },
  { kind: 'rock', tx: 3, ty: 6 },
  { kind: 'sign', tx: 5, ty: 10 },
  { kind: 'signMeadow', tx: 10, ty: 7 },
];

/** Тропинка: от дома к амбару и вниз к мельнице. */
export const PATH = new Set<string>();
for (let tx = 1; tx <= 9; tx++) PATH.add(`${tx},3`);
for (let ty = 4; ty <= 9; ty++) PATH.add(`5,${ty}`);
for (let tx = 6; tx <= 8; tx++) PATH.add(`${tx},9`);
// ответвление к мостику в лес
for (let ty = 9; ty <= 11; ty++) PATH.add(`4,${ty}`);
// и к мостику на луг
for (let ty = 4; ty <= 6; ty++) PATH.add(`9,${ty}`);
for (let tx = 10; tx <= 11; tx++) PATH.add(`${tx},6`);

export const INITIAL_PLOTS: Array<[number, number]> = [
  [6, 5], [7, 5], [8, 5],
  [6, 6], [7, 6], [8, 6],
];

/** Клетки, занятые статичными объектами (на них нельзя ставить грядки). */
export function staticBlocked(): Set<string> {
  const s = new Set<string>(PATH);
  for (const b of BUILDINGS)
    for (let x = b.tx; x < b.tx + b.w; x++) for (let y = b.ty; y < b.ty + b.h; y++) s.add(`${x},${y}`);
  for (let x = POND.tx; x < POND.tx + POND.w; x++)
    for (let y = POND.ty; y < POND.ty + POND.h; y++) s.add(`${x},${y}`);
  for (const d of DECOR) s.add(`${d.tx},${d.ty}`);
  return s;
}

// ---------------------------------------------------------------- лес

const inClearing = (tx: number, ty: number, grow = 0) =>
  Math.hypot(tx + 0.5 - CLEARING.cx, ty + 0.5 - CLEARING.cy) < CLEARING.r + grow;

/** Тропинка от моста до поляны. */
export const FOREST_PATH = new Set<string>(['4,14', '4,15']);
/** Клетки у входа в лес без деревьев, чтобы мостик и тропинку было видно. */
const FOREST_ENTRY = new Set<string>(['3,14', '5,14', '3,15']);

export const isClearingTile = (tx: number, ty: number) => inClearing(tx, ty);

/**
 * Деревья леса: плотное кольцо вокруг поляны. Раскладка детерминированная,
 * чтобы лес выглядел одинаково при каждом запуске.
 */
export const FOREST_DECOR: Array<{ kind: DecorKind; tx: number; ty: number; dx: number; dy: number }> = (() => {
  const out: Array<{ kind: DecorKind; tx: number; ty: number; dx: number; dy: number }> = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let ty = FOREST.ty; ty < FOREST.ty + FOREST.h; ty++)
    for (let tx = FOREST.tx; tx < FOREST.tx + FOREST.w; tx++) {
      if (inClearing(tx, ty) || FOREST_PATH.has(`${tx},${ty}`) || FOREST_ENTRY.has(`${tx},${ty}`)) continue;
      const r = rnd();
      const edge = inClearing(tx, ty, 1.1);
      let kind: DecorKind;
      if (edge) kind = r < 0.35 ? 'fern' : r < 0.55 ? 'bush' : r < 0.7 ? 'stump' : r < 0.85 ? 'tree' : 'pine';
      else kind = r < 0.55 ? 'pine' : r < 0.9 ? 'tree' : 'fern';
      out.push({ kind, tx, ty, dx: (rnd() - 0.5) * 0.3, dy: (rnd() - 0.5) * 0.3 });
    }
  return out;
})();

/** Высокие деревья, за которыми гриб скрылся бы целиком. */
const TALL = FOREST_DECOR.filter((d) => d.kind === 'tree' || d.kind === 'pine').map((d) => iso(d.tx + 0.5 + d.dx, d.ty + 0.5 + d.dy));

/**
 * Случайная точка для нового гриба: на поляне или у самой опушки.
 * Кусты и папоротники могут частично прикрыть гриб, а высокие деревья — нет:
 * искать должно быть интересно, а не невозможно.
 */
export function randomMushroomSpot(existing: Array<{ tx: number; ty: number }>) {
  for (let i = 0; i < 60; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = (Math.random() < 0.3 ? 0.8 + Math.random() * 0.2 : Math.sqrt(Math.random()) * 0.78) * CLEARING.r;
    const tx = CLEARING.cx + Math.cos(a) * d;
    const ty = CLEARING.cy + Math.sin(a) * d;
    const p = iso(tx, ty);
    const hidden = TALL.some((t) => Math.abs(t.x - p.x) < 80 && p.y < t.y && p.y > t.y - 320);
    if (!hidden && existing.every((m) => Math.hypot(m.tx - tx, m.ty - ty) > 0.6)) return { tx, ty };
  }
  return null;
}

// ---------------------------------------------------------------- луг

/** Тропинка от моста вглубь луга. */
export const MEADOW_PATH = new Set<string>(['14,6', '15,6']);

/** Грядки-пастбища, где сеют траву для животных. */
export const PASTURES: Array<[number, number]> = [
  [17, 3],
  [18, 3],
  [17, 8],
  [18, 8],
];

export const MEADOW_DECOR: Array<{ kind: DecorKind; tx: number; ty: number; dx: number; dy: number }> = [
  { kind: 'tree', tx: 14, ty: 2, dx: 0, dy: 0 },
  { kind: 'pine', tx: 21, ty: 2, dx: 0, dy: 0 },
  { kind: 'tree', tx: 21, ty: 9, dx: 0, dy: 0 },
  { kind: 'pine', tx: 14, ty: 9, dx: 0, dy: 0 },
  { kind: 'hay', tx: 20, ty: 4, dx: 0, dy: 0 },
  { kind: 'hay', tx: 20, ty: 5, dx: 0.1, dy: 0.2 },
  { kind: 'hay', tx: 15, ty: 8, dx: 0, dy: 0 },
  { kind: 'bush', tx: 15, ty: 2, dx: 0, dy: 0 },
  { kind: 'bush', tx: 21, ty: 6, dx: 0, dy: 0 },
];

/** Где могут гулять животные (дробные координаты тайлов). */
export const MEADOW_WALK = { tx0: 15.2, tx1: 20.6, ty0: 2.8, ty1: 8.8 };

/** Кит плавает в открытом море южнее фермы, между лесом и лугом. */
export const WHALE_SEA = { tx0: 11, tx1: 19, ty0: 13.5, ty1: 18 };
