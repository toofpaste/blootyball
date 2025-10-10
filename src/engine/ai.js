// src/engine/ai.js
import { clamp, dist, rand, yardsToPixY } from './helpers';
import { FIELD_PIX_W, PX_PER_YARD } from './constants';
import { startPass } from './ball';

/* =========================================================
   Tunables
   ========================================================= */
// ---- Tunables (defense strengthened) ----
const CFG = {
    // ---- QB reads (unchanged except slightly tighter WR windows) ----
    // ---- QB reads ----
    CHECKDOWN_LAG: 1.0,
    PRIMARY_MAX_BONUS: 18,
    PRIMARY_DECAY_AFTER: 0.4,
    WR_MIN_OPEN: 16,
    WR_MIN_DEPTH_YARDS: 3.0,
    RB_EARLY_PENALTY: 12,
    RB_MIN_OPEN: 16,
    RB_MAX_THROWLINE: 200,


    // ---- OL / DL interaction (OL less bulldozy, DL moves better while engaged) ----
    PASS_SET_DEPTH_YDS: 1.6,
    GAP_GUARDRAIL_X: 18,
    OL_SEPARATION_R: 12,
    OL_SEPARATION_PUSH: 0.5,
    OL_ENGAGE_R: 16,
    OL_STICK_TIME: 0.30,
    OL_BLOCK_PUSHBACK: 34,      // was 34 — OL push is weaker
    OL_BLOCK_MIRROR: 0.92,
    OL_REACH_SPEED: 0.95,
    DL_ENGAGED_SLOW: 0.85,      // was 0.45/0.70 — DL keeps moving even if engaged
    DL_SEPARATION_R: 12,
    DL_SEPARATION_PUSH: 0.35,

    // ---- Shedding (new) ----
    SHED_INTERVAL: 0.25,        // try to shed this often while engaged
    SHED_BASE: 0.22,            // base chance, modified by attrs and angles
    SHED_SIDE_STEP: 12,         // lateral offset applied on successful shed

    // ---- wrap / forward progress (tackles succeed more often) ----
    FP_CONTACT_R: 3,
    FP_SLOW_SPEED: 2.5,
    FP_DURATION: 0.55,
    CONTACT_R: 11,
    TACKLER_COOLDOWN: 0.9,
    GLOBAL_IMMUNITY: 0.45,
    MIN_DIST_AFTER_BREAK: 8,
    WRAP_HOLD_MIN: 0.45,
    WRAP_HOLD_MAX: 0.75,

    // ---- Run-after-catch (tone down open-field burst a touch) ----
    RAC_TURN_SMOOTH: 0.86,
    RAC_LOOKAHEAD: 110,
    RAC_AVOID_R: 20,
    RAC_SIDESTEP: 8,
    RAC_SPEED: 0.95,

    // ---- Coverage & pursuit (new) ----
    COVER_CUSHION_YDS: 2.8,     // desired vertical cushion in man
    COVER_SWITCH_DIST: 26,      // when crossers get closer to another DB, switch
    PURSUIT_LEAD_T: 0.28,       // seconds to lead the carrier
    PURSUIT_SPEED: 1.06,        // defenders run a bit hotter in pursuit
};


/* =========================================================
   Route and Play Initialization
   ========================================================= */
// SAFER: handles missing WR/TE/RB so we don't read .pos of undefined
// SAFER init + seed coverage
export function initRoutesAfterSnap(s) {
    const off = (s.play && s.play.formation && s.play.formation.off) || {};
    const call = (s.play && s.play.playCall) || {};

    s.play.routeTargets = {};

    // ---- WR routes ----
    ['WR1', 'WR2', 'WR3'].forEach((wr) => {
        const player = off[wr];
        if (!player || !player.pos) return;
        const path = (call.wrRoutes && call.wrRoutes[wr]) || [{ dx: 0, dy: 4 }];
        const targets = path.map((step) => ({
            x: clamp((player.pos.x) + (step.dx || 0) * PX_PER_YARD, 20, FIELD_PIX_W - 20),
            y: (player.pos.y) + (step.dy || 0) * PX_PER_YARD,
        }));
        s.play.routeTargets[wr] = targets;
        player.targets = targets;
        player.routeIdx = 0;
    });

    // ---- TE ----
    if (off.TE && off.TE.pos) {
        const tePath = call.teRoute || [{ dx: 0, dy: 4 }];
        const teTargets = tePath.map((step) => ({
            x: clamp(off.TE.pos.x + (step.dx || 0) * PX_PER_YARD, 20, FIELD_PIX_W - 20),
            y: off.TE.pos.y + (step.dy || 0) * PX_PER_YARD,
        }));
        s.play.teTargets = teTargets;
        off.TE.targets = teTargets;
        off.TE.routeIdx = 0;
    } else {
        s.play.teTargets = [];
    }

    // ---- RB ----
    if (off.RB && off.RB.pos) {
        const rbPath = (call.rbPath || call.rbCheckdown || [{ dx: 0, dy: 2 }]);
        const rbTargets = rbPath.map((step) => ({
            x: clamp(off.RB.pos.x + (step.dx || 0) * PX_PER_YARD, 20, FIELD_PIX_W - 20),
            y: off.RB.pos.y + (step.dy || 0) * PX_PER_YARD,
        }));
        s.play.rbTargets = rbTargets;
        if (call.type === 'PASS') {
            off.RB.targets = rbTargets;
            off.RB.routeIdx = 0;
        }
    } else {
        s.play.rbTargets = [];
    }

    // ---- Run seeds ----
    if (call.type === 'RUN') {
        const first = (s.play.rbTargets && s.play.rbTargets[0]) ||
            (off.RB?.pos ? { x: off.RB.pos.x, y: off.RB.pos.y + 12 } : null);
        s.play.runHoleX = first ? clamp(first.x, 24, FIELD_PIX_W - 24) : clamp((off.QB?.pos?.x ?? FIELD_PIX_W / 2), 24, FIELD_PIX_W - 24);
        const baseY = off.C?.pos?.y ?? off.QB?.pos?.y ?? yardsToPixY(25);
        s.play.runLaneY = baseY + yardsToPixY(2.5);
    } else {
        s.play.runHoleX = null;
        s.play.runLaneY = null;
    }

    // ---- QB timings ----
    const qb = off.QB;
    const qbIQ = clamp(qb?.attrs?.awareness ?? 0.9, 0.4, 1.3);
    const quick = !!call.quickGame;
    const baseTTT = quick ? rand(1.0, 1.7) : rand(1.6, 3.0);
    const iqAdj = clamp((1.0 - qbIQ) * 0.4 - (qbIQ - 1.0) * 0.2, -0.3, 0.3);
    s.play.qbTTT = clamp(baseTTT + iqAdj, 0.9, 3.2);
    s.play.qbMaxHold = s.play.qbTTT + rand(1.2, 1.9);
    const qbPos = qb?.pos || { x: FIELD_PIX_W / 2, y: yardsToPixY(25) };
    s.play.qbDropTarget = { x: qbPos.x, y: qbPos.y - (call.qbDrop || 3) * PX_PER_YARD };

    // Reset OL per-play
    ['LT', 'LG', 'C', 'RG', 'RT'].forEach(k => { if (off[k]) { off[k]._assignId = null; off[k]._stickTimer = 0; } });

    // ---- NEW: seed coverage for this snap ----
    _computeCoverageAssignments(s);

    s.play.routesInitialized = true;
}



