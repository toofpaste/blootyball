import { PX_PER_YARD } from './constants';

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const rand = (a, b) => a + Math.random() * (b - a);
export const choice = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const yardsToPixY = (y) => y * PX_PER_YARD;
export const yardsToPixX = (x) => x * PX_PER_YARD;
export const pixYToYards = (py) => py / PX_PER_YARD;
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const unitVec = (v) => {
    const d = Math.hypot(v.x, v.y) || 1;
    return { x: v.x / d, y: v.y / d };
};
export const midPoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

const EMPTY_PLAYERS = Object.freeze([]);

export function forEachPlayer(map, fn) {
    if (!map || typeof fn !== 'function') return;
    for (const key in map) {
        if (!Object.prototype.hasOwnProperty.call(map, key)) continue;
        const player = map[key];
        if (player) fn(player, key);
    }
}

export function findPlayerById(map, id) {
    if (!map || id == null) return null;
    for (const key in map) {
        if (!Object.prototype.hasOwnProperty.call(map, key)) continue;
        const player = map[key];
        if (player && player.id === id) return player;
    }
    return null;
}

export function collectPlayers(map, target = []) {
    if (!map) {
        target.length = 0;
        return target;
    }
    let idx = 0;
    for (const key in map) {
        if (!Object.prototype.hasOwnProperty.call(map, key)) continue;
        const player = map[key];
        if (player) {
            target[idx++] = player;
        }
    }
    target.length = idx;
    return target;
}

export function collectActivePlayers(map, target = []) {
    if (!map) {
        target.length = 0;
        return target;
    }
    let idx = 0;
    for (const key in map) {
        if (!Object.prototype.hasOwnProperty.call(map, key)) continue;
        const player = map[key];
        if (player?.pos) {
            target[idx++] = player;
        }
    }
    target.length = idx;
    return target;
}

export function somePlayer(map, predicate) {
    if (!map || typeof predicate !== 'function') return false;
    for (const key in map) {
        if (!Object.prototype.hasOwnProperty.call(map, key)) continue;
        const player = map[key];
        if (player && predicate(player, key)) return true;
    }
    return false;
}

export function reducePlayers(map, reducer, initial) {
    if (!map || typeof reducer !== 'function') return initial;
    let acc = initial;
    for (const key in map) {
        if (!Object.prototype.hasOwnProperty.call(map, key)) continue;
        const player = map[key];
        if (player) {
            acc = reducer(acc, player, key);
        }
    }
    return acc;
}

export function getPlayerArray(map) {
    if (!map) return EMPTY_PLAYERS;
    const list = [];
    for (const key in map) {
        if (!Object.prototype.hasOwnProperty.call(map, key)) continue;
        const player = map[key];
        if (player) list.push(player);
    }
    return list;
}
