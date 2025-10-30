// ⬇️ UPDATE your imports at the top of this file
import { clamp, dist, rand, yardsToPixY } from './helpers';
import { FIELD_PIX_W, FIELD_PIX_H, PX_PER_YARD } from './constants';
import { mphToPixelsPerSecond } from './motion';
import { recordPlayEvent } from './diagnostics';

const PASS_ARC_SHAPE_EXP = 0.68;
const PASS_ARC_NORMALIZER = Math.pow(0.5, PASS_ARC_SHAPE_EXP * 2);

// ⬇️ ADD this small helper near the top (below the imports)
function _resolveOffensivePlayer(off, idOrRole) {
    if (!off) return null;
    if (idOrRole == null) return null;

    // Role string (e.g., 'QB', 'RB', 'WR1'…)
    if (typeof idOrRole === 'string' && off[idOrRole] && off[idOrRole].pos) {
        return off[idOrRole];
    }
    // Match by player id
    for (const p of Object.values(off)) {
        if (p && p.id === idOrRole && p.pos) return p;
    }
    return null;
}

// ⬇️ REPLACE your existing getBallPix with this defensive version
export function getBallPix(s) {
    const off = s?.play?.formation?.off || {};
    const ball = s?.play?.ball || {};

    // If we already cached a render position (e.g., while in-flight), use it
    if (ball.renderPos && typeof ball.renderPos.x === 'number' && typeof ball.renderPos.y === 'number') {
        return ball.renderPos;
    }

    // Try to resolve the current carrier by role or id
    let carrier = _resolveOffensivePlayer(off, ball.carrierId);

    // Fallbacks: QB → any offensive player → safe default
    if (!carrier && off.QB && off.QB.pos) carrier = off.QB;
    if (!carrier) {
        const any = Object.values(off).find(p => p && p.pos);
        if (any) carrier = any;
    }
    if (carrier && carrier.pos) return { x: carrier.pos.x, y: carrier.pos.y };

    // Safe default while the next formation is being placed
    return { x: FIELD_PIX_W / 2, y: yardsToPixY(25) };
}

export function isBallLoose(ball) {
    return !!(ball && !ball.inAir && ball.carrierId == null && ball.loose && ball.loose.pos);
}

export function startFumble(s, { pos, byId, forcedById } = {}) {
    if (!s?.play || !s.play.ball) return;
    const ball = s.play.ball;
    const drop = pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)
        ? { x: clamp(pos.x, 6, FIELD_PIX_W - 6), y: clamp(pos.y, 0, FIELD_PIX_H) }
        : getBallPix(s);

    ball.inAir = false;
    ball.targetId = null;
    ball.carrierId = null;
    ball.lastCarrierId = byId || ball.lastCarrierId || null;
    ball.renderPos = { ...drop };
    ball.shadowPos = { ...drop };
    ball.flight = { kind: 'fumble', height: 0 };
    ball.loose = {
        pos: { ...drop },
        vx: rand(-40, 40),
        vy: rand(-24, 42),
        vz: 90 + Math.random() * 40,
        gravity: 230,
        friction: 0.9,
        restitution: 0.42,
        bounces: 0,
        maxBounces: 3,
        cooldown: 0.25,
        height: 0,
        settleTimer: 0,
    };

    const existing = s.play.fumble || {};
    s.play.fumble = {
        ...existing,
        active: true,
        startAt: s.play.elapsed ?? existing.startAt ?? 0,
        byId: byId || existing.byId || ball.lastCarrierId || null,
        forcedById: forcedById ?? existing.forcedById ?? null,
        recoveredById: null,
        recoveredByTeam: null,
        recoveredAt: null,
        dropPos: { ...drop },
    };

    s.play.resultText = 'Fumble!';
    s.play.resultWhy = 'Fumble';
    s.play.turnover = false;
    s.play.deadAt = null;

    recordPlayEvent(s, {
        type: 'ball:fumble',
        by: byId || ball.lastCarrierId || null,
        forcedBy: forcedById ?? null,
    });

    if (s.debug?.forceNextOutcome === 'FUMBLE') {
        s.play.__forcedFumbleDone = true;
    }
}

