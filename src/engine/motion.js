import { clamp, dist, unitVec } from './helpers';
import { FIELD_PIX_W, FIELD_PIX_H, PX_PER_YARD } from './constants';

// ---------------------------------------------------------------------------
// Core conversion helpers
// ---------------------------------------------------------------------------
const MPH_TO_YARDS_PER_SEC = 0.488889; // 1 mph ≈ 0.4889 yards/sec
export const mphToPixelsPerSecond = (mph) => mph * MPH_TO_YARDS_PER_SEC * PX_PER_YARD;

// ---------------------------------------------------------------------------
// Physical templates
// ---------------------------------------------------------------------------
const ROLE_PHYSICS = {
    QB: { topSpeed: 18.8, accel: 6.2, radius: 8.5 },
    RB: { topSpeed: 21.4, accel: 8.8, radius: 7.6 },
    WR: { topSpeed: 22.0, accel: 9.1, radius: 7.4 },
    TE: { topSpeed: 19.4, accel: 7.1, radius: 8.6 },
    OL: { topSpeed: 17.2, accel: 5.4, radius: 9.4 },
    DL: { topSpeed: 17.8, accel: 5.9, radius: 9.0 },
    LB: { topSpeed: 19.8, accel: 7.6, radius: 8.2 },
    DB: { topSpeed: 21.2, accel: 8.5, radius: 7.6 },
    DEFAULT: { topSpeed: 18.6, accel: 6.6, radius: 8.0 },
};

function roleKey(role = '') {
    if (!role) return 'DEFAULT';
    if (/^WR/.test(role)) return 'WR';
    if (/^CB/.test(role) || /^S/.test(role) || role === 'NB') return 'DB';
    if (/^LB/.test(role)) return 'LB';
    if (/^RTk$/.test(role) || /^DT$/.test(role)) return 'DL';
    if (/^LE$/.test(role) || /^RE$/.test(role)) return 'DL';
    if (/^LT$/.test(role) || /^LG$/.test(role) || /^RG$/.test(role) || /^RT$/.test(role) || role === 'C') return 'OL';
    if (role === 'RB') return 'RB';
    if (role === 'TE') return 'TE';
    if (role === 'QB') return 'QB';
    return 'DEFAULT';
}

function templateFor(player) {
    const tpl = ROLE_PHYSICS[roleKey(player?.role)] || ROLE_PHYSICS.DEFAULT;
    return tpl;
}

// ---------------------------------------------------------------------------
// Physical profile helpers
// ---------------------------------------------------------------------------
function ensurePhysicalProfile(player) {
    if (!player) return null;
    if (!player.physical) {
        const tpl = templateFor(player);
        const baseHeight = tpl.radius >= 9 ? 75 : tpl.radius <= 7.6 ? 72 : 74;
        const baseWeight = tpl.radius >= 9 ? 305 : tpl.radius <= 7.6 ? 195 : 240;
        player.physical = {
            heightIn: baseHeight,
            weightLb: baseWeight,
            radius: tpl.radius,
        };
    }
    const physical = player.physical;
    physical.heightIn = clamp(Math.round(physical.heightIn ?? 74), 66, 82);
    physical.weightLb = clamp(Math.round(physical.weightLb ?? 220), 160, 360);
    const radius = physical.radius ?? templateFor(player).radius;
    physical.radius = clamp(radius, 6.8, 9.8);
    physical.mass = (physical.weightLb ?? 220) / 2.205; // convert lb → kg approx
    if (!player.radius) player.radius = physical.radius;
    return physical;
}

function ensureMotion(player) {
    if (!player) return null;
    if (!player.motion) {
        player.motion = {
            vx: 0,
            vy: 0,
            ax: 0,
            ay: 0,
            speed: 0,
            heading: { x: 0, y: 1 },
            stamina: 1,
            reaction: 1,
            lateral: 0,
            prevPos: player.pos ? { x: player.pos.x, y: player.pos.y } : { x: 0, y: 0 },
        };
    }
    ensurePhysicalProfile(player);
    player.motion.mass = player.physical?.mass ?? 95;
    player.motion.radius = player.physical?.radius ?? 8;
    return player.motion;
}

