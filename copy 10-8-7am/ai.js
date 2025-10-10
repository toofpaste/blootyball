// src/engine/ai.js
import { clamp, dist, unitVec, rand, midPoint, yardsToPixY } from './helpers';
import { FIELD_PIX_W } from './constants';
import { startPass } from './ball';

/* =========================================================
   Route / Play Initialization
   - Also derives a RUN HOLE target (x) for run plays
   ========================================================= */
export function initRoutesAfterSnap(s) {
    const off = s.play.formation.off;
    const call = s.play.playCall;

    s.play.routeTargets = {};

    // WR routes
    ['WR1', 'WR2', 'WR3'].forEach(wr => {
        const path = (call.wrRoutes && call.wrRoutes[wr]) || [{ dx: 0, dy: 4 }];
        const start = off[wr].pos;
        const targets = path.map(step => ({
            x: clamp(start.x + step.dx * 8, 20, FIELD_PIX_W - 20),
            y: start.y + step.dy * 8
        }));
        s.play.routeTargets[wr] = targets;
        off[wr].targets = targets;
        off[wr].routeIdx = 0;
    });

    // TE route
    const teTargets = (call.teRoute || [{ dx: 0, dy: 4 }]).map(step => ({
        x: clamp(off.TE.pos.x + step.dx * 8, 20, FIELD_PIX_W - 20),
        y: off.TE.pos.y + step.dy * 8
    }));
    s.play.teTargets = teTargets;
    off.TE.targets = teTargets;
    off.TE.routeIdx = 0;

    // RB path / checkdown
    const rbTargets = (call.rbPath || call.rbCheckdown || [{ dx: 0, dy: 2 }]).map(step => ({
        x: clamp(off.RB.pos.x + step.dx * 8, 20, FIELD_PIX_W - 20),
        y: off.RB.pos.y + step.dy * 8
    }));
    s.play.rbTargets = rbTargets;
    if (call.type === 'PASS') { // leak on pass plays
        off.RB.targets = rbTargets;
        off.RB.routeIdx = 0;
    }

    // Derive a RUN HOLE for run plays based on the first RB waypoint
    if (call.type === 'RUN') {
        const first = rbTargets[0] || { x: off.RB.pos.x, y: off.RB.pos.y + 12 };
        // store intended hole X and a forward "lane" Y to aim through
        s.play.runHoleX = clamp(first.x, 24, FIELD_PIX_W - 24);
        s.play.runLaneY = (off.C.pos.y) + yardsToPixY(2.5); // about 2–3 yards past LOS
    } else {
        s.play.runHoleX = null;
        s.play.runLaneY = null;
    }

    // Throw timing derived from play + QB IQ
    const qbIQ = clamp(off.QB.attrs.awareness ?? 0.9, 0.4, 1.3);
    const quick = !!call.quickGame;
    const baseTTT = quick ? rand(1.0, 1.7) : rand(1.6, 3.0);
    const iqAdj = clamp((1.0 - qbIQ) * 0.4 - (qbIQ - 1.0) * 0.2, -0.3, 0.3);
    s.play.qbTTT = clamp(baseTTT + iqAdj, 0.9, 3.2);
    s.play.qbMaxHold = s.play.qbTTT + rand(1.2, 1.9);

    s.play.qbDropTarget = { x: off.QB.pos.x, y: off.QB.pos.y - (call.qbDrop || 3) * 8 };
    s.play.routesInitialized = true;
}

/* =========================================================
   Movement Helpers
   ========================================================= */
export function moveToward(p, target, dt, speedMul = 1) {
    const dx = target.x - p.pos.x;
    const dy = target.y - p.pos.y;
    const d = Math.hypot(dx, dy) || 1;
    const maxV = p.attrs.speed * 30 * speedMul;
    const step = Math.min(d, maxV * dt);
    p.pos.x += (dx / d) * step;
    p.pos.y += (dy / d) * step;
}

/* =========================================================
   Offensive Line
   - PASS: protect lanes (stay between DL and QB)
   - RUN: create/develop the hole (steer DL away from hole, climb a bit)
   ========================================================= */
