// ⬇️ UPDATE your imports at the top of this file
import { clamp, dist, yardsToPixY } from './helpers';
import { FIELD_PIX_W, FIELD_PIX_H, PX_PER_YARD } from './constants';
import { mphToPixelsPerSecond } from './motion';
import { recordPlayEvent } from './diagnostics';

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
export function startPass(s, from, to, targetId) {
    const ball = s.play.ball;
    const qb = s.play?.formation?.off?.QB;
    const arm = clamp(qb?.attrs?.throwPow ?? 1, 0.5, 1.4);
    const acc = clamp(qb?.attrs?.throwAcc ?? 1, 0.4, 1.4);
    const distance = Math.max(1, dist(from, to));
    const velocityTrait = clamp((qb?.modifiers?.throwVelocity ?? 0.5) - 0.5, -0.3, 0.3);
    const mph = clamp(48 + (arm - 1) * 18 + velocityTrait * 12, 40, 66);
    const speed = Math.max(60, mphToPixelsPerSecond(mph));
    const duration = clamp(distance / speed, 0.35, 1.85);

    ball.inAir = true;
    ball.lastCarrierId = ball.carrierId || ball.lastCarrierId || qb?.id || 'QB';
    ball.carrierId = null;
    ball.from = { ...from };
    ball.to = { ...to };
    ball.t = 0;
    ball.flight = {
        duration,
        elapsed: 0,
        arc: clamp(distance * 0.18, 10, 60),
        wobble: Math.random() * 0.15,
        speed,
        accuracy: acc,
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

export function moveBall(s, dt) {
    const off = s.play.formation.off;
    const def = s.play.formation.def;
    const ball = s.play.ball;

    // force fumble once per play if requested and someone has possession
    if (!ball.inAir && ball.carrierId && s.debug?.forceNextOutcome === 'FUMBLE' && !s.play.__forcedFumbleDone) {
        s.play.__forcedFumbleDone = true;
        s.play.deadAt = s.play.elapsed;
        s.play.phase = 'DEAD';
        s.play.resultWhy = 'Fumble';
        s.play.turnover = true;
        recordPlayEvent(s, { type: 'ball:fumble', by: ball.carrierId });
        return;
    }

    if (ball.inAir) {
        const flight = ball.flight || { duration: 0.6, elapsed: 0, arc: 18, speed: 120, accuracy: 1, totalDist: 1, travelled: 0 };
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
        const progress = flight.totalDist > 0 ? clamp(flight.travelled / flight.totalDist, 0, 1) : 1;
        const eased = progress * progress * (3 - 2 * progress);
        const arcHeight = Math.sin(Math.PI * eased) * (flight.arc || 0);

        ball.renderPos = { x: safeX, y: safeY };
        ball.shadowPos = { x: safeX, y: safeY };
        if (ball.flight) ball.flight.height = arcHeight;

        const reached = distToTarget <= Math.max(6, travelStep * 0.6);

        if (reached) {
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
                    const dd = Math.hypot(d.pos.x - r.pos.x, d.pos.y - r.pos.y);
                    return dd < best.d ? { d: dd, t: d } : best;
                }, { d: 1e9, t: null });

                let picked = false;

                // allow forced interception once per play
                if (s.debug?.forceNextOutcome === 'INT' && !s.play.__forcedIntDone) {
                    picked = true;
                    s.play.__forcedIntDone = true;
                } else if (nearestDef.t && nearestDef.d < 14) {
                    const defenderIQ = (nearestDef.t.attrs.awareness ?? 0.9);
                    const qbAcc = (off.QB.attrs.throwAcc ?? 0.9);
                    const wrHands = (r.attrs.catch ?? 0.9);
                    const hawkTrait = clamp((nearestDef.t.modifiers?.ballHawk ?? 0.5) - 0.5, -0.3, 0.3);
                    const wrHandsTrait = clamp((r.modifiers?.hands ?? 0.5) - 0.5, -0.3, 0.3);
                    let pickProb = 0.08 + defenderIQ * 0.12 - qbAcc * 0.08 - wrHands * 0.04;
                    pickProb += hawkTrait * 0.05;
                    pickProb -= wrHandsTrait * 0.03;
                    if (s.play.passRisky) pickProb += 0.08;
                    pickProb += (1 - (ball.flight?.accuracy ?? 1)) * 0.05;
                    pickProb = clamp(pickProb, 0.02, 0.25);
                    picked = Math.random() < pickProb;
                }

                if (picked) {
                    s.play.deadAt = s.play.elapsed;
                    s.play.phase = 'DEAD';
                    s.play.resultWhy = 'Interception';
                    s.play.turnover = true;
                    ball.inAir = false;
                    ball.flight = null;
                    ball.renderPos = { ...r.pos };
                    ball.shadowPos = { ...r.pos };
                    recordPlayEvent(s, {
                        type: 'pass:interception',
                        by: nearestDef.t?.id || null,
                        targetId: r.id,
                    });
                    return;
                }

                const handsTrait = clamp((r.modifiers?.hands ?? 0.5) - 0.5, -0.4, 0.4);
                const precisionTrait = clamp((r.modifiers?.routePrecision ?? 0.5) - 0.5, -0.3, 0.3);
                const hands = clamp((r.attrs.catch ?? 0.8) + handsTrait * 0.2 + precisionTrait * 0.1, 0.4, 1.4);
                const qbAccMods = off?.QB?.modifiers || {};
                const qbAccTrait = clamp((qbAccMods.releaseQuickness ?? 0.5) - 0.5, -0.3, 0.3);
                const qbAccBoost = clamp((off?.QB?.attrs?.throwAcc ?? 0.9) + qbAccTrait * 0.08, 0.4, 1.35);
                const ballAcc = clamp(ball.flight?.accuracy ?? 1, 0.6, 1.4);
                const separation = nearestDef.d;
                const sepFactor = clamp(((separation ?? 28) - 6) / 18, 0.35, 1.08);
                const accuracyBlend = hands * 0.45 + qbAccBoost * 0.18 + ballAcc * 0.15;
                const throwDistPx = ball.flight?.totalDist || dist(ball.from, ball.to);
                const throwDistYards = clamp((throwDistPx || 0) / PX_PER_YARD, 0, 80);
                const shortBonus = throwDistYards <= 7 ? (7 - throwDistYards) * 0.04 : 0;
                const deepPenalty = throwDistYards > 10 ? (throwDistYards - 10) * 0.035 : 0;
                const sepBonus = clamp((sepFactor - 0.7) * 0.2, -0.08, 0.12);
                const baseCatchChance = clamp(0.28 + accuracyBlend * 0.32 + sepBonus + shortBonus - deepPenalty, 0.1, 0.6);
                const separationYards = (separation ?? 0) / PX_PER_YARD;
                const openRatio = clamp((separationYards - 1.5) / 6, 0, 1);
                const openBonus = openRatio * 0.3;
                const catchProbability = clamp(baseCatchChance + openBonus, 0.05, 0.85);

                const dropBase = 0.08;
                const dropHands = clamp(1.15 - hands, 0, 0.75) * 0.16;
                const dropContact = clamp((14 - (separation ?? 18)) / 26, 0, 0.22);
                const dropRisk = s.play.passRisky ? 0.05 : 0;
                const depthDrop = clamp((throwDistYards - 12) * 0.015, 0, 0.14);
                const traitDrop = clamp(-handsTrait * 0.08, -0.08, 0.08);
                const openDropRelief = openRatio * 0.14;
                const dropProbability = clamp(dropBase + dropHands + dropContact + dropRisk + depthDrop + traitDrop - openDropRelief, 0.02, 0.42);
                const completionChance = clamp(catchProbability * (1 - dropProbability), 0, 1);

                if (typeof console !== 'undefined' && console?.log) {
                    const targetName = r.profile?.fullName || r.role || r.id;
                    console.log('[Pass Target]', {
                        target: {
                            id: r.id,
                            name: targetName,
                            role: r.role ?? null,
                        },
                        catchModifiers: {
                            baseCatch: r.attrs?.catch ?? null,
                            hands,
                            handsTrait,
                            precisionTrait,
                            qbAccBoost,
                            ballAcc,
                            separationPixels: separation ?? null,
                            separationYards,
                            openRatio,
                            openBonus,
                            baseCatchChance,
                            catchProbability,
                            dropProbability,
                            completionChance,
                            completionPercent: Math.round(completionChance * 1000) / 10,
                        },
                    });
                }

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