function updateLooseBall(s, dt) {
    const ball = s.play.ball;
    const loose = ball.loose;
    if (!loose || !loose.pos) {
        ball.loose = null;
        return;
    }

    const friction = Math.pow(loose.friction ?? 0.9, dt * 60);
    loose.cooldown = Math.max(0, (loose.cooldown ?? 0) - dt);
    loose.settleTimer = (loose.settleTimer || 0) + dt;

    loose.vx = (loose.vx || 0) * friction;
    loose.vy = (loose.vy || 0) * friction;
    loose.vz = (loose.vz || 0) - (loose.gravity ?? 230) * dt;

    loose.height = Math.max(0, (loose.height || 0) + (loose.vz || 0) * dt);
    if (loose.height <= 0 && loose.vz < 0) {
        if ((loose.bounces || 0) < (loose.maxBounces ?? 2) && Math.abs(loose.vz) > 30) {
            loose.bounces = (loose.bounces || 0) + 1;
            loose.vz = -loose.vz * (loose.restitution ?? 0.4);
            loose.height = 0;
            loose.vx *= 0.82;
            loose.vy *= 0.82;
        } else {
            loose.height = 0;
            loose.vz = 0;
        }
    }

    loose.pos.x = clamp((loose.pos.x || 0) + (loose.vx || 0) * dt, 6, FIELD_PIX_W - 6);
    loose.pos.y = clamp((loose.pos.y || 0) + (loose.vy || 0) * dt, 0, FIELD_PIX_H);

    ball.renderPos = { x: loose.pos.x, y: loose.pos.y };
    ball.shadowPos = { x: loose.pos.x, y: loose.pos.y };
    ball.flight = { kind: 'fumble', height: loose.height || 0 };

    handleLooseBallBoundaries(s);
    if (ball.loose) maybeRecoverLooseBall(s);
}

function handleLooseBallBoundaries(s) {
    if (!isBallLoose(s.play?.ball)) return;
    const loose = s.play.ball.loose;
    const pos = loose?.pos;
    if (!pos) return;

    const outLeft = pos.x <= 8;
    const outRight = pos.x >= FIELD_PIX_W - 8;
    const outTop = pos.y <= 4;
    const outBottom = pos.y >= FIELD_PIX_H - 4;

    if (outLeft || outRight || outTop || outBottom) {
        s.play.ball.loose = null;
        s.play.ball.flight = null;
        s.play.ball.renderPos = { ...pos };
        s.play.ball.shadowPos = { ...pos };
        const existing = s.play.fumble || {};
        s.play.fumble = {
            ...existing,
            active: false,
            recoveredById: existing.recoveredById ?? null,
            recoveredByTeam: existing.recoveredByTeam ?? null,
            recoveredAt: { ...pos },
        };
        s.play.deadAt = s.play.elapsed;
        s.play.phase = 'DEAD';
        s.play.turnover = false;
        s.play.resultWhy = 'Fumble out of bounds';
        s.play.resultText = 'Fumble out of bounds';
    }
}

function maybeRecoverLooseBall(s) {
    if (!isBallLoose(s.play?.ball)) return;
    const ball = s.play.ball;
    const loose = ball.loose;
    const pos = loose?.pos;
    if (!pos) return;

    const offPlayers = Object.values(s.play?.formation?.off || {});
    const defPlayers = Object.values(s.play?.formation?.def || {});
    const all = [...offPlayers, ...defPlayers].filter(p => p && p.pos);
    if (!all.length) return;

    const recoverRadius = loose.height > 4 ? 9 : 11;
    let best = null;
    for (const p of all) {
        const d = dist(p.pos, pos);
        if (!best || d < best.d) {
            best = { player: p, d };
        }
        if (d <= recoverRadius && loose.cooldown <= 0 && loose.height <= 6) {
            completeFumbleRecovery(s, p);
            return;
        }
    }

    if (best && (loose.settleTimer || 0) > 1.6) {
        completeFumbleRecovery(s, best.player);
    }
}

