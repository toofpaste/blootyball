// src/engine/ai.js
import { clamp, dist, rand, yardsToPixY } from './helpers';
import { FIELD_PIX_W, PX_PER_YARD } from './constants';
import { steerPlayer, dampMotion, applyCollisionSlowdown } from './motion';
import { startPass } from './ball';

/* =========================================================
   AI state helpers
   ========================================================= */
function _ensureAI(player) {
    if (!player) return null;
    if (!player._ai) player._ai = {};
    return player._ai;
}

function _blendHeading(prev, next, smooth = 0.82) {
    const x = prev.x * smooth + next.x * (1 - smooth);
    const y = prev.y * smooth + next.y * (1 - smooth);
    const mag = Math.hypot(x, y) || 1;
    return { x: x / mag, y: y / mag };
}

function _lerp(a, b, t) {
    return a + (b - a) * clamp(t, 0, 1);
}

function _routeTargetsFromPath(startPos, path = [], { releaseDepthYards = 2 } = {}) {
    const targets = [];
    let cursor = { x: startPos.x, y: startPos.y };
    let totalDepth = 0;
    path.forEach((step, idx) => {
        const dx = (step.dx || 0) * PX_PER_YARD;
        const dy = (step.dy || 0) * PX_PER_YARD;
        cursor = {
            x: clamp(cursor.x + dx, 16, FIELD_PIX_W - 16),
            y: cursor.y + dy,
        };
        totalDepth += Math.max(0, dy);
        targets.push({
            x: cursor.x,
            y: cursor.y,
            break: step.break || null,
            settle: !!step.settle,
            label: step.label || null,
            option: step.option || null,
            speed: step.speed || 1,
            depth: totalDepth,
            raw: { ...step },
            idx,
        });
    });

    if (!targets.length) {
        targets.push({
            x: clamp(startPos.x, 16, FIELD_PIX_W - 16),
            y: startPos.y + releaseDepthYards * PX_PER_YARD,
            break: null,
            settle: false,
            label: 'auto-release',
            option: null,
            speed: 1,
            depth: releaseDepthYards * PX_PER_YARD,
            raw: {},
            idx: 0,
        });
    }

    return targets;
}

function _assignRoute(player, path, options = {}) {
    if (!player?.pos) return;
    const ai = _ensureAI(player);
    const targets = _routeTargetsFromPath(player.pos, path, options);
    player.targets = targets;
    player.routeIdx = 0;
    ai.type = 'route';
    ai.route = {
        targets,
        finished: false,
        scrambleTimer: 0,
        settleHold: 0,
        allowScrambleAdjust: options.allowScramble !== false,
        releaseDepth: options.releaseDepthYards || 2,
        name: options.name || player.role || player.label || 'WR',
        throttle: options.speed || 1,
    };
    ai.prevHeading = { x: 0, y: 1 };
}

function _markRouteFinished(player, aiRoute) {
    if (!aiRoute) return;
    aiRoute.finished = true;
    aiRoute.scrambleTimer = 0;
}

function _nearestAssignmentDefender(def, player) {
    if (!player) return null;
    let best = null;
    for (const d of Object.values(def || {})) {
        if (!d?.pos) continue;
        const dd = dist(d.pos, player.pos);
        if (!best || dd < best.dist) best = { dist: dd, defender: d };
    }
    return best;
}

function _laneSample(off, def, yDepth) {
    const samples = [];
    for (let x = 24; x <= FIELD_PIX_W - 24; x += 12) {
        const point = { x, y: yDepth };
        const offHelp = Object.values(off || {}).reduce((acc, p) => {
            if (!p?.pos) return acc;
            const d = dist(p.pos, point);
            return d < 18 ? acc + (18 - d) : acc;
        }, 0);
        const defThreat = Object.values(def || {}).reduce((acc, p) => {
            if (!p?.pos) return acc;
            const d = dist(p.pos, point);
            return d < 24 ? acc + (24 - d) : acc;
        }, 0);
        samples.push({ x, score: offHelp - defThreat, point });
    }
    samples.sort((a, b) => b.score - a.score);
    return samples;
}

