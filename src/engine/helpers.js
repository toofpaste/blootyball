import { PX_PER_YARD } from './constants';

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const rand = (a, b) => a + Math.random() * (b - a);
export const choice = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const yardsToPixY = (y) => y * PX_PER_YARD;
export const yardsToPixX = (x) => x * PX_PER_YARD;
export const pixYToYards = (py) => py / PX_PER_YARD;

function toVec3(v) {
    const hasZ = v != null && Object.prototype.hasOwnProperty.call(v, 'z');
    const x = Number.isFinite(v?.x) ? v.x : 0;
    const y = Number.isFinite(v?.y) ? v.y : 0;
    const z = Number.isFinite(v?.z) ? v.z : 0;
    return { x, y, z, hasZ };
}

export const vectorLength = (v) => {
    const { x, y, z } = toVec3(v || {});
    return Math.hypot(x, y, z);
};

export const dist = (a, b) => {
    if (!a || !b) return 0;
    const av = toVec3(a);
    const bv = toVec3(b);
    return Math.hypot(av.x - bv.x, av.y - bv.y, av.z - bv.z);
};

export const distSq = (a, b) => {
    if (!a || !b) return 0;
    const av = toVec3(a);
    const bv = toVec3(b);
    const dx = av.x - bv.x;
    const dy = av.y - bv.y;
    const dz = av.z - bv.z;
    return dx * dx + dy * dy + dz * dz;
};

export const unitVec = (v) => {
    const vec = toVec3(v || {});
    const d = Math.hypot(vec.x, vec.y, vec.z) || 1;
    const res = { x: vec.x / d, y: vec.y / d };
    if (vec.hasZ || vec.z !== 0) res.z = vec.z / d;
    return res;
};

export const vectorDiff = (a, b) => {
    const av = toVec3(a || {});
    const bv = toVec3(b || {});
    const diff = { x: av.x - bv.x, y: av.y - bv.y };
    const dz = av.z - bv.z;
    if (a?.z != null || b?.z != null || dz !== 0) diff.z = dz;
    return diff;
};

export const midPoint = (a, b) => {
    const av = toVec3(a || {});
    const bv = toVec3(b || {});
    const point = { x: (av.x + bv.x) / 2, y: (av.y + bv.y) / 2 };
    if (a?.z != null || b?.z != null || av.z !== 0 || bv.z !== 0) {
        point.z = (av.z + bv.z) / 2;
    }
    return point;
};

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
