// src/engine/ai.js
import { clamp, dist, rand, yardsToPixY } from './helpers';
import { FIELD_PIX_W, PX_PER_YARD } from './constants';
import { steerPlayer, dampMotion, applyCollisionSlowdown } from './motion';
import { getPlayerMass, getPlayerRadius } from './physics';
import { startPass, startPitch } from './ball';

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
    if (!firstBand.length) return { x: rb.pos.x, score: 0 };
    const vision = clamp((rb?.modifiers?.vision ?? 0.5) - 0.5, -0.4, 0.4);
    if (vision <= 0) {
        const conservative = firstBand.reduce((best, lane) => {
            const distPenalty = Math.abs(lane.x - rb.pos.x) * (0.4 + (-vision) * 0.6);
            const score = lane.score - distPenalty;
            return (!best || score > best.score) ? { score, lane } : best;
        }, null);
        return conservative?.lane || firstBand[0];
    }
    const aggressive = firstBand.reduce((best, lane) => {
        const score = lane.score + vision * 6 - Math.abs(lane.x - rb.pos.x) * 0.1;
        return (!best || score > best.score) ? { score, lane } : best;
    }, null);
    return aggressive?.lane || firstBand[0];
}

/* =========================================================
   Tunables
   ========================================================= */
// ---- Tunables (defense strengthened) ----
const CFG = {
    // ---- QB reads (unchanged except slightly tighter WR windows) ----
    // ---- QB reads ----
    CHECKDOWN_LAG: 0.85,
    PRIMARY_MAX_BONUS: 18,
    PRIMARY_DECAY_AFTER: 0.4,
    WR_MIN_OPEN: 16,
    WR_MIN_DEPTH_YARDS: 3.0,
    RB_EARLY_PENALTY: 12,
    RB_MIN_OPEN: 14,
    RB_MAX_THROWLINE: 230,


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
    // CONTACT_R defines how close a defender needs to be to initiate a wrap/tackle.
    // Player physics prevents bodies from overlapping closer than roughly the sum
    // of their radii (~16-18px for two average players). With the previous 11px
    // threshold, defenders were never considered "in contact", so wraps and
    // tackles could not start. Bump the radius above the physical separation
    // limit so legitimate collisions trigger tackles again.
    CONTACT_R: 18,
    TACKLER_COOLDOWN: 0.9,
    GLOBAL_IMMUNITY: 0.45,
    MIN_DIST_AFTER_BREAK: 8,
    WRAP_HOLD_MIN: 0.45,
    WRAP_HOLD_MAX: 0.75,

    // ---- Run-after-catch (tone down open-field burst a touch) ----
    RAC_TURN_SMOOTH: 0.86,
    RAC_LOOKAHEAD: 96,
    RAC_AVOID_R: 20,
    RAC_SIDESTEP: 8,
    RAC_SPEED: 0.9,

    // ---- Coverage & pursuit (new) ----
    COVER_CUSHION_YDS: 2.8,     // desired vertical cushion in man
    COVER_SWITCH_DIST: 26,      // when crossers get closer to another DB, switch
    PURSUIT_LEAD_T: 0.28,       // seconds to lead the carrier
    PURSUIT_SPEED: 1.12,        // defenders run a bit hotter in pursuit
    PURSUIT_TRIGGER_R: 180,     // defenders rally when carrier within this radius
    PURSUIT_RECENT_TIME: 1.0,   // after a catch/possession change, rally quickly
};

const SHOTGUN_HINTS = ['gun', 'shotgun', 'empty'];

function guessShotgun(call = {}, formationName = '') {
    if (call.shotgun != null) return !!call.shotgun;
    const haystack = `${call.name || ''} ${formationName || ''}`.toLowerCase();
    return SHOTGUN_HINTS.some((hint) => haystack.includes(hint));
}

function resolveDropDepth(call = {}, formationName = '') {
    const shotgun = guessShotgun(call, formationName);
    if (call.type === 'RUN') {
        const base = call.qbDrop ?? (shotgun ? 1.2 : 0.9);
        return clamp(base, 0.4, shotgun ? 2.6 : 1.8);
    }
    const quick = !!call.quickGame;
    const playAction = !!call.playAction;
    const defaultDepth = quick ? 3.6 : playAction ? 7.2 : 5.6;
    const base = call.qbDrop != null ? call.qbDrop : defaultDepth;
    if (shotgun) return clamp(base, 4.6, 7.6);
    return clamp(base, quick ? 3.4 : 5.0, 7.4);
}


/* =========================================================
   Route and Play Initialization
   ========================================================= */