export function moveOL(off, def, dt) {
    // Per-OL anchor line at (home.y - ANCHOR_BACK) so they can't backpedal endlessly.
    const dls = ['LE', 'DT', 'RTk', 'RE'].map(k => def[k]).filter(Boolean);

    const isRun = !!off.__runFlag;
    const runHoleX = off.__runHoleX ?? null;

    // --- Tunables ---
    const ENGAGE_DIST = 20;  // start hand-fighting
    const COLLIDE_DIST = 14;  // min separation
    const THREAT_DIST = 60;  // start mirroring rusher
    const ANCHOR_BACK = 8;   // max px OL can move UPFIELD from their home (prevents backpedal)
    const STEP_PASS = 0.95;
    const STEP_RUN = 1.05;

    ['LT', 'LG', 'C', 'RG', 'RT'].forEach(k => {
        const ol = off[k]; if (!ol) return;

        // Per-OL anchor line (smaller y is more upfield; we clamp y >= minY)
        const minY = (ol.home?.y ?? ol.pos.y) - ANCHOR_BACK;
        if (ol.pos.y < minY) ol.pos.y = minY;

        // Nearest DL to this OL
        const nearest = dls.reduce((best, d) => {
            const dd = dist(ol.pos, d.pos);
            return dd < best.d ? { d: dd, t: d } : best;
        }, { d: 1e9, t: null });

        if (!isRun) {
            // ===== PASS PRO =====
            if (nearest.t) {
                // Intercept geometry: stand between DL and QB at our current Y
                const qb = off.QB;
                const dl = nearest.t;
                const vx = qb.pos.x - dl.pos.x;
                const vy = qb.pos.y - dl.pos.y || 1e-3;
                const t = (ol.pos.y - dl.pos.y) / vy; // where DL→QB line reaches our Y
                let interceptX = dl.pos.x + vx * t;
                interceptX = clamp(interceptX, 20, FIELD_PIX_W - 20);

                const setSpot = { x: interceptX, y: Math.max(minY, ol.pos.y) }; // never below minY (no backpedal)
                const speed = nearest.d < THREAT_DIST ? STEP_PASS : 0.7;
                moveToward(ol, setSpot, dt, speed);
            }

            // Engage if close
            if (nearest.t && nearest.d < ENGAGE_DIST) {
                ensureEngagement(ol, nearest.t);
            }
        } else {
            // ===== RUN BLOCK =====
            const holeX = runHoleX ?? (ol.home ? ol.home.x : off.QB.pos.x);
            const side = Math.sign((ol.pos.x - holeX) || 1); // widen away from hole
            const climb = { x: clamp(ol.pos.x + side * 8, 20, FIELD_PIX_W - 20), y: ol.pos.y + 8 };
            moveToward(ol, climb, dt, STEP_RUN);

            if (nearest.t && nearest.d < ENGAGE_DIST) {
                ensureEngagement(ol, nearest.t);
            }
        }

        // Enforce anchor again after movement/forces
        if (ol.pos.y < minY) ol.pos.y = minY;
    });

    // Resolve contacts so engaged pairs push and never overlap
    resolveOLDLContacts(off, def, dt, {
        isRun,
        runHoleX,
        COLLIDE_DIST,
    });
}



/* =========================================================
   Receivers (includes scramble drill)
   ========================================================= */