/* =========================================================
   Shared helpers
   ========================================================= */
export function moveToward(p, target, dt, speedMul = 1) {
    const dx = target.x - p.pos.x;
    const dy = target.y - p.pos.y;
    const d = Math.hypot(dx, dy) || 1;
    const maxV = (p.attrs.speed || 5.5) * 30 * speedMul;
    const step = Math.min(d, maxV * dt);
    p.pos.x += (dx / d) * step;
    p.pos.y += (dy / d) * step;
}

function _olKeys(off) { return ['LT', 'LG', 'C', 'RG', 'RT'].filter(k => off[k]); }
function _dlKeys(def) { return ['LE', 'DT', 'RTk', 'RE'].filter(k => def[k]); }

/* =========================================================
   Run-after-catch (RAC) — smooth pathing for the ball carrier
   ========================================================= */
function _isCarrier(off, ball, p) {
    if (!p || !ball) return false;
    if (ball.carrierId == null) return false;
    if (ball.carrierId === p.id) return true;
    const role = Object.entries(off || {}).find(([, pl]) => pl && pl.id === ball.carrierId)?.[0];
    return role ? off[role]?.id === p.id : false;
}

function _nearestDefender(def, pos, maxR = 1e9) {
    let best = null;
    for (const d of Object.values(def || {})) {
        if (!d) continue;
        const dd = dist(d.pos, pos);
        if (dd < maxR && (!best || dd < best.d)) best = { d: dd, p: d };
    }
    return best;
}

function _racAdvance(off, def, p, dt) {
    // On first possession, clear leftover route/scramble targets
    if (!p._hasBallInit) {
        p._hasBallInit = true;
        p.targets = null;
        p.routeIdx = null;
        p._scrTarget = null;
        p._scrUntil = 0;
        p._scrClock = 0;
        p._scrClockTotal = 0;
    }

    // Base desire: go downfield
    let desired = { x: 0, y: 1 };

    // Gently avoid nearest defender
    const nd = _nearestDefender(def, p.pos, CFG.RAC_AVOID_R);
    if (nd && nd.p) {
        const away = Math.sign(p.pos.x - nd.p.pos.x) || (Math.random() < 0.5 ? -1 : 1);
        desired.x += away * (CFG.RAC_SIDESTEP / CFG.RAC_AVOID_R);
    }

    // Stay inside the numbers
    const leftBound = 16, rightBound = FIELD_PIX_W - 16;
    if (p.pos.x < leftBound + 8) desired.x += 0.6;
    if (p.pos.x > rightBound - 8) desired.x -= 0.6;

    // Smooth heading to eliminate zig-zag / stop-go
    const mag = Math.hypot(desired.x, desired.y) || 1;
    const want = { x: desired.x / mag, y: desired.y / mag };
    if (!p._racHeading) p._racHeading = want;
    p._racHeading = {
        x: p._racHeading.x * CFG.RAC_TURN_SMOOTH + want.x * (1 - CFG.RAC_TURN_SMOOTH),
        y: p._racHeading.y * CFG.RAC_TURN_SMOOTH + want.y * (1 - CFG.RAC_TURN_SMOOTH),
    };
    const hMag = Math.hypot(p._racHeading.x, p._racHeading.y) || 1;
    const stepTarget = {
        x: clamp(p.pos.x + (p._racHeading.x / hMag) * CFG.RAC_LOOKAHEAD, 20, FIELD_PIX_W - 20),
        y: p.pos.y + (p._racHeading.y / hMag) * CFG.RAC_LOOKAHEAD,
    };

    moveToward(p, stepTarget, dt, CFG.RAC_SPEED);
}

/* =========================================================
   Offensive Line — assignments, spacing, pass sets, pushback
   ========================================================= */
function pickAssignments(off, def) {
    const qbX = off.QB.pos.x;
    const ols = _olKeys(off).map(k => off[k]).sort((a, b) => a.home.x - b.home.x);
    const dls = _dlKeys(def).map(k => def[k]);

    const leftDL = dls.filter(d => d.pos.x <= qbX);
    const rightDL = dls.filter(d => d.pos.x > qbX);

    function takeNearest(pool, ol) {
        let best = null, bi = -1;
        for (let i = 0; i < pool.length; i++) {
            const d = Math.abs(pool[i].pos.x - ol.home.x) + Math.abs(pool[i].pos.y - ol.pos.y) * 0.25;
            if (!best || d < best.d) { best = { d, t: pool[i] }; bi = i; }
        }
        if (best) { pool.splice(bi, 1); return best.t.id; }
        return null;
    }

    const map = {};
    for (const ol of ols) {
        const isLeft = ol.home.x <= qbX;
        let id = isLeft ? takeNearest(leftDL, ol) : takeNearest(rightDL, ol);
        if (id == null) id = isLeft ? takeNearest(rightDL, ol) : takeNearest(leftDL, ol);
        map[ol.role || ol.label || _roleOf(off, ol.id)] = id;
    }
    return map;
}

function _roleOf(group, id) {
    for (const [k, p] of Object.entries(group)) if (p?.id === id) return k;
    return null;
}

function repelTeammates(players, R, push) {
    for (let i = 0; i < players.length; i++) {
        for (let j = i + 1; j < players.length; j++) {
            const a = players[i], b = players[j];
            const dx = b.pos.x - a.pos.x, dy = b.pos.y - a.pos.y;
            const d = Math.hypot(dx, dy);
            if (d > 0 && d < R) {
                const k = ((R - d) / R) * push;
                const nx = dx / d, ny = dy / d;
                a.pos.x -= nx * k;
                a.pos.y -= ny * k;
                b.pos.x += nx * k;
                b.pos.y += ny * k;
            }
        }
    }
}

