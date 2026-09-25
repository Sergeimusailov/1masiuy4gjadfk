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

export const inBounds = (tx: number, ty: number) => tx >= 0 && ty >= 0 && tx < N && ty < N;

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

export type DecorKind = 'tree' | 'pine' | 'bush' | 'rock';
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
  { kind: 'bush', tx: 4, ty: 9 },
  { kind: 'bush', tx: 11, ty: 7 },
  { kind: 'rock', tx: 6, ty: 10 },
  { kind: 'rock', tx: 3, ty: 6 },
];

/** Тропинка: от дома к амбару и вниз к мельнице. */
export const PATH = new Set<string>();
for (let tx = 1; tx <= 9; tx++) PATH.add(`${tx},3`);
for (let ty = 4; ty <= 9; ty++) PATH.add(`5,${ty}`);
for (let tx = 6; tx <= 8; tx++) PATH.add(`${tx},9`);

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