export function moveReceivers(off, dt) {
    const qb = off.QB;

    ['WR1', 'WR2', 'WR3'].forEach(key => {
        const p = off[key];
        if (!p || !p.alive) return;

        // NEW: if this WR is the ballcarrier and is wrapped, move almost not at all
        if (off.__carrierWrapped === key) {
            return; // absolutely no movement while wrapped
        }

        // If it's a run, stalk/insert a bit and stop
        if (off.__runFlag) {
            const aim = { x: p.pos.x, y: p.pos.y + 8 };
            moveToward(p, aim, dt, 0.9);
            return;
        }

        // Still on a called route? Keep running it.
        if (p.targets && p.routeIdx != null) {
            const t = p.targets[p.routeIdx];
            if (t) {
                moveToward(p, t, dt, 0.85);
                if (dist(p.pos, t) < 6) p.routeIdx = Math.min(p.routeIdx + 1, p.targets.length);
                return;
            }
        }

        // -------- SCRAMBLE DRILL: prefer deeper & cross-field ----------
        // Retarget every ~0.4–0.8s so they keep working
        const nowRetarget = !p._scrUntil || (p._scrUntil <= (p._scrClock = (p._scrClock || 0) + dt));

        if (nowRetarget || !p._scrTarget) {
            const losY = off.__losPixY ?? (qb.pos.y - 6);
            const wantMinY = Math.max(losY + 16, qb.pos.y + 30); // ALWAYS try to be deeper than LOS & QB
            const deepY = Math.max(wantMinY, p.pos.y + 12);      // never pick a backward target

            // Cross-field lane preference:
            // - WR1 tends to left deep lane
            // - WR2 tends to right deep lane
            // - WR3 picks a crossing lane relative to QB
            const leftLaneX = 40;
            const rightLaneX = FIELD_PIX_W - 40;
            let laneX;
            if (key === 'WR1') laneX = leftLaneX + rand(-18, 18);
            else if (key === 'WR2') laneX = rightLaneX + rand(-18, 18);
            else laneX = clamp(qb.pos.x + rand(-120, 120), 20, FIELD_PIX_W - 20); // crossing

            // 10% chance: true comeback toward QB if we've been scrambling a while
            const allowComeback = (p._scrClockTotal = (p._scrClockTotal || 0) + dt) > 2.2 && Math.random() < 0.10;

            // If comeback, only allow a *slight* backward movement (work back to ball)
            if (allowComeback) {
                const backY = Math.max(losY + 8, qb.pos.y + 8, p.pos.y - 10); // limit how far back
                p._scrTarget = { x: clamp(qb.pos.x + rand(-60, 60), 20, FIELD_PIX_W - 20), y: backY };
            } else {
                p._scrTarget = { x: clamp(laneX, 20, FIELD_PIX_W - 20), y: deepY };
            }

            p._scrUntil = (p._scrClock || 0) + rand(0.4, 0.8);
        }

        // Move toward target; enforce anti-backwards rule:
        const target = { ...p._scrTarget };
        const maxBackward = 6; // px we allow to drift back at most
        if (target.y < p.pos.y - maxBackward) {
            target.y = p.pos.y - maxBackward; // only tiny comeback allowed
        }

        moveToward(p, target, dt, 0.95);
    });
}


/* =========================================================
   TightEnds
   ============================================== */

export function moveTE(off, dt) {
    const p = off.TE;
    if (!p || !p.alive) return;

    // Run fits: seal/step forward a bit
    if (off.__runFlag) {
        const aim = { x: p.pos.x + (Math.random() < 0.5 ? -4 : 4), y: p.pos.y + 8 };
        moveToward(p, aim, dt, 0.95);
        return;
    }

    // Route if available
    if (p.targets && p.routeIdx != null) {
        const t = p.targets[p.routeIdx];
        if (t) {
            moveToward(p, t, dt, 0.9);
            if (dist(p.pos, t) < 6) p.routeIdx = Math.min(p.routeIdx + 1, p.targets.length);
            return;
        }
    }

    // Scramble settle: deeper than QB & LOS, in a soft mid-lane
    const qb = off.QB;
    const losY = off.__losPixY ?? (qb.pos.y - 6);
    const deepY = Math.max(losY + 14, qb.pos.y + 18, p.pos.y + 8);
    const midLane = clamp(qb.pos.x + rand(-40, 40), 20, FIELD_PIX_W - 20);

    // Tiny chance to work back if nothing else (rare)
    const allowComeback = Math.random() < 0.08;
    const target = allowComeback
        ? { x: clamp(qb.pos.x + rand(-30, 30), 20, FIELD_PIX_W - 20), y: Math.max(losY + 8, qb.pos.y + 8, p.pos.y - 8) }
        : { x: midLane, y: deepY };

    moveToward(p, target, dt, 0.95);
}

/* =========================================================
   Quarterback (drop, scramble, throw decisions)
   ========================================================= */
