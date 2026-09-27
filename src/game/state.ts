// Модель игры: только данные и правила, без графики.
// Сцены подписываются на события и перерисовывают то, что изменилось.

export type CropId = 'wheat' | 'carrot';

export interface CropDef {
  id: CropId;
  name: string;
  growMs: number;
  seedCost: number;
  sellPrice: number;
  xp: number;
  unlockLevel: number;
}

export const CROPS: Record<CropId, CropDef> = {
  wheat: { id: 'wheat', name: 'Пшеница', growMs: 10_000, seedCost: 2, sellPrice: 5, xp: 3, unlockLevel: 1 },
  carrot: { id: 'carrot', name: 'Морковь', growMs: 25_000, seedCost: 6, sellPrice: 15, xp: 8, unlockLevel: 2 },
};

export type MushroomId = 'champignon' | 'chanterelle' | 'porcini';
export type ItemId = CropId | MushroomId;

export interface MushroomDef {
  id: MushroomId;
  name: string;
  growMs: number;
  sellPrice: number;
  xp: number;
  /** Относительная частота появления. */
  weight: number;
}

export const MUSHROOMS: Record<MushroomId, MushroomDef> = {
  champignon: { id: 'champignon', name: 'Шампиньон', growMs: 15_000, sellPrice: 6, xp: 2, weight: 50 },
  chanterelle: { id: 'chanterelle', name: 'Лисичка', growMs: 22_000, sellPrice: 10, xp: 4, weight: 35 },
  porcini: { id: 'porcini', name: 'Белый гриб', growMs: 40_000, sellPrice: 30, xp: 10, weight: 15 },
};

export const MUSHROOM_IDS = Object.keys(MUSHROOMS) as MushroomId[];
export const ITEM_IDS: ItemId[] = ['wheat', 'carrot', ...MUSHROOM_IDS];

export const sellPrice = (id: ItemId) =>
  id === 'wheat' || id === 'carrot' ? CROPS[id].sellPrice : MUSHROOMS[id].sellPrice;

export interface Mushroom {
  id: number;
  kind: MushroomId;
  /** Дробные координаты тайла. */
  tx: number;
  ty: number;
  spawnedAt: number;
}

/** Сколько грибов может одновременно расти в лесу. */
export const MAX_MUSHROOMS = 7;
const nextSpawnDelay = () => 5_000 + Math.random() * 9_000;

export interface Plot {
  id: number;
  tx: number;
  ty: number;
  crop: CropId | null;
  plantedAt: number;
}

interface SaveData {
  coins: number;
  xp: number;
  level: number;
  inventory: Record<ItemId, number>;
  plots: Plot[];
  nextPlotId: number;
  mushrooms?: Mushroom[];
  nextMushroomAt?: number;
  nextMushroomId?: number;
}

type Listener = (...args: any[]) => void;

const SAVE_KEY = 'iso-farm-save-v1';

const emptyInventory = (): Record<ItemId, number> => ({ wheat: 0, carrot: 0, champignon: 0, chanterelle: 0, porcini: 0 });

export const xpForLevel = (level: number) => 10 + (level - 1) * 15;

export class GameState {
  coins = 30;
  xp = 0;
  level = 1;
  inventory: Record<ItemId, number> = emptyInventory();
  plots: Plot[] = [];
  mushrooms: Mushroom[] = [];
  private nextPlotId = 1;
  private nextMushroomAt = Date.now() + 1_500;
  private nextMushroomId = 1;
  private listeners = new Map<string, Set<Listener>>();

  constructor(initialPlots: Array<[number, number]>) {
    if (!this.load()) {
      for (const [tx, ty] of initialPlots) this.addPlot(tx, ty);
    }
  }

  on(event: string, fn: Listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
    return () => this.listeners.get(event)?.delete(fn);
  }

  private emit(event: string, ...args: unknown[]) {
    this.listeners.get(event)?.forEach((fn) => fn(...args));
    this.save();
  }

  get plotCost() {
    return 15 + Math.max(0, this.plots.length - 6) * 10;
  }

  isUnlocked(crop: CropId) {
    return this.level >= CROPS[crop].unlockLevel;
  }

  /** 0..1, 1 означает «созрело». */
  growth(plot: Plot, now = Date.now()) {
    if (!plot.crop) return 0;
    return Math.min(1, (now - plot.plantedAt) / CROPS[plot.crop].growMs);
  }

  msLeft(plot: Plot, now = Date.now()) {
    if (!plot.crop) return 0;
    return Math.max(0, plot.plantedAt + CROPS[plot.crop].growMs - now);
  }

  plotAt(tx: number, ty: number) {
    return this.plots.find((p) => p.tx === tx && p.ty === ty);
  }

  plant(plot: Plot, crop: CropId): boolean {
    const def = CROPS[crop];
    if (plot.crop || !this.isUnlocked(crop) || this.coins < def.seedCost) return false;
    this.coins -= def.seedCost;
    plot.crop = crop;
    plot.plantedAt = Date.now();
    this.emit('coins', this.coins);
    this.emit('plot', plot);
    return true;
  }