export function moveOL(off, def, dt) {
    const olKeys = _olKeys(off);
    const dlKeys = _dlKeys(def);
    if (!olKeys.length || !dlKeys.length) return;

    const suggested = pickAssignments(off, def);

    const qb = off.QB;
    const losY = off.__losPixY ?? (qb.pos.y - PX_PER_YARD);
    const passSetDepth = CFG.PASS_SET_DEPTH_YDS * PX_PER_YARD;
    const setY = Math.max(losY - passSetDepth, qb.pos.y - passSetDepth);

    for (const key of olKeys) {
        const ol = off[key];
        const homeX = ol.home?.x ?? ol.pos.x;
        const baseX = clamp(homeX, 20, FIELD_PIX_W - 20);
        const minX = baseX - CFG.GAP_GUARDRAIL_X;
        const maxX = baseX + CFG.GAP_GUARDRAIL_X;

        // Assignment stickiness (per-OL timer)
        ol._stickTimer = (ol._stickTimer || 0) - dt;
        let desiredId = suggested[key] || null;

        let currentDef = ol._assignId ? Object.values(def).find(d => d && d.id === ol._assignId) : null;
        if (ol._assignId && ol._stickTimer > 0 && currentDef) {
            const far = dist(ol.pos, currentDef.pos) > 140;
            if (far) { currentDef = null; ol._assignId = null; }
        }
        if (!ol._assignId && desiredId) {
            ol._assignId = desiredId;
            ol._stickTimer = CFG.OL_STICK_TIME;
            currentDef = Object.values(def).find(d => d && d.id === desiredId) || null;
        }

        // Base pass set spot (stagger slightly by role)
        const roleBias = (key === 'LT' ? -6 : key === 'RT' ? 6 : 0);
        const baseSet = { x: clamp(baseX + roleBias, minX, maxX), y: setY };

        // Mirror between DL and QB so OL stands in the way
        let target = baseSet;
        if (currentDef) {
            const vx = qb.pos.x - currentDef.pos.x;
            const vy = qb.pos.y - currentDef.pos.y || 1e-6;
            const t = (baseSet.y - currentDef.pos.y) / vy;
            let ix = currentDef.pos.x + vx * t;
            ix = clamp(ix, minX, maxX);
            target = { x: ix, y: baseSet.y };

            const dd = dist(ol.pos, currentDef.pos);
            const blend = clamp(1 - (dd / 60), 0, 1) * CFG.OL_BLOCK_MIRROR;
            target.x = clamp(target.x * (1 - blend) + baseSet.x * blend, minX, maxX);
        }

        moveToward(ol, target, dt, CFG.OL_REACH_SPEED);

        // Engage if close; push DL back and keep OL in front
        if (currentDef) {
            const d = dist(ol.pos, currentDef.pos);
            if (d < CFG.OL_ENGAGE_R) {
                ol.engagedId = currentDef.id;
                currentDef.engagedId = ol.id;

                // Push DL back toward LOS / QB
                const toQBdx = qb.pos.x - currentDef.pos.x;
                const toQBdy = qb.pos.y - currentDef.pos.y || 1e-6;
                const mag = Math.hypot(toQBdx, toQBdy) || 1;
                const pushV = CFG.OL_BLOCK_PUSHBACK * dt;
                currentDef.pos.x -= (toQBdx / mag) * (pushV * 0.35);
                currentDef.pos.y -= (toQBdy / mag) * pushV;

                if (ol.pos.y < currentDef.pos.y - 4) ol.pos.y = currentDef.pos.y - 4;
            } else if (ol.engagedId === currentDef.id) {
                ol.engagedId = null;
                if (currentDef.engagedId === ol.id) currentDef.engagedId = null;
            }
        }

        // Guardrails
        if (ol.pos.x < minX) ol.pos.x = minX;
        if (ol.pos.x > maxX) ol.pos.x = maxX;
        if (ol.pos.y < setY - PX_PER_YARD * 0.5) ol.pos.y = setY - PX_PER_YARD * 0.5;
    }

    // Separation to prevent bunching
    repelTeammates(olKeys.map(k => off[k]), CFG.OL_SEPARATION_R, CFG.OL_SEPARATION_PUSH);
    repelTeammates(dlKeys.map(k => def[k]), CFG.DL_SEPARATION_R, CFG.DL_SEPARATION_PUSH);
}

/* =========================================================
   Receivers
   ========================================================= */
export function moveReceivers(off, dt, s = null) {
    const qb = off.QB;
    const def = s?.play?.formation?.def || null;
    const ball = s?.play?.ball || null;

    ['WR1', 'WR2', 'WR3'].forEach((key) => {
        const p = off[key];
        if (!p || !p.alive) return;

        // If this WR currently has the ball, switch to RAC logic
        if (s && _isCarrier(off, ball, p)) { _racAdvance(off, def, p, dt); return; }

        // stop if this WR is wrapped
        if (off.__carrierWrapped === key) return;

        if (off.__runFlag) {
            const aim = { x: p.pos.x, y: p.pos.y + PX_PER_YARD };
            moveToward(p, aim, dt, 0.9);
            return;
        }

        // called route
        if (p.targets && p.routeIdx != null) {
            const t = p.targets[p.routeIdx];
            if (t) {
                moveToward(p, t, dt, 0.95);
                if (dist(p.pos, t) < 6) p.routeIdx = Math.min(p.routeIdx + 1, p.targets.length);
                return;
            }
        }

        // scramble drill
        const nowRetarget = !p._scrUntil || (p._scrUntil <= (p._scrClock = (p._scrClock || 0) + dt));
        if (nowRetarget || !p._scrTarget) {
            const losY = off.__losPixY ?? (qb.pos.y - PX_PER_YARD);
            const wantMinY = Math.max(losY + PX_PER_YARD * 3, qb.pos.y + PX_PER_YARD * 5);
            const deepY = Math.max(wantMinY, p.pos.y + PX_PER_YARD * 2);

            const leftLaneX = 40;
            const rightLaneX = FIELD_PIX_W - 40;
            let laneX;
            if (key === 'WR1') laneX = leftLaneX + rand(-18, 18);
            else if (key === 'WR2') laneX = rightLaneX + rand(-18, 18);
            else laneX = clamp(qb.pos.x + rand(-120, 120), 20, FIELD_PIX_W - 20);

            const allowComeback = (p._scrClockTotal = (p._scrClockTotal || 0) + dt) > 2.2 && Math.random() < 0.10;

            if (allowComeback) {
                const backY = Math.max(losY + PX_PER_YARD, qb.pos.y + PX_PER_YARD, p.pos.y - PX_PER_YARD * 1.2);
                p._scrTarget = { x: clamp(qb.pos.x + rand(-60, 60), 20, FIELD_PIX_W - 20), y: backY };
            } else {
                p._scrTarget = { x: clamp(laneX, 20, FIELD_PIX_W - 20), y: deepY };
            }
            p._scrUntil = (p._scrClock || 0) + rand(0.4, 0.8);
        }

        const target = { ...p._scrTarget };
        const maxBackward = PX_PER_YARD;
        if (target.y < p.pos.y - maxBackward) target.y = p.pos.y - maxBackward;

        moveToward(p, target, dt, 0.95);
    });
}

/* =========================================================
   Tight End
   ========================================================= */
