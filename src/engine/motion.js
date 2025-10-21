import { clamp, dist, unitVec } from './helpers';
import { FIELD_PIX_W, FIELD_PIX_H, PX_PER_YARD } from './constants';
import { resolveBehaviorTuning } from './movementProfiles';

// Conversion helpers -------------------------------------------------------
const MPH_TO_YARDS_PER_SEC = 0.488889; // 1 mph ≈ 0.4889 yards/sec
export const mphToPixelsPerSecond = (mph) => mph * MPH_TO_YARDS_PER_SEC * PX_PER_YARD;

// Typical NFL top speeds by archetype (mph). Numbers are grounded in publicly
// available player-tracking data from the Next Gen Stats era.
const ROLE_SPEED_TEMPLATES = {
    QB: 18.5,
    RB: 20.6,
    WR: 21.4,
    TE: 19.1,
    OL: 17.2,
    DL: 17.6,
    LB: 19.3,
    DB: 20.8,
    DEFAULT: 18.8,
};

const ROLE_ACCEL_TEMPLATES = {
    QB: 6.5,
    RB: 8.8,
    WR: 8.9,
    TE: 7.2,
    OL: 5.0,
    DL: 5.6,
    LB: 7.8,
    DB: 8.4,
    DEFAULT: 6.6,
};