export function qbLogic(s, dt) {
    const off = s.play.formation.off;
    const def = s.play.formation.def;
    const call = s.play.playCall;
    const qb = off.QB;

    if (s.play.ball.carrierId !== 'QB') return;

    // ---------- Pressure awareness ----------
    const rushers = ['LE', 'DT', 'RTk', 'RE'].map(k => def[k]).filter(Boolean);
    const nearestDL = rushers.reduce((best, d) => {
        const d0 = dist(d.pos, qb.pos);
        return d0 < best.d ? { d: d0, t: d } : best;
    }, { d: 1e9, t: null });
    const pressureDist = nearestDL.d;
    const underImmediatePressure = pressureDist < 26;
    const underHeat = pressureDist < 38;

    // ---------- Movement constraints ----------
    // Cap how far back we can retreat beyond the designed drop
    const maxBackExtra = 6; // yards
    const minY = s.play.qbDropTarget ? Math.min(s.play.qbDropTarget.y - maxBackExtra * 8, s.play.qbDropTarget.y) : qb.pos.y;

    if (!s.play.qbMoveMode) s.play.qbMoveMode = 'DROP';              // DROP | SCRAMBLE
    if (s.play.qbMoveMode === 'DROP' && !qb.targets) { qb.targets = [s.play.qbDropTarget]; qb.routeIdx = 0; }

    const time = s.play.elapsed;
    const iq = clamp(qb.attrs.awareness ?? 1.0, 0.4, 1.3);
    const lateralBias = (() => {
        // Positive => scramble to the right sideline, negative => left
        if (!nearestDL.t) return (Math.random() < 0.5 ? -1 : 1);
        // Bias opposite the side the rusher is on (move away from pressure)
        return Math.sign(qb.pos.x - nearestDL.t.pos.x) || (Math.random() < 0.5 ? -1 : 1);
    })();

    // ---------- Enter scramble? ----------
    // Trigger if heat is close or we've waited past TTT a bit
    if (s.play.qbMoveMode === 'DROP' && (underImmediatePressure || time > (s.play.qbTTT || 1.6) + 0.7)) {
        s.play.qbMoveMode = 'SCRAMBLE';
        s.play.scrambleMode = (Math.random() < 0.7 ? 'LATERAL' : 'FORWARD'); // prefer lateral
        s.play.scrambleDir = lateralBias;                                   // -1 left, +1 right
        s.play.scrambleUntil = time + rand(0.45, 0.9);
        // initial target (don’t go further back than minY)
        s.play.scrambleTarget = {
            x: clamp(qb.pos.x + s.play.scrambleDir * rand(34, 60), 20, FIELD_PIX_W - 20),
            y: Math.max(minY, qb.pos.y + (s.play.scrambleMode === 'FORWARD' ? rand(10, 24) : rand(4, 14)))
        };
    }

    // ---------- Move (drop vs scramble) ----------
    if (s.play.qbMoveMode === 'DROP') {
        const t = s.play.qbDropTarget;
        if (t) {
            const target = { x: t.x, y: Math.max(t.y, minY) };
            moveToward(qb, target, dt, 0.75);
        }
    } else {
        // Re-evaluate scramble lane periodically or if the rusher crosses face
        const needRetarget = !s.play.scrambleTarget
            || time > (s.play.scrambleUntil || 0)
            || (nearestDL.t && Math.sign(qb.pos.x - nearestDL.t.pos.x) !== Math.sign(s.play.scrambleDir));

        if (needRetarget) {
            // 80% chance to choose LATERAL again when still under heat
            if (underHeat && Math.random() < 0.8) s.play.scrambleMode = 'LATERAL';
            // Flip direction away from pressure if needed
            s.play.scrambleDir = lateralBias;

            s.play.scrambleTarget = {
                x: clamp(qb.pos.x + s.play.scrambleDir * rand(34, 68), 20, FIELD_PIX_W - 20),
                y: Math.max(minY, qb.pos.y + (s.play.scrambleMode === 'FORWARD' ? rand(10, 24) : rand(4, 16)))
            };
            s.play.scrambleUntil = time + rand(0.35, 0.75);
        }
        const speedMul = s.play.scrambleMode === 'FORWARD' ? 0.78 : 0.82;
        moveToward(qb, s.play.scrambleTarget, dt, speedMul);
    }

    // ---------- Handoff for run plays ----------
    if (call.type === 'RUN') {
        if (!s.play.handed && dist(qb.pos, s.play.qbDropTarget) < 6) {
            const rb = off.RB;
            s.play.ball.carrierId = 'RB';
            s.play.handed = true;
            rb.targets = s.play.rbTargets;
            rb.routeIdx = 0;
        }
        return;
    }

    // ---------- Passing decisions ----------
    if (s.play.ball.inAir) return;

    const atDropOrScramble = s.play.qbMoveMode === 'SCRAMBLE' || dist(qb.pos, s.play.qbDropTarget) < 8;
    const timeReady = Math.max(0, time - (s.play.qbTTT || 1.6));
    const urgency = clamp(timeReady / 2.0, 0, 1);

    // Dynamic threshold for pulling the trigger (easier under pressure/urgency)
    let baseThresh = 0.18;
    if (underHeat) baseThresh -= 0.04;
    if (underImmediatePressure) baseThresh -= 0.06;
    baseThresh -= 0.08 * urgency;
    baseThresh = clamp(baseThresh, 0.10, 0.20);
    const shouldThrow = (score, isPrimary) => score > (baseThresh - (isPrimary ? 0.02 : 0));

    const eligible = atDropOrScramble && (timeReady > 0.0 || underImmediatePressure || s.play.qbMoveMode === 'SCRAMBLE');

    if (eligible) {
        const order = getReadOrder(call);
        for (const id of order) {
            const r = off[id]; if (!r) continue;
            const score = receiverOpenScore(r, s, call);
            if (shouldThrow(score, id === call.primary)) {
                const targetPos = leadTarget(qb.pos, r.pos);
                const jitter = rand(-0.08, 0.1) * (1.2 - iq); // lower IQ => slightly riskier
                s.play.passRisky = jitter > 0.05;
                startPass(s, qb.pos, targetPos, r.id);
                return;
            }
        }

        // Checkdown increases with urgency & heat (reduced by IQ)
        const rb = off.RB;
        const checkdownBias = clamp(0.10 + 0.45 * urgency + (underHeat ? 0.15 : 0) - (iq - 1.0) * 0.25, 0.08, 0.65);
        if (rb && Math.random() < checkdownBias) {
            s.play.passRisky = false;
            startPass(s, qb.pos, leadTarget(qb.pos, rb.pos), rb.id);
            return;
        }
    }

    // Throw-away or force after max hold
    if (time > (s.play.qbMaxHold || 3.0)) {
        const throwAwayProb = clamp(0.55 - (iq - 1.0) * 0.25 + (underHeat ? 0.1 : 0), 0.25, 0.8);
        if (Math.random() < throwAwayProb) {
            const toRight = s.play.scrambleDir > 0;
            const sidelineX = toRight ? (FIELD_PIX_W - 8) : 8;
            const away = { x: sidelineX, y: qb.pos.y + 18 };
            s.play.throwAway = true;
            s.play.passRisky = false;
            startPass(s, qb.pos, away, null);
        } else {
            const order = getReadOrder(call);
            const ranked = order
                .map(id => ({ id, r: off[id], score: off[id] ? receiverOpenScore(off[id], s, call) : -1 }))
                .filter(x => x.r)
                .sort((a, b) => b.score - a.score);
            if (ranked.length) {
                const target = ranked[0].r;
                s.play.passRisky = true;
                startPass(s, qb.pos, leadTarget(qb.pos, target.pos), target.id);
            } else if (off.RB) {
                s.play.passRisky = true;
                startPass(s, qb.pos, leadTarget(qb.pos, off.RB.pos), 'RB');
            }
        }
    }
}


