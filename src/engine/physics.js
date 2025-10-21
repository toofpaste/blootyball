import { Engine, World, Bodies, Body } from 'matter-js';

import { clamp } from './helpers';
import { FIELD_PIX_W, FIELD_PIX_H } from './constants';
import { applyCollisionSlowdown } from './motion';

function clampToField(pos) {
    if (!pos) return;
    pos.x = clamp(pos.x, 8, FIELD_PIX_W - 8);
    pos.y = clamp(pos.y, 0, FIELD_PIX_H - 6);
}

function createPhysicsEngine() {
    const engine = Engine.create({ enableSleeping: false, gravity: { x: 0, y: 0 } });
    engine.positionIterations = 8;
    engine.velocityIterations = 6;
    engine.world.gravity.x = 0;
    engine.world.gravity.y = 0;
    return engine;
}

function syncPlayerFromBody(player, body, dt) {
    if (!player?.pos || !body) return;
    const targetX = clamp(body.position.x, 8, FIELD_PIX_W - 8);
    const targetY = clamp(body.position.y, 0, FIELD_PIX_H - 6);
    const hitWallX = Math.abs(targetX - body.position.x) > 1e-4;
    const hitWallY = Math.abs(targetY - body.position.y) > 1e-4;

    player.pos.x = targetX;
    player.pos.y = targetY;

    if (!player.motion) return;

    const safeDt = dt > 1e-4 ? dt : 1e-4;
    const invDt = 1 / safeDt;
    const finalVx = hitWallX ? 0 : body.velocity.x * invDt;
    const finalVy = hitWallY ? 0 : body.velocity.y * invDt;
    player.motion.vx = finalVx;
    player.motion.vy = finalVy;
    player.motion.speed = Math.hypot(finalVx, finalVy);
    if (player.motion.speed > 0.01) {
        player.motion.heading = { x: finalVx / player.motion.speed, y: finalVy / player.motion.speed };
    }
}

function buildPlayerBody(player, dt) {
    const radius = resolveRadius(player);
    const mass = resolveMass(player);
    const pos = player?.pos || { x: FIELD_PIX_W / 2, y: FIELD_PIX_H / 2 };
    const motion = player?.motion || { vx: 0, vy: 0 };
    const safeDt = dt > 1e-4 ? dt : 1e-4;

    const body = Bodies.circle(pos.x, pos.y, radius, {
        frictionAir: clamp(0.1 + ((player?.attrs?.agility ?? 1) - 1) * 0.08, 0.04, 0.22),
        friction: 0,
        frictionStatic: 0,
        restitution: 0.18,
        inertia: Infinity,
    });

    Body.setMass(body, mass);
    Body.setVelocity(body, {
        x: (motion.vx ?? 0) * safeDt,
        y: (motion.vy ?? 0) * safeDt,
    });
    body.plugin = { player, radius, mass };
    return body;
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
    const attackerStrength = clamp(attacker?.attrs?.strength ?? 1, 0.5, 1.6);
    const targetStrength = clamp(target?.attrs?.strength ?? 1, 0.5, 1.6);
    const targetSpeed = target.motion.speed || Math.hypot(target.motion.vx, target.motion.vy);
    const strengthEdge = clamp(attackerStrength / Math.max(targetStrength, 0.5), 0.5, 2.2);
    const momentum = rel * attackerMass * (0.85 + (attackerStrength - 1) * 0.35);
    const resistance = Math.max(0.25, targetMass * (0.75 + (targetStrength - 1) * 0.6) + targetSpeed * 0.08);
    const impulse = Math.max(0, (momentum - resistance) * 0.32 * strengthEdge);
    if (impulse <= 0) return;
    const push = clamp(impulse * (dt * 42), 0, 18);
    target.pos.x += normal.x * push;
    target.pos.y += normal.y * push;
    target.motion.vx += normal.x * impulse * clamp(0.35 + (1 - targetStrength) * 0.25, 0.2, 0.6);
    target.motion.vy += normal.y * impulse * clamp(0.35 + (1 - targetStrength) * 0.25, 0.2, 0.6);
    attacker.motion.vx -= normal.x * impulse * clamp(0.18 + (attackerStrength - 1) * 0.12, 0.08, 0.35);
    attacker.motion.vy -= normal.y * impulse * clamp(0.18 + (attackerStrength - 1) * 0.12, 0.08, 0.35);
    clampToField(target.pos);
    clampToField(attacker.pos);
}