function roleToTemplateKey(role = '') {
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

const BASE_SPEED_BOOST = 1.08;
const PLAYER_SPEED_MULTIPLIER = 2;

function resolveTemplate(role) {
    const key = roleToTemplateKey(role);
    return {
        topSpeedMph: ROLE_SPEED_TEMPLATES[key] ?? ROLE_SPEED_TEMPLATES.DEFAULT,
        accelYds: ROLE_ACCEL_TEMPLATES[key] ?? ROLE_ACCEL_TEMPLATES.DEFAULT,
    };
}

function ratingToBonusMph(rating = 5.5) {
    // Ratings are roughly centred on 5.5 (see roster factory). Increase the
    // spread so that elite athletes create a clear separation on the field and
    // plodders noticeably lag behind.
    const delta = clamp(rating - 5.5, -2.5, 2.5);
    return delta * 1.15;
}

function ratingToAccelBonus(accelRating = 12) {
    // accel rating in roster factory is roughly 8..25 (yards/s^2). Amplify the
    // influence so explosive runners hit top speed much faster while slower
    // players feel laboured out of their breaks.
    const delta = clamp(accelRating - 15, -8, 10);
    return delta * 0.28;
}

function ensureMotion(player) {
    if (!player) return null;
    if (!player.motion) {
        player.motion = {
            vx: 0,
            vy: 0,
            speed: 0,
            heading: { x: 0, y: 1 },
            stamina: 1,
            reaction: 1,
            mass: player?.phys?.mass ?? 1,
        };
    }
    if (player.motion.mass == null) player.motion.mass = player?.phys?.mass ?? 1;
    return player.motion;
}

function limitToField(p) {
    if (!p?.pos) return;
    p.pos.x = clamp(p.pos.x, 8, FIELD_PIX_W - 8);
    p.pos.y = clamp(p.pos.y, 0, FIELD_PIX_H - 6);
}

function smoothstep(t) {
    return t * t * (3 - 2 * t);
}

function extractVelocity(source) {
    if (!source) return null;
    if (Number.isFinite(source.vx) && Number.isFinite(source.vy)) {
        return { vx: source.vx, vy: source.vy };
    }
    if (source.motion && Number.isFinite(source.motion.vx) && Number.isFinite(source.motion.vy)) {
        return { vx: source.motion.vx, vy: source.motion.vy };
    }
    if (source.vel && Number.isFinite(source.vel.x) && Number.isFinite(source.vel.y)) {
        return { vx: source.vel.x, vy: source.vel.y };
    }
    return null;
}

function projectVelocity(vx, vy, ax, ay, maxDelta) {
    const dvx = ax - vx;
    const dvy = ay - vy;
    const mag = Math.hypot(dvx, dvy);
    if (mag <= maxDelta || mag === 0) {
        return { vx: ax, vy: ay };
    }
    const scale = maxDelta / mag;
    return {
        vx: vx + dvx * scale,
        vy: vy + dvy * scale,
    };
}

export function resolveMaxSpeed(player, { speedMultiplier = 1 } = {}) {
    const template = resolveTemplate(player?.role);
    const rating = player?.attrs?.speed ?? 5.5;
    const stamina = clamp(player?.motion?.stamina ?? 1, 0.5, 1.0);
    const mph = clamp(template.topSpeedMph + ratingToBonusMph(rating), 13.5, 24.5);
    const weightAdj = clamp(1 - ((player?.phys?.weight ?? 210) - 215) / 420, 0.75, 1.12);
    const strength = clamp(player?.attrs?.strength ?? 1, 0.5, 1.5);
    const strengthDrag = clamp(1 - (Math.max(1 - strength, 0) * 0.12), 0.82, 1.05);
    const baseSpeed =
        mphToPixelsPerSecond(mph) *
        stamina *
        weightAdj *
        strengthDrag *
        BASE_SPEED_BOOST *
        PLAYER_SPEED_MULTIPLIER;

    const throttle = clamp(speedMultiplier, 0, 1.35);
    if (throttle <= 1) {
        return baseSpeed * throttle;
    }

    const burst = 1 + (throttle - 1) * 0.12;
    return baseSpeed * burst;
}

const ACCEL_MIN = PX_PER_YARD * 2.0;
const ACCEL_MAX = PX_PER_YARD * 14.5;

export function resolveAcceleration(player, { accelMultiplier = 1 } = {}) {
    const template = resolveTemplate(player?.role);
    const base = template.accelYds + ratingToAccelBonus(player?.attrs?.accel ?? 12);
    const strength = clamp(player?.attrs?.strength ?? 1, 0.5, 1.5);
    const strengthBoost = clamp((strength - 1) * 0.9, -0.3, 0.45);
    const massAdj = clamp(1.05 - ((player?.phys?.mass ?? 1) - 1) * 0.35 + strengthBoost, 0.45, 1.35);
    const accel = base * PX_PER_YARD * accelMultiplier * massAdj * PLAYER_SPEED_MULTIPLIER;
    return clamp(accel, ACCEL_MIN * PLAYER_SPEED_MULTIPLIER, ACCEL_MAX * PLAYER_SPEED_MULTIPLIER);
}

export function dampMotion(player, dt, damping = 4.0) {
    const motion = ensureMotion(player);
    if (!motion) return;
    const inertia = clamp((player?.phys?.mass ?? 1), 0.55, 1.95);
    const factor = clamp(1 - (damping / (1 + (inertia - 1) * 0.65)) * dt, 0, 1);
    motion.vx *= factor;
    motion.vy *= factor;
    motion.speed = Math.hypot(motion.vx, motion.vy);
    if (motion.speed < 0.25) {
        motion.vx = 0;
        motion.vy = 0;
        motion.speed = 0;
    }
}

export function steerPlayer(player, target, dt, opts = {}) {
    if (!player?.pos || !Number.isFinite(dt)) return;
    const motion = ensureMotion(player);
    const goal = target || player.pos;

    const tuning = resolveBehaviorTuning(player, opts.behavior, opts);

    const maxSpeed = resolveMaxSpeed(player, opts);
    const accel = resolveAcceleration(player, opts);

    const leadSeconds = opts.leadSeconds ?? tuning.leadSeconds ?? 0;
    let aim = goal;
    if (leadSeconds > 0) {
        const targetVel = opts.targetVelocity || extractVelocity(opts.pursuitTarget);
        if (targetVel) {
            aim = {
                x: goal.x + targetVel.vx * leadSeconds,
                y: goal.y + targetVel.vy * leadSeconds,
            };
        }
    }

    const dx = aim.x - player.pos.x;
    const dy = aim.y - player.pos.y;
    const distance = Math.hypot(dx, dy);

    const captureRadius = opts.captureRadius ?? tuning.captureRadius ?? 0.5;
    if (distance < captureRadius) {
        const settleDamping = opts.settleDamping ?? tuning.settleDamping ?? 6.0;
        dampMotion(player, dt, settleDamping);
        limitToField(player);
        return;
    }

    const rawHeading = distance > 0 ? { x: dx / distance, y: dy / distance } : motion.heading;
    const agility = clamp(player?.attrs?.agility ?? 1, 0.5, 1.5);
    const agilityCurve = tuning.agilityCurve ?? 0.18;
    const blendMin = tuning.blendMin ?? 0.4;
    const blendMax = tuning.blendMax ?? 0.88;
    const baseBlend = clamp(tuning.headingLag - (agility - 1) * agilityCurve, blendMin, blendMax);
    const distanceBlend = clamp(distance / (PX_PER_YARD * (tuning.distanceHorizon ?? 4)), 0, 1);
    const blendBase = tuning.distanceBlendBase ?? 0.5;
    const blendGain = tuning.distanceBlendGain ?? 0.5;
    const blend = clamp(baseBlend * (blendBase + distanceBlend * blendGain), blendMin, blendMax);
    const desiredHeading = (() => {
        const hx = motion.heading.x * blend + rawHeading.x * (1 - blend);
        const hy = motion.heading.y * blend + rawHeading.y * (1 - blend);
        const mag = Math.hypot(hx, hy) || 1;
        return { x: hx / mag, y: hy / mag };
    })();
    const ramp = smoothstep(clamp(distance / (PX_PER_YARD * (tuning.accelRamp ?? 1.6)), 0, 1));
    const arrivalBrake = Math.max(tuning.arrivalBrake ?? 4, 0.5);
    const arrivalSpeed = clamp(distance / Math.max(dt * arrivalBrake, 1e-3), 0, maxSpeed * (tuning.arrivalCap ?? 0.9));
    const rampedSpeed = ramp * maxSpeed * (tuning.rampScale ?? 1);
    const desiredSpeed = Math.min(maxSpeed * (tuning.speedCeiling ?? 1), Math.max(rampedSpeed, arrivalSpeed));
    const desiredVx = desiredHeading.x * desiredSpeed;
    const desiredVy = desiredHeading.y * desiredSpeed;

    const agilityBias = tuning.agilityBias ?? 1;
    const agilityMin = tuning.agilityMin ?? 0.6;
    const agilityMax = tuning.agilityMax ?? 1.35;
    const agilityBoost = clamp(agility * agilityBias, agilityMin, agilityMax);
    const maxDelta = accel * agilityBoost * dt;
    const { vx, vy } = projectVelocity(motion.vx, motion.vy, desiredVx, desiredVy, maxDelta);

    motion.vx = vx;
    motion.vy = vy;

    player.pos.x += motion.vx * dt;
    player.pos.y += motion.vy * dt;

    motion.speed = Math.hypot(motion.vx, motion.vy);
    if (motion.speed > 0.01) {
        motion.heading = unitVec({ x: motion.vx, y: motion.vy });
    }

    limitToField(player);
}

export function syncMotionToPosition(player) {
    if (!player?.motion || !player?.pos || !player?.motion.prevPos) return;
    const dx = player.pos.x - player.motion.prevPos.x;
    const dy = player.pos.y - player.motion.prevPos.y;
    const distMoved = Math.hypot(dx, dy);
    const heading = distMoved > 0 ? { x: dx / distMoved, y: dy / distMoved } : player.motion.heading;
    player.motion.heading = heading;
    player.motion.speed = distMoved;
}

export function beginFrame(players = []) {
    for (const p of players) {
        if (!p) continue;
        ensureMotion(p);
        p.motion.prevPos = p.motion.prevPos || { x: p.pos.x, y: p.pos.y };
        p.motion.prevPos.x = p.pos.x;
        p.motion.prevPos.y = p.pos.y;
    }
}

export function endFrame(players = []) {
    for (const p of players) {
        if (!p) continue;
        syncMotionToPosition(p);
        if (p.motion) {
            p.motion.prevPos.x = p.pos.x;
            p.motion.prevPos.y = p.pos.y;
        }
    }
}

export function resetMotion(player) {
    if (!player) return;
    player.motion = {
        vx: 0,
        vy: 0,
        speed: 0,
        heading: { x: 0, y: 1 },
        stamina: 1,
        reaction: 1,
        mass: player?.phys?.mass ?? 1,
    };
}

export function applyCollisionSlowdown(player, severity = 1.0) {
    const motion = ensureMotion(player);
    if (!motion) return;
    const factor = clamp(1 - 0.55 * severity, 0.25, 1);
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

export function willReach(player, target, lookahead = 0.3) {
    if (!player?.pos || !player?.motion) return false;
    const projected = {
        x: player.pos.x + player.motion.vx * lookahead,
        y: player.pos.y + player.motion.vy * lookahead,
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
    };
}