function completeFumbleRecovery(s, player) {
    if (!player?.pos) return;
    const ball = s.play.ball;
    const offenseSlot = s.possession;
    const recoveredByOffense = player.team ? (player.team === offenseSlot) : false;

    ball.loose = null;
    ball.flight = null;
    ball.renderPos = { x: player.pos.x, y: player.pos.y };
    ball.shadowPos = { x: player.pos.x, y: player.pos.y };
    ball.carrierId = player.id || player.role || null;
    ball.lastCarrierId = ball.carrierId || ball.lastCarrierId || null;

    const existing = s.play.fumble || {};
    s.play.fumble = {
        ...existing,
        active: false,
        recoveredById: player.id || null,
        recoveredByTeam: player.team || null,
        recoveredAt: { x: player.pos.x, y: player.pos.y },
    };

    const baseName = player.profile?.lastName
        || player.profile?.shortName
        || player.profile?.fullName
        || player.role
        || player.id
        || (recoveredByOffense ? 'offense' : 'defense');
    const text = `Fumble recovered by ${baseName}`;

    s.play.deadAt = s.play.elapsed;
    s.play.phase = 'DEAD';
    s.play.turnover = !recoveredByOffense;
    s.play.resultWhy = text;
    s.play.resultText = text;

    recordPlayEvent(s, {
        type: 'ball:fumble-recovered',
        by: player.id || null,
        team: player.team || null,
        offenseRecovered: recoveredByOffense,
    });
}
export function startPass(s, from, to, targetId) {
    const ball = s.play.ball;
    const qb = s.play?.formation?.off?.QB;
    const arm = clamp(qb?.attrs?.throwPow ?? 1, 0.5, 1.4);
    const acc = clamp(qb?.attrs?.throwAcc ?? 1, 0.35, 1.4);
    const iq = clamp(qb?.attrs?.awareness ?? 0.9, 0.4, 1.4);
    const distance = Math.max(1, dist(from, to));
    const velocityTrait = clamp((qb?.modifiers?.throwVelocity ?? 0.5) - 0.5, -0.3, 0.3);
    const touchTrait = clamp((qb?.modifiers?.touch ?? 0.5) - 0.5, -0.3, 0.3);
    const mph = clamp(54 + (arm - 1) * 28 + velocityTrait * 16, 42, 78);
    const speed = Math.max(90, mphToPixelsPerSecond(mph));
    const duration = clamp(distance / speed, 0.32, 1.6);
    const distanceYards = distance / PX_PER_YARD;
    const difficulty = clamp((distanceYards - 8) / 18, 0, 1.3);
    const accComposite = clamp(Math.pow(acc + touchTrait * 0.14, 1.12), 0.3, 1.55);
    const iqComposite = clamp(Math.pow(iq, 1.08), 0.35, 1.5);
    const rawAccuracy = accComposite * (0.54 + iqComposite * 0.36);
    const accuracyPenalty = difficulty * clamp(1.25 - accComposite * 0.55 - iqComposite * 0.25, 0.45, 1.25);
    const flightAccuracy = clamp(rawAccuracy - accuracyPenalty, 0.2, 1.42);
    const loftFactor = clamp(0.36 + touchTrait * 0.12, 0.26, 0.5);
    const peakHeight = clamp(distance * loftFactor, 24, 128);

    ball.inAir = true;
    ball.lastCarrierId = ball.carrierId || ball.lastCarrierId || qb?.id || 'QB';
    ball.carrierId = null;
    ball.from = { ...from };
    ball.to = { ...to };
    ball.t = 0;
    ball.flight = {
        kind: 'pass',
        duration,
        elapsed: 0,
        peakHeight,
        wobble: Math.random() * clamp(0.18 + (1 - flightAccuracy) * 0.5, 0.12, 0.55),
        speed,
        accuracy: flightAccuracy,
        totalDist: distance,
        travelled: 0,
    };
    ball.shadowPos = { ...from };
    ball.renderPos = { ...from };
    ball.targetId = targetId; // null means throw-away

    recordPlayEvent(s, {
        type: 'pass:thrown',
        from: { ...from },
        to: { ...to },
        targetId: targetId ?? null,
        throwSpeed: speed,
        duration,
    });
}

