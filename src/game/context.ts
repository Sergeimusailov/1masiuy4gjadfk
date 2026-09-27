import { GameState } from './state';
import { INITIAL_PLOTS, PASTURES } from './world';

/** Плотность пикселей экрана (ограничиваем 2, чтобы не перегружать слабые GPU). */
export const DPR = Math.min(window.devicePixelRatio || 1, 2);

export const state = new GameState(INITIAL_PLOTS, PASTURES);

export const FONT = 'Rubik, "Trebuchet MS", sans-serif';
