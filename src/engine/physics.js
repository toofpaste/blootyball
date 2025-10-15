import { clamp } from './helpers';
import { FIELD_PIX_W, FIELD_PIX_H } from './constants';
import { applyCollisionSlowdown } from './motion';

function clampToField(pos) {
    if (!pos) return;
    pos.x = clamp(pos.x, 8, FIELD_PIX_W - 8);
    pos.y = clamp(pos.y, 0, FIELD_PIX_H - 6);
}

function resolveRadius(player) {
    if (!player) return 8;
    if (player.phys?.radius) return clamp(player.phys.radius, 6, 14);
    const height = player.phys?.height ?? 74;
    return clamp(7 + (height - 70) * 0.32, 6, 12);
}

function resolveMass(player) {
    if (!player) return 1;
    if (player.motion?.mass != null) return clamp(player.motion.mass, 0.5, 2.2);
    if (player.phys?.mass != null) return clamp(player.phys.mass, 0.5, 2.2);
    const weight = player.phys?.weight ?? 210;
    return clamp(weight / 220, 0.5, 2.2);
}

function sameTeam(a, b) {
    if (!a || !b) return false;
    return a.team && b.team && a.team === b.team;
}

function isCarrier(play, player) {
    if (!play?.ball || !player) return false;
    const carrierId = play.ball.carrierId;
    if (carrierId == null) return false;
    if (carrierId === player.id) return true;
    const off = play.formation?.off || {};
    for (const [role, p] of Object.entries(off)) {
        if (p && (p.id === carrierId || carrierId === role)) {
            return player.id === p.id;
        }
    }
    const def = play.formation?.def || {};
    for (const [, p] of Object.entries(def)) {
        if (p && (p.id === carrierId || carrierId === p.role)) {
            return player.id === p.id;
        }
    }
    return false;
}

function applyMomentumPush(attacker, target, normal, dt) {
    if (!attacker?.motion || !target?.motion) return;
    const rel = attacker.motion.vx * normal.x + attacker.motion.vy * normal.y;
    if (rel <= 0) return;
    const attackerMass = resolveMass(attacker);
    const targetMass = resolveMass(target);
    const targetSpeed = target.motion.speed || Math.hypot(target.motion.vx, target.motion.vy);
    const momentum = rel * attackerMass;
    const resistance = Math.max(0.3, targetMass * 0.9 + targetSpeed * 0.08);
    const impulse = Math.max(0, (momentum - resistance) * 0.32);
    if (impulse <= 0) return;
    const push = clamp(impulse * (dt * 42), 0, 18);
    target.pos.x += normal.x * push;
    target.pos.y += normal.y * push;
    target.motion.vx += normal.x * impulse * 0.45;
    target.motion.vy += normal.y * impulse * 0.45;
    attacker.motion.vx -= normal.x * impulse * 0.2;
    attacker.motion.vy -= normal.y * impulse * 0.2;
    clampToField(target.pos);
    clampToField(attacker.pos);
}

export function applyPlayerPhysics(play, dt = 0.016) {
    if (!play?.formation) return;
    const offPlayers = Object.values(play.formation.off || {}).filter(p => p && p.pos);
    const defPlayers = Object.values(play.formation.def || {}).filter(p => p && p.pos);
    const allPlayers = [...offPlayers, ...defPlayers];
    if (allPlayers.length < 2) return;

    for (let i = 0; i < allPlayers.length; i++) {
        for (let j = i + 1; j < allPlayers.length; j++) {
            const a = allPlayers[i];
            const b = allPlayers[j];
            const ax = a.pos?.x ?? 0;
            const ay = a.pos?.y ?? 0;
            const bx = b.pos?.x ?? 0;
            const by = b.pos?.y ?? 0;
            let dx = bx - ax;
            let dy = by - ay;
            let d = Math.hypot(dx, dy);
            if (d < 1e-3) {
                d = 1e-3;
                const angle = Math.random() * Math.PI * 2;
                dx = Math.cos(angle) * d;
                dy = Math.sin(angle) * d;
            }

            const radiusA = resolveRadius(a);
            const radiusB = resolveRadius(b);
            const allowOverlap = 2.2;
            const minDist = radiusA + radiusB - allowOverlap;
            if (d >= minDist) continue;

            const normal = { x: dx / d, y: dy / d };
            const penetration = minDist - d;
            const massA = resolveMass(a);
            const massB = resolveMass(b);
            const totalMass = Math.max(massA + massB, 1e-3);
            const moveA = penetration * (massB / totalMass);
            const moveB = penetration * (massA / totalMass);

            a.pos.x -= normal.x * moveA;
            a.pos.y -= normal.y * moveA;
            b.pos.x += normal.x * moveB;
            b.pos.y += normal.y * moveB;
            clampToField(a.pos);
            clampToField(b.pos);

            const severity = clamp(penetration / (radiusA + radiusB), 0.1, 1.0);
            const heavier = massA > massB ? a : b;
            const lighter = heavier === a ? b : a;
            const heavyBias = clamp(Math.abs(massA - massB) / (massA + massB + 1e-3), 0, 0.35);
            applyCollisionSlowdown(heavier, severity * (0.35 - heavyBias * 0.2));
            applyCollisionSlowdown(lighter, severity * (0.55 + heavyBias * 0.6));

            const aCarrier = isCarrier(play, a);
            const bCarrier = isCarrier(play, b);
            if (aCarrier && !sameTeam(a, b)) {
                applyMomentumPush(a, b, normal, dt);
            } else if (bCarrier && !sameTeam(a, b)) {
                applyMomentumPush(b, a, { x: -normal.x, y: -normal.y }, dt);
            }
        }
    }
}

export function getPlayerMass(player) {
    return resolveMass(player);
}

export function getPlayerRadius(player) {
    return resolveRadius(player);
}
