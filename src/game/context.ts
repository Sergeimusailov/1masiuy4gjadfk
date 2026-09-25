import { GameState } from './state';
import { INITIAL_PLOTS } from './world';

/** Плотность пикселей экрана (ограничиваем 2, чтобы не перегружать слабые GPU). */
export const DPR = Math.min(window.devicePixelRatio || 1, 2);

export const state = new GameState(INITIAL_PLOTS);

export const FONT = 'Rubik, "Trebuchet MS", sans-serif';