function limitToField(player) {
    if (!player?.pos) return;
    const radius = player.physical?.radius ?? 8;
    player.pos.x = clamp(player.pos.x, radius + 2, FIELD_PIX_W - radius - 2);
    player.pos.y = clamp(player.pos.y, radius + 2, FIELD_PIX_H - radius - 2);
}

function smoothApproach(distance, radius) {
    const scaled = clamp(distance / Math.max(1, radius * 2.5), 0, 1);
    return scaled * scaled * (3 - 2 * scaled);
}

function fatigueFactor(player) {
    const stamina = clamp(player?.motion?.stamina ?? 1, 0.45, 1.0);
    const fatigue = clamp(player?.modifiers?.fatigue ?? 0, 0, 0.35);
    return clamp(stamina - fatigue, 0.35, 1);
}

function ratingDelta(val, center = 1) {
    return clamp((val ?? center) - center, -0.7, 0.9);
}

export function resolveMaxSpeed(player, { speedMultiplier = 1 } = {}) {
    const tpl = templateFor(player);
    const physical = ensurePhysicalProfile(player);
    const rating = clamp(player?.attrs?.speed ?? 5.5, 3.5, 7.8);
    const agility = ratingDelta(player?.attrs?.agility, 1);
    const stamina = fatigueFactor(player);
    const weightPenalty = clamp((physical.weightLb - 215) / 85, -0.35, 0.55);
    const mph = tpl.topSpeed
        + (rating - 5.5) * 0.95
        + agility * 1.6
        - weightPenalty * 1.1;
    const finalMph = clamp(mph, 14.8, 23.8);
    return mphToPixelsPerSecond(finalMph) * speedMultiplier * stamina;
}

export function resolveAcceleration(player, { accelMultiplier = 1 } = {}) {
    const tpl = templateFor(player);
    const physical = ensurePhysicalProfile(player);
    const accelRating = clamp(player?.attrs?.accel ?? 14, 8, 26);
    const strength = ratingDelta(player?.attrs?.strength, 1);
    const agility = ratingDelta(player?.attrs?.agility, 1);
    const massPenalty = clamp((physical.weightLb - 225) / 200, -0.25, 0.45);
    const yardsPerSec2 = tpl.accel
        + (accelRating - 14) * 0.26
        + strength * 0.9
        + agility * 0.8
        - massPenalty * 1.25;
    const base = clamp(yardsPerSec2, 3.6, 12.5) * PX_PER_YARD;
    return base * accelMultiplier;
}

function applyDrag(motion, dt, groundDrag = 0.92) {
    const damping = clamp(groundDrag, 0, 1);
    motion.vx *= clamp(1 - dt * (1 - damping) * 6, 0.25, 1);
    motion.vy *= clamp(1 - dt * (1 - damping) * 6, 0.25, 1);
}

export function dampMotion(player, dt, damping = 6.0) {
    const motion = ensureMotion(player);
    if (!motion) return;
    const factor = clamp(1 - dt * damping, 0, 1);
    motion.vx *= factor;
    motion.vy *= factor;
    motion.speed = Math.hypot(motion.vx, motion.vy);
    if (motion.speed < 0.1) {
        motion.vx = 0;
        motion.vy = 0;
        motion.speed = 0;
    }
}

function integratePlayer(player, desiredVx, desiredVy, dt, accel, opts = {}) {
    const motion = ensureMotion(player);
    const mass = Math.max(65, motion.mass || 80);
    const maxDelta = (accel / Math.pow(mass / 90, 0.35)) * dt;
    const dvx = desiredVx - motion.vx;
    const dvy = desiredVy - motion.vy;
    const distDelta = Math.hypot(dvx, dvy);
    let vx = motion.vx;
    let vy = motion.vy;
    if (distDelta > 1e-3) {
        const scale = distDelta > maxDelta ? maxDelta / distDelta : 1;
        vx += dvx * scale;
        vy += dvy * scale;
    } else {
        vx = desiredVx;
        vy = desiredVy;
    }

    // Add angular damping for quick cuts
    const agility = clamp(player?.attrs?.agility ?? 1, 0.5, 1.4);
    const cutDamping = clamp(1 - Math.min(Math.abs(motion.lateral) * 0.35, 0.5), 0.65, 1);
    const agilityBoost = 1 + (agility - 1) * 0.6;
    vx *= cutDamping * agilityBoost;
    vy *= cutDamping * agilityBoost;

    motion.vx = vx;
    motion.vy = vy;
    applyDrag(motion, dt, opts.drag ?? 0.88);

    player.pos.x += motion.vx * dt;
    player.pos.y += motion.vy * dt;

    motion.speed = Math.hypot(motion.vx, motion.vy);
    if (motion.speed > 0.05) {
        motion.heading = unitVec({ x: motion.vx, y: motion.vy });
    }
    limitToField(player);
}

