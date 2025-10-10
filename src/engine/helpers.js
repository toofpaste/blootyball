import { PX_PER_YARD } from './constants';

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const rand = (a, b) => a + Math.random() * (b - a);
export const choice = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const yardsToPixY = (y) => y * PX_PER_YARD;
export const yardsToPixX = (x) => x * PX_PER_YARD;
export const pixYToYards = (py) => py / PX_PER_YARD;
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const unitVec = (v) => { const d = Math.hypot(v.x, v.y) || 1; return { x: v.x / d, y: v.y / d }; };
export const midPoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