  harvest(plot: Plot): CropId | null {
    const crop = plot.crop;
    if (!crop || this.growth(plot) < 1) return null;
    plot.crop = null;
    this.inventory[crop] += 1;
    this.emit('plot', plot);
    this.emit('inventory', this.inventory);
    this.addXp(CROPS[crop].xp);
    return crop;
  }

  /** Продаёт весь урожай и грибы, возвращает выручку по товарам. */
  sellAll(): Array<{ item: ItemId; count: number; coins: number }> {
    const sold: Array<{ item: ItemId; count: number; coins: number }> = [];
    for (const item of ITEM_IDS) {
      const count = this.inventory[item];
      if (count > 0) {
        sold.push({ item, count, coins: count * sellPrice(item) });
        this.inventory[item] = 0;
      }
    }
    if (sold.length) this.emit('inventory', this.inventory);
    return sold;
  }

  get mushroomCount() {
    return MUSHROOM_IDS.reduce((a, k) => a + this.inventory[k], 0);
  }

  // ---------------------------------------------------------------- грибы

  mushroomGrowth(m: Mushroom, now = Date.now()) {
    return Math.min(1, Math.max(0, (now - m.spawnedAt) / MUSHROOMS[m.kind].growMs));
  }

  mushroomMsLeft(m: Mushroom, now = Date.now()) {
    return Math.max(0, m.spawnedAt + MUSHROOMS[m.kind].growMs - now);
  }

  /**
   * Появление новых грибов. Время появления «отматывается» назад, поэтому
   * после паузы в игре лес успевает зарасти, как будто время шло.
   */
  tickMushrooms(pickSpot: (existing: Mushroom[]) => { tx: number; ty: number } | null, now = Date.now()) {
    const spawned: Mushroom[] = [];
    while (now >= this.nextMushroomAt) {
      if (this.mushrooms.length >= MAX_MUSHROOMS) {
        this.nextMushroomAt = now + nextSpawnDelay();
        break;
      }
      const spot = pickSpot(this.mushrooms);
      if (!spot) break;
      const m: Mushroom = { id: this.nextMushroomId++, kind: rollMushroom(), ...spot, spawnedAt: this.nextMushroomAt };
      this.mushrooms.push(m);
      spawned.push(m);
      this.nextMushroomAt += nextSpawnDelay();
    }
    if (spawned.length) this.emit('mushrooms:spawn', spawned);
    return spawned;
  }

  pickMushroom(id: number): Mushroom | null {
    const m = this.mushrooms.find((x) => x.id === id);
    if (!m || this.mushroomGrowth(m) < 1) return null;
    this.mushrooms = this.mushrooms.filter((x) => x !== m);
    this.inventory[m.kind] += 1;
    // после сбора новый гриб появится не сразу
    this.nextMushroomAt = Math.max(this.nextMushroomAt, Date.now() + 3_000);
    this.emit('inventory', this.inventory);
    this.addXp(MUSHROOMS[m.kind].xp);
    return m;
  }

  /** Монеты зачисляются отдельно, когда анимация долетает до счётчика. */
  addCoins(amount: number) {
    this.coins += amount;
    this.emit('coins', this.coins);
  }

  buyPlot(tx: number, ty: number): Plot | null {
    if (this.coins < this.plotCost) return null;
    this.coins -= this.plotCost;
    const plot = this.addPlot(tx, ty);
    this.emit('coins', this.coins);
    return plot;
  }

  private addPlot(tx: number, ty: number) {
    const plot: Plot = { id: this.nextPlotId++, tx, ty, crop: null, plantedAt: 0 };
    this.plots.push(plot);
    return plot;
  }

  private addXp(amount: number) {
    this.xp += amount;
    while (this.xp >= xpForLevel(this.level)) {
      this.xp -= xpForLevel(this.level);
      this.level += 1;
      this.emit('levelup', this.level);
    }
    this.emit('xp', this.xp, xpForLevel(this.level));
  }

  private save() {
    const data: SaveData = {
      coins: this.coins,
      xp: this.xp,
      level: this.level,
      inventory: this.inventory,
      plots: this.plots,
      nextPlotId: this.nextPlotId,
      mushrooms: this.mushrooms,
      nextMushroomAt: this.nextMushroomAt,
      nextMushroomId: this.nextMushroomId,
    };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch {
      // хранилище недоступно (приватный режим) — играем без сохранений
    }
  }

  private load(): boolean {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw) as SaveData;
      this.coins = data.coins;
      this.xp = data.xp;
      this.level = data.level;
      this.inventory = Object.assign(emptyInventory(), data.inventory);
      this.plots = data.plots;
      this.nextPlotId = data.nextPlotId;
      this.mushrooms = data.mushrooms ?? [];
      this.nextMushroomAt = data.nextMushroomAt ?? Date.now() + 1_500;
      this.nextMushroomId = data.nextMushroomId ?? 1;
      return this.plots.length > 0;
    } catch {
      return false;
    }
  }
}

function rollMushroom(): MushroomId {
  const total = MUSHROOM_IDS.reduce((a, k) => a + MUSHROOMS[k].weight, 0);
  let r = Math.random() * total;
  for (const k of MUSHROOM_IDS) {
    r -= MUSHROOMS[k].weight;
    if (r <= 0) return k;
  }
  return 'champignon';
}