export function moveTE(off, dt, s = null) {
    const p = off.TE;
    if (!p || !p.alive) return;

    const def = s?.play?.formation?.def || null;
    const ball = s?.play?.ball || null;

    // If TE is the ball carrier, use RAC logic
    if (s && _isCarrier(off, ball, p)) { _racAdvance(off, def, p, dt); return; }

    if (off.__runFlag) {
        const aim = { x: p.pos.x + (Math.random() < 0.5 ? -4 : 4), y: p.pos.y + PX_PER_YARD };
        moveToward(p, aim, dt, 0.93);
        return;
    }

    if (p.targets && p.routeIdx != null) {
        const t = p.targets[p.routeIdx];
        if (t) {
            moveToward(p, t, dt, 0.9);
            if (dist(p.pos, t) < 6) p.routeIdx = Math.min(p.routeIdx + 1, p.targets.length);
            return;
        }
    }

    const qb = off.QB;
    const losY = off.__losPixY ?? (qb.pos.y - PX_PER_YARD);
    const deepY = Math.max(losY + PX_PER_YARD * 2.4, qb.pos.y + PX_PER_YARD * 3, p.pos.y + PX_PER_YARD * 1.2);
    const midLane = clamp(qb.pos.x + rand(-40, 40), 20, FIELD_PIX_W - 20);

    const allowComeback = Math.random() < 0.08;
    const target = allowComeback
        ? { x: clamp(qb.pos.x + rand(-30, 30), 20, FIELD_PIX_W - 20), y: Math.max(losY + PX_PER_YARD, qb.pos.y + PX_PER_YARD, p.pos.y - PX_PER_YARD) }
        : { x: midLane, y: deepY };

    moveToward(p, target, dt, 0.95);
}

/* =========================================================
   Quarterback + throw selection (RB bias fixed)
   ========================================================= */
export function qbLogic(s, dt) {
    const off = s.play?.formation?.off || {};
    const def = s.play?.formation?.def || {};
    const call = s.play?.playCall || {};
    const qb = off.QB;

    // If we don't have a QB or a position yet, bail safely.
    if (!qb || !qb.pos) return;

    // Only run QB logic if the ball is with the QB (role string or id match).
    const carrierId = s.play?.ball?.carrierId;
    const qbHasBall = carrierId === 'QB' || carrierId === qb.id;
    if (!qbHasBall) return;

    // Rush context (robust to missing defenders)
    const rushers = ['LE', 'DT', 'RTk', 'RE']
        .map(k => def[k])
        .filter(d => d && d.pos);
    let nearestDL = { d: 1e9, t: null };
    for (const d of rushers) {
        const d0 = dist(d.pos, qb.pos);
        if (d0 < nearestDL.d) nearestDL = { d: d0, t: d };
    }
    const pressureDist = nearestDL.d;
    const underImmediatePressure = pressureDist < 18;  // was 15
    const underHeat = pressureDist < 36;

    // Ensure move mode + drop target exist
    if (!s.play.qbMoveMode) s.play.qbMoveMode = 'DROP';
    const dropTarget = s.play?.qbDropTarget || {
        x: qb.pos.x,
        y: qb.pos.y - (call.qbDrop || 3) * PX_PER_YARD,
    };
    s.play.qbDropTarget = dropTarget;

    // Initialize qb.targets sensibly if missing
    if (
        s.play.qbMoveMode === 'DROP' &&
        (!Array.isArray(qb.targets) || qb.targets.length === 0)
    ) {
        qb.targets = [dropTarget];
        qb.routeIdx = 0;
    }
    if (typeof qb.routeIdx !== 'number') qb.routeIdx = 0;

    const time = s.play.elapsed || 0;
    const lateralBias = nearestDL.t
        ? Math.sign(qb.pos.x - nearestDL.t.pos.x) || (Math.random() < 0.5 ? -1 : 1)
        : (Math.random() < 0.5 ? -1 : 1);

    // Debug hook: forced scramble
    if (s.debug?.forceNextOutcome === 'SCRAMBLE' && !s.play.__forcedScrambleArmed) {
        s.play.__forcedScrambleArmed = true;
        s.play.qbMoveMode = 'SCRAMBLE';
        s.play.scrambleMode = Math.random() < 0.7 ? 'LATERAL' : 'FORWARD';
        s.play.scrambleDir = Math.random() < 0.5 ? -1 : 1;
        s.play.scrambleUntil = time + rand(0.45, 0.9);
    }
    // Auto-scramble from pressure / timing
    const ttt = s.play.qbTTT || 1.6;
    if (
        s.play.qbMoveMode === 'DROP' &&
        (underImmediatePressure || time > (ttt + 0.9))  // was +0.7
    ) {
        s.play.qbMoveMode = 'SCRAMBLE';
        s.play.scrambleMode = Math.random() < 0.7 ? 'LATERAL' : 'FORWARD';
        s.play.scrambleDir = lateralBias;
        s.play.scrambleUntil = time + rand(0.45, 0.9);
    }

    // Move QB
    const minY =
        s.play.qbDropTarget
            ? Math.min(s.play.qbDropTarget.y - PX_PER_YARD, s.play.qbDropTarget.y)
            : qb.pos.y;

    if (s.play.qbMoveMode === 'DROP') {
        const t =
            Array.isArray(qb.targets) && qb.targets.length > 0
                ? qb.targets[Math.max(0, Math.min(qb.routeIdx, qb.targets.length - 1))]
                : dropTarget;
        moveToward(qb, { x: t.x, y: Math.max(t.y, minY) }, dt, 0.9);
        if (t && dist(qb.pos, t) < 4 && Array.isArray(qb.targets)) {
            qb.routeIdx = Math.min(qb.routeIdx + 1, qb.targets.length);
        }
    } else {
        if (!s.play.scrambleMode) s.play.scrambleMode = 'LATERAL';
        const lateral = {
            x: clamp(qb.pos.x + (s.play.scrambleDir || 1) * 60, 20, FIELD_PIX_W - 20),
            y: Math.max(minY, qb.pos.y - 2),
        };
        const forward = {
            x: clamp(qb.pos.x + (s.play.scrambleDir || 1) * 8, 20, FIELD_PIX_W - 20),
            y: qb.pos.y + PX_PER_YARD * 4,
        };
        const tgt = s.play.scrambleMode === 'LATERAL' ? lateral : forward;
        moveToward(qb, tgt, dt, 1.05);
        if (time > (s.play.scrambleUntil || 0)) s.play.scrambleMode = 'FORWARD';
    }

    // Throws (unchanged scoring, just guarded inside tryThrow)
    tryThrow(s, { underHeat, underImmediatePressure });
}