function _computeLaneForRB(off, def, rb, losY) {
    const firstBand = _laneSample(off, def, Math.max(losY + PX_PER_YARD * 2, rb.pos.y + PX_PER_YARD * 2));
    return firstBand.length ? firstBand[0] : { x: rb.pos.x, score: 0 };
}

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

    off.__playCall = call;

    s.play.routeTargets = {};

    // ---- WR routes ----
    ['WR1', 'WR2', 'WR3'].forEach((wr) => {
        const player = off[wr];
        if (!player || !player.pos) return;
        const path = (call.wrRoutes && call.wrRoutes[wr]) || [{ dx: 0, dy: 4 }];
        const targets = _routeTargetsFromPath(player.pos, path, { name: wr });
        s.play.routeTargets[wr] = targets;
        _assignRoute(player, path, { name: wr });
    });

    // ---- TE ----
    if (off.TE && off.TE.pos) {
        const tePath = call.teRoute || [{ dx: 0, dy: 4 }];
        const teTargets = _routeTargetsFromPath(off.TE.pos, tePath, { name: 'TE' });
        s.play.teTargets = teTargets;
        _assignRoute(off.TE, tePath, { name: 'TE' });
    } else {
        s.play.teTargets = [];
    }

    // ---- RB ----
    if (off.RB && off.RB.pos) {
        const rbPath = (call.rbPath || call.rbCheckdown || [{ dx: 0, dy: 2 }]);
        const rbTargets = _routeTargetsFromPath(off.RB.pos, rbPath, { name: 'RB' });
        s.play.rbTargets = rbTargets;
        if (call.type === 'PASS') {
            _assignRoute(off.RB, rbPath, { name: 'RB', releaseDepthYards: 1.5, speed: 0.9 });
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
        off.__runHoleX = s.play.runHoleX;
        off.__runLaneY = s.play.runLaneY;
    } else {
        s.play.runHoleX = null;
        s.play.runLaneY = null;
        off.__runHoleX = null;
        off.__runLaneY = null;
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
    if (!p) return;
    if (!target || Number.isNaN(target.x) || Number.isNaN(target.y)) {
        dampMotion(p, dt);
        return;
    }
    steerPlayer(p, target, dt, { speedMultiplier: speedMul });
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

function _readOptionBreak(baseTarget, player, def, losY) {
    if (!baseTarget?.option) return baseTarget;
    const option = baseTarget.option;
    const clone = { ...baseTarget };
    const nearest = _nearestAssignmentDefender(def, player);
    if (!nearest) return clone;
    const defender = nearest.defender;
    if (!defender?.pos) return clone;

    const leverageInside = defender.pos.x < player.pos.x;
    const leverageOverTop = defender.pos.y < player.pos.y - PX_PER_YARD;
    if (option === 'in-or-out') {
        const breakOut = leverageInside || !leverageOverTop;
        clone.x = clamp(player.pos.x + (breakOut ? 12 : -12), 18, FIELD_PIX_W - 18);
        clone.y = Math.max(baseTarget.y, player.pos.y + PX_PER_YARD * 2);
    } else if (option === 'settle-hook') {
        if (nearest.dist > 18 && player.pos.y >= losY + PX_PER_YARD * 4) {
            clone.settle = true;
            clone.y = player.pos.y + PX_PER_YARD * 0.2;
        }
    }
    return clone;
}

function _routeScrambleTarget(player, aiRoute, context) {
    const qb = context.qb;
    const losY = context.losY;
    const scrambleDir = player.pos.x < qb.pos.x ? -1 : 1;
    const depth = Math.max(losY + PX_PER_YARD * 3, qb.pos.y + PX_PER_YARD * 4);
    const width = 42;
    const x = clamp(qb.pos.x + scrambleDir * width, 16, FIELD_PIX_W - 16);
    const y = Math.max(depth, player.pos.y - PX_PER_YARD * 0.5);
    return { x, y };
}

function _updateRouteRunner(player, context, dt) {
    const ai = _ensureAI(player);
    if (!ai || ai.type !== 'route' || !ai.route) return false;
    const { route } = ai;
    const def = context.def || {};
    const qb = context.qb;
    const losY = context.losY;

    // Already finished? work scramble drill
    if (route.finished) {
        if (!route.allowScrambleAdjust || !qb?.pos) return false;
        route.scrambleTimer += dt;
        const tgt = _routeScrambleTarget(player, route, context);
        const blend = _blendHeading(ai.prevHeading || { x: 0, y: 1 }, {
            x: tgt.x - player.pos.x,
            y: tgt.y - player.pos.y,
        }, 0.65);
        const look = 34;
        const stepTarget = {
            x: clamp(player.pos.x + blend.x * look, 16, FIELD_PIX_W - 16),
            y: player.pos.y + blend.y * look,
        };
        moveToward(player, stepTarget, dt, 0.95);
        ai.prevHeading = blend;
        return true;
    }

    const idx = Math.min(player.routeIdx || 0, route.targets.length - 1);
    const baseTarget = route.targets[idx];
    if (!baseTarget) { _markRouteFinished(player, route); return false; }

    const adjusted = _readOptionBreak(baseTarget, player, def, losY);
    let aim = { x: adjusted.x, y: adjusted.y };

    // Keep spacing away from sideline
    if (player.pos.x < 32) aim.x = Math.max(aim.x, 36);
    if (player.pos.x > FIELD_PIX_W - 32) aim.x = Math.min(aim.x, FIELD_PIX_W - 36);

    // Fight leverage with assigned defender
    const nearest = _nearestAssignmentDefender(def, player);
    if (nearest && nearest.dist < 30 && nearest.defender?.pos) {
        const shadeX = Math.sign(player.pos.x - nearest.defender.pos.x) || 0;
        const shadeY = Math.sign(player.pos.y - nearest.defender.pos.y) || 0;
        aim.x += shadeX * clamp(28 - nearest.dist, 0, 8);
        if (adjusted.depth < PX_PER_YARD * 6 && shadeY < 0) {
            // work vertical stem before break if DB squatting
            aim.y = Math.max(aim.y, player.pos.y + PX_PER_YARD * 1.6);
        }
    }

    // Smooth heading and lead a little
    const dx = aim.x - player.pos.x;
    const dy = aim.y - player.pos.y;
    const mag = Math.hypot(dx, dy) || 1;
    const want = { x: dx / mag, y: dy / mag };
    const heading = _blendHeading(ai.prevHeading || want, want, 0.78);
    ai.prevHeading = heading;

    const lookAhead = 30 + Math.min(65, adjusted.depth * 0.25);
    const stepTarget = {
        x: clamp(player.pos.x + heading.x * lookAhead, 16, FIELD_PIX_W - 16),
        y: player.pos.y + heading.y * lookAhead,
    };

    const speedMul = clamp((adjusted.speed || 1) * (route.throttle || 1), 0.6, 1.15);
    moveToward(player, stepTarget, dt, speedMul);

    const closeEnough = dist(player.pos, aim) < 6 + Math.min(8, Math.max(0, (nearest?.dist || 40) - 18) * 0.1);
    if (closeEnough) {
        player.routeIdx = Math.min((player.routeIdx || 0) + 1, route.targets.length);
        if (adjusted.settle) {
            route.settleHold += dt;
            if (route.settleHold > 0.35) {
                _markRouteFinished(player, route);
            }
        } else {
            route.settleHold = 0;
        }
        if (player.routeIdx >= route.targets.length) {
            _markRouteFinished(player, route);
        }
    } else if (adjusted.settle) {
        // Sit between zones by drifting from defenders
        route.settleHold += dt;
        const away = _nearestDefender(def, player.pos, 60);
        if (away?.p) {
            const sdx = player.pos.x - away.p.pos.x;
            const sdy = player.pos.y - away.p.pos.y;
            const sm = Math.hypot(sdx, sdy) || 1;
            player.pos.x += (sdx / sm) * dt * 20;
            player.pos.y += (sdy / sm) * dt * 12;
        }
        if (route.settleHold > 0.6) _markRouteFinished(player, route);
    } else {
        route.settleHold = 0;
    }

    return true;
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
                applyCollisionSlowdown(a, 0.4);
                applyCollisionSlowdown(b, 0.4);
            }
        }
    }
}