export function applyPlayerPhysics(play, dt = 0.016) {
    if (!play?.formation) return;
    if (!Number.isFinite(dt) || dt <= 0) return;
    const offPlayers = Object.values(play.formation.off || {}).filter(p => p && p.pos);
    const defPlayers = Object.values(play.formation.def || {}).filter(p => p && p.pos);
    const allPlayers = [...offPlayers, ...defPlayers];
    if (allPlayers.length === 0) return;

    const engine = createPhysicsEngine();
    const world = engine.world;
    const bodies = [];

    for (const player of allPlayers) {
        bodies.push(buildPlayerBody(player, dt));
    }

    if (bodies.length === 0) return;

    World.add(world, bodies);
    Engine.update(engine, dt * 1000);

    for (const body of bodies) {
        const player = body.plugin?.player;
        if (!player) continue;
        syncPlayerFromBody(player, body, dt);
        clampToField(player.pos);
    }

    const processed = new Set();
    for (const pair of engine.pairs.list || []) {
        if (!pair?.isActive || pair.isSensor) continue;
        const playerA = pair.bodyA?.plugin?.player;
        const playerB = pair.bodyB?.plugin?.player;
        if (!playerA || !playerB || playerA === playerB) continue;

        const key = playerA.id && playerB.id ? `${playerA.id}:${playerB.id}` : `${playerA.role}:${playerB.role}`;
        if (processed.has(key) || processed.has(`${playerB?.id ?? playerB?.role}:${playerA?.id ?? playerA?.role}`)) continue;
        processed.add(key);

        const radiusA = pair.bodyA?.plugin?.radius ?? resolveRadius(playerA);
        const radiusB = pair.bodyB?.plugin?.radius ?? resolveRadius(playerB);
        const ax = playerA.pos?.x ?? 0;
        const ay = playerA.pos?.y ?? 0;
        const bx = playerB.pos?.x ?? 0;
        const by = playerB.pos?.y ?? 0;
        let dx = bx - ax;
        let dy = by - ay;
        let dist = Math.hypot(dx, dy);
        if (dist < 1e-5) {
            dist = 1e-5;
            const angle = Math.random() * Math.PI * 2;
            dx = Math.cos(angle) * dist;
            dy = Math.sin(angle) * dist;
        }

        const normal = { x: dx / dist, y: dy / dist };
        const overlap = Math.max(radiusA + radiusB - dist, 0);
        const penetration = Math.max(pair.collision?.depth ?? 0, overlap);
        if (penetration <= 0) continue;

        const massA = resolveMass(playerA);
        const massB = resolveMass(playerB);
        const severity = clamp(penetration / (radiusA + radiusB), 0.05, 1.0);
        const heavier = massA >= massB ? playerA : playerB;
        const lighter = heavier === playerA ? playerB : playerA;
        const heavyBias = clamp(Math.abs(massA - massB) / (massA + massB + 1e-3), 0, 0.35);
        applyCollisionSlowdown(heavier, severity * (0.35 - heavyBias * 0.2));
        applyCollisionSlowdown(lighter, severity * (0.55 + heavyBias * 0.6));

        const aCarrier = isCarrier(play, playerA);
        const bCarrier = isCarrier(play, playerB);
        if (aCarrier && !sameTeam(playerA, playerB)) {
            applyMomentumPush(playerA, playerB, normal, dt);
        } else if (bCarrier && !sameTeam(playerA, playerB)) {
            applyMomentumPush(playerB, playerA, { x: -normal.x, y: -normal.y }, dt);
        }
    }

    for (const player of allPlayers) {
        if (!player?.motion) continue;
        player.motion.speed = Math.hypot(player.motion.vx, player.motion.vy);
        if (player.motion.speed > 0.01) {
            player.motion.heading = {
                x: player.motion.vx / player.motion.speed,
                y: player.motion.vy / player.motion.speed,
            };
        }
        clampToField(player.pos);
    }

    World.clear(world, false);
    Engine.clear(engine);
}

export function getPlayerMass(player) {
    return resolveMass(player);
}

export function getPlayerRadius(player) {
    return resolveRadius(player);
}