function nearestDefDist(def, pos) {
    let best = 1e9;
    for (const d of Object.values(def)) {
        if (!d) continue;
        const dd = dist(d.pos, pos);
        if (dd < best) best = dd;
    }
    return best;
}
function tryThrow(s, press) {
    const off = s.play?.formation?.off || {};
    const def = s.play?.formation?.def || {};
    const qb = off.QB;
    const call = s.play?.playCall || {};
    if (!qb || !qb.pos) return;
    const tNow = s.play.elapsed, ttt = s.play.qbTTT || 2.5, maxHold = s.play.qbMaxHold || 4.8;
    const minThrowGate = Math.min(ttt - 0.1, 1.6); // never earlier than ~1.5s unless quick-game changed ttt
    if (tNow < minThrowGate) return;
    const checkdownGate = press.underImmediatePressure || s.play.qbMoveMode === 'SCRAMBLE' || (tNow >= ttt + CFG.CHECKDOWN_LAG);
    const losY = off.__losPixY ?? (qb.pos.y - PX_PER_YARD);
   
    const wrteKeys = ['WR1', 'WR2', 'WR3', 'TE'];
    let bestWRTE = null;
    for (const key of wrteKeys) {
        const r = off[key]; if (!r || !r.alive) continue; if (r.pos.y < losY) continue;
        const open = nearestDefDist(def, r.pos);                      // bigger is better
        const throwLine = dist(qb.pos, r.pos);                        // shorter is better
        const depthPastLOS = r.pos.y - losY;                          // downfield progress
        let primaryBonus = 0;
        if (key === call.primary) {
            const endBonusT = ttt + CFG.PRIMARY_DECAY_AFTER;
            const k = clamp((endBonusT - tNow) / Math.max(0.001, CFG.PRIMARY_DECAY_AFTER + ttt), 0, 1);
            primaryBonus = CFG.PRIMARY_MAX_BONUS * k;
        }
        const score = open * 1.35 + depthPastLOS * 0.12 + primaryBonus - throwLine * 0.10;
        const cand = { key, r, score, open, depthPastLOS, throwLine };
        if (!bestWRTE || score > bestWRTE.score) bestWRTE = cand;
    }
    const wrDepthNeed = CFG.WR_MIN_DEPTH_YARDS * PX_PER_YARD;
    
    const wrAccept = bestWRTE && (
    bestWRTE.open >= CFG.WR_MIN_OPEN ||
        bestWRTE.depthPastLOS >= wrDepthNeed ||
        (tNow >= ttt && press.underHeat && bestWRTE.open >= CFG.WR_MIN_OPEN * 0.75)
    );
    let rbCand = null;
    if (!wrAccept && checkdownGate) {
        const r = off.RB;
        if (r && r.alive) {
            const open = nearestDefDist(def, r.pos), throwLine = dist(qb.pos, r.pos);
            let score = open * 1.05 - throwLine * 0.35;
            if (tNow < (ttt + CFG.CHECKDOWN_LAG)) score -= CFG.RB_EARLY_PENALTY;
            rbCand = { key: 'RB', r, score, open, throwLine };
        }
    }
    const mustThrow = (tNow >= maxHold) || (tNow >= (ttt + 0.65) && press.underHeat);
    const _leadTo = (p) => {
        const v = _updateAndGetVel(p, 0.016);
        const leadT = 0.62; // keep your current lead
        const raw = { x: p.pos.x + v.x * leadT, y: p.pos.y + v.y * leadT };
        // Never aim behind the QB's Y (prevents backward/lateral passes)
        const safeY = Math.max(raw.y, qb.pos.y - PX_PER_YARD * 0.25);
        return { x: raw.x, y: safeY };
    };

    if (wrAccept) {
        const to = _leadTo(bestWRTE.r);
        if (isThrowLaneClear(def, { x: qb.pos.x, y: qb.pos.y }, to, 18)) {
            const from = { x: qb.pos.x, y: qb.pos.y - 2 };
            const safeTo = { x: to.x, y: Math.max(to.y, qb.pos.y - PX_PER_YARD * 0.25) };
            startPass(s, from, { x: safeTo.x, y: safeTo.y }, bestWRTE.r.id);
            s.play.passRisky = bestWRTE.open < 22;
            return;
        }
        // lane blocked → keep reading this tick
    }

    if (rbCand && rbCand.open >= CFG.RB_MIN_OPEN && rbCand.throwLine <= CFG.RB_MAX_THROWLINE) {
        const to = _leadTo(rbCand.r);
        if (isThrowLaneClear(def, { x: qb.pos.x, y: qb.pos.y }, to, 16)) {
            const from = { x: qb.pos.x, y: qb.pos.y - 2 };
            const safeTo = { x: to.x, y: Math.max(to.y, qb.pos.y - PX_PER_YARD * 0.25) };
            startPass(s, from, { x: safeTo.x, y: safeTo.y }, rbCand.r.id);
            s.play.passRisky = rbCand.open < 22;
            return;
        }
        // lane blocked → skip this tick
    }
    if (mustThrow) {
        if (bestWRTE) {
            const to = _leadTo(bestWRTE.r);
            if (isThrowLaneClear(def, { x: qb.pos.x, y: qb.pos.y }, to, 18)) {
                const from = { x: qb.pos.x, y: qb.pos.y - 2 };
                const safeTo = { x: to.x, y: Math.max(to.y, qb.pos.y - PX_PER_YARD * 0.25) };
                startPass(s, from, { x: safeTo.x, y: safeTo.y }, bestWRTE.r.id);
                s.play.passRisky = bestWRTE.open < 22;
            } else {
                // Throwaway should also NEVER be backward: aim sideline but forward
                const sidelineX = qb.pos.x < FIELD_PIX_W / 2 ? 8 : FIELD_PIX_W - 8;
                const outY = Math.max(qb.pos.y + PX_PER_YARD * 2, losY + PX_PER_YARD); // forward/out
                startPass(s, { x: qb.pos.x, y: qb.pos.y - 2 }, { x: sidelineX, y: outY }, null);
            }
        } else {
            const sidelineX = qb.pos.x < FIELD_PIX_W / 2 ? 8 : FIELD_PIX_W - 8;
            const outY = Math.max(qb.pos.y + PX_PER_YARD * 2, losY + PX_PER_YARD);
            startPass(s, { x: qb.pos.x, y: qb.pos.y - 2 }, { x: sidelineX, y: outY }, null);
        }
    }

}
// Lateral clearance check: is any defender sitting in the throw lane?
// Returns true if lane is clear, false if a defender is in the corridor.
function isThrowLaneClear(defMap, from, to, corridorPx = 16) {
    const ax = to.x - from.x;
    const ay = to.y - from.y;
    const len = Math.hypot(ax, ay) || 1;
    const ux = ax / len, uy = ay / len;

    for (const d of Object.values(defMap || {})) {
        if (!d?.pos) continue;
        // skip defenders clearly behind the QB relative to the throw vector
        if (d.pos.y < from.y - 6) continue;

        const vx = d.pos.x - from.x;
        const vy = d.pos.y - from.y;

        // projection along segment only
        const t = vx * ux + vy * uy;
        if (t <= 0 || t >= len) continue;

        const px = from.x + ux * t, py = from.y + uy * t;
        const lat = Math.hypot(d.pos.x - px, d.pos.y - py);
        if (lat < corridorPx) return false;
    }
    return true;
}