/* =========================================================
   Running Back (with IQ for hole finding / cutbacks)
   ========================================================= */
export function rbLogic(s, dt) {
    const off = s.play.formation.off;
    const rb = off.RB;
    if (!rb) return;
    // If RB is wrapped, slow to a crawl and do nothing else
    if (off.__carrierWrapped === 'RB') {
        return; // absolutely no movement while wrapped
    }


    // flag for OL run logic
    off.__runFlag = s.play.playCall.type === 'RUN' && (s.play.ball.carrierId === 'RB' || !s.play.handed);
    off.__runHoleX = s.play.runHoleX;

    // If not the carrier, still leak on pass if route is there
    if (s.play.ball.carrierId !== 'RB') {
        if (rb.targets && rb.routeIdx != null) {
            const t = rb.targets[rb.routeIdx];
            if (t) { moveToward(rb, t, dt, 0.95); if (dist(rb.pos, t) < 7) rb.routeIdx = Math.min(rb.routeIdx + 1, rb.targets.length); }
        }
        return;
    }

    // Carrier logic (RB has the ball)
    const IQ = clamp(rb.attrs.awareness ?? 0.9, 0.4, 1.3);
    const holeX = s.play.runHoleX ?? rb.pos.x;
    const laneY = s.play.runLaneY ?? (rb.pos.y + 24);

    // Look-ahead point through the hole, downfield
    let aim = { x: holeX, y: Math.max(laneY, rb.pos.y + 14) };

    // If the immediate lane is clogged by defenders, smart RB will bend/cut
    const defAll = Object.values(s.play.formation.def);
    const clogRadius = 18;
    const clogged = defAll.some(d => dist(d.pos, { x: holeX, y: laneY }) < clogRadius);

    if (clogged) {
        const cutDir = Math.random() < 0.5 ? -1 : 1;
        const bend = {
            x: clamp(holeX + cutDir * (IQ > 1.0 ? 24 : 16), 20, FIELD_PIX_W - 20),
            y: laneY + (IQ > 1.0 ? 10 : 6)
        };
        aim = bend;
    } else {
        // even if not clogged, lower IQ may drift, high IQ aims truer
        aim.x = clamp(aim.x + rand(-10, 10) * (1.1 - Math.min(IQ, 1.1)), 20, FIELD_PIX_W - 20);
    }

    moveToward(rb, aim, dt, 1.05);
}