export function steerPlayer(player, target, dt, opts = {}) {
    if (!player?.pos || !Number.isFinite(dt)) return;
    const motion = ensureMotion(player);
    const goal = target || player.pos;
    const dx = goal.x - player.pos.x;
    const dy = goal.y - player.pos.y;
    const distance = Math.hypot(dx, dy);

    if (distance < (player.physical?.radius ?? 6.5) * 0.35) {
        dampMotion(player, dt, 9.0);
        return;
    }

    const heading = distance > 0 ? { x: dx / distance, y: dy / distance } : motion.heading;
    const maxSpeed = resolveMaxSpeed(player, opts);
    const accel = resolveAcceleration(player, opts);

    const anticipation = clamp(opts.anticipation ?? 0.2, 0, 0.9);
    const closeRatio = smoothApproach(distance, player.physical?.radius ?? 8);
    const speed = clamp(maxSpeed * (anticipation + closeRatio * (1 - anticipation)), maxSpeed * 0.25, maxSpeed);

    const desiredVx = heading.x * speed;
    const desiredVy = heading.y * speed;

    integratePlayer(player, desiredVx, desiredVy, dt, accel, opts);
}

export function syncMotionToPosition(player) {
    if (!player?.motion || !player?.pos) return;
    const motion = ensureMotion(player);
    motion.prevPos = motion.prevPos || { x: player.pos.x, y: player.pos.y };
    const dx = player.pos.x - motion.prevPos.x;
    const dy = player.pos.y - motion.prevPos.y;
    const moved = Math.hypot(dx, dy);
    motion.speed = moved;
    if (moved > 0.01) {
        motion.heading = unitVec({ x: dx, y: dy });
        motion.vx = dx;
        motion.vy = dy;
    }
    motion.prevPos.x = player.pos.x;
    motion.prevPos.y = player.pos.y;
}

export function beginFrame(players = []) {
    for (const p of players) {
        if (!p?.pos) continue;
        ensureMotion(p);
        p.motion.prevPos = p.motion.prevPos || { x: p.pos.x, y: p.pos.y };
        p.motion.prevPos.x = p.pos.x;
        p.motion.prevPos.y = p.pos.y;
    }
}

export function endFrame(players = []) {
    for (const p of players) {
        if (!p?.pos) continue;
        syncMotionToPosition(p);
    }
}

export function resetMotion(player) {
    if (!player) return;
    player.motion = {
        vx: 0,
        vy: 0,
        ax: 0,
        ay: 0,
        speed: 0,
        heading: { x: 0, y: 1 },
        stamina: 1,
        reaction: 1,
        lateral: 0,
        prevPos: player.pos ? { x: player.pos.x, y: player.pos.y } : { x: 0, y: 0 },
        mass: ensurePhysicalProfile(player)?.mass ?? 95,
    };
}

export function applyCollisionSlowdown(player, severity = 1.0) {
    const motion = ensureMotion(player);
    const factor = clamp(1 - severity * 0.45, 0.35, 1);
    motion.vx *= factor;
    motion.vy *= factor;
    motion.speed *= factor;
}

export function distanceAhead(pos, heading, magnitude) {
    if (!pos || !heading) return { x: pos?.x ?? 0, y: pos?.y ?? 0 };
    return {
        x: pos.x + heading.x * magnitude,
        y: pos.y + heading.y * magnitude,
    };
}