/* =========================================================
   Running back
   ========================================================= */
export function rbLogic(s, dt) {
    const off = s.play.formation.off, call = s.play.playCall, rb = off.RB;
    const def = s.play.formation.def;
    if (!rb || !rb.alive) return;

    // If RB has the ball (after catch or handoff), use RAC logic
    if (_isCarrier(off, s.play.ball, rb)) { _racAdvance(off, def, rb, dt); return; }

    if (call.type === 'RUN') {
        // aim deeper and a touch wider to find daylight, then hit it harder
        const baseLaneY = rb.pos.y + PX_PER_YARD * 6; // was 3
        const losBuffer = (off.__losPixY || rb.pos.y) + PX_PER_YARD * 2;
        const laneY = Math.max(baseLaneY, losBuffer);

        const laneX = s.play.runHoleX ?? rb.pos.x;
        const aim = { x: clamp(laneX + rand(-8, 8), 18, FIELD_PIX_W - 18), y: laneY };

        // slightly faster through the hole to beat first contact
        moveToward(rb, aim, dt, 1.18); // was 1.08
    }
    if (call.type === 'PASS' && rb.targets && rb.routeIdx != null) {
        const t = rb.targets[rb.routeIdx];
        if (t) { moveToward(rb, t, dt, 0.9); if (dist(rb.pos, t) < 6) rb.routeIdx = Math.min(rb.routeIdx + 1, rb.targets.length); return; }
    }
    if (call.type === 'RUN') {
        const laneX = s.play.runHoleX ?? rb.pos.x, laneY = s.play.runLaneY ?? (rb.pos.y + PX_PER_YARD * 3);
        const aim = { x: clamp(laneX + rand(-6, 6), 20, FIELD_PIX_W - 20), y: laneY };
        moveToward(rb, aim, dt, 1.08);
    }
}

/* =========================================================
   Defense — respect engagement & try to shed
   ========================================================= */
function findOffRoleById(off, id) { for (const [role, p] of Object.entries(off || {})) { if (p && p.id === id) return role; } return null; }
function normalizeCarrier(off, ball) {
    let role = null, player = null, id = null;
    if (typeof ball.carrierId === 'string' && off[ball.carrierId]) { role = ball.carrierId; player = off[role]; id = player?.id ?? null; }
    if (!player && ball.carrierId != null) { player = Object.values(off || {}).find(p => p && p.id === ball.carrierId) || null; role = player ? findOffRoleById(off, player.id) : role; id = player?.id ?? id; }
    if (!player) { role = 'QB'; player = off.QB || null; id = player?.id ?? 'QB'; }
    return { role, player, id };
}

function startWrap(s, carrierId, defenderId) {
    (s.play.wrapCounts ||= {}); s.play.wrapCounts[carrierId] = (s.play.wrapCounts[carrierId] || 0) + 1;
    const off = s.play.formation.off; const carrier = Object.values(off || {}).find(p => p && p.id === carrierId);
    s.play.wrap = { carrierId, byId: defenderId, startAt: s.play.elapsed, holdDur: rand(CFG.WRAP_HOLD_MIN, CFG.WRAP_HOLD_MAX), lockPos: carrier ? { x: carrier.pos.x, y: carrier.pos.y } : null };
    (s.play.events ||= []).push({ t: s.play.elapsed, type: 'wrap:start', carrierId, byId: defenderId });
}
function isWrapped(s, id) { return !!(s.play.wrap && s.play.wrap.carrierId === id); }
function endWrap(s, why = 'wrap:end') { if (s.play.wrap) (s.play.events ||= []).push({ t: s.play.elapsed, type: why, wrap: s.play.wrap }); s.play.wrap = null; }
function freezeCarrierIfWrapped(s) {
    if (!s.play.wrap || !s.play.wrap.lockPos) return;
    const off = s.play.formation.off; const carrier = Object.values(off || {}).find(p => p && p.id === s.play.wrap.carrierId);
    if (!carrier) return; carrier.pos.x = s.play.wrap.lockPos.x; carrier.pos.y = s.play.wrap.lockPos.y;
}
function _ensureVec(p) { return (p && p.pos) ? p.pos : { x: 0, y: 0 }; }

function _updateAndGetVel(p, dt) {
    // Store last pos and estimate simple velocity
    if (!p || !p.pos) return { x: 0, y: 0 };
    const last = p._lastPos || { x: p.pos.x, y: p.pos.y };
    const vx = (p.pos.x - last.x) / Math.max(dt, 1e-3);
    const vy = (p.pos.y - last.y) / Math.max(dt, 1e-3);
    p._lastPos = { x: p.pos.x, y: p.pos.y };
    return { x: vx, y: vy };
}

function _leadPoint(p, dtLead, dtSample = 0.016) {
    // Predict a little ahead using our crude velocity estimate
    const v = _updateAndGetVel(p, dtSample);
    return { x: p.pos.x + v.x * dtLead, y: p.pos.y + v.y * dtLead };
}

// Greedy nearest assignment with role weighting (CBs prefer WRs > TE > RB)
function _computeCoverageAssignments(s) {
    const off = s.play?.formation?.off || {};
    const def = s.play?.formation?.def || {};
    const losY = off.__losPixY ?? (off.QB?.pos?.y ?? 0);

    const defenders = ['CB1', 'CB2', 'NB', 'S1', 'S2', 'LB1', 'LB2'].map(k => ({ k, p: def[k] })).filter(x => x.p && x.p.pos);
    const targets = ['WR1', 'WR2', 'WR3', 'TE', 'RB'].map(k => ({ k, p: off[k] })).filter(x => x.p && x.p.pos);

    const weight = (role) => role.startsWith('WR') ? 0 : role === 'TE' ? 15 : 30; // WR easiest
    const assigned = {};
    const used = new Set();

    // Prefer man-match when not Cover-2 Shell; in Cover-2 we still seed "primary"
    const isCover2 = (s.play.defFormation || '').includes('Cover-2');
    const list = defenders.slice().sort((a, b) => a.p.pos.y - b.p.pos.y); // shallow first

    for (const d of list) {
        let best = null;
        for (const t of targets) {
            if (used.has(t.k)) continue;
            const cost = dist(d.p.pos, t.p.pos) + weight(t.k);
            if (!best || cost < best.cost) best = { cost, t };
        }
        if (best) {
            assigned[d.k] = best.t.k;
            used.add(best.t.k);
        }
    }

    // Stash zone landmarks for safeties (deep halves)
    let deepLandmarks = null;
    if (isCover2) {
        const midX = (off.QB?.pos?.x ?? 200);
        const cushion = CFG.COVER_CUSHION_YDS * PX_PER_YARD;
        deepLandmarks = {
            left: { x: midX - 55, y: losY + PX_PER_YARD * 12 + cushion },
            right: { x: midX + 55, y: losY + PX_PER_YARD * 12 + cushion },
        };
    }

    s.play.coverage = { assigned, isCover2, deepLandmarks, losY };
}

