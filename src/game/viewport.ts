// Игра рассчитана только на вертикальный телефон.
// На телефоне занимаем весь экран; на компьютере показываем «телефон» по центру,
// чтобы игру можно было открыть и проверить без устройства.

export const isMobile = window.matchMedia('(pointer: coarse)').matches;

/** Размер игрового поля в CSS-пикселях (всегда портретный). */
export function frameSize() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (isMobile) return { w: vw, h: vh };
  const h = Math.min(vh - 40, 900);
  const w = Math.round(h * (9 / 19.5));
  return { w: Math.min(w, vw - 20), h };
}

/** Отступы «чёлки» и полоски жестов iPhone (safe area). */
export function safeInsets() {
  const el = document.getElementById('safe');
  if (!el || !isMobile) return { top: 0, bottom: 0 };
  const cs = getComputedStyle(el);
  return { top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 };
}

export function applyFrame() {
  const { w, h } = frameSize();
  const el = document.getElementById('game')!;
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
  document.body.classList.toggle('desktop', !isMobile);
  return { w, h };
}

/** Пытаемся зафиксировать портрет (работает в полноэкранном режиме / PWA). */
export function lockPortrait() {
  const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
  o?.lock?.('portrait').catch(() => undefined);
}