// SAFER: handles missing WR/TE/RB so we don't read .pos of undefined
// SAFER init + seed coverage
export function initRoutesAfterSnap(s) {
    const off = (s.play && s.play.formation && s.play.formation.off) || {};
    const call = (s.play && s.play.playCall) || {};

    s.play.defFormation = s.play.formation?.defFormation || s.play.defFormation || '';

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
        const handoffStyle = (call.handoffStyle || 'HANDOFF').toUpperCase();
        const handoffDelay = call.handoffDelay ?? (handoffStyle === 'PITCH' ? 0.45 : 0.6);
        const handoffWindow = call.handoffWindow ?? (handoffStyle === 'PITCH' ? 0.35 : 0.5);
        s.play.handoffStyle = handoffStyle;
        s.play.handoffReadyAt = s.play.elapsed + handoffDelay;
        s.play.handoffDeadline = s.play.elapsed + handoffDelay + handoffWindow;
        s.play.handoffPending = null;
        s.play.pitchTarget = call.pitchTarget || null;
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
        s.play.handoffStyle = null;
        s.play.handoffReadyAt = null;
        s.play.handoffDeadline = null;
        s.play.handoffPending = null;
        s.play.pitchTarget = null;
    }

    // ---- QB timings ----
    const qb = off.QB;
    const qbIQ = clamp(qb?.attrs?.awareness ?? 0.9, 0.4, 1.3);
    const quick = !!call.quickGame;
    const baseTTT = quick ? rand(1.0, 1.7) : rand(1.6, 3.0);
    const iqAdj = clamp((1.0 - qbIQ) * 0.4 - (qbIQ - 1.0) * 0.2, -0.3, 0.3);
    const qbMods = qb?.modifiers || {};
    const release = clamp((qbMods.releaseQuickness ?? 0.5), 0, 1);
    const poise = clamp((qbMods.pocketPoise ?? 0.5), 0, 1);
    const releaseAdj = (0.5 - release) * 0.6;
    const poiseAdj = (poise - 0.5) * 0.8;
    s.play.qbTTT = clamp(baseTTT + iqAdj + releaseAdj + poiseAdj, 0.8, 3.4);
    const holdBonus = (poise - 0.5) * 1.2;
    s.play.qbMaxHold = s.play.qbTTT + rand(1.2, 1.9) + holdBonus;
    const qbPos = qb?.pos || { x: FIELD_PIX_W / 2, y: yardsToPixY(25) };
    const dropDepth = resolveDropDepth(call, s.play.offFormation || '');
    s.play.qbPreferredDrop = dropDepth;
    s.play.qbDropTarget = { x: qbPos.x, y: qbPos.y - dropDepth * PX_PER_YARD };

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
            if (!(d > 0 && d < R)) continue;

            const nx = dx / d;
            const ny = dy / d;
            const radiusA = getPlayerRadius(a);
            const radiusB = getPlayerRadius(b);
            const separation = Math.max((radiusA + radiusB) * 0.5, R);
            const k = ((separation - d) / separation) * push;
            const massA = getPlayerMass(a);
            const massB = getPlayerMass(b);
            const totalMass = Math.max(massA + massB, 1e-3);
            const shareA = massB / totalMass;
            const shareB = massA / totalMass;

            a.pos.x -= nx * k * shareA;
            a.pos.y -= ny * k * shareA;
            b.pos.x += nx * k * shareB;
            b.pos.y += ny * k * shareB;
            applyCollisionSlowdown(a, 0.28 + shareA * 0.22);
            applyCollisionSlowdown(b, 0.28 + shareB * 0.22);
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
    const qbMods = qb?.modifiers || {};
    const scrambleAggro = clamp(qbMods.scrambleAggression ?? 0.26, 0, 1);
    const handoffRole = typeof call.handoffTo === 'string' ? call.handoffTo : 'RB';
    const handoffRunner = (handoffRole && off[handoffRole]) || off.RB;

    // If we don't have a QB or a position yet, bail safely.
    if (!qb || !qb.pos) return;

    // Only run QB logic if the ball is with the QB (role string or id match).
    const carrierId = s.play?.ball?.carrierId;
    const qbHasBall = carrierId === 'QB' || carrierId === qb.id;
    if (!qbHasBall) {
        if (carrierId && carrierId !== qb.id && carrierId !== 'QB') {
            s.play.qbVision = null;
        }
        return;
    }

    if (call.type !== 'PASS') {
        s.play.qbVision = null;
    }

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
    const preferredDrop = s.play.qbPreferredDrop ?? resolveDropDepth(call, s.play.offFormation || '');
    const dropTarget = s.play?.qbDropTarget || {
        x: qb.pos.x,
        y: qb.pos.y - preferredDrop * PX_PER_YARD,
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
        const qbAwareness = clamp(qb?.attrs?.awareness ?? 0.9, 0.4, 1.3);
        const quickConcept = !!call.quickGame;
        const baseCadence = quickConcept ? 0.24 : 0.32;
        const iqCadenceAdj = clamp((1 - qbAwareness) * 0.14 - (qbAwareness - 1) * 0.08, -0.1, 0.14);
        const cadenceJitter = rand(-0.045, 0.06);
        const qbReadCadence = clamp(baseCadence + iqCadenceAdj + cadenceJitter, 0.2, 0.45);

        s.play.qbProgressionOrder = [..._progressionOrder(call), 'RB'];
        s.play.qbReadIdx = 0;
        s.play.qbReadCadence = qbReadCadence;
        s.play.qbNextReadAt = qbReadCadence;
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
        s.play.qbReadyAt = Math.max(time + 0.22, Math.min(ttt + 0.12, 1.55));
        s.play.qbSettlePoint = {
            x: dropTarget.x,
            y: Math.min(dropTarget.y + PX_PER_YARD * 0.6, qb.pos.y + PX_PER_YARD * 0.4),
        };
    }

    const pressureToSet = underImmediatePressure && s.play.qbMoveMode === 'DROP' && time > ttt * 0.35;
    if (pressureToSet) {
        s.play.qbMoveMode = 'SET';
        s.play.qbReadyAt = s.play.qbReadyAt || Math.max(time + 0.18, Math.min(ttt + 0.1, 1.45));
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
        const scrambleGate = clamp(scrambleAggro + (underImmediatePressure ? 0.25 : 0) + (underHeat ? 0.12 : 0), 0.08, 0.9);
        if (Math.random() < scrambleGate) {
            s.play.qbMoveMode = 'SCRAMBLE';
            s.play.scrambleMode = Math.random() < 0.7 ? 'LATERAL' : 'FORWARD';
            s.play.scrambleDir = lateralBias;
            s.play.scrambleUntil = time + rand(0.45, 0.9);
            const lookX = clamp(qb.pos.x + (s.play.scrambleDir || lateralBias || 1) * 36, 12, FIELD_PIX_W - 12);
            const lookY = qb.pos.y + PX_PER_YARD * 2.2;
            s.play.qbVision = {
                lookAt: { x: lookX, y: lookY },
                intent: 'SCRAMBLE',
                targetRole: null,
                targetId: null,
                updatedAt: time,
            };
        } else {
            s.play.qbMoveMode = 'SET';
            s.play.qbReadyAt = Math.min(s.play.qbReadyAt ?? (time + 0.2), time + 0.35);
            s.play.qbVision = {
                lookAt: { x: qb.pos.x, y: qb.pos.y + PX_PER_YARD * 5 },
                intent: 'HOLD',
                targetRole: null,
                targetId: null,
                updatedAt: time,
            };
        }
    }

    // Move QB
    const inHandoffPhase = call.type === 'RUN' && !s.play.handed && handoffRunner?.pos;

    if (inHandoffPhase) {
        const firstTarget = Array.isArray(s.play.rbTargets) ? s.play.rbTargets[0] : null;
        const meshX = clamp(firstTarget?.x ?? handoffRunner.pos.x, 20, FIELD_PIX_W - 20);
        const meshY = Math.min(handoffRunner.pos.y - PX_PER_YARD * 0.2, qb.pos.y + PX_PER_YARD * 0.7);
        const meshPoint = {
            x: clamp((handoffRunner.pos.x * 2 + meshX) / 3, 20, FIELD_PIX_W - 20),
            y: meshY,
        };
        moveToward(qb, meshPoint, dt, 0.92);
    } else if (s.play.qbMoveMode === 'DROP') {
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

    if (call.type === 'RUN') {
        const runner = handoffRunner;
        if (!runner || !runner.pos) return;

        const style = (s.play.handoffStyle || call.handoffStyle || 'HANDOFF').toUpperCase();
        const isPitch = style === 'PITCH';
        if (!s.play.handoffStyle) s.play.handoffStyle = style;

        const readyAt = s.play.handoffReadyAt ?? (s.play.elapsed + (call.handoffDelay ?? (isPitch ? 0.45 : 0.6)));
        if (s.play.handoffReadyAt == null) s.play.handoffReadyAt = readyAt;
        const window = call.handoffWindow ?? (isPitch ? 0.35 : 0.5);
        const deadline = s.play.handoffDeadline ?? (readyAt + window);
        if (s.play.handoffDeadline == null) s.play.handoffDeadline = deadline;

        const exchangeRadius = PX_PER_YARD * (isPitch ? 1.8 : 1.45);
        const meshDist = dist(qb.pos, runner.pos);
        const closenessFactor = isPitch ? 1.12 : 0.95;
        const atMeshPoint = dropArrived || meshDist <= exchangeRadius * closenessFactor;
        const meshReady = s.play.elapsed >= readyAt;
        const forced = s.play.elapsed >= deadline;

        if (!s.play.handed && (meshReady && atMeshPoint || (forced && meshDist <= exchangeRadius * 1.35))) {
            const carrierKey = runner.id || handoffRole || 'RB';
            if (isPitch) {
                const pitchOffset = s.play.pitchTarget || {};
                const pitchX = clamp(
                    (typeof pitchOffset.dx === 'number' ? runner.pos.x + pitchOffset.dx * PX_PER_YARD : runner.pos.x),
                    18,
                    FIELD_PIX_W - 18,
                );
                const desiredY = typeof pitchOffset.dy === 'number'
                    ? runner.pos.y + pitchOffset.dy * PX_PER_YARD
                    : runner.pos.y;
                const pitchY = Math.min(desiredY, Math.min(runner.pos.y + PX_PER_YARD * 0.6, qb.pos.y + PX_PER_YARD * 0.6));
                const pitchTarget = { x: pitchX, y: pitchY };
                startPitch(s, { x: qb.pos.x, y: qb.pos.y }, pitchTarget, carrierKey);
                s.play.handed = true;
                s.play.handoffPending = { type: 'PITCH', targetId: carrierKey };
                s.play.qbMoveMode = 'SET';
                if (Array.isArray(s.play.rbTargets) && s.play.rbTargets.length) {
                    runner.targets = s.play.rbTargets;
                    runner.routeIdx = 0;
                }
            } else {
                s.play.ball.inAir = false;
                s.play.ball.targetId = null;
                s.play.ball.flight = null;
                s.play.ball.carrierId = carrierKey;
                s.play.ball.lastCarrierId = carrierKey;
                s.play.handed = true;
                s.play.handoffTime = s.play.elapsed;
                s.play.handoffPending = null;
                s.play.qbMoveMode = 'SET';
                if (Array.isArray(s.play.rbTargets) && s.play.rbTargets.length) {
                    runner.targets = s.play.rbTargets;
                    runner.routeIdx = 0;
                }
            }
        }

        return;
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
    const depthYards = depthPastLOS / PX_PER_YARD;
    const throwYards = throwLine / PX_PER_YARD;
    const leverageBonus = nearest?.defender?.pos ? clamp((r.pos.y - nearest.defender.pos.y) / PX_PER_YARD, -4, 6) : 0;
    const progression = _progressionOrder(call);
    const progressionIdx = progression.indexOf(key);
    const progressionBonus = progressionIdx >= 0 ? (progression.length - progressionIdx) * 1.8 : 0;
    const scrambleBonus = s.play.qbMoveMode === 'SCRAMBLE' ? 4 : 0;
    const timingBonus = stage > 0.65 ? stage * 6 : stage * 2 - 3;
    const coverageHelp = coverage.assigned && Object.values(coverage.assigned).some(v => v === key) ? 1 : 0;
    const needDepth = s.play?.mustReachSticks ? (s.play?.sticksDepthPx || 0) : 0;
    let sticksBonus = 0;
    if (needDepth > 0) {
        const diff = depthPastLOS - needDepth;
        sticksBonus = diff >= -PX_PER_YARD ? diff * 0.18 + 4 : diff * 0.25;
    }
    let score = separation * 1.25 + depthPastLOS * 0.14 - throwLine * 0.09 + timingBonus + progressionBonus + leverageBonus + scrambleBonus - coverageHelp * 2 + sticksBonus;

    // Bias reads toward quick-hitting options under ~10 yards
    if (depthYards <= 4) {
        score += 6 - depthYards * 0.5;
    } else if (depthYards <= 8) {
        score += 3 - (depthYards - 4) * 0.9;
    } else {
        score -= (depthYards - 8) * 2.4;
    }

    if (throwYards <= 12) {
        score += (12 - throwYards) * 0.35;
    } else {
        score -= (throwYards - 12) * 1.5;
    }

    const qbMods = qb?.modifiers || {};
    const tendencies = qbMods.passTendencies || {};
    const depthKey = depthYards <= 5 ? 'short' : depthYards <= 15 ? 'intermediate' : 'deep';
    const aliasKey = depthKey === 'intermediate' ? 'medium' : depthKey;
    const pref = typeof tendencies[depthKey] === 'number'
        ? tendencies[depthKey]
        : (typeof tendencies[aliasKey] === 'number' ? tendencies[aliasKey] : null);
    if (pref != null) {
        score *= 1 + clamp(pref - 0.33, -0.25, 0.25);
    }

    const recMods = r.modifiers || {};
    if (recMods.routePrecision != null) {
        score += clamp((recMods.routePrecision - 0.5) * 12, -6, 6);
    }
    if (recMods.release != null && depthYards <= 12) {
        score += clamp((recMods.release - 0.5) * 8, -4, 4);
    }
    if (recMods.deepThreat != null && depthYards > 12) {
        score += clamp((recMods.deepThreat - 0.5) * 10, -5, 5);
    }

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
    const dynamics = s.gameDynamics?.teams?.[qb.team] || null;
    const chemistryMap = dynamics?.relationshipValues?.passing?.[qb.id] || {};
    const rushingMomentum = dynamics?.relationshipValues?.rushing || {};
    const tNow = s.play.elapsed, ttt = s.play.qbTTT || 2.5, maxHold = s.play.qbMaxHold || 4.8;
    const minThrowGate = Math.max(Math.min(ttt + 0.18, 1.65), 1.05);
    const readyAt = s.play.qbReadyAt != null ? Math.max(minThrowGate, s.play.qbReadyAt) : minThrowGate;
    const updateVision = (info = null) => {
        if (!qb?.pos) {
            s.play.qbVision = null;
            return;
        }
        const fallbackLook = { x: qb.pos.x, y: qb.pos.y + PX_PER_YARD * 5.5 };
        const src = info?.r?.pos || info?.pos || fallbackLook;
        const look = {
            x: Number.isFinite(src?.x) ? src.x : fallbackLook.x,
            y: Number.isFinite(src?.y) ? src.y : fallbackLook.y,
        };
        const intent = info?.intent || (info?.r ? 'PROGRESS' : 'SCAN');
        s.play.qbVision = {
            lookAt: look,
            intent,
            targetRole: info?.key || info?.targetRole || null,
            targetId: info?.r?.id || info?.targetId || null,
            updatedAt: tNow,
        };
    };
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
    const qbCadence = clamp(s.play.qbReadCadence ?? (call.quickGame ? 0.26 : 0.32), 0.18, 0.42);
    if (typeof s.play.qbNextReadAt !== 'number' || s.play.qbNextReadAt <= 0) {
        s.play.qbNextReadAt = qbCadence;
    }

    const progressionIndex = new Map();
    progression.forEach((key, idx) => progressionIndex.set(key, idx));

    let readLimit = Math.max(0, Math.min(s.play.qbReadIdx, progression.length - 1));
    const cadenceMul = press.underImmediatePressure ? 0.55 : press.underHeat ? 0.75 : 1;
    const cadenceStep = clamp(qbCadence * cadenceMul, 0.16, 0.48);
    while (readLimit < progression.length - 1 && tNow >= s.play.qbNextReadAt) {
        readLimit += 1;
        s.play.qbReadIdx = readLimit;
        s.play.qbNextReadAt = tNow + cadenceStep;
    }
    readLimit = Math.max(0, Math.min(s.play.qbReadIdx, progression.length - 1));
    const maxIdxAllowed = readLimit;
    const currentReadKey = progression.length ? progression[Math.min(readLimit, progression.length - 1)] : null;
    const rbIndex = progressionIndex.has('RB') ? progressionIndex.get('RB') : progression.length - 1;

    const wrteKeys = ['WR1', 'WR2', 'WR3', 'TE'];
    const candidates = [];
    for (const key of wrteKeys) {
        const r = off[key];
        if (!r || !r.alive || r.pos.y < losY) continue;
        const evalResult = _evaluateReceivingTarget(s, key, r, qb, def, losY, call);
        const chemistry = chemistryMap?.[r.id] || 0;
        evalResult.score += chemistry * 12;
        candidates.push(evalResult);
    }
    candidates.sort((a, b) => b.score - a.score);
    const bestOverallWRTE = candidates[0] || null;
    const bestWRTE = candidates.find((cand) => {
        const idx = progressionIndex.has(cand.key) ? progressionIndex.get(cand.key) : progression.length;
        return idx <= maxIdxAllowed;
    }) || null;
    const wrDepthNeed = CFG.WR_MIN_DEPTH_YARDS * PX_PER_YARD;

    const wrAccept = bestWRTE && (
        bestWRTE.separation >= CFG.WR_MIN_OPEN ||
        bestWRTE.depthPastLOS >= wrDepthNeed ||
        (tNow >= ttt && press.underHeat && bestWRTE.separation >= CFG.WR_MIN_OPEN * 0.75)
    );
    const targetChoice = wrAccept ? bestWRTE : null;
    let rbCand = null;
    const progressedPastRB = maxIdxAllowed >= rbIndex;
    const forceCheckdown = press.underHeat && tNow >= ttt;
    if (checkdownGate && (forceCheckdown || progressedPastRB)) {
        const r = off.RB;
        if (r && r.alive) {
            const open = nearestDefDist(def, r.pos), throwLine = dist(qb.pos, r.pos);
            let score = open * 1.05 - throwLine * 0.35;
            const momentum = rushingMomentum?.[r.id] || 0;
            score += momentum * 8;
            if (tNow < (ttt + CFG.CHECKDOWN_LAG)) score -= CFG.RB_EARLY_PENALTY;
            const depth = Math.max(0, r.pos.y - losY);
            rbCand = { key: 'RB', r, score, open, throwLine, depthPastLOS: depth };
        }
    }

    let focusInfo = null;
    if (targetChoice) {
        focusInfo = { key: targetChoice.key, r: targetChoice.r, intent: 'PRIMARY' };
    } else if (checkdownGate && rbCand && (forceCheckdown || progressedPastRB)) {
        focusInfo = { key: rbCand.key, r: rbCand.r, intent: 'CHECKDOWN' };
    } else if (bestWRTE) {
        focusInfo = { key: bestWRTE.key, r: bestWRTE.r, intent: 'PROGRESS' };
    } else if (currentReadKey && off[currentReadKey]?.pos) {
        focusInfo = { key: currentReadKey, r: off[currentReadKey], intent: 'PROGRESS' };
    } else if (bestOverallWRTE) {
        focusInfo = { key: bestOverallWRTE.key, r: bestOverallWRTE.r, intent: 'SCAN' };
    } else if (rbCand) {
        focusInfo = { key: rbCand.key, r: rbCand.r, intent: 'CHECKDOWN' };
    }

    if (!focusInfo) {
        const fallbackKey = progression.find((key, idx) => {
            if (key === 'RB') return false;
            if (idx > maxIdxAllowed) return false;
            const player = off[key];
            return player && player.alive && player.pos && player.pos.y >= losY;
        });
        if (fallbackKey) {
            focusInfo = { key: fallbackKey, r: off[fallbackKey], intent: 'PROGRESS' };
        }
    }

    if (!focusInfo && rbCand?.r?.pos) {
        focusInfo = { key: rbCand.key, r: rbCand.r, intent: 'CHECKDOWN' };
    }

    if (!focusInfo) {
        focusInfo = { pos: { x: qb.pos.x, y: qb.pos.y + PX_PER_YARD * 4.5 }, intent: 'SCAN' };
    }

    updateVision(focusInfo);

    if (tNow < readyAt) return;

    const mustThrow =
        (press.underImmediatePressure && tNow >= maxHold) ||
        (press.underHeat && tNow >= (ttt + 0.85)) ||
        (tNow >= maxHold + 0.35);
    const _leadTo = (p) => {
        const v = _updateAndGetVel(p, 0.016);
        const leadT = 0.62; // keep your current lead
        const raw = { x: p.pos.x + v.x * leadT, y: p.pos.y + v.y * leadT };
        // Never aim behind the QB's Y (prevents backward/lateral passes)
        const safeY = Math.max(raw.y, qb.pos.y - PX_PER_YARD * 0.25);
        return { x: raw.x, y: safeY };
    };

    const tryPassTo = (cand, corridor = 18, opts = {}) => {
        if (!cand) return false;
        const { allowContest = false, contestThreshold = CFG.WR_MIN_OPEN, riskThreshold = 22 } = opts;
        const to = _leadTo(cand.r);
        const laneClear = isThrowLaneClear(def, { x: qb.pos.x, y: qb.pos.y }, to, corridor);
        const separationMetric = cand.separation ?? cand.open ?? 0;
        if (!laneClear && (!allowContest || separationMetric < contestThreshold)) return false;
        if (s.play?.mustReachSticks) {
            const needDepth = s.play?.sticksDepthPx || 0;
            const depth = cand.depthPastLOS != null ? cand.depthPastLOS : Math.max(0, cand.r.pos.y - losY);
            if (depth + PX_PER_YARD * 0.5 < needDepth) return false;
        }
        const from = { x: qb.pos.x, y: qb.pos.y - 2 };
        const safeTo = { x: to.x, y: Math.max(to.y, qb.pos.y - PX_PER_YARD * 0.25) };
        const throwIntent = opts.intent || 'THROW';
        updateVision({ key: cand.key, r: cand.r, intent: throwIntent });
        startPass(s, from, { x: safeTo.x, y: safeTo.y }, cand.r.id);
        s.play.passRisky = separationMetric < riskThreshold;
        return true;
    };

    if (tryPassTo(targetChoice, 16)) return;

    if (
        rbCand &&
        rbCand.open >= CFG.RB_MIN_OPEN &&
        rbCand.throwLine <= CFG.RB_MAX_THROWLINE &&
        tryPassTo(rbCand, 14, {
            allowContest: true,
            contestThreshold: CFG.RB_MIN_OPEN * 0.9,
            riskThreshold: 20,
        })
    ) {
        return;
    }

    if (mustThrow) {
        if (tryPassTo(targetChoice, 14, {
            allowContest: true,
            contestThreshold: CFG.WR_MIN_OPEN * 0.75,
        })) {
            return;
        }

        if (
            rbCand &&
            tryPassTo(rbCand, 12, {
                allowContest: true,
                contestThreshold: CFG.RB_MIN_OPEN * 0.75,
                riskThreshold: 18,
            })
        ) {
            return;
        }

        const underDuress = press.underImmediatePressure || press.underHeat;
        if (!underDuress && s.play.qbMoveMode !== 'SCRAMBLE') {
            s.play.qbMoveMode = 'SCRAMBLE';
            s.play.scrambleMode = Math.random() < 0.6 ? 'FORWARD' : 'LATERAL';
            const dir = press.lateralBias || (Math.random() < 0.5 ? -1 : 1);
            s.play.scrambleDir = dir;
            s.play.scrambleUntil = tNow + rand(0.45, 0.9);
            s.play.qbMaxHold = Math.max(maxHold + 0.35, tNow + 0.6);
            updateVision({ pos: { x: qb.pos.x + dir * 42, y: qb.pos.y + PX_PER_YARD * 2.4 }, intent: 'SCRAMBLE' });
            return;
        }

        const sidelineX = qb.pos.x < FIELD_PIX_W / 2 ? 8 : FIELD_PIX_W - 8;
        const outY = Math.max(qb.pos.y + PX_PER_YARD * 2, losY + PX_PER_YARD);
        updateVision({ pos: { x: sidelineX, y: outY }, intent: 'THROW_AWAY' });
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
    const mods = rb.modifiers || {};
    const burst = clamp(1 + ((mods.burst ?? 0.5) - 0.5) * 0.4, 0.7, 1.4);
    const patienceBase = clamp(0.22 + ((mods.patience ?? 0.5) - 0.5) * 0.18, 0.1, 0.42);

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
        ai.patience = ai.patience ?? patienceBase;
        ai.patienceClock = (ai.patienceClock || 0) + dt;
        const patiencePhase = ai.patienceClock < ai.patience;

        if (!s.play.handed && qb?.pos) {
            const firstTarget = Array.isArray(s.play.rbTargets) ? s.play.rbTargets[0] : null;
            const meshX = clamp(firstTarget?.x ?? qb.pos.x, 18, FIELD_PIX_W - 18);
            const meshY = Math.min(firstTarget?.y ?? (qb.pos.y + PX_PER_YARD * 0.6), qb.pos.y + PX_PER_YARD * 0.6);
            moveToward(rb, { x: meshX, y: meshY }, dt, 1.04 * burst);
            return;
        }

        const lane = _computeLaneForRB(off, def, rb, losY);
        const vision = clamp((mods.vision ?? 0.5) - 0.5, -0.3, 0.3);
        const blendBase = patiencePhase ? 0.45 : 0.8;
        const laneX = clamp(_lerp(rb.pos.x, lane.x, clamp(blendBase + vision * 0.25, 0.2, 1.0)), 18, FIELD_PIX_W - 18);
        const laneY = Math.max(off.__runLaneY ?? (rb.pos.y + PX_PER_YARD * 2.5), losY + PX_PER_YARD * 2.2);
        const depthTarget = { x: laneX, y: laneY };

        if (patiencePhase) {
            const settle = { x: laneX, y: Math.min(rb.pos.y + PX_PER_YARD, losY + PX_PER_YARD * 0.8) };
            moveToward(rb, settle, dt, 0.8 * burst);
        } else {
            moveToward(rb, depthTarget, dt, 1.18 * burst);
        }

        if (s.play.rbTargets && s.play.rbTargets.length > 1 && ai.patienceClock < ai.patience + 0.35) {
            const next = s.play.rbTargets[Math.min(1, s.play.rbTargets.length - 1)];
            moveToward(rb, next, dt, 1.05 * burst);
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
    moveToward(rb, check, dt, 0.92 * burst);
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

const MAN_KEYS = ['CB1', 'CB2', 'NB', 'LB1', 'LB2'];

function _isDefensiveBack(key) {
    return key === 'CB1' || key === 'CB2' || key === 'NB';
}

function _coverageReleaseDepthFor(cover, key) {
    const isDB = _isDefensiveBack(key);
    const releaseBoost = cover?.releaseBoost || {};
    const boost = isDB ? (releaseBoost.db ?? 0) : (releaseBoost.lb ?? 0);
    return {
        run: cover.losY + PX_PER_YARD * ((isDB ? 3.2 : 1.8) + boost),
        qb: cover.losY + PX_PER_YARD * ((isDB ? 2.2 : 1.0) + boost * 0.6),
    };
}

function _manMatchScore(defender, target, losY) {
    if (!defender?.pos || !target?.pos) return Infinity;
    const dx = target.pos.x - defender.pos.x;
    const dy = target.pos.y - defender.pos.y;
    const distScore = Math.hypot(dx, dy);
    const lateral = Math.abs(dx);
    const depthAhead = defender.pos.y - target.pos.y;
    const cushionRef = target.pos.y - (losY + PX_PER_YARD * 3.2);
    const behindPenalty = depthAhead > 0 ? depthAhead * 0.9 : 0;
    const shallowPenalty = depthAhead < -cushionRef ? (-depthAhead - cushionRef) * 0.35 : 0;
    const engagedPenalty = defender.engagedId ? 60 : 0;
    return distScore + lateral * 0.3 + behindPenalty + shallowPenalty + engagedPenalty;
}

function _maybeHandOff(ctx, key, targetRole) {
    const { cover, off, def } = ctx;
    const target = off[targetRole];
    if (!target?.pos) return null;

    const current = def[key];
    const currentScore = _manMatchScore(current, target, cover.losY);
    let bestKey = key;
    let bestScore = currentScore;

    for (const otherKey of MAN_KEYS) {
        if (otherKey === key) continue;
        const other = def[otherKey];
        if (!other?.pos) continue;
        const score = _manMatchScore(other, target, cover.losY);
        if (score + 8 < bestScore) {
            bestScore = score;
            bestKey = otherKey;
        }
    }

    if (bestKey !== key) {
        if (cover.assigned[key] === targetRole) delete cover.assigned[key];
        const prev = cover.assigned[bestKey];
        if (prev && prev !== targetRole) delete cover.assigned[bestKey];
        cover.assigned[bestKey] = targetRole;
        return null;
    }

    return targetRole;
}

function _acquireNearestThreat(ctx, key) {
    const { cover, off, def } = ctx;
    const defender = def[key];
    if (!defender?.pos) return null;

    const already = new Set(Object.values(cover.assigned || {}));
    let best = null;
    const roles = ['WR1', 'WR2', 'WR3', 'TE', 'RB'];
    const weight = (role) => (role.startsWith('WR') ? 0 : role === 'TE' ? 10 : 18);

    for (const role of roles) {
        const t = off[role];
        if (!t?.pos || !t.alive) continue;
        if (already.has(role)) continue;
        const dd = dist(defender.pos, t.pos);
        const depthBias = Math.max(0, t.pos.y - cover.losY) * 0.12;
        const score = dd - depthBias + weight(role);
        if (!best || score < best.score) best = { role, score };
    }

    if (best) {
        cover.assigned[key] = best.role;
        return best.role;
    }
    return null;
}

function _resolveManAssignment(ctx, key) {
    const { cover, off } = ctx;
    let targetRole = cover.assigned?.[key] || null;

    if (targetRole) {
        const target = off[targetRole];
        if (!target?.pos || target.alive === false) {
            delete cover.assigned[key];
            targetRole = null;
        }
    }

    if (targetRole) {
        const kept = _maybeHandOff(ctx, key, targetRole);
        if (!kept) targetRole = null;
        else targetRole = kept;
    }

    if (!targetRole) targetRole = _acquireNearestThreat(ctx, key);

    return targetRole;
}

function _coverageLeverage(defender, target, qbPos) {
    if (!defender?.pos || !target?.pos) return 0;
    const fieldMid = FIELD_PIX_W / 2;
    const outside = Math.abs(target.pos.x - fieldMid) > 70;
    let leverage = Math.sign(target.pos.x - defender.pos.x);
    if (!leverage) leverage = target.pos.x < fieldMid ? -1 : 1;
    if (outside) leverage = target.pos.x < fieldMid ? -1 : 1;
    if (!outside && Math.abs(target.pos.x - fieldMid) < 42) {
        leverage = Math.sign((qbPos?.x ?? fieldMid) - defender.pos.x) || leverage;
    }
    return leverage;
}

function _computeRouteMirrorAim(ctx, defender, target, { isDB, cushion, targetRole }) {
    if (!target || !target.pos) return null;
    if (!targetRole || !/^WR[1-3]$/.test(targetRole)) {
        if (targetRole !== 'TE') return null;
    }

    const route = target._ai?.route || null;
    if (!route || !Array.isArray(target.targets) || !target.targets.length) return null;

    const mirror = defender._manMirror || (defender._manMirror = {});
    const now = ctx.s?.play?.elapsed ?? 0;
    const idx = Math.min(target.routeIdx || 0, target.targets.length - 1);
    const next = target.targets[idx] || target.targets[target.targets.length - 1];

    const velocity = _updateAndGetVel(target, ctx.dt);
    const vMag = Math.hypot(velocity.x, velocity.y);
    let dir = null;
    if (vMag > 0.4) {
        dir = { x: velocity.x / vMag, y: velocity.y / vMag };
    } else if (next) {
        const dx = (next.x ?? target.pos.x) - target.pos.x;
        const dy = (next.y ?? target.pos.y) - target.pos.y;
        const mag = Math.hypot(dx, dy);
        if (mag > 1e-2) dir = { x: dx / mag, y: dy / mag };
    }

    if (!dir) return null;

    const stepIdx = next?.idx ?? idx;
    if (mirror.lastStepIdx != null && stepIdx !== mirror.lastStepIdx) {
        const agility = clamp(target?.attrs?.agility ?? 0.85, 0.5, 1.4);
        const jukeChance = clamp(0.14 + (agility - 0.8) * 0.4, 0.06, 0.65);
        if (Math.random() < jukeChance) {
            const stumble = clamp(0.18 + (1.05 - (defender?.attrs?.agility ?? 0.8)) * 0.2, 0.12, 0.4);
            mirror.jukedUntil = now + stumble;
            mirror.jukeDir = mirror.lastDir || dir;
        }
    }
    mirror.lastStepIdx = stepIdx;

    if (mirror.jukedUntil && now < mirror.jukedUntil && mirror.jukeDir) {
        dir = mirror.jukeDir;
    } else {
        mirror.jukeDir = null;
    }

    mirror.lastDir = dir;

    const relX = defender.pos.x - target.pos.x;
    const relY = defender.pos.y - target.pos.y;
    const alignment = relX * dir.x + relY * dir.y;
    const cushionPx = Math.max(PX_PER_YARD * 1.6, (cushion || PX_PER_YARD * 3) * 0.9);

    if (!mirror.mode || (now - (mirror.modeSince || 0)) > 0.8) {
        if (alignment > PX_PER_YARD * 0.8) mirror.mode = 'front';
        else if (Math.abs(relX) > Math.abs(relY)) mirror.mode = 'side';
        else mirror.mode = 'trail';
        mirror.modeSince = now;
    }

    const offset = cushionPx * 0.65;
    let aim = { x: target.pos.x, y: target.pos.y };
    const perp = { x: -dir.y, y: dir.x };
    if (mirror.mode === 'front') {
        aim.x += dir.x * offset * 0.7;
        aim.y += dir.y * offset * 0.7;
    } else if (mirror.mode === 'side') {
        const side = Math.sign(relX) || (Math.random() < 0.5 ? -1 : 1);
        aim.x += perp.x * offset * 0.8 * side - dir.x * offset * 0.25;
        aim.y += perp.y * offset * 0.5 * side - dir.y * offset * 0.25;
    } else {
        aim.x -= dir.x * offset;
        aim.y -= dir.y * offset;
    }

    aim.x = clamp(aim.x, 16, FIELD_PIX_W - 16);
    aim.y = Math.max(aim.y, ctx.cover.losY + PX_PER_YARD * 0.6);

    let speedMul = isDB ? 1.05 : 0.98;
    const spacing = dist(defender.pos, target.pos);
    if (spacing > cushionPx * 1.4) speedMul += 0.08;
    if (mirror.jukedUntil && now < mirror.jukedUntil) speedMul *= 0.88;

    return { point: aim, speedMul };
}

function _computeManAim(ctx, defender, target, { isDB, cushion, zoneDrop = null, targetRole = null }) {
    const targeted = ctx.ball.inAir && ctx.passTarget && target && (
        ctx.passTarget.id === target.id ||
        (ctx.passTargetRole && targetRole && ctx.passTargetRole === targetRole)
    );
    if (targeted) {
        const dest = ctx.ball.to || ctx.passTarget.pos || target.pos;
        const clampX = (x) => clamp(x, 16, FIELD_PIX_W - 16);
        const floorY = ctx.cover.losY + PX_PER_YARD * (isDB ? 1.4 : 1.1);
        const aim = {
            x: clampX(dest.x),
            y: Math.max(dest.y - PX_PER_YARD * (isDB ? 0.8 : 0.6), floorY),
        };
        const speedMul = (isDB ? 1.18 : 1.08) * (zoneDrop?.speed || 1);
        return { point: aim, speedMul };
    }

    const mirror = _computeRouteMirrorAim(ctx, defender, target, { isDB, cushion, targetRole });
    if (mirror) {
        let aimX = mirror.point.x;
        let aimY = mirror.point.y;
        let speedMul = mirror.speedMul;
        if (zoneDrop) {
            const dropY = zoneDrop.y ?? aimY;
            aimY = Math.max(aimY, dropY);
            const dropX = zoneDrop.x ?? aimX;
            aimX = clamp(_lerp(dropX, aimX, 0.55), 16, FIELD_PIX_W - 16);
            if (zoneDrop.speed) speedMul = speedMul * zoneDrop.speed;
        }
        return { point: { x: aimX, y: aimY }, speedMul };
    }

    const lead = _leadPoint(target, isDB ? 0.32 : 0.26, ctx.dt);
    const leverage = _coverageLeverage(defender, target, ctx.qbPos);
    const minDepth = ctx.cover.losY + PX_PER_YARD * (isDB ? 1.2 : 0.8);
    const desiredDepth = Math.max(minDepth, lead.y - cushion);
    const maxDepth = Math.max(desiredDepth, target.pos.y - PX_PER_YARD * 0.25);
    let aimY = clamp(desiredDepth, minDepth, maxDepth);
    let aimX = clamp(lead.x + leverage * (isDB ? 6 : 4), 16, FIELD_PIX_W - 16);

    const trailing = defender.pos.y > target.pos.y - PX_PER_YARD * 0.6;
    const spacing = dist(defender.pos, target.pos);
    let speedMul = isDB ? 1.055 : 1.0;
    if (trailing) {
        aimY = Math.min(aimY, target.pos.y - PX_PER_YARD * 0.45);
        speedMul += 0.08;
    }
    if (spacing > cushion * 1.8) speedMul += 0.05;

    if (zoneDrop) {
        const dropY = zoneDrop.y ?? aimY;
        aimY = Math.max(aimY, dropY);
        const dropX = zoneDrop.x ?? aimX;
        aimX = clamp(_lerp(dropX, aimX, 0.55), 16, FIELD_PIX_W - 16);
        if (zoneDrop.speed) speedMul = speedMul * zoneDrop.speed;
    }

    return { point: { x: aimX, y: aimY }, speedMul };
}

function _findZoneHelpAim(ctx, defender, key) {
    const isDB = _isDefensiveBack(key);
    const zoneDrop = ctx.cover.zoneDrops?.[key];
    if (zoneDrop) {
        return {
            point: { x: zoneDrop.x, y: zoneDrop.y },
            speedMul: zoneDrop.speed ?? (isDB ? 0.96 : 0.9),
        };
    }
    const baseDepth = ctx.cover.losY + PX_PER_YARD * (isDB ? 7.0 : 5.2);
    let anchor = {
        x: clamp(ctx.qbPos.x + (defender.pos.x < FIELD_PIX_W / 2 ? -28 : 28), 20, FIELD_PIX_W - 20),
        y: baseDepth,
    };

    const threats = ['WR1', 'WR2', 'WR3', 'TE', 'RB']
        .map(role => ctx.off[role])
        .filter(p => p && p.pos && p.alive !== false && p.pos.y >= ctx.cover.losY);

    const nearest = threats.reduce((best, p) => {
        const dd = dist(p.pos, defender.pos);
        const depthBias = Math.max(0, p.pos.y - ctx.cover.losY) * 0.1;
        const score = dd - depthBias;
        return (!best || score < best.score) ? { score, player: p } : best;
    }, null);

    if (nearest?.player) {
        const leverage = Math.sign(defender.pos.x - nearest.player.pos.x) || (nearest.player.pos.x < FIELD_PIX_W / 2 ? -1 : 1);
        anchor = {
            x: clamp(nearest.player.pos.x + leverage * (isDB ? 12 : 8), 18, FIELD_PIX_W - 18),
            y: Math.max(ctx.cover.losY + PX_PER_YARD * 2.0, nearest.player.pos.y - PX_PER_YARD * (isDB ? 2.3 : 1.7)),
        };
    }

    return { point: anchor, speedMul: isDB ? 0.98 : 0.92 };
}

function _handleZoneCoverage(ctx, key, defender) {
    const zoneInfo = ctx.cover.zoneAssignments?.[key] || null;
    if (!zoneInfo) return false;

    const anchor = zoneInfo.anchor || defender.pos || { x: FIELD_PIX_W / 2, y: ctx.cover.losY + PX_PER_YARD * 5 };
    const radius = zoneInfo.radius ?? PX_PER_YARD * 7;
    const chaseSpeed = zoneInfo.chaseSpeed ?? 0.98;
    const attackSpeed = zoneInfo.attackSpeed ?? 1.04;
    const dropSpeed = zoneInfo.dropSpeed ?? 0.92;

    const threats = ['WR1', 'WR2', 'WR3', 'TE', 'RB']
        .map(role => ({ role, player: ctx.off[role] }))
        .filter(entry => entry.player && entry.player.pos && entry.player.alive !== false);

    const anchorClamp = (pt) => ({ x: clamp(pt.x, 16, FIELD_PIX_W - 16), y: pt.y });
    const anchorPoint = anchorClamp(anchor);

    const targetPos = ctx.ball.to || null;
    let chase = null;

    const assignedRole = ctx.cover.assigned?.[key] || null;
    const assignedPlayer = assignedRole ? ctx.off[assignedRole] : null;

    let targetedIntercept = false;

    if (ctx.ball.inAir && ctx.passTarget?.pos) {
        const dest = targetPos || ctx.passTarget.pos;
        const dx = dest.x - anchorPoint.x;
        const dy = dest.y - anchorPoint.y;
        const distScore = Math.hypot(dx, dy);
        const targeted = assignedRole && ctx.passTargetRole && assignedRole === ctx.passTargetRole;
        const reachFactor = targeted ? 2.6 : 1.9;
        if (distScore <= radius * reachFactor || targeted) {
            targetedIntercept = targeted;
            chase = { player: ctx.passTarget, intercept: true, dest };
        }
    }

    if (!chase && assignedPlayer?.pos) {
        const dx = assignedPlayer.pos.x - anchorPoint.x;
        const dy = assignedPlayer.pos.y - anchorPoint.y;
        if (dy >= -PX_PER_YARD * 0.8) {
            const distScore = Math.hypot(dx, dy);
            const depthBias = Math.max(0, assignedPlayer.pos.y - ctx.cover.losY) * 0.28;
            const effectiveRadius = radius * 2.15;
            if ((distScore - depthBias) <= effectiveRadius) {
                chase = { player: assignedPlayer, role: assignedRole, dist: distScore, priority: true };
            }
        }
    }

    if (!chase) {
        const zoneThreat = threats.reduce((best, entry) => {
            const p = entry.player;
            const dx = p.pos.x - anchorPoint.x;
            const dy = p.pos.y - anchorPoint.y;
            if (dy < -PX_PER_YARD * 0.6) return best;
            const distScore = Math.hypot(dx, dy);
            const depthBias = Math.max(0, p.pos.y - ctx.cover.losY) * 0.35;
            const score = distScore - depthBias;
            if (distScore > radius * 1.8) return best;
            return (!best || score < best.score) ? { score, entry, dist: distScore } : best;
        }, null);
        if (zoneThreat) {
            chase = { player: zoneThreat.entry.player, role: zoneThreat.entry.role, dist: zoneThreat.dist };
        }
    }

    if (chase?.player) {
        if (chase.intercept) {
            const aim = {
                x: clamp(chase.dest.x, 16, FIELD_PIX_W - 16),
                y: Math.max(chase.dest.y - PX_PER_YARD * 0.8, ctx.cover.losY + PX_PER_YARD * 1.5),
            };
            const burst = targetedIntercept ? 1.12 : attackSpeed;
            moveToward(defender, aim, ctx.dt, burst);
        } else {
            const aim = {
                x: clamp(chase.player.pos.x, 16, FIELD_PIX_W - 16),
                y: Math.max(chase.player.pos.y - PX_PER_YARD * 0.6, ctx.cover.losY + PX_PER_YARD * 1.2),
            };
            const speed = chase.priority ? Math.max(chaseSpeed, 1.02) : chaseSpeed;
            moveToward(defender, aim, ctx.dt, speed);
        }
        return true;
    }

    const drop = ctx.cover.zoneDrops?.[key] || anchorPoint;
    const settle = {
        x: clamp(drop.x, 16, FIELD_PIX_W - 16),
        y: Math.max(drop.y, ctx.cover.losY + PX_PER_YARD * 1.4),
    };
    moveToward(defender, settle, ctx.dt, dropSpeed);
    return true;
}

function _pursueCarrierIfNeeded(ctx, key, defender, assignedTarget) {
    const { carrierPos, carrierRole, carrier, ball, lastCarrierChange } = ctx;
    if (!carrierPos || !carrier || ball.inAir) return false;

    const release = _coverageReleaseDepthFor(ctx.cover, key);
    const distToCarrier = dist(defender.pos, carrierPos);
    const assigned = assignedTarget && carrierRole && assignedTarget === carrierRole;

    const releaseY = carrierRole === 'QB' ? release.qb : release.run;
    const beyondLos = carrierPos.y >= ctx.cover.losY + PX_PER_YARD * 0.5;
    const clearedRelease = beyondLos || carrierPos.y >= releaseY - PX_PER_YARD * 0.5;
    const recentPossession = (ctx.s.play.elapsed - (lastCarrierChange ?? 0)) <= CFG.PURSUIT_RECENT_TIME;
    const closeEnough = distToCarrier <= CFG.PURSUIT_TRIGGER_R;
    const sameSide = Math.abs(defender.pos.x - carrierPos.x) <= 120;

    if (!assigned) {
        const rally = recentPossession && (closeEnough || sameSide);
        const qbBehindRelease = carrierRole === 'QB' && carrierPos.y < release.qb - PX_PER_YARD * 0.5;
        if (!clearedRelease && !closeEnough && !rally && !qbBehindRelease) return false;
        if (distToCarrier > CFG.PURSUIT_TRIGGER_R * 1.4) return false;
    }

    const leadT = assigned ? CFG.PURSUIT_LEAD_T * 1.2 : CFG.PURSUIT_LEAD_T * 0.9;
    const lead = _leadPoint(carrier, leadT, ctx.dt);
    const aim = {
        x: lead.x,
        y: Math.min(lead.y, carrierPos.y + PX_PER_YARD * 0.2),
    };
    const speedMul = CFG.PURSUIT_SPEED * (assigned ? 1.18 : recentPossession ? 1.08 : 1.0);
    moveToward(defender, aim, ctx.dt, speedMul);
    return true;
}

function _updateManCoverageForKey(ctx, key) {
    const defender = ctx.def[key];
    if (!defender?.pos) return;

    const targetRole = _resolveManAssignment(ctx, key);
    const target = targetRole ? ctx.off[targetRole] : null;
    const zoneDrop = ctx.cover.zoneDrops?.[key] || null;
    const isZone = !!ctx.cover.zoneAssignments?.[key];

    if (_pursueCarrierIfNeeded(ctx, key, defender, targetRole)) return;

    if (isZone) {
        if (_handleZoneCoverage(ctx, key, defender)) return;
    }

    if (target?.pos) {
        const aim = _computeManAim(ctx, defender, target, {
            isDB: _isDefensiveBack(key),
            cushion: ctx.cushion,
            zoneDrop,
            targetRole,
        });
        moveToward(defender, aim.point, ctx.dt, aim.speedMul);
        return;
    }

    const zone = _findZoneHelpAim(ctx, defender, key);
    moveToward(defender, zone.point, ctx.dt, zone.speedMul);
}

function _updateSafetyCoverage(ctx, key, idx, coverables) {
    const defender = ctx.def[key];
    if (!defender?.pos) return;

    if (ctx.ball.inAir) {
        const tgt = ctx.ball.to || ctx.qbPos;
        moveToward(defender, tgt, ctx.dt, 1.04);
        return;
    }

    const shell = ctx.cover.shell || 'default';
    const drop = ctx.cover.safetyDrops?.[key] || null;
    const isLeft = idx === 0;

    if (shell === 'cover3') {
        if (isLeft) {
            const landmark = drop || ctx.cover.deepLandmarks?.middle || {
                x: ctx.qbPos.x,
                y: ctx.cover.losY + PX_PER_YARD * 13.4,
            };
            const threat = coverables.reduce((best, p) => {
                if (!p?.pos) return best;
                if (p.pos.y < ctx.cover.losY + PX_PER_YARD * 5) return best;
                const lateral = Math.abs(p.pos.x - landmark.x);
                const depth = p.pos.y - ctx.cover.losY;
                const score = depth * 1.15 - lateral * 0.4;
                return (!best || score > best.score) ? { score, player: p } : best;
            }, null);
            if (threat?.player) {
                const lead = _leadPoint(threat.player, 0.34, ctx.dt);
                const aim = {
                    x: clamp(_lerp(landmark.x, lead.x, 0.6), 20, FIELD_PIX_W - 20),
                    y: Math.max(landmark.y, lead.y - PX_PER_YARD * 5.2),
                };
                moveToward(defender, aim, ctx.dt, 0.95);
            } else {
                moveToward(defender, landmark, ctx.dt, 0.92);
            }
        } else {
            const landmark = drop || {
                x: clamp(ctx.qbPos.x + (defender.pos.x < FIELD_PIX_W / 2 ? -32 : 32), 22, FIELD_PIX_W - 22),
                y: ctx.cover.losY + PX_PER_YARD * 7.2,
            };
            const side = landmark.x >= FIELD_PIX_W / 2 ? 1 : -1;
            const threat = coverables.reduce((best, p) => {
                if (!p?.pos) return best;
                if (p.pos.y < ctx.cover.losY + PX_PER_YARD * 3.5) return best;
                const onSide = side > 0 ? p.pos.x >= FIELD_PIX_W / 2 - 8 : p.pos.x <= FIELD_PIX_W / 2 + 8;
                if (!onSide) return best;
                const depth = p.pos.y - ctx.cover.losY;
                const lateral = Math.abs(p.pos.x - landmark.x);
                const score = depth * 0.85 - lateral * 0.25;
                return (!best || score > best.score) ? { score, player: p } : best;
            }, null);
            if (threat?.player) {
                const lead = _leadPoint(threat.player, 0.3, ctx.dt);
                const aim = {
                    x: clamp(_lerp(landmark.x, lead.x, 0.6), 20, FIELD_PIX_W - 20),
                    y: Math.max(landmark.y, Math.min(landmark.y + PX_PER_YARD * 4.2, lead.y - PX_PER_YARD * 2.2)),
                };
                moveToward(defender, aim, ctx.dt, 0.96);
            } else {
                moveToward(defender, landmark, ctx.dt, 0.9);
            }
        }
        return;
    }

    if (shell === 'cover4' && ctx.cover.deepLandmarks) {
        const landmark = drop || (isLeft ? ctx.cover.deepLandmarks.left : ctx.cover.deepLandmarks.right) || {
            x: ctx.qbPos.x + (isLeft ? -60 : 60),
            y: ctx.cover.losY + PX_PER_YARD * 13.6,
        };
        const threat = coverables.reduce((best, p) => {
            if (!p?.pos) return best;
            const onSide = isLeft ? p.pos.x <= FIELD_PIX_W / 2 + 12 : p.pos.x >= FIELD_PIX_W / 2 - 12;
            if (!onSide) return best;
            const depth = p.pos.y - ctx.cover.losY;
            const lateral = Math.abs(p.pos.x - landmark.x);
            const score = depth * 1.1 - lateral * 0.35;
            return (!best || score > best.score) ? { score, player: p } : best;
        }, null);
        if (threat?.player) {
            const lead = _leadPoint(threat.player, 0.34, ctx.dt);
            const aim = {
                x: clamp(_lerp(landmark.x, lead.x, 0.55), 20, FIELD_PIX_W - 20),
                y: Math.max(landmark.y, lead.y - PX_PER_YARD * 5.2),
            };
            moveToward(defender, aim, ctx.dt, 0.94);
        } else {
            moveToward(defender, landmark, ctx.dt, 0.92);
        }
        return;
    }

    if ((ctx.cover.isCover2 || ctx.cover.isTwoMan) && ctx.cover.deepLandmarks) {
        const landmark = drop || (isLeft ? ctx.cover.deepLandmarks.left : ctx.cover.deepLandmarks.right);
        const threat = coverables.reduce((best, p) => {
            if (!p?.pos) return best;
            const onSide = isLeft ? p.pos.x <= FIELD_PIX_W / 2 : p.pos.x >= FIELD_PIX_W / 2;
            if (!onSide && !ctx.cover.isTwoMan) return best;
            const depth = p.pos.y - ctx.cover.losY;
            const lateral = Math.abs(p.pos.x - landmark.x);
            const score = ctx.cover.isTwoMan
                ? depth * 1.1 - lateral * 0.25
                : depth * 1.0 - lateral * 0.3;
            return (!best || score > best.score) ? { score, player: p } : best;
        }, null);
        if (threat?.player) {
            const lead = _leadPoint(threat.player, ctx.cover.isTwoMan ? 0.38 : 0.36, ctx.dt);
            const mix = ctx.cover.isTwoMan ? 0.5 : 0.6;
            const depthFloor = ctx.cover.losY + PX_PER_YARD * (ctx.cover.isTwoMan ? 11.2 : 9.0);
            const aim = {
                x: clamp(_lerp(landmark.x, lead.x, mix), 20, FIELD_PIX_W - 20),
                y: Math.max(landmark?.y ?? depthFloor, Math.max(depthFloor, lead.y - PX_PER_YARD * (ctx.cover.isTwoMan ? 5.2 : 4.6))),
            };
            moveToward(defender, aim, ctx.dt, ctx.cover.isTwoMan ? 0.96 : 0.94);
        } else if (landmark) {
            moveToward(defender, landmark, ctx.dt, 0.92);
        }
        return;
    }

    const deepThreat = coverables.reduce((best, p) => {
        if (!p?.pos) return best;
        if (p.pos.y < ctx.cover.losY) return best;
        if (!best || p.pos.y > best.pos.y) return p;
        return best;
    }, null);

    if (deepThreat) {
        const lead = _leadPoint(deepThreat, 0.34, ctx.dt);
        const shade = _coverageLeverage(defender, deepThreat, ctx.qbPos);
        const aim = {
            x: clamp(lead.x - shade * 12, 18, FIELD_PIX_W - 18),
            y: Math.max(lead.y - PX_PER_YARD * 4.8, ctx.cover.losY + PX_PER_YARD * 8.2),
        };
        moveToward(defender, aim, ctx.dt, 0.96);
    } else {
        const robber = {
            x: clamp(ctx.qbPos.x + (defender.pos.x < FIELD_PIX_W / 2 ? -22 : 22), 20, FIELD_PIX_W - 20),
            y: ctx.cover.losY + PX_PER_YARD * 7.2,
        };
        moveToward(defender, robber, ctx.dt, 0.9);
    }
}

// Greedy nearest assignment with role weighting (CBs prefer WRs > TE > RB)
function _computeCoverageAssignments(s) {
    const off = s.play?.formation?.off || {};
    const def = s.play?.formation?.def || {};
    const losY = off.__losPixY ?? (off.QB?.pos?.y ?? 0);

    Object.values(def).forEach(p => {
        if (!p) return;
        p._manMirror = null;
    });

    const defenders = ['CB1', 'CB2', 'NB', 'S1', 'S2', 'LB1', 'LB2'].map(k => ({ k, p: def[k] })).filter(x => x.p && x.p.pos);
    const targets = ['WR1', 'WR2', 'WR3', 'TE', 'RB'].map(k => ({ k, p: off[k] })).filter(x => x.p && x.p.pos);

    const weight = (role) => role.startsWith('WR') ? 0 : role === 'TE' ? 15 : 30; // WR easiest
    const assigned = {};
    const used = new Set();

    const defFormationName = (s.play.defFormation || '').toLowerCase();
    const shell = defFormationName.includes('cover-4') || defFormationName.includes('quarters')
        ? 'cover4'
        : defFormationName.includes('cover-3')
            ? 'cover3'
            : defFormationName.includes('cover-2')
                ? 'cover2'
                : defFormationName.includes('2-man')
                    ? 'twoMan'
                    : defFormationName.includes('zero')
                        ? 'zero'
                        : 'default';

    const isCover2 = shell === 'cover2';
    const isTwoMan = shell === 'twoMan';
    const isCover3 = shell === 'cover3';
    const isCover4 = shell === 'cover4';

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

    if (isCover2 || isTwoMan || isCover3 || isCover4) {
        if (assigned.S1) used.delete(assigned.S1);
        if (assigned.S2) used.delete(assigned.S2);
        delete assigned.S1;
        delete assigned.S2;
    }

    const usedRoles = new Set(Object.values(assigned));
    const ensure = (defKey, role) => {
        if (!role || !off[role]?.pos) return;
        if (!def[defKey]?.pos) return;
        if (assigned[defKey]) return;
        if (usedRoles.has(role)) return;
        assigned[defKey] = role;
        usedRoles.add(role);
    };

    if (isTwoMan) {
        ensure('CB1', 'WR1');
        ensure('CB2', 'WR2');
        ensure('NB', 'WR3');
        ensure('LB1', off.TE ? 'TE' : null);
        ensure('LB2', off.RB ? 'RB' : null);
    } else if (isCover3 || isCover4) {
        ensure('CB1', 'WR1');
        ensure('CB2', 'WR2');
        ensure('NB', 'WR3');
        ensure('LB1', off.TE ? 'TE' : null);
        ensure('LB2', off.RB ? 'RB' : null);
    } else if (isCover2) {
        ensure('CB1', 'WR1');
        ensure('CB2', 'WR2');
        ensure('NB', 'WR3');
    }

    const midX = off.QB?.pos?.x ?? (FIELD_PIX_W / 2);
    const wr1X = off.WR1?.pos?.x ?? (midX - 80);
    const wr2X = off.WR2?.pos?.x ?? (midX + 80);
    const wr3X = off.WR3?.pos?.x ?? midX;
    const clampX = (x) => clamp(x, 18, FIELD_PIX_W - 18);
    const slotDir = wr3X >= midX ? 1 : -1;

    const zoneDrops = {};
    const safetyDrops = {};
    const releaseBoost = { db: 0, lb: 0 };
    let cushionBoost = 1;
    let deepLandmarks = null;
    const zoneAssignments = {};

    switch (shell) {
        case 'cover2': {
            const cushion = CFG.COVER_CUSHION_YDS * PX_PER_YARD;
            deepLandmarks = {
                left: { x: clampX(midX - 55), y: losY + PX_PER_YARD * 12 + cushion },
                right: { x: clampX(midX + 55), y: losY + PX_PER_YARD * 12 + cushion },
            };
            safetyDrops.S1 = deepLandmarks.left;
            safetyDrops.S2 = deepLandmarks.right;
            zoneDrops.CB1 = { x: clampX((wr1X ?? (midX - 72)) + 4), y: losY + PX_PER_YARD * 5.6, speed: 0.95 };
            zoneDrops.CB2 = { x: clampX((wr2X ?? (midX + 72)) - 4), y: losY + PX_PER_YARD * 5.6, speed: 0.95 };
            zoneDrops.NB = { x: clampX(wr3X), y: losY + PX_PER_YARD * 7.0, speed: 0.92 };
            zoneDrops.LB1 = { x: clampX(midX - 20), y: losY + PX_PER_YARD * 6.2, speed: 0.9 };
            zoneDrops.LB2 = { x: clampX(midX + 20), y: losY + PX_PER_YARD * 6.2, speed: 0.9 };
            cushionBoost = 1.1;
            releaseBoost.db = 0.8;
            releaseBoost.lb = 0.2;
            break;
        }
        case 'twoMan': {
            deepLandmarks = {
                left: { x: clampX(midX - 68), y: losY + PX_PER_YARD * 13.2 },
                right: { x: clampX(midX + 68), y: losY + PX_PER_YARD * 13.2 },
            };
            safetyDrops.S1 = deepLandmarks.left;
            safetyDrops.S2 = deepLandmarks.right;
            cushionBoost = 1.25;
            releaseBoost.db = 1.1;
            releaseBoost.lb = 0.35;
            break;
        }
        case 'cover3': {
            deepLandmarks = {
                left: { x: clampX(midX - 78), y: losY + PX_PER_YARD * 12.8 },
                middle: { x: clampX(midX), y: losY + PX_PER_YARD * 13.6 },
                right: { x: clampX(midX + 78), y: losY + PX_PER_YARD * 12.8 },
            };
            zoneDrops.CB1 = { x: deepLandmarks.left.x, y: deepLandmarks.left.y, speed: 0.96 };
            zoneDrops.CB2 = { x: deepLandmarks.right.x, y: deepLandmarks.right.y, speed: 0.96 };
            zoneDrops.NB = { x: clampX(wr3X - slotDir * 6), y: losY + PX_PER_YARD * 7.4, speed: 0.92 };
            zoneDrops.LB1 = { x: clampX(midX - 30), y: losY + PX_PER_YARD * 6.4, speed: 0.9 };
            zoneDrops.LB2 = { x: clampX(midX + 30), y: losY + PX_PER_YARD * 6.4, speed: 0.9 };
            safetyDrops.S1 = deepLandmarks.middle;
            const curlX = wr3X;
            const curlOffset = curlX >= midX ? 24 : -24;
            safetyDrops.S2 = { x: clampX(curlX + curlOffset), y: losY + PX_PER_YARD * 7.2 };
            cushionBoost = 1.35;
            releaseBoost.db = 1.4;
            releaseBoost.lb = 0.5;
            break;
        }
        case 'cover4': {
            deepLandmarks = {
                left: { x: clampX((wr1X ?? (midX - 80)) - 6), y: losY + PX_PER_YARD * 13.8 },
                right: { x: clampX((wr2X ?? (midX + 80)) + 6), y: losY + PX_PER_YARD * 13.8 },
                middle: { x: clampX(midX), y: losY + PX_PER_YARD * 13.6 },
            };
            zoneDrops.CB1 = { x: deepLandmarks.left.x, y: deepLandmarks.left.y, speed: 0.95 };
            zoneDrops.CB2 = { x: deepLandmarks.right.x, y: deepLandmarks.right.y, speed: 0.95 };
            zoneDrops.NB = { x: clampX(wr3X + slotDir * 6), y: losY + PX_PER_YARD * 8.2, speed: 0.92 };
            zoneDrops.LB1 = { x: clampX(midX - 26), y: losY + PX_PER_YARD * 6.2, speed: 0.9 };
            zoneDrops.LB2 = { x: clampX(midX + 26), y: losY + PX_PER_YARD * 6.2, speed: 0.9 };
            safetyDrops.S1 = { x: clampX(midX - 50), y: losY + PX_PER_YARD * 13.8 };
            safetyDrops.S2 = { x: clampX(midX + 50), y: losY + PX_PER_YARD * 13.8 };
            cushionBoost = 1.55;
            releaseBoost.db = 1.8;
            releaseBoost.lb = 0.6;
            break;
        }
        case 'default': {
            if (defFormationName.includes('nickel 3-3-5')) {
                cushionBoost = 1.18;
                releaseBoost.db = 0.9;
                releaseBoost.lb = 0.4;
                zoneDrops.LB1 = { x: clampX(midX - 24), y: losY + PX_PER_YARD * 6.0, speed: 0.9 };
                zoneDrops.LB2 = { x: clampX(midX + 24), y: losY + PX_PER_YARD * 6.0, speed: 0.9 };
                zoneDrops.NB = { x: clampX(wr3X), y: losY + PX_PER_YARD * 6.6, speed: 0.92 };
            }
            releaseBoost.db = Math.max(releaseBoost.db, 0.25);
            releaseBoost.lb = Math.max(releaseBoost.lb, 0.12);
            break;
        }
        default:
            break;
    }

    const registerZone = (key, drop) => {
        if (!drop) return;
        const isDB = _isDefensiveBack(key);
        zoneAssignments[key] = {
            anchor: { x: drop.x, y: drop.y },
            radius: PX_PER_YARD * (isDB ? 8.5 : 6.6),
            chaseSpeed: isDB ? 1.0 : 0.94,
            attackSpeed: isDB ? 1.08 : 1.0,
            dropSpeed: drop.speed ?? (isDB ? 0.95 : 0.9),
        };
    };
    Object.entries(zoneDrops).forEach(([key, drop]) => registerZone(key, drop));

    s.play.coverage = {
        assigned,
        isCover2,
        isTwoMan,
        isCover3,
        isCover4,
        deepLandmarks,
        losY,
        shell,
        zoneDrops,
        safetyDrops,
        releaseBoost,
        cushionBoost,
        zoneAssignments,
    };
}

export function defenseLogic(s, dt) {
    const off = s.play.formation.off, def = s.play.formation.def, ball = s.play.ball;
    const cover = s.play.coverage || {
        assigned: {},
        isCover2: false,
        isTwoMan: false,
        isCover3: false,
        isCover4: false,
        deepLandmarks: null,
        losY: off.__losPixY ?? 0,
        shell: 'default',
        zoneDrops: {},
        safetyDrops: {},
        releaseBoost: { db: 0, lb: 0 },
        cushionBoost: 1,
        zoneAssignments: {},
    };
    const carrierInfo = normalizeCarrier(off, ball);
    const carrier = carrierInfo.player;
    const carrierRole = carrierInfo.role;
    const carrierPos = carrier?.pos || null;

    if (carrierInfo.id) {
        if (s.play.__lastCarrierId !== carrierInfo.id) {
            s.play.__lastCarrierId = carrierInfo.id;
            s.play.__lastCarrierChange = s.play.elapsed;
        } else if (s.play.__lastCarrierChange == null) {
            s.play.__lastCarrierChange = s.play.elapsed;
        }
    }
    const lastCarrierChange = s.play.__lastCarrierChange ?? 0;
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
    const baseCushion = CFG.COVER_CUSHION_YDS * PX_PER_YARD;
    const cushion = baseCushion * (cover.cushionBoost ?? 1);
    const coverables = ['WR1', 'WR2', 'WR3', 'TE', 'RB']
        .map(role => off[role])
        .filter(player => player?.pos && player.alive !== false);
    if (carrier?.pos && !coverables.includes(carrier)) {
        coverables.push(carrier);
    }
    const passTargetRole = ball.inAir && ball.targetId ? findOffRoleById(off, ball.targetId) : null;
    const passTarget = passTargetRole ? off[passTargetRole] : null;
    const coverageCtx = {
        s,
        dt,
        off,
        def,
        cover,
        ball,
        qbPos,
        cushion,
        carrier,
        carrierRole,
        carrierPos,
        lastCarrierChange,
        passTarget,
        passTargetRole,
    };

    MAN_KEYS.forEach(key => _updateManCoverageForKey(coverageCtx, key));
    ['S1', 'S2'].forEach((key, idx) => _updateSafetyCoverage(coverageCtx, key, idx, coverables));

    // 3) Contact & tackle logic (slightly tougher)
    if (ball.inAir) return;

    const { player: ballCarrier, id: carrierId } = carrierInfo;
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
            const tackleTrait = clamp((tackler?.modifiers?.tackle ?? 0.5) - 0.5, -0.3, 0.3);
            const breakTrait = clamp((ballCarrier?.modifiers?.breakTackle ?? 0.5) - 0.5, -0.3, 0.3);
            let tackleChance = 0.66 + (tacklerSkill - carStr) * 0.22 - (carIQ - 1.0) * 0.10 + assistants * 0.08 + (Math.random() * 0.10 - 0.05);
            tackleChance += tackleTrait * 0.25;
            tackleChance -= breakTrait * 0.22;
            const designedRun = s.play?.playCall?.type === 'RUN' && typeof s.play?.handoffTime === 'number';
            const rbRun = designedRun && (carrierRole === 'RB' || carrierId === (off.RB?.id ?? 'RB'));
            if (rbRun) {
                const visionTrait = clamp((ballCarrier?.modifiers?.vision ?? 0.5) - 0.5, -0.25, 0.25);
                const powerEdge = clamp((ballCarrier.attrs?.strength ?? 0.9) - 0.95, -0.25, 0.4);
                const runResist = clamp(0.14 + breakTrait * 0.32 + visionTrait * 0.18 + powerEdge * 0.24, -0.05, 0.42);
                tackleChance -= runResist;
            }
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