export function defenseLogic(s, dt) {
    const off = s.play.formation.off, def = s.play.formation.def, ball = s.play.ball;
    const cover = s.play.coverage || { assigned: {}, isCover2: false, deepLandmarks: null, losY: off.__losPixY ?? 0 };

    // 1) DL rush with shedding and lane offsets to avoid piling behind a teammate
    const rushKeys = ['LE', 'DT', 'RTk', 'RE'];
    const qbPos = _ensureVec(off.QB);
    const midX = qbPos.x;

    rushKeys.forEach((k, i) => {
        const d = def[k]; if (!d || !d.pos) return;

        // Assign a slight lane offset so two rushers don’t stack
        const laneBias = (k === 'LE' ? -10 : k === 'RE' ? 10 : (k === 'DT' ? -4 : 4));

        // Default aim: QB (or carrier if ball not with QB)
        const { player: carrier } = normalizeCarrier(off, ball);
        let aim = ball.inAir ? qbPos : carrier?.pos || qbPos;
        aim = { x: clamp(aim.x + laneBias, 20, FIELD_PIX_W - 20), y: aim.y };

        // If engaged → try to shed periodically
        if (d.engagedId) {
            d._shedT = (d._shedT || 0) + dt;
            if (d._shedT >= CFG.SHED_INTERVAL) {
                d._shedT = 0;
                const blocker = Object.values(off).find(o => o && o.id === d.engagedId);
                const dStr = d.attrs?.tackle ?? 0.9;
                const bStr = blocker?.attrs?.strength ?? 1.0;
                const angleHelp = Math.abs((d.pos.x - (blocker?.pos?.x ?? d.pos.x)) / Math.max(1, d.pos.y - (blocker?.pos?.y ?? d.pos.y)));
                const shedP = clamp(CFG.SHED_BASE + (dStr - bStr) * 0.25 + angleHelp * 0.06, 0.05, 0.65);
                if (Math.random() < shedP) {
                    // sidestep shed
                    const side = Math.sign(d.pos.x - (blocker?.pos?.x ?? d.pos.x)) || (Math.random() < 0.5 ? -1 : 1);
                    d.pos.x = clamp(d.pos.x + side * CFG.SHED_SIDE_STEP, 20, FIELD_PIX_W - 20);
                    d.engagedId = null;
                }
            }
            // still move (reduced), trying to get around blocker
            const sideWish = Math.sign((qbPos.x + laneBias) - d.pos.x) || (Math.random() < 0.5 ? -1 : 1);
            const around = { x: clamp(d.pos.x + sideWish * 20, 20, FIELD_PIX_W - 20), y: d.pos.y + PX_PER_YARD * 0.8 };
            moveToward(d, around, dt, CFG.DL_ENGAGED_SLOW);
        } else {
            moveToward(d, aim, dt, 0.98);
        }
    });

    // 2) Coverage / pursuit for back seven
    const coverables = ['WR1', 'WR2', 'WR3', 'TE', 'RB'].map(k => off[k]).filter(Boolean);
    const cushion = CFG.COVER_CUSHION_YDS * PX_PER_YARD;

    const manKeys = ['CB1', 'CB2', 'NB', 'LB1', 'LB2'];
    manKeys.forEach(k => {
        const d = def[k]; if (!d || !d.pos) return;

        // If ball not in air & close to carrier → pursuit with lead
        const { player: carrier } = normalizeCarrier(off, ball);
        if (!ball.inAir && carrier && carrier.pos) {
            const dx = carrier.pos.x - d.pos.x, dy = carrier.pos.y - d.pos.y;
            const dsq = dx * dx + dy * dy;
            if (dsq < (220 * 220)) {
                const lead = _leadPoint(carrier, CFG.PURSUIT_LEAD_T, dt);
                moveToward(d, lead, dt, CFG.PURSUIT_SPEED);
                return;
            }
        }

        // Otherwise: man on assigned target
        const targetRole = cover.assigned[k];
        const t = targetRole ? off[targetRole] : null;
        if (t && t.pos) {
            // If another DB is much closer to this WR (crossers), switch
            const nearestDB = ['CB1', 'CB2', 'NB', 'S1', 'S2', 'LB1', 'LB2']
                .map(kk => def[kk])
                .filter(pp => pp && pp.pos)
                .reduce((best, pp) => {
                    const dd = dist(pp.pos, t.pos);
                    return (!best || dd < best.d) ? { d: dd, p: pp } : best;
                }, null);
            if (nearestDB && nearestDB.p === d && dist(d.pos, t.pos) > CFG.COVER_SWITCH_DIST) {
                // keep assignment
            } else if (nearestDB && nearestDB.d + 1 < dist(d.pos, t.pos)) {
                // switch if someone else owns it better
                for (const [dk, rk] of Object.entries(cover.assigned)) if (rk === targetRole) delete cover.assigned[dk];
                cover.assigned[k] = Object.entries(def).find(([dk, pp]) => pp === nearestDB.p)?.[0] ? targetRole : cover.assigned[k];
            }

            const aim = { x: t.pos.x, y: Math.max(t.pos.y - cushion, cover.losY + PX_PER_YARD * 1.2) };
            moveToward(d, aim, dt, 0.96);
            return;
        }

        // Fallback: landmark middle hook
        const mid = { x: qbPos.x, y: cover.losY + PX_PER_YARD * 6 };
        moveToward(d, mid, dt, 0.9);
    });

    // Safeties: Cover-2 landmarks + break on ball
    ['S1', 'S2'].forEach((k, idx) => {
        const d = def[k]; if (!d || !d.pos) return;
        if (ball.inAir) {
            const tgt = s.play.ball?.to || qbPos;
            moveToward(d, tgt, dt, 1.04);
            return;
        }
        if (cover.isCover2 && cover.deepLandmarks) {
            moveToward(d, idx === 0 ? cover.deepLandmarks.left : cover.deepLandmarks.right, dt, 0.92);
        } else {
            // man/robber-ish
            const deepest = coverables.reduce((best, p) => {
                if (!p || !p.pos) return best;
                return (!best || p.pos.y > best.pos.y) ? p : best;
            }, null);
            if (deepest) {
                const aim = { x: deepest.pos.x * 0.65 + qbPos.x * 0.35, y: Math.max(deepest.pos.y - PX_PER_YARD * 3.5, cover.losY + PX_PER_YARD * 8) };
                moveToward(d, aim, dt, 0.94);
            }
        }
    });

    // 3) Contact & tackle logic (slightly tougher)
    if (ball.inAir) return;

    const { role: carrierRole, player: ballCarrier, id: carrierId } = normalizeCarrier(off, ball);
    if (!ballCarrier) return;

    off.__carrierWrapped = isWrapped(s, carrierId) ? (carrierRole || carrierId) : null;
    off.__carrierWrappedId = isWrapped(s, carrierId) ? carrierId : null;

    if (isWrapped(s, carrierId)) {
        freezeCarrierIfWrapped(s);
        const wr = s.play.wrap;
        const tackler = Object.values(def).find((d) => d && d.id === wr.byId);
        if (tackler) moveToward(tackler, ballCarrier.pos, dt, 1.2);

        const wrapsSoFar = (s.play.wrapCounts && s.play.wrapCounts[carrierId]) || 1;
        if (wrapsSoFar >= 2) {
            s.play.deadAt = s.play.elapsed; s.play.phase = 'DEAD'; s.play.resultWhy = (carrierRole === 'QB') ? 'Sack' : 'Tackled';
            (s.play.events ||= []).push({ t: s.play.elapsed, type: 'tackle:wrap2', carrierId, byId: wr.byId }); endWrap(s); return;
        }
        if (s.play.elapsed - wr.startAt >= wr.holdDur) {
            const breaks = s.play.breaks || (s.play.breaks = {}); const alreadyBroke = (breaks[carrierId] || 0) >= 1;

            // assistants nearby increase tackle chance
            const assistants = Object.values(def).filter(dv => dv && dv.id !== wr.byId && dist(dv.pos, ballCarrier.pos) < 14).length;
            const tackler = Object.values(def).find((d) => d && d.id === wr.byId);

            if (alreadyBroke) {
                s.play.deadAt = s.play.elapsed; s.play.phase = 'DEAD'; s.play.resultWhy = (carrierRole === 'QB') ? 'Sack' : 'Tackled';
                (s.play.events ||= []).push({ t: s.play.elapsed, type: 'tackle:wrapHold', carrierId, byId: wr.byId }); endWrap(s); return;
            }
            const tacklerSkill = (tackler?.attrs?.tackle ?? 0.9), carStr = (ballCarrier.attrs?.strength ?? 0.85), carIQ = clamp(ballCarrier.attrs?.awareness ?? 1.0, 0.4, 1.3);
            let tackleChance = 0.66 + (tacklerSkill - carStr) * 0.22 - (carIQ - 1.0) * 0.10 + assistants * 0.08 + (Math.random() * 0.10 - 0.05);
            if (tackleChance > 0.5) {
                s.play.deadAt = s.play.elapsed; s.play.phase = 'DEAD'; s.play.resultWhy = (carrierRole === 'QB') ? 'Sack' : 'Tackled';
                (s.play.events ||= []).push({ t: s.play.elapsed, type: 'tackle:wrapHoldWin', carrierId, byId: wr.byId }); endWrap(s); return;
            } else {
                breaks[carrierId] = (breaks[carrierId] || 0) + 1;
                moveToward(ballCarrier, { x: ballCarrier.pos.x, y: ballCarrier.pos.y + PX_PER_YARD * 3.7 }, dt, 7.0);
                s.play.noWrapUntil = s.play.elapsed + CFG.GLOBAL_IMMUNITY;
                s.play.lastBreakPos = { x: ballCarrier.pos.x, y: ballCarrier.pos.y };
                (s.play.wrapCooldown ||= {}); if (tackler) s.play.wrapCooldown[tackler.id] = s.play.elapsed + CFG.TACKLER_COOLDOWN;
                (s.play.events ||= []).push({ t: s.play.elapsed, type: 'break:won', carrierId, byId: wr.byId }); endWrap(s);
            }
        }
        return;
    }

    // Try to start a new wrap
    const now = s.play.elapsed;
    const immuneGlobal = now < (s.play.noWrapUntil || 0);
    let distOk = true;
    if (s.play.lastBreakPos) {
        distOk = Math.hypot(ballCarrier.pos.x - s.play.lastBreakPos.x, ballCarrier.pos.y - s.play.lastBreakPos.y) >= CFG.MIN_DIST_AFTER_BREAK;
        if (!immuneGlobal && distOk) s.play.lastBreakPos = null;
    }
    if (!immuneGlobal && distOk) {
        const tackler = Object.values(def).find((d) => {
            if (!d) return false;
            const cd = s.play.wrapCooldown?.[d.id]; if (cd && now < cd) return false;
            const dx = d.pos.x - ballCarrier.pos.x, dy = d.pos.y - ballCarrier.pos.y;
            return (dx * dx + dy * dy) <= (CFG.CONTACT_R * CFG.CONTACT_R);
        });
        if (tackler) {
            startWrap(s, carrierId, tackler.id);
            (s.play.wrapCooldown ||= {}); s.play.wrapCooldown[tackler.id] = now + CFG.TACKLER_COOLDOWN; return;
        }
    }

    // Forward progress (unchanged)
    (s.play._fp ||= { t0: null, last: null });
    const last = s.play._fp.last;
    s.play._fp.last = { t: now, x: ballCarrier.pos.x, y: ballCarrier.pos.y };
    let speed = Infinity;
    if (last) { const dtWin = Math.max(1e-3, now - last.t); const dxy = Math.hypot(ballCarrier.pos.x - last.x, ballCarrier.pos.y - last.y); speed = dxy / dtWin; }
    const nearestSq = Object.values(def).reduce((best, d) => {
        if (!d) return best; const dx = d.pos.x - ballCarrier.pos.x, dy = d.pos.y - ballCarrier.pos.y; const dsq = dx * dx + dy * dy; return Math.min(best, dsq);
    }, Infinity);
    const inContact = nearestSq <= CFG.FP_CONTACT_R * CFG.FP_CONTACT_R;
    if (inContact && speed <= CFG.FP_SLOW_SPEED) {
        if (!s.play._fp.t0) { s.play._fp.t0 = now; (s.play.events ||= []).push({ t: now, type: 'fp:start', speed, nearest: Math.sqrt(nearestSq) }); }
        else if (now - s.play._fp.t0 > CFG.FP_DURATION) {
            s.play.deadAt = now; s.play.phase = 'DEAD'; s.play.resultWhy = 'Forward progress stopped';
            (s.play.events ||= []).push({ t: now, type: 'fp:whistle', speed, nearest: Math.sqrt(nearestSq) }); s.play._fp.t0 = null; return;
        }
    } else { if (s.play._fp.t0) (s.play.events ||= []).push({ t: now, type: 'fp:reset' }); s.play._fp.t0 = null; }
}