function _chooseRunBlockTarget(player, off, def, context) {
    const ai = _ensureAI(player);
    const { runHoleX, losY } = context;
    const rb = off.RB;
    const laneX = runHoleX ?? rb?.pos?.x ?? player.pos.x;
    let current = ai.blockTargetId ? Object.values(def).find(d => d && d.id === ai.blockTargetId) : null;
    if (current && (!current.pos || dist(current.pos, player.pos) > 120)) current = null;
    if (!current) {
        const ahead = Object.values(def || {}).filter(d => d?.pos && d.pos.y <= player.pos.y + PX_PER_YARD * 4);
        let best = null;
        ahead.forEach((d) => {
            const toLane = Math.abs((d.pos.x || laneX) - laneX);
            const downfield = Math.max(0, d.pos.y - losY);
            const score = downfield * 0.7 - toLane * 1.2 - dist(player.pos, d.pos) * 0.6;
            if (!best || score > best.score) best = { score, target: d };
        });
        if (best) current = best.target;
    }
    ai.blockTargetId = current?.id || null;
    return current;
}

function _runSupportReceiver(player, off, def, dt, context) {
    const target = _chooseRunBlockTarget(player, off, def, context);
    if (!target) {
        const seal = { x: context.runHoleX ?? player.pos.x, y: player.pos.y + PX_PER_YARD * 2.5 };
        moveToward(player, seal, dt, 0.92);
        return;
    }
    const leverage = Math.sign((context.runHoleX ?? player.pos.x) - target.pos.x) || (player.pos.x < target.pos.x ? -1 : 1);
    const fit = {
        x: clamp(target.pos.x + leverage * 8, 18, FIELD_PIX_W - 18),
        y: target.pos.y - PX_PER_YARD * 0.8,
    };
    moveToward(player, fit, dt, 0.96);
}

function _runSupportTightEnd(player, off, def, dt, context) {
    const ai = _ensureAI(player);
    const rightSide = player.pos.x > FIELD_PIX_W / 2;
    const edgeKeys = rightSide ? ['RE', 'LB2'] : ['LE', 'LB1'];
    let target = ai.blockTargetId ? Object.values(def).find(d => d && d.id === ai.blockTargetId) : null;
    if (!target || !target.pos) {
        for (const k of edgeKeys) {
            const d = def[k];
            if (d?.pos) { target = d; break; }
        }
        if (!target) {
            target = _nearestDefender(def, player.pos, 160)?.p || null;
        }
    }
    ai.blockTargetId = target?.id || null;
    if (!target?.pos) {
        moveToward(player, { x: context.runHoleX ?? player.pos.x, y: player.pos.y + PX_PER_YARD * 1.5 }, dt, 0.95);
        return;
    }
    const leverage = rightSide ? -1 : 1;
    const fit = {
        x: clamp(target.pos.x + leverage * 6, 16, FIELD_PIX_W - 16),
        y: target.pos.y - PX_PER_YARD * 0.6,
    };
    moveToward(player, fit, dt, 0.98);
}

