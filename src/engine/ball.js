// ⬇️ UPDATE your imports at the top of this file
import { clamp, dist, yardsToPixY } from './helpers';
import { FIELD_PIX_W, FIELD_PIX_H } from './constants';
import { mphToPixelsPerSecond } from './motion';

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
    const mph = clamp(48 + (arm - 1) * 18, 42, 64);
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
    };
    ball.shadowPos = { ...from };
    ball.renderPos = { ...from };
    ball.targetId = targetId; // null means throw-away
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
        return;
    }

    if (ball.inAir) {
        const flight = ball.flight || { duration: 0.6, elapsed: 0, arc: 18, speed: 120, accuracy: 1 };
        flight.elapsed += dt;
        const tRaw = clamp(flight.elapsed / Math.max(flight.duration, 0.01), 0, 1);
        const t = tRaw * tRaw * (3 - 2 * tRaw);
        const nx = ball.from.x + (ball.to.x - ball.from.x) * t;
        const ny = ball.from.y + (ball.to.y - ball.from.y) * t;
        const safeX = clamp(nx, 6, FIELD_PIX_W - 6);
        const safeY = clamp(ny, 0, FIELD_PIX_H);
        const arcHeight = Math.sin(Math.PI * t) * (flight.arc || 0);
        const offsetY = arcHeight * 0.08;
        ball.renderPos = { x: safeX, y: safeY - offsetY };
        ball.shadowPos = { x: safeX, y: safeY };
        if (ball.flight) ball.flight.height = arcHeight;

        if (tRaw >= 1) {
            if (!ball.targetId) {
                s.play.deadAt = s.play.elapsed;
                s.play.phase = 'DEAD';
                s.play.resultWhy = 'Throw away';
                ball.inAir = false;
                ball.flight = null;
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
                    let pickProb = 0.08 + defenderIQ * 0.12 - qbAcc * 0.08 - wrHands * 0.04;
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
                    return;
                }

                const hands = clamp(r.attrs.catch ?? 0.8, 0.4, 1.3);
                const qbAccBoost = clamp(off?.QB?.attrs?.throwAcc ?? 0.9, 0.4, 1.3);
                const ballAcc = clamp(ball.flight?.accuracy ?? 1, 0.6, 1.4);
                const separation = nearestDef.d;
                const sepFactor = clamp(((separation ?? 28) - 6) / 18, 0.35, 1.08);
                const accuracyBlend = hands * 0.45 + qbAccBoost * 0.18 + ballAcc * 0.15;
                const catchChance = accuracyBlend * sepFactor + Math.random() * 0.16 - 0.08;
                if (catchChance > 0.5) {
                    ball.inAir = false;
                    ball.carrierId = r.id;
                    ball.flight = null;
                    ball.renderPos = { ...r.pos };
                    ball.shadowPos = { ...r.pos };
                } else {
                    s.play.deadAt = s.play.elapsed;
                    s.play.phase = 'DEAD';
                    s.play.resultWhy = 'Incomplete';
                    ball.inAir = false;
                    ball.flight = null;
                    ball.renderPos = { ...ball.to };
                    ball.shadowPos = { ...ball.to };
                }
            } else {
                s.play.deadAt = s.play.elapsed;
                s.play.phase = 'DEAD';
                s.play.resultWhy = 'Incomplete';
                ball.inAir = false;
                ball.flight = null;
                ball.renderPos = { ...ball.to };
                ball.shadowPos = { ...ball.to };
            }
        }
    } else {
        const carrier = s.play.ball.carrierId ? off[s.play.ball.carrierId] : null;
        if (carrier) {
            ball.renderPos = { ...carrier.pos };
            ball.shadowPos = { ...carrier.pos };
        } else {
            const fallback = _resolveOffensivePlayer(off, ball.lastCarrierId) || off.QB;
            if (fallback?.pos) {
                ball.renderPos = { ...fallback.pos };
                ball.shadowPos = { ...fallback.pos };
            }
        }
        ball.flight = null;
    }
}