export function willReach(player, target, lookahead = 0.35) {
    if (!player?.pos || !player?.motion || !target) return false;
    const motion = ensureMotion(player);
    const projected = {
        x: player.pos.x + motion.vx * lookahead,
        y: player.pos.y + motion.vy * lookahead,
    };
    return dist(projected, target) < dist(player.pos, target);
}

export function cloneMotion(player) {
    if (!player?.motion) return null;
    return {
        vx: player.motion.vx,
        vy: player.motion.vy,
        speed: player.motion.speed,
        heading: { ...player.motion.heading },
        stamina: player.motion.stamina,
        reaction: player.motion.reaction,
        mass: player.motion.mass,
        radius: player.motion.radius,
    };
}

// ---------------------------------------------------------------------------
// Contact resolution
// ---------------------------------------------------------------------------
function pushStrength(player) {
    const physical = ensurePhysicalProfile(player);
    const strength = clamp(player?.attrs?.strength ?? 1, 0.5, 1.4);
    const weightFactor = clamp(physical.weightLb / 230, 0.7, 1.5);
    return strength * weightFactor;
}

function separationRadius(a, b) {
    const ra = ensurePhysicalProfile(a)?.radius ?? 8;
    const rb = ensurePhysicalProfile(b)?.radius ?? 8;
    return ra + rb;
}

function resolvePairContact(a, b, dt, opts) {
    if (!a?.pos || !b?.pos) return;
    const dx = b.pos.x - a.pos.x;
    const dy = b.pos.y - a.pos.y;
    const distance = Math.hypot(dx, dy) || 1;
    const minDist = separationRadius(a, b) * (opts?.overlap ?? 0.6);
    if (distance >= minDist) return;

    const overlap = minDist - distance;
    const nx = dx / distance;
    const ny = dy / distance;

    const aStrength = pushStrength(a);
    const bStrength = pushStrength(b);
    const totalStrength = aStrength + bStrength || 1;
    const pushA = (overlap * (bStrength / totalStrength)) + (opts?.slop ?? 0.5);
    const pushB = (overlap * (aStrength / totalStrength)) + (opts?.slop ?? 0.5);

    a.pos.x -= nx * pushA;
    a.pos.y -= ny * pushA;
    b.pos.x += nx * pushB;
    b.pos.y += ny * pushB;
    limitToField(a);
    limitToField(b);

    // Momentum exchange for pushing
    const relativeVx = (b.motion?.vx ?? 0) - (a.motion?.vx ?? 0);
    const relativeVy = (b.motion?.vy ?? 0) - (a.motion?.vy ?? 0);
    const relAlongNormal = relativeVx * nx + relativeVy * ny;
    if (relAlongNormal > 0) return;

    const restitution = opts?.restitution ?? 0.1;
    const massA = Math.max(60, a.motion?.mass ?? 90);
    const massB = Math.max(60, b.motion?.mass ?? 90);
    const impulse = -(1 + restitution) * relAlongNormal / (1 / massA + 1 / massB);
    const impulseX = impulse * nx;
    const impulseY = impulse * ny;

    if (a.motion) {
        a.motion.vx -= (impulseX / massA) * (opts?.momentumScale ?? 1);
        a.motion.vy -= (impulseY / massA) * (opts?.momentumScale ?? 1);
    }
    if (b.motion) {
        b.motion.vx += (impulseX / massB) * (opts?.momentumScale ?? 1);
        b.motion.vy += (impulseY / massB) * (opts?.momentumScale ?? 1);
    }
}

export function resolvePlayerContacts(players, dt, opts = {}) {
    if (!Array.isArray(players) || players.length < 2) return;
    const options = {
        overlap: opts.overlap ?? 0.9,
        slop: opts.slop ?? 0.1,
        restitution: opts.restitution ?? 0.05,
        momentumScale: opts.momentumScale ?? 1.0,
    };
    for (let i = 0; i < players.length; i += 1) {
        const a = players[i];
        if (!a) continue;
        for (let j = i + 1; j < players.length; j += 1) {
            const b = players[j];
            if (!b) continue;
            resolvePairContact(a, b, dt, options);
        }
    }
}