function _updatePassBlocker(ol, key, context, dt) {
    const { qb, losY, assignments, def } = context;
    const homeX = ol.home?.x ?? ol.pos.x;
    const baseX = clamp(homeX, 20, FIELD_PIX_W - 20);
    const minX = baseX - CFG.GAP_GUARDRAIL_X;
    const maxX = baseX + CFG.GAP_GUARDRAIL_X;
    const passSetDepth = CFG.PASS_SET_DEPTH_YDS * PX_PER_YARD;
    const setY = Math.max(losY - passSetDepth, qb.pos.y - passSetDepth);

    // Assignment stickiness
    ol._stickTimer = (ol._stickTimer || 0) - dt;
    const desiredId = assignments[key] || null;
    let currentDef = ol._assignId ? Object.values(def).find(d => d && d.id === ol._assignId) : null;
    if (ol._assignId && ol._stickTimer > 0 && currentDef) {
        const far = dist(ol.pos, currentDef.pos) > 150;
        if (far) { currentDef = null; ol._assignId = null; }
    }
    if (!ol._assignId && desiredId) {
        ol._assignId = desiredId;
        ol._stickTimer = CFG.OL_STICK_TIME;
        currentDef = Object.values(def).find(d => d && d.id === desiredId) || null;
    }

    const roleBias = (key === 'LT' ? -8 : key === 'RT' ? 8 : key === 'LG' ? -3 : key === 'RG' ? 3 : 0);
    const baseSet = { x: clamp(baseX + roleBias, minX, maxX), y: setY };
    let target = baseSet;
    if (currentDef) {
        const vx = qb.pos.x - currentDef.pos.x;
        const vy = qb.pos.y - currentDef.pos.y || 1e-6;
        const t = (baseSet.y - currentDef.pos.y) / vy;
        let ix = currentDef.pos.x + vx * t;
        ix = clamp(ix, minX, maxX);
        const blend = clamp(1 - (dist(ol.pos, currentDef.pos) / 70), 0, 1) * CFG.OL_BLOCK_MIRROR;
        target = {
            x: clamp(ix * (1 - blend) + baseSet.x * blend, minX, maxX),
            y: baseSet.y,
        };
    }

    moveToward(ol, target, dt, CFG.OL_REACH_SPEED);

    if (currentDef) {
        const d = dist(ol.pos, currentDef.pos);
        if (d < CFG.OL_ENGAGE_R) {
            ol.engagedId = currentDef.id;
            currentDef.engagedId = ol.id;

            const toQBdx = qb.pos.x - currentDef.pos.x;
            const toQBdy = qb.pos.y - currentDef.pos.y || 1e-6;
            const mag = Math.hypot(toQBdx, toQBdy) || 1;
            const pushV = CFG.OL_BLOCK_PUSHBACK * dt;
            currentDef.pos.x -= (toQBdx / mag) * (pushV * 0.3);
            currentDef.pos.y -= (toQBdy / mag) * pushV;

            if (ol.pos.y < currentDef.pos.y - 4) ol.pos.y = currentDef.pos.y - 4;
        } else if (ol.engagedId === currentDef.id) {
            ol.engagedId = null;
            if (currentDef.engagedId === ol.id) currentDef.engagedId = null;
        }
    }

    if (ol.pos.x < minX) ol.pos.x = minX;
    if (ol.pos.x > maxX) ol.pos.x = maxX;
    if (ol.pos.y < setY - PX_PER_YARD * 0.5) ol.pos.y = setY - PX_PER_YARD * 0.5;
}

function _selectRunBlockTarget(ol, context) {
    const { def, runHoleX } = context;
    const ai = _ensureAI(ol);
    let target = ai.blockTargetId ? Object.values(def).find(d => d && d.id === ai.blockTargetId) : null;
    if (target && (!target.pos || dist(target.pos, ol.pos) > 150)) target = null;
    if (!target) {
        const primary = ['LE', 'DT', 'RTk', 'RE'];
        let best = null;
        primary.forEach((k) => {
            const d = def[k];
            if (!d?.pos) return;
            const laneBias = Math.abs((runHoleX ?? ol.pos.x) - d.pos.x);
            const score = -laneBias - dist(ol.pos, d.pos) * 0.4 + (d.pos.y - ol.pos.y) * 0.2;
            if (!best || score > best.score) best = { score, target: d };
        });
        if (!best) {
            Object.values(def || {}).forEach((d) => {
                if (!d?.pos) return;
                const score = -dist(ol.pos, d.pos);
                if (!best || score > best.score) best = { score, target: d };
            });
        }
        target = best?.target || null;
    }
    ai.blockTargetId = target?.id || null;
    return target;
}

function _updateRunBlocker(ol, key, context, dt) {
    const { runHoleX, runLaneY } = context;
    const target = _selectRunBlockTarget(ol, context);
    const laneX = runHoleX ?? ol.pos.x;
    const laneY = runLaneY ?? (ol.pos.y + PX_PER_YARD * 2);

    const baseFit = {
        x: clamp(laneX + (key === 'LT' || key === 'LG' ? -8 : key === 'RT' || key === 'RG' ? 8 : 0), 16, FIELD_PIX_W - 16),
        y: laneY,
    };

    if (!target?.pos) {
        moveToward(ol, baseFit, dt, 1.02);
        return;
    }

    const leverage = Math.sign((laneX) - target.pos.x) || (key === 'LT' || key === 'LG' ? 1 : -1);
    const fit = {
        x: clamp(target.pos.x + leverage * 6, 16, FIELD_PIX_W - 16),
        y: Math.min(target.pos.y + PX_PER_YARD * 0.6, laneY),
    };
    moveToward(ol, fit, dt, 1.08);

    const d = dist(ol.pos, target.pos);
    if (d < CFG.OL_ENGAGE_R + 2) {
        ol.engagedId = target.id;
        target.engagedId = ol.id;

        const drive = { x: -leverage * 0.6, y: 1 };
        const mag = Math.hypot(drive.x, drive.y) || 1;
        const pushV = CFG.OL_BLOCK_PUSHBACK * dt * 0.85;
        target.pos.x += (drive.x / mag) * pushV;
        target.pos.y += (drive.y / mag) * pushV;
        if (target.pos.y > laneY + PX_PER_YARD * 1.2) target.pos.y = laneY + PX_PER_YARD * 1.2;
    } else if (ol.engagedId === target.id) {
        ol.engagedId = null;
        if (target.engagedId === ol.id) target.engagedId = null;
    }

    // climb after a beat if defender displaced
    const ai = _ensureAI(ol);
    ai.comboTimer = (ai.comboTimer || 0) + dt;
    if (ai.comboTimer > 0.9 && dist(target.pos, { x: laneX, y: laneY }) > 18) {
        ai.blockTargetId = null;
        moveToward(ol, { x: laneX, y: laneY + PX_PER_YARD * 1.2 }, dt, 1.02);
    }
}

