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
  inventory: Record<CropId, number>;
  plots: Plot[];
  nextPlotId: number;
}

type Listener = (...args: any[]) => void;

const SAVE_KEY = 'iso-farm-save-v1';

export const xpForLevel = (level: number) => 10 + (level - 1) * 15;

export class GameState {
  coins = 30;
  xp = 0;
  level = 1;
  inventory: Record<CropId, number> = { wheat: 0, carrot: 0 };
  plots: Plot[] = [];
  private nextPlotId = 1;
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

  /** Продаёт весь урожай, возвращает выручку по культурам. */
  sellAll(): Array<{ crop: CropId; count: number; coins: number }> {
    const sold: Array<{ crop: CropId; count: number; coins: number }> = [];
    for (const crop of Object.keys(this.inventory) as CropId[]) {
      const count = this.inventory[crop];
      if (count > 0) {
        sold.push({ crop, count, coins: count * CROPS[crop].sellPrice });
        this.inventory[crop] = 0;
      }
    }
    if (sold.length) this.emit('inventory', this.inventory);
    return sold;
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
      this.inventory = Object.assign({ wheat: 0, carrot: 0 }, data.inventory);
      this.plots = data.plots;
      this.nextPlotId = data.nextPlotId;
      return this.plots.length > 0;
    } catch {
      return false;
    }
  }
}
