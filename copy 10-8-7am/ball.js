// src/engine/ball.js
import { clamp, dist } from './helpers';

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

    if (ball.inAir) {
        const speed = 420; // px/sec
        ball.t += dt * speed / Math.max(1, dist(ball.from, ball.to));
        const t = clamp(ball.t, 0, 1);
        const nx = ball.from.x + (ball.to.x - ball.from.x) * t;
        const ny = ball.from.y + (ball.to.y - ball.from.y) * t;
        ball.renderPos = { x: nx, y: ny };

        if (t >= 1) {
            // Throw-away lands out of bounds / empty space
            if (!ball.targetId) {
                s.play.deadAt = s.play.elapsed;
                s.play.phase = 'DEAD';
                s.play.resultWhy = 'Throw away';
                return;
            }

            // Contest at catch point: interception chance
            const r = off[ball.targetId];
            if (r) {
                const nearestDef = Object.values(def).reduce((best, d) => {
                    const dd = dist(d.pos, r.pos);
                    return dd < best.d ? { d: dd, t: d } : best;
                }, { d: 1e9, t: null });

                let picked = false;
                if (nearestDef.t && nearestDef.d < 14) {
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

                // Otherwise, try to catch
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

export function getBallPix(s) {
    if (s.play.ball.renderPos) return s.play.ball.renderPos;
    const off = s.play.formation.off;
    const carrier = s.play.ball.carrierId ? off[s.play.ball.carrierId] : off.QB;
    return { ...carrier.pos };
}