export function startPitch(s, from, to, targetId) {
    const ball = s.play.ball;
    const qb = s.play?.formation?.off?.QB;
    const distance = Math.max(1, dist(from, to));
    const speed = clamp(distance / 0.2, 80, 200);
    const duration = clamp(distance / speed, 0.12, 0.4);

    ball.inAir = true;
    ball.lastCarrierId = ball.carrierId || ball.lastCarrierId || qb?.id || 'QB';
    ball.carrierId = null;
    ball.from = { ...from };
    ball.to = { ...to };
    ball.t = 0;
    ball.flight = {
        kind: 'pitch',
        duration,
        elapsed: 0,
        peakHeight: clamp(distance * 0.12, 5, 20),
        wobble: 0,
        speed,
        accuracy: 1,
        totalDist: distance,
        travelled: 0,
    };
    ball.shadowPos = { ...from };
    ball.renderPos = { ...from };
    ball.targetId = targetId;

    recordPlayEvent(s, {
        type: 'pitch:thrown',
        from: { ...from },
        to: { ...to },
        targetId: targetId ?? null,
        duration,
    });
}

export function moveBall(s, dt) {
    const off = s.play.formation.off;
    const def = s.play.formation.def;
    const ball = s.play.ball;

    if (isBallLoose(ball)) {
        updateLooseBall(s, dt);
        return;
    }

    // force fumble once per play if requested and someone has possession
    if (!ball.inAir && ball.carrierId && s.debug?.forceNextOutcome === 'FUMBLE' && !s.play.__forcedFumbleDone) {
        const carrier = _resolveOffensivePlayer(off, ball.carrierId);
        startFumble(s, { pos: carrier?.pos ? { ...carrier.pos } : ball.renderPos, byId: ball.carrierId });
        return;
    }

    if (ball.inAir) {
        const flight = ball.flight || { duration: 0.6, elapsed: 0, peakHeight: 18, speed: 120, accuracy: 1, totalDist: 1, travelled: 0 };
        flight.elapsed += dt;

        const currentPos = ball.renderPos || ball.shadowPos || ball.from;
        let targetPos = ball.to ? { ...ball.to } : { ...ball.from };

        if (ball.targetId) {
            const target = _resolveOffensivePlayer(off, ball.targetId);
            if (target?.pos) {
                const desired = { x: target.pos.x, y: target.pos.y };
                const lerp = clamp(dt * 6, 0, 1);
                targetPos = {
                    x: targetPos.x + (desired.x - targetPos.x) * lerp,
                    y: targetPos.y + (desired.y - targetPos.y) * lerp,
                };
                ball.to = { ...targetPos };
            }
        }

        const dx = targetPos.x - currentPos.x;
        const dy = targetPos.y - currentPos.y;
        const distToTarget = Math.hypot(dx, dy);
        const travelStep = flight.speed * dt;
        const step = distToTarget > 0 ? Math.min(travelStep, distToTarget) : 0;
        const nx = currentPos.x + (distToTarget > 0 ? (dx / distToTarget) * step : 0);
        const ny = currentPos.y + (distToTarget > 0 ? (dy / distToTarget) * step : 0);
        const safeX = clamp(nx, 6, FIELD_PIX_W - 6);
        const safeY = clamp(ny, 0, FIELD_PIX_H);

        const travelledNow = Math.hypot(safeX - currentPos.x, safeY - currentPos.y);
        flight.travelled = (flight.travelled || 0) + travelledNow;
        const remaining = Math.max(0, distToTarget - travelledNow);
        const inferredTotal = flight.travelled + remaining;
        flight.totalDist = Math.max(flight.totalDist || inferredTotal, inferredTotal);
        const timeProgress = flight.duration > 0
            ? clamp(flight.elapsed / flight.duration, 0, 1)
            : (flight.totalDist > 0 ? clamp(flight.travelled / flight.totalDist, 0, 1) : 1);
        let arcHeight;
        if (flight.kind === 'pass') {
            const shaped = Math.pow(timeProgress, PASS_ARC_SHAPE_EXP) * Math.pow(1 - timeProgress, PASS_ARC_SHAPE_EXP);
            const normalized = PASS_ARC_NORMALIZER > 0 ? shaped / PASS_ARC_NORMALIZER : 0;
            arcHeight = (flight.peakHeight || 0) * normalized;
        } else {
            arcHeight = (flight.peakHeight || 0) * 4 * timeProgress * (1 - timeProgress);
        }

        ball.renderPos = { x: safeX, y: safeY };
        ball.shadowPos = { x: safeX, y: safeY };
        if (ball.flight) ball.flight.height = arcHeight;

        const reached = distToTarget <= Math.max(6, travelStep * 0.6);

        if (reached) {
            const isPitch = flight?.kind === 'pitch';
            if (isPitch) {
                const runner = _resolveOffensivePlayer(off, ball.targetId);
                const catchPos = runner?.pos ? { x: runner.pos.x, y: runner.pos.y } : { ...targetPos };
                ball.inAir = false;
                ball.flight = null;
                ball.renderPos = catchPos;
                ball.shadowPos = catchPos;
                ball.to = { ...catchPos };

                if (runner?.id) {
                    ball.carrierId = runner.id;
                    ball.lastCarrierId = runner.id;
                    ball.targetId = null;
                    if (s.play) {
                        s.play.handoffTime = s.play.elapsed;
                        s.play.handoffPending = null;
                        s.play.handed = true;
                    }
                    recordPlayEvent(s, {
                        type: 'pitch:caught',
                        targetId: runner.id,
                    });
                } else {
                    ball.carrierId = null;
                    ball.targetId = null;
                    if (s.play) {
                        s.play.handoffPending = null;
                        if (!s.play.deadAt) {
                            s.play.deadAt = s.play.elapsed;
                            s.play.phase = 'DEAD';
                            s.play.resultWhy = 'Pitch misfire';
                        }
                    }
                    recordPlayEvent(s, {
                        type: 'pitch:misfire',
                        targetId: null,
                    });
                }
                return;
            }
            if (!ball.targetId) {
                s.play.deadAt = s.play.elapsed;
                s.play.phase = 'DEAD';
                s.play.resultWhy = 'Throw away';
                ball.inAir = false;
                ball.flight = null;
                recordPlayEvent(s, { type: 'pass:throwaway' });
                return;
            }

            const r = _resolveOffensivePlayer(off, ball.targetId);
            if (r) {
                const nearestDef = Object.values(def).reduce((best, d) => {
                    if (!d?.pos) return best;
                    const dd = Math.hypot(d.pos.x - r.pos.x, d.pos.y - r.pos.y);
                    return dd < best.d ? { d: dd, t: d } : best;
                }, { d: 1e9, t: null });

                let picked = false;

                // allow forced interception once per play
                if (s.debug?.forceNextOutcome === 'INT' && !s.play.__forcedIntDone) {
                    picked = true;
                    s.play.__forcedIntDone = true;
                } else if (nearestDef.t && nearestDef.d < 22) {
                    const defenderIQ = clamp(nearestDef.t.attrs?.awareness ?? 0.9, 0.4, 1.5);
                    const defenderHands = clamp(nearestDef.t.attrs?.catch ?? nearestDef.t.attrs?.tackle ?? 0.85, 0.4, 1.45);
                    const defenderAgility = clamp(nearestDef.t.attrs?.agility ?? 1, 0.5, 1.5);
                    const qbAcc = clamp(off.QB.attrs.throwAcc ?? 0.9, 0.35, 1.45);
                    const qbIQ = clamp(off.QB.attrs.awareness ?? 0.9, 0.4, 1.5);
                    const wrHands = clamp(r.attrs.catch ?? 0.9, 0.4, 1.45);
                    const wrAwareness = clamp(r.attrs.awareness ?? 0.9, 0.4, 1.4);
                    const hawkTrait = clamp((nearestDef.t.modifiers?.ballHawk ?? 0.5) - 0.5, -0.3, 0.3);
                    const wrHandsTrait = clamp((r.modifiers?.hands ?? 0.5) - 0.5, -0.3, 0.3);
                    const targetRole = Object.entries(off || {}).find(([, player]) => player?.id === r.id)?.[0] || null;
                    const coverageAssigned = targetRole
                        ? Object.entries(s.play?.coverage?.assigned || {}).some(([, role]) => role === targetRole)
                        : false;
                    let pickProb = 0.08;
                    pickProb += (defenderIQ - qbIQ) * 0.28;
                    pickProb += (defenderHands - 1) * 0.26;
                    pickProb += (defenderAgility - 1) * 0.18;
                    pickProb += (1 - qbAcc) * 0.42;
                    pickProb -= (wrHands - 1) * 0.22;
                    pickProb -= (wrAwareness - 1) * 0.18;
                    pickProb += hawkTrait * 0.09;
                    pickProb -= wrHandsTrait * 0.05;
                    const ballAccFactor = clamp(1 - (ball.flight?.accuracy ?? 1), -0.6, 0.8);
                    pickProb += ballAccFactor * 0.48;
                    const tightness = clamp((16 - (nearestDef.d ?? 16)) / 16, 0, 1);
                    pickProb += tightness * 0.42;
                    if (coverageAssigned) pickProb += 0.08;
                    if (s.play.passRisky) pickProb += 0.12;
                    pickProb = clamp(pickProb, 0.04, 0.75);
                    if (nearestDef.d > 18) pickProb *= 0.65;
                    picked = Math.random() < pickProb;
                }

                if (picked) {
                    const picker = nearestDef.t || null;
                    const pickPos = picker?.pos ? { x: picker.pos.x, y: picker.pos.y } : { ...r.pos };

                    s.play.deadAt = s.play.elapsed;
                    s.play.phase = 'DEAD';
                    s.play.resultWhy = 'Interception';
                    s.play.turnover = true;
                    ball.inAir = false;
                    ball.flight = null;
                    ball.carrierId = picker?.id || null;
                    ball.lastCarrierId = picker?.id || ball.lastCarrierId || null;
                    ball.renderPos = pickPos;
                    ball.shadowPos = pickPos;
                    recordPlayEvent(s, {
                        type: 'pass:interception',
                        by: picker?.id || null,
                        targetId: r.id,
                    });
                    return;
                }

                const handsTrait = clamp((r.modifiers?.hands ?? 0.5) - 0.5, -0.4, 0.4);
                const precisionTrait = clamp((r.modifiers?.routePrecision ?? 0.5) - 0.5, -0.3, 0.3);
                const technique = clamp(r.attrs.agility ?? 1, 0.5, 1.5);
                const awareness = clamp(r.attrs.awareness ?? 0.9, 0.4, 1.4);
                const rawHands = clamp(r.attrs.catch ?? 0.8, 0.4, 1.55);
                const handsComposite = clamp(
                    rawHands + handsTrait * 0.28 + precisionTrait * 0.16 + (technique - 1) * 0.1,
                    0.35,
                    1.7,
                );
                const hands = clamp(Math.pow(handsComposite, 1.12), 0.35, 1.75);
                const qbAccMods = off?.QB?.modifiers || {};
                const qbAccTrait = clamp((qbAccMods.releaseQuickness ?? 0.5) - 0.5, -0.3, 0.3);
                const qbIQ = clamp(off?.QB?.attrs?.awareness ?? 0.9, 0.4, 1.5);
                const qbProcessing = clamp(Math.pow(qbIQ, 1.05), 0.35, 1.55);
                const qbAccBase = clamp((off?.QB?.attrs?.throwAcc ?? 0.9) + qbAccTrait * 0.1, 0.35, 1.5);
                const qbAccBoost = clamp(Math.pow(qbAccBase, 1.1), 0.35, 1.65);
                const ballAcc = clamp(ball.flight?.accuracy ?? 1, 0.4, 1.45);
                const separation = nearestDef.d;
                const sepFactor = clamp(((separation ?? 28) - 6) / 18, 0.25, 1.18);
                const accuracyBlend = hands * 0.48 + qbAccBoost * 0.3 + ballAcc * 0.14 + qbProcessing * 0.18;
                const throwDistPx = ball.flight?.totalDist || dist(ball.from, ball.to);
                const throwDistYards = clamp((throwDistPx || 0) / PX_PER_YARD, 0, 80);
                const shortBonus = throwDistYards <= 7 ? (7 - throwDistYards) * 0.05 : 0;
                const deepPenalty = throwDistYards > 10 ? (throwDistYards - 10) * 0.048 : 0;
                const sepBonus = clamp((sepFactor - 0.7) * 0.42, -0.2, 0.34);
                const baseCatchChance = clamp(0.12 + accuracyBlend * 0.56 + sepBonus + shortBonus - deepPenalty, 0.03, 0.85);
                const separationYards = (separation ?? 0) / PX_PER_YARD;
                const openRatio = clamp((separationYards - 1.5) / 6, 0, 1);
                const awarenessRelief = clamp((awareness - 1) * 0.18, -0.18, 0.22);
                const openBonus = openRatio * 0.42 + awarenessRelief;
                const catchProbability = clamp(baseCatchChance + openBonus, 0.02, 0.96);

                const dropBase = clamp(0.2 - (qbAccBoost - 1) * 0.12 - (qbProcessing - 1) * 0.08, 0.03, 0.26);
                const dropHands = clamp(Math.pow(Math.max(1.3 - hands * qbAccBoost, 0), 1.1) * 0.32, 0, 0.62);
                const dropContact = clamp((14 - (separation ?? 18)) / 20, 0, 0.28);
                const dropRisk = s.play.passRisky ? 0.05 : 0;
                const depthDrop = clamp((throwDistYards - 12) * 0.018, 0, 0.18);
                const traitDrop = clamp(-handsTrait * 0.1, -0.1, 0.1);
                const accuracyDrop = clamp(1 - ballAcc, 0, 0.6) * 0.38;
                const openDropRelief = openRatio * 0.2 + clamp((technique - 1) * 0.16, -0.16, 0.16);
                const dropProbability = clamp(
                    dropBase + dropHands + dropContact + dropRisk + depthDrop + traitDrop + accuracyDrop - openDropRelief,
                    0.02,
                    0.75,
                );
                const completionChance = clamp(catchProbability * (1 - dropProbability), 0, 1);

                if (Math.random() < catchProbability) {
                    if (Math.random() < dropProbability) {
                        s.play.deadAt = s.play.elapsed;
                        s.play.phase = 'DEAD';
                        s.play.resultWhy = 'Drop';
                        ball.inAir = false;
                        ball.flight = null;
                        ball.renderPos = { ...ball.to };
                        ball.shadowPos = { ...ball.to };
                        recordPlayEvent(s, {
                            type: 'pass:drop',
                            targetId: r.id,
                            separation: nearestDef.d,
                        });
                    } else {
                        ball.inAir = false;
                        ball.carrierId = r.id;
                        ball.lastCarrierId = r.id;
                        ball.flight = null;
                        ball.renderPos = { ...r.pos };
                        ball.shadowPos = { ...r.pos };
                        recordPlayEvent(s, {
                            type: 'pass:complete',
                            targetId: r.id,
                            separation: nearestDef.d,
                        });
                    }
                } else {
                    s.play.deadAt = s.play.elapsed;
                    s.play.phase = 'DEAD';
                    s.play.resultWhy = 'Incomplete';
                    ball.inAir = false;
                    ball.flight = null;
                    ball.renderPos = { ...ball.to };
                    ball.shadowPos = { ...ball.to };
                    recordPlayEvent(s, {
                        type: 'pass:incomplete',
                        targetId: r.id,
                        separation: nearestDef.d,
                    });
                }
            } else {
                s.play.deadAt = s.play.elapsed;
                s.play.phase = 'DEAD';
                s.play.resultWhy = 'Incomplete';
                ball.inAir = false;
                ball.flight = null;
                ball.renderPos = { ...ball.to };
                ball.shadowPos = { ...ball.to };
                recordPlayEvent(s, { type: 'pass:incomplete', targetId: null });
            }
        }
    } else {
        const carrier = _resolveOffensivePlayer(off, s.play.ball.carrierId);
        if (carrier) {
            ball.renderPos = { ...carrier.pos };
            ball.shadowPos = { ...carrier.pos };
            if (carrier.id) ball.lastCarrierId = carrier.id;
        } else {
            const fallback = _resolveOffensivePlayer(off, ball.lastCarrierId) || off.QB;
            if (fallback?.pos) {
                ball.renderPos = { ...fallback.pos };
                ball.shadowPos = { ...fallback.pos };
                if (fallback.id) ball.lastCarrierId = fallback.id;
            } else {
                recordPlayEvent(s, {
                    type: 'ball:lost-carrier',
                    carrierId: ball.carrierId ?? null,
                    lastCarrierId: ball.lastCarrierId ?? null,
                });
            }
        }
        ball.flight = null;
    }
}

