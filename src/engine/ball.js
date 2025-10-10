// ⬇️ UPDATE your imports at the top of this file
import { clamp, dist, yardsToPixY } from './helpers';
import { FIELD_PIX_W } from './constants';

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
    s.play.ball.inAir = true;
    s.play.ball.carrierId = null;
    s.play.ball.from = { ...from };
    s.play.ball.to = { ...to };
    s.play.ball.t = 0;
    s.play.ball.targetId = targetId; // null means throw-away
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
        const speed = 420;
        ball.t += dt * speed / Math.max(1, dist(ball.from, ball.to));
        const t = clamp(ball.t, 0, 1);
        const nx = ball.from.x + (ball.to.x - ball.from.x) * t;
        const ny = ball.from.y + (ball.to.y - ball.from.y) * t;
        ball.renderPos = { x: nx, y: ny };

        if (t >= 1) {
            if (!ball.targetId) {
                s.play.deadAt = s.play.elapsed;
                s.play.phase = 'DEAD';
                s.play.resultWhy = 'Throw away';
                return;
            }

            const r = off[ball.targetId];
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
                    pickProb = clamp(pickProb, 0.02, 0.25);
                    picked = Math.random() < pickProb;
                }

                if (picked) {
                    s.play.deadAt = s.play.elapsed;
                    s.play.phase = 'DEAD';
                    s.play.resultWhy = 'Interception';
                    s.play.turnover = true;
                    return;
                }

                const catchChance = r.attrs.catch * 0.6 + Math.random() * 0.5 - 0.15;
                if (catchChance > 0.5) {
                    s.play.ball.inAir = false;
                    s.play.ball.carrierId = r.id;
                } else {
                    s.play.deadAt = s.play.elapsed;
                    s.play.phase = 'DEAD';
                    s.play.resultWhy = 'Incomplete';
                }
            } else {
                s.play.deadAt = s.play.elapsed;
                s.play.phase = 'DEAD';
                s.play.resultWhy = 'Incomplete';
            }
        }
    } else {
        const carrier = s.play.ball.carrierId ? off[s.play.ball.carrierId] : null;
        if (carrier) s.play.ball.renderPos = { ...carrier.pos };
    }
}