/* =========================================================
   Defense
   - DL hunts QB on pass or RB on run
   - LBs flow to ball/run fit
   - Coverage maintains cushion
   - Tackle/fumble after catch/handoff (not when ball is in air)
   ========================================================= */
// --- Wrap / Tackle system ---
// --- Wrap / Tackle helpers (hard-freeze the carrier while wrapped) ---
function startWrap(s, carrierId, defenderId) {
    const carrier = s.play.formation.off[carrierId];
    s.play.wrap = {
        carrierId,
        byId: defenderId,
        startAt: s.play.elapsed,
        holdDur: 0.35 + Math.random() * 0.2, // 0.35–0.55s
        lockPos: { x: carrier.pos.x, y: carrier.pos.y } // <-- freeze here
    };
}
function isWrapped(s, id) {
    return !!(s.play.wrap && s.play.wrap.carrierId === id);
}
function endWrap(s) {
    s.play.wrap = null;
}
function freezeCarrierIfWrapped(s) {
    if (!s.play.wrap) return;
    const { carrierId, lockPos } = s.play.wrap;
    const off = s.play.formation.off;
    const c = off[carrierId];
    if (!c || !lockPos) return;
    // Hard-set position; no forward creep
    c.pos.x = lockPos.x;
    c.pos.y = lockPos.y;
}

export function defenseLogic(s, dt) {
    const off = s.play.formation.off;
    const def = s.play.formation.def;
    const ball = s.play.ball;

    const isRunContext =
        s.play.playCall.type === 'RUN' ||
        (ball.carrierId === 'RB' && !ball.inAir);

    // DL rush / run fit (engagement handled elsewhere)
    ['LE', 'DT', 'RTk', 'RE'].forEach(k => {
        const dl = def[k]; if (!dl) return;
        const targetPos = isRunContext ? (off.RB?.pos || off.QB.pos) : off.QB.pos;
        if (dl.engagedWith) {
            dl.pos.x += rand(-2, 2) * dt;
            dl.pos.y += rand(-1, 1) * dt;
        } else {
            moveToward(dl, targetPos, dt, 1.0);
        }
    });

    // LBs flow
    ['LB1', 'LB2'].forEach(k => {
        const lb = def[k]; if (!lb) return;
        const target = ball.inAir
            ? midPoint(off.QB.pos, ball.to)
            : (ball.carrierId ? off[ball.carrierId].pos : off.QB.pos);
        moveToward(lb, { x: target.x, y: Math.max(lb.pos.y, target.y - 12) }, dt, 0.92);
    });

    // Coverage
    const coverMap = { CB1: 'WR1', CB2: 'WR2', NB: 'WR3', S1: 'TE', S2: 'WR1' };
    Object.entries(coverMap).forEach(([dk, ok]) => {
        const d = def[dk], o = off[ok]; if (!d || !o) return;
        const cushion = { x: o.pos.x + (ok === 'WR1' ? 6 : -6), y: o.pos.y - 10 };
        moveToward(d, cushion, dt, 0.95);
    });

    // No contact while ball in air
    if (ball.inAir) return;

    const carrierId = ball.carrierId || 'QB';
    const carrier = off[carrierId];
    if (!carrier) return;

    // Tell offense if wrapped (so movers early-return)
    off.__carrierWrapped = isWrapped(s, carrierId) ? carrierId : null;

    // If wrapped, hard-freeze carrier position every frame
    if (isWrapped(s, carrierId)) {
        const wr = s.play.wrap;
        const tackler = Object.values(def).find(d => d && d.id === wr.byId);
        // Keep tackler attached visually
        if (tackler) moveToward(tackler, carrier.pos, dt, 1.2);

        // LOCK carrier so nothing else can nudge it
        freezeCarrierIfWrapped(s);

        // Resolve after hold window
        if (s.play.elapsed - wr.startAt >= wr.holdDur) {
            const breaks = s.play.breaks || (s.play.breaks = {});
            const alreadyBroke = (breaks[carrierId] || 0) >= 1; // max 1 break per play

            if (alreadyBroke) {
                // Forced tackle on second wrap
                s.play.deadAt = s.play.elapsed;
                s.play.phase = 'DEAD';
                s.play.resultWhy = (carrierId === 'QB') ? 'Sack' : 'Tackled';
                endWrap(s);
                return;
            }

            const tacklerSkill = (tackler?.attrs?.tackle ?? 0.8);
            const carStr = (carrier.attrs.strength ?? 0.8);
            const carIQ = clamp(carrier.attrs.awareness ?? 1.0, 0.4, 1.3);

            let tackleChance = 0.55
                + (tacklerSkill - carStr) * 0.20
                - (carIQ - 1.0) * 0.10
                + rand(-0.06, 0.06);

            if (tackleChance > 0.5) {
                s.play.deadAt = s.play.elapsed;
                s.play.phase = 'DEAD';
                s.play.resultWhy = (carrierId === 'QB') ? 'Sack' : 'Tackled';
                endWrap(s);
                return;
            } else {
                // First (and only) broken tackle this play
                breaks[carrierId] = (breaks[carrierId] || 0) + 1;

                // Burst forward once
                moveToward(carrier, { x: carrier.pos.x, y: carrier.pos.y + 22 }, dt, 7.0);

                // Global no-wrap + defender cooldown + distance hysteresis
                s.play.postBreakUntil = s.play.elapsed + 1.1;
                s.play.noWrapUntil = s.play.elapsed + 1.1;
                if (!s.play.wrapCooldown) s.play.wrapCooldown = {};
                if (tackler) s.play.wrapCooldown[tackler.id] = s.play.elapsed + 1.6;
                s.play.lastBreakPos = { x: carrier.pos.x, y: carrier.pos.y };

                endWrap(s);
            }
        }
        return;
    }

    // Post-break immunity + hysteresis
    const now = s.play.elapsed;
    const immuneGlobal = now < (s.play.noWrapUntil || 0);

    const MIN_DIST_AFTER_BREAK = 12; // must advance this far before any wrap
    let distOk = true;
    if (s.play.lastBreakPos) {
        distOk = dist(carrier.pos, s.play.lastBreakPos) >= MIN_DIST_AFTER_BREAK;
        if (!immuneGlobal && distOk) s.play.lastBreakPos = null;
    }

    // Start wrap (tight radius + cooldowns)
    if (!immuneGlobal && distOk) {
        const CONTACT_R = 8.0; // slightly tighter
        const tackler = Object.values(def).find(d => {
            if (!d) return false;
            const cd = s.play.wrapCooldown?.[d.id];
            if (cd && now < cd) return false;
            return dist(d.pos, carrier.pos) < CONTACT_R;
        });
        if (tackler) {
            startWrap(s, carrierId, tackler.id);
            off.__carrierWrapped = carrierId;
            // Immediately record a fresh lockPos (absolute freeze)
            freezeCarrierIfWrapped(s);
            return;
        }
    }
}