export function moveOL(off, def, dt) {
    const olKeys = _olKeys(off);
    const dlKeys = _dlKeys(def);
    if (!olKeys.length) return;

    const qb = off.QB;
    const losY = off.__losPixY ?? (qb?.pos?.y ?? yardsToPixY(25)) - PX_PER_YARD;
    const assignments = pickAssignments(off, def);
    const context = {
        qb,
        losY,
        def,
        assignments,
        runHoleX: off.__runHoleX,
        runLaneY: off.__runLaneY,
    };

    const isRun = !!off.__runFlag;

    for (const key of olKeys) {
        const ol = off[key];
        if (!ol) continue;
        if (isRun) {
            _updateRunBlocker(ol, key, context, dt);
        } else {
            _updatePassBlocker(ol, key, context, dt);
        }
    }

    repelTeammates(olKeys.map(k => off[k]).filter(Boolean), CFG.OL_SEPARATION_R, CFG.OL_SEPARATION_PUSH);
    repelTeammates(dlKeys.map(k => def[k]).filter(Boolean), CFG.DL_SEPARATION_R, CFG.DL_SEPARATION_PUSH);
}

/* =========================================================
   Receivers
   ========================================================= */
export function moveReceivers(off, dt, s = null) {
    const qb = off.QB;
    const def = s?.play?.formation?.def || null;
    const ball = s?.play?.ball || null;
    const losY = off.__losPixY ?? (qb?.pos?.y ?? yardsToPixY(25)) - PX_PER_YARD;
    const context = {
        qb,
        def,
        losY,
        runHoleX: s?.play?.runHoleX ?? null,
        scrambleMode: s?.play?.qbMoveMode,
        off,
        play: s?.play,
    };

    ['WR1', 'WR2', 'WR3'].forEach((key) => {
        const p = off[key];
        if (!p || !p.alive) return;

        // If this WR currently has the ball, switch to RAC logic
        if (s && _isCarrier(off, ball, p)) { _racAdvance(off, def, p, dt); return; }

        if (off.__carrierWrapped === key) return;

        if (off.__runFlag) {
            _runSupportReceiver(p, off, def || {}, dt, context);
            return;
        }

        const followedRoute = _updateRouteRunner(p, context, dt);
        if (followedRoute) return;

        // scramble drill fallback if QB extends play
        const ai = _ensureAI(p);
        ai._scrClock = (ai._scrClock || 0) + dt;
        const retarget = !ai._scrTarget || ai._scrClock > (ai._scrUntil || 0);
        if (retarget) {
            const deepY = Math.max(losY + PX_PER_YARD * 3, qb?.pos?.y ?? p.pos.y) + PX_PER_YARD * 2;
            const laneX = clamp((qb?.pos?.x ?? p.pos.x) + rand(-80, 80), 24, FIELD_PIX_W - 24);
            ai._scrTarget = { x: laneX, y: deepY };
            ai._scrUntil = ai._scrClock + rand(0.5, 0.9);
        }
        const target = ai._scrTarget || { x: p.pos.x, y: p.pos.y + PX_PER_YARD * 2 };
        moveToward(p, target, dt, 0.96);
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

    const qb = off.QB;
    const losY = off.__losPixY ?? (qb?.pos?.y ?? yardsToPixY(25)) - PX_PER_YARD;
    const context = {
        qb,
        def,
        losY,
        runHoleX: s?.play?.runHoleX ?? null,
        scrambleMode: s?.play?.qbMoveMode,
        off,
        play: s?.play,
    };

    if (off.__runFlag) {
        _runSupportTightEnd(p, off, def || {}, dt, context);
        return;
    }

    const followedRoute = _updateRouteRunner(p, context, dt);
    if (followedRoute) return;

    const ai = _ensureAI(p);
    ai._scrClock = (ai._scrClock || 0) + dt;
    if (!ai._scrTarget || ai._scrClock > (ai._scrUntil || 0)) {
        const settleY = Math.max(losY + PX_PER_YARD * 2, qb?.pos?.y ?? p.pos.y) + PX_PER_YARD * 1.5;
        const settleX = clamp((qb?.pos?.x ?? p.pos.x) + rand(-28, 28), 24, FIELD_PIX_W - 24);
        ai._scrTarget = { x: settleX, y: settleY };
        ai._scrUntil = ai._scrClock + rand(0.45, 0.8);
    }
    moveToward(p, ai._scrTarget, dt, 0.94);
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

    // One-time setup for read cadence / progression
    if (!Array.isArray(s.play.qbProgressionOrder)) {
        s.play.qbProgressionOrder = [..._progressionOrder(call), 'RB'];
        s.play.qbReadIdx = 0;
        s.play.qbNextReadAt = 0;
        s.play.qbReadyAt = null;
        s.play.qbDropArrivedAt = null;
        s.play.qbSettlePoint = null;
    }

    // Debug hook: forced scramble
    if (s.debug?.forceNextOutcome === 'SCRAMBLE' && !s.play.__forcedScrambleArmed) {
        s.play.__forcedScrambleArmed = true;
        s.play.qbMoveMode = 'SCRAMBLE';
        s.play.scrambleMode = Math.random() < 0.7 ? 'LATERAL' : 'FORWARD';
        s.play.scrambleDir = Math.random() < 0.5 ? -1 : 1;
        s.play.scrambleUntil = time + rand(0.45, 0.9);
    }

    const ttt = s.play.qbTTT || 1.6;
    const dropArrived = dist(qb.pos, dropTarget) < 4 || qb.routeIdx >= (qb.targets?.length || 0);
    if (s.play.qbMoveMode === 'DROP' && dropArrived) {
        s.play.qbMoveMode = 'SET';
        s.play.qbDropArrivedAt = s.play.qbDropArrivedAt ?? time;
        s.play.qbReadyAt = Math.max(time + 0.16, Math.min(ttt - 0.05, 1.25));
        s.play.qbSettlePoint = {
            x: dropTarget.x,
            y: Math.min(dropTarget.y + PX_PER_YARD * 0.6, qb.pos.y + PX_PER_YARD * 0.4),
        };
    }

    const pressureToSet = underImmediatePressure && s.play.qbMoveMode === 'DROP' && time > ttt * 0.35;
    if (pressureToSet) {
        s.play.qbMoveMode = 'SET';
        s.play.qbReadyAt = s.play.qbReadyAt || Math.max(time + 0.12, Math.min(ttt - 0.05, 1.2));
        s.play.qbSettlePoint = {
            x: dropTarget.x,
            y: Math.min(dropTarget.y + PX_PER_YARD * 0.5, qb.pos.y + PX_PER_YARD * 0.3),
        };
    }

    const minY =
        s.play.qbDropTarget
            ? Math.min(s.play.qbDropTarget.y - PX_PER_YARD, s.play.qbDropTarget.y)
            : qb.pos.y;

    const shouldScramble = () => {
        if (s.play.qbMoveMode === 'SCRAMBLE') return false;
        if (underImmediatePressure && time > (s.play.qbReadyAt ?? (ttt - 0.1))) return true;
        if (underHeat && time > (ttt + 0.65)) return true;
        if (time > (s.play.qbMaxHold || (ttt + 1.2))) return true;
        return false;
    };

    if (shouldScramble()) {
        s.play.qbMoveMode = 'SCRAMBLE';
        s.play.scrambleMode = Math.random() < 0.7 ? 'LATERAL' : 'FORWARD';
        s.play.scrambleDir = lateralBias;
        s.play.scrambleUntil = time + rand(0.45, 0.9);
    }

    // Move QB
    if (s.play.qbMoveMode === 'DROP') {
        const t =
            Array.isArray(qb.targets) && qb.targets.length > 0
                ? qb.targets[Math.max(0, Math.min(qb.routeIdx, qb.targets.length - 1))]
                : dropTarget;
        moveToward(qb, { x: t.x, y: Math.max(t.y, minY) }, dt, 0.9);
        if (t && dist(qb.pos, t) < 4 && Array.isArray(qb.targets)) {
            qb.routeIdx = Math.min(qb.routeIdx + 1, qb.targets.length);
        }
    } else if (s.play.qbMoveMode === 'SET') {
        const settle = s.play.qbSettlePoint || dropTarget;
        const heatSlide = underHeat && nearestDL.t ? clamp((nearestDL.t.pos.x - settle.x) * 0.25, -12, 12) : 0;
        const stepUp = underHeat ? PX_PER_YARD * 0.35 : PX_PER_YARD * 0.15;
        const aim = {
            x: clamp(settle.x - heatSlide, 20, FIELD_PIX_W - 20),
            y: Math.min(settle.y + stepUp, qb.pos.y + PX_PER_YARD * 0.6),
        };
        moveToward(qb, aim, dt, 0.82);
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
    tryThrow(s, { underHeat, underImmediatePressure, lateralBias });
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

function _progressionOrder(call) {
    const order = [];
    if (call.primary) order.push(call.primary);
    if (call.secondary && !order.includes(call.secondary)) order.push(call.secondary);
    ['WR1', 'WR2', 'WR3', 'TE'].forEach((key) => {
        if (!order.includes(key)) order.push(key);
    });
    return order;
}

function _evaluateReceivingTarget(s, key, r, qb, def, losY, call) {
    const coverage = s.play.coverage || { assigned: {} };
    const ai = _ensureAI(r);
    const route = ai?.route;
    const routeProgress = route && route.targets?.length ? ((r.routeIdx || 0) / route.targets.length) : 1;
    const stage = route?.finished ? 1.1 : routeProgress;
    const nearest = _nearestAssignmentDefender(def, r);
    const separation = nearest ? nearest.dist : 60;
    const throwLine = dist(qb.pos, r.pos);
    const depthPastLOS = Math.max(0, r.pos.y - losY);
    const leverageBonus = nearest?.defender?.pos ? clamp((r.pos.y - nearest.defender.pos.y) / PX_PER_YARD, -4, 6) : 0;
    const progression = _progressionOrder(call);
    const progressionIdx = progression.indexOf(key);
    const progressionBonus = progressionIdx >= 0 ? (progression.length - progressionIdx) * 1.8 : 0;
    const scrambleBonus = s.play.qbMoveMode === 'SCRAMBLE' ? 4 : 0;
    const timingBonus = stage > 0.65 ? stage * 6 : stage * 2 - 3;
    const coverageHelp = coverage.assigned && Object.values(coverage.assigned).some(v => v === key) ? 1 : 0;
    const score = separation * 1.25 + depthPastLOS * 0.14 - throwLine * 0.09 + timingBonus + progressionBonus + leverageBonus + scrambleBonus - coverageHelp * 2;
    return {
        key,
        r,
        score,
        separation,
        throwLine,
        depthPastLOS,
        stage,
        routeFinished: route?.finished || false,
    };
}

function tryThrow(s, press) {
    const off = s.play?.formation?.off || {};
    const def = s.play?.formation?.def || {};
    const qb = off.QB;
    const call = s.play?.playCall || {};
    if (!qb || !qb.pos) return;
    const tNow = s.play.elapsed, ttt = s.play.qbTTT || 2.5, maxHold = s.play.qbMaxHold || 4.8;
    const minThrowGate = Math.min(ttt - 0.15, 1.35);
    const readyAt = s.play.qbReadyAt != null ? Math.max(minThrowGate * 0.85, s.play.qbReadyAt) : minThrowGate;
    if (tNow < readyAt) return;
    const checkdownGate = press.underImmediatePressure || s.play.qbMoveMode === 'SCRAMBLE' || (tNow >= ttt + CFG.CHECKDOWN_LAG);
    const losY = off.__losPixY ?? (qb.pos.y - PX_PER_YARD);

    const progression = Array.isArray(s.play.qbProgressionOrder)
        ? s.play.qbProgressionOrder
        : [..._progressionOrder(call), 'RB'];
    if (!Array.isArray(s.play.qbProgressionOrder)) {
        s.play.qbProgressionOrder = progression;
    }
    if (typeof s.play.qbReadIdx !== 'number') {
        s.play.qbReadIdx = 0;
    }

    const wrteKeys = ['WR1', 'WR2', 'WR3', 'TE'];
    const candidates = [];
    for (const key of wrteKeys) {
        const r = off[key];
        if (!r || !r.alive || r.pos.y < losY) continue;
        candidates.push(_evaluateReceivingTarget(s, key, r, qb, def, losY, call));
    }
    candidates.sort((a, b) => b.score - a.score);
    const bestWRTE = candidates[0] || null;
    const wrDepthNeed = CFG.WR_MIN_DEPTH_YARDS * PX_PER_YARD;

    const wrAccept = bestWRTE && (
        bestWRTE.separation >= CFG.WR_MIN_OPEN ||
        bestWRTE.depthPastLOS >= wrDepthNeed ||
        (tNow >= ttt && press.underHeat && bestWRTE.separation >= CFG.WR_MIN_OPEN * 0.75)
    );
    const targetChoice = wrAccept ? bestWRTE : null;
    let rbCand = null;
    const rbIndex = Math.max(progression.indexOf('RB'), progression.length - 1);
    if (!targetChoice && checkdownGate && s.play.qbReadIdx > rbIndex) {
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

    if (targetChoice) {
        const to = _leadTo(targetChoice.r);
        if (isThrowLaneClear(def, { x: qb.pos.x, y: qb.pos.y }, to, 18)) {
            const from = { x: qb.pos.x, y: qb.pos.y - 2 };
            const safeTo = { x: to.x, y: Math.max(to.y, qb.pos.y - PX_PER_YARD * 0.25) };
            startPass(s, from, { x: safeTo.x, y: safeTo.y }, bestWRTE.r.id);
            s.play.passRisky = bestWRTE.separation < 22;
            return;
        }
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
    }

    if (mustThrow) {
        if (targetChoice) {
            const to = _leadTo(targetChoice.r);
            if (isThrowLaneClear(def, { x: qb.pos.x, y: qb.pos.y }, to, 18)) {
                const from = { x: qb.pos.x, y: qb.pos.y - 2 };
                const safeTo = { x: to.x, y: Math.max(to.y, qb.pos.y - PX_PER_YARD * 0.25) };
                startPass(s, from, { x: safeTo.x, y: safeTo.y }, bestWRTE.r.id);
                s.play.passRisky = bestWRTE.separation < 22;
                return;
            }
        }

        const underDuress = press.underImmediatePressure || press.underHeat;
        if (!underDuress && s.play.qbMoveMode !== 'SCRAMBLE') {
            s.play.qbMoveMode = 'SCRAMBLE';
            s.play.scrambleMode = Math.random() < 0.6 ? 'FORWARD' : 'LATERAL';
            const dir = press.lateralBias || (Math.random() < 0.5 ? -1 : 1);
            s.play.scrambleDir = dir;
            s.play.scrambleUntil = tNow + rand(0.45, 0.9);
            s.play.qbMaxHold = Math.max(maxHold + 0.35, tNow + 0.6);
            return;
        }

        const sidelineX = qb.pos.x < FIELD_PIX_W / 2 ? 8 : FIELD_PIX_W - 8;
        const outY = Math.max(qb.pos.y + PX_PER_YARD * 2, losY + PX_PER_YARD);
        startPass(s, { x: qb.pos.x, y: qb.pos.y - 2 }, { x: sidelineX, y: outY }, null);
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
function _rbPassProtect(rb, off, def, dt, context) {
    const qb = context.qb;
    const ai = _ensureAI(rb);
    ai.passClock = (ai.passClock || 0) + dt;
    const rushers = ['LE', 'RE', 'DT', 'RTk', 'LB1', 'LB2', 'NB'].map(k => def[k]).filter(Boolean);
    let target = ai.blockTargetId ? rushers.find(r => r.id === ai.blockTargetId) : null;
    const losY = context.losY;

    const findThreat = () => {
        let best = null;
        rushers.forEach((r) => {
            if (!r.pos) return;
            if (r.pos.y > qb.pos.y + PX_PER_YARD * 2) return;
            const towardQB = dist(r.pos, qb.pos);
            const towardRB = dist(r.pos, rb.pos);
            const engaged = !!r.engagedId;
            const score = -towardQB * 0.7 - towardRB * 0.4 + (engaged ? -12 : 0);
            if (!best || score > best.score) best = { score, target: r };
        });
        return best?.target || null;
    };

    if (!target || !target.pos || dist(target.pos, rb.pos) > 120) {
        target = findThreat();
        ai.blockTargetId = target?.id || null;
    }

    if (target) {
        const meet = {
            x: clamp(target.pos.x + (qb.pos.x - target.pos.x) * 0.3, 20, FIELD_PIX_W - 20),
            y: Math.min(qb.pos.y - PX_PER_YARD * 0.6, losY + PX_PER_YARD * 0.5),
        };
        moveToward(rb, meet, dt, 1.05);
        const d = dist(rb.pos, target.pos);
        if (d < CFG.OL_ENGAGE_R) {
            rb.engagedId = target.id;
            target.engagedId = rb.id;
            const push = CFG.OL_BLOCK_PUSHBACK * dt * 0.8;
            const dir = {
                x: qb.pos.x - target.pos.x,
                y: (qb.pos.y - PX_PER_YARD) - target.pos.y,
            };
            const mag = Math.hypot(dir.x, dir.y) || 1;
            target.pos.x -= (dir.x / mag) * push * 0.4;
            target.pos.y -= (dir.y / mag) * push;
        }
        ai.passClock = Math.min(ai.passClock, 0.6);
        return true;
    }

    if (ai.passClock < 0.45) {
        const settle = { x: rb.pos.x, y: Math.min(rb.pos.y, losY + PX_PER_YARD * 0.6) };
        moveToward(rb, settle, dt, 0.9);
        return true;
    }
    ai.blockTargetId = null;
    return false;
}

export function rbLogic(s, dt) {
    const off = s.play.formation.off, call = s.play.playCall, rb = off.RB;
    const def = s.play.formation.def;
    if (!rb || !rb.alive) return;

    // If RB has the ball (after catch or handoff), use RAC logic
    if (_isCarrier(off, s.play.ball, rb)) { _racAdvance(off, def, rb, dt); return; }

    const qb = off.QB;
    const losY = off.__losPixY ?? (qb?.pos?.y ?? yardsToPixY(25)) - PX_PER_YARD;
    const context = {
        qb,
        def,
        losY,
        runHoleX: off.__runHoleX,
        runLaneY: off.__runLaneY,
    };

    if (call.type === 'RUN') {
        const ai = _ensureAI(rb);
        ai.patience = ai.patience ?? rand(0.18, 0.32);
        ai.patienceClock = (ai.patienceClock || 0) + dt;
        const patiencePhase = ai.patienceClock < ai.patience;

        const lane = _computeLaneForRB(off, def, rb, losY);
        const laneX = clamp(_lerp(rb.pos.x, lane.x, patiencePhase ? 0.45 : 0.8), 18, FIELD_PIX_W - 18);
        const laneY = Math.max(off.__runLaneY ?? (rb.pos.y + PX_PER_YARD * 2.5), losY + PX_PER_YARD * 2.2);
        const depthTarget = { x: laneX, y: laneY };

        if (patiencePhase) {
            const settle = { x: laneX, y: Math.min(rb.pos.y + PX_PER_YARD, losY + PX_PER_YARD * 0.8) };
            moveToward(rb, settle, dt, 0.8);
        } else {
            moveToward(rb, depthTarget, dt, 1.18);
        }

        if (s.play.rbTargets && s.play.rbTargets.length > 1 && ai.patienceClock < ai.patience + 0.35) {
            const next = s.play.rbTargets[Math.min(1, s.play.rbTargets.length - 1)];
            moveToward(rb, next, dt, 1.05);
        }
        return;
    }

    const protect = _rbPassProtect(rb, off, def, dt, context);
    if (protect) return;

    if (rb.targets && rb.routeIdx != null) {
        const routeContext = { ...context, qb, def, losY };
        const followed = _updateRouteRunner(rb, routeContext, dt);
        if (followed) return;
    }

    const check = {
        x: clamp(qb.pos.x + rand(-28, 28), 24, FIELD_PIX_W - 24),
        y: qb.pos.y + PX_PER_YARD * 2.4,
    };
    moveToward(rb, check, dt, 0.92);
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