function ensureEngagement(ol, dl) {
    if (ol.engagedWith && ol.engagedWith !== dl.id) return;
    if (dl.engagedWith && dl.engagedWith !== ol.id) return;
    ol.engagedWith = dl.id;
    dl.engagedWith = ol.id;
    ol._engT = ol._engT || 0;
    dl._engT = dl._engT || 0;
}


// Push apart & apply competing forces while engaged
function resolveOLDLContacts(off, def, dt, ctx) {
    const { isRun, runHoleX, COLLIDE_DIST } = ctx;
    const dlKeys = ['LE', 'DT', 'RTk', 'RE'];

    ['LT', 'LG', 'C', 'RG', 'RT'].forEach(ok => {
        const ol = off[ok]; if (!ol || !ol.engagedWith) return;

        const dl = Object.values(def).find(d => d && d.id === ol.engagedWith);
        if (!dl) { ol.engagedWith = null; return; }
        if (dl.engagedWith !== ol.id) { ol.engagedWith = null; return; }

        // Per-OL anchor
        const minY = (ol.home?.y ?? ol.pos.y) - 8;

        // --- Prevent overlap (no phasing) ---
        const dx = dl.pos.x - ol.pos.x;
        const dy = dl.pos.y - ol.pos.y;
        const d = Math.max(1, Math.hypot(dx, dy));
        if (d < COLLIDE_DIST) {
            const push = (COLLIDE_DIST - d) * 0.5;
            const nx = dx / d, ny = dy / d;
            dl.pos.x += nx * push; dl.pos.y += ny * push;
            ol.pos.x -= nx * push; ol.pos.y -= ny * push;
        }

        // --- Competing forces ---
        const qbPos = off.QB.pos;
        const olStr = (ol.attrs.strength ?? 1);
        const dlStr = (dl.attrs.strength ?? 1);
        const techOL = (ol.attrs.awareness ?? 1) * 0.6 + olStr * 0.4;
        const techDL = (dl.attrs.awareness ?? 1) * 0.6 + dlStr * 0.4;

        if (!isRun) {
            // PASS: OL shades laterally to stay between DL and QB; no backwards y
            const wantX = qbPos.x + (dl.pos.x - qbPos.x) * 0.55;
            const lat = clamp((wantX - ol.pos.x) * 2.0, -26, 26);
            ol.pos.x += lat * dt;

            // DL drives toward QB
            const toQB = unitVec({ x: qbPos.x - dl.pos.x, y: qbPos.y - dl.pos.y });
            const dlPush = (6 + 16 * techDL) * 0.5;
            dl.pos.x += toQB.x * dlPush * dt;
            dl.pos.y += toQB.y * dlPush * dt;

            // Clamp OL to anchor (no backpedal)
            if (ol.pos.y < minY) ol.pos.y = minY;
        } else {
            // RUN: widen away from hole + downfield drive
            const holeX = runHoleX ?? qbPos.x;
            const side = Math.sign((ol.pos.x - holeX) || 1);
            dl.pos.x += side * (14 + 10 * techOL) * dt;
            ol.pos.x += side * 6 * dt;
            dl.pos.y += (10 + 10 * techOL - 6 * techDL) * dt;
            ol.pos.y += 6 * dt;
        }

        // --- Win/Lose checks ---
        ol._engT = (ol._engT || 0) + dt;
        dl._engT = (dl._engT || 0) + dt;

        if (ol._engT > 0.35 && dl._engT > 0.35) {
            let odds = (techDL - techOL) * 0.22 + rand(-0.06, 0.06);
            if (isRun) odds -= 0.04;

            if (odds > 0.18) {
                // DL sheds: break + burst
                dl.engagedWith = null; ol.engagedWith = null;
                const toQB = unitVec({ x: qbPos.x - dl.pos.x, y: qbPos.y - dl.pos.y });
                dl.pos.x += toQB.x * 10; dl.pos.y += toQB.y * 10;
                dl._engT = 0; ol._engT = 0;
            } else if (odds < -0.22 && Math.random() < 0.25) {
                // OL wins: steer aside
                const side = isRun ? Math.sign((dl.pos.x - (runHoleX ?? qbPos.x)) || 1) : Math.sign((dl.pos.x - qbPos.x) || 1);
                dl.pos.x += side * 16; dl.pos.y += isRun ? 8 : 2;
                dl._engT = 0.2; ol._engT = 0.2;
            }
        }

        // Re-enforce anchor after all forces
        if (ol.pos.y < minY) ol.pos.y = minY;
    });

    // Clean dangling DL locks
    dlKeys.forEach(k => {
        const dl = def[k]; if (!dl) return;
        const olRef = dl.engagedWith ? Object.values(off).find(o => o && o.id === dl.engagedWith) : null;
        if (dl.engagedWith && !olRef) dl.engagedWith = null;
    });
}


/* =========================================================
   QB Read Helpers
   ========================================================= */
function receiverOpenScore(rcv, s, call) {
    const defAll = Object.values(s.play.formation.def);
    const nearest = defAll.reduce((best, d) => {
        const dd = dist(d.pos, rcv.pos);
        return dd < best.d ? { d: dd, t: d } : best;
    }, { d: 1e9, t: defAll[0] });
    const sep = nearest.d;
    const depth = rcv.pos.y - s.play.formation.off.C.pos.y;
    const roleBias = rcv.role.startsWith('WR') ? 0.08 : (rcv.role === 'TE' ? -0.04 : 0);
    const primaryBias = call && call.primary === rcv.id ? 0.08 : 0;
    return sep * 0.004 + depth * 0.001 + roleBias + primaryBias + Math.random() * 0.04;
}
function leadTarget(from, to) {
    const d = unitVec({ x: to.x - from.x, y: to.y - from.y });
    return { x: to.x + d.x * 16, y: to.y + d.y * 12 };
}
function getReadOrder(call) {
    const wrs = ['WR1', 'WR2', 'WR3']; const ordered = [];
    if (call && call.primary) ordered.push(call.primary);
    wrs.forEach(w => { if (!ordered.includes(w)) ordered.push(w); });
    if (!ordered.includes('TE')) ordered.push('TE');
    return ordered;
}
function isOpen(score, isPrimary) {
    const base = 0.20;
    return score > (isPrimary ? base * 0.85 : base);
}
