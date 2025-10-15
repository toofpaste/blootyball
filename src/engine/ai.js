// src/engine/ai.js - new movement + decision engine inspired by retro-style football
import { clamp, dist, rand, yardsToPixY } from './helpers';
import { FIELD_PIX_W, FIELD_PIX_H, PX_PER_YARD } from './constants';
import {
    steerPlayer,
    dampMotion,
    resolveMaxSpeed,
    resolveAcceleration,
    resolvePlayerContacts,
    distanceAhead,
} from './motion';
import { startPass } from './ball';

/* -------------------------------------------------------------------------
   Shared helpers
   ------------------------------------------------------------------------- */
function ensureBrain(player) {
    if (!player) return null;
    if (!player.ai) {
        player.ai = {
            mode: 'idle',
            targets: [],
            index: 0,
            timers: {},
            meta: {},
        };
    }
    return player.ai;
}

function resetBrain(player) {
    const brain = ensureBrain(player);
    brain.mode = 'idle';
    brain.targets = [];
    brain.index = 0;
    brain.timers = {};
    brain.meta = {};
    return brain;
}

function clampFieldX(x) {
    return clamp(x, 18, FIELD_PIX_W - 18);
}

function followTargets(player, dt, speedMultiplier = 1, anticipation = 0.2) {
    const brain = ensureBrain(player);
    const target = brain.targets[brain.index];
    if (!target) {
        dampMotion(player, dt, 8.5);
        return false;
    }
    steerPlayer(player, target, dt, { speedMultiplier, anticipation });
    if (dist(player.pos, target) <= Math.max(player.physical?.radius ?? 6, 6)) {
        brain.index = Math.min(brain.index + 1, brain.targets.length);
    }
    return brain.index >= brain.targets.length;
}

function buildRouteTargets(start, path = [], { settleRadius = 6 } = {}) {
    const pts = [];
    let cursor = { x: start.x, y: start.y };
    path.forEach((step) => {
        const dx = (step.dx || 0) * PX_PER_YARD;
        const dy = (step.dy || 0) * PX_PER_YARD;
        cursor = {
            x: clampFieldX(cursor.x + dx),
            y: clamp(cursor.y + dy, 0, FIELD_PIX_H - 12),
        };
        pts.push({ ...cursor, settle: !!step.settle, label: step.label || null });
    });
    if (!pts.length) pts.push({ x: start.x, y: start.y + PX_PER_YARD * 3 });
    pts[pts.length - 1].settleRadius = settleRadius;
    return pts;
}

function attachRoute(player, path, opts = {}) {
    const brain = resetBrain(player);
    brain.mode = 'route';
    brain.targets = buildRouteTargets(player.pos, path, opts);
    brain.index = 0;
    brain.meta.release = opts.releaseDepth || PX_PER_YARD * 2;
    brain.meta.speedMultiplier = opts.speedMultiplier || 1;
    return brain;
}

function attachBlock(player, targetId, opts = {}) {
    const brain = resetBrain(player);
    brain.mode = 'block';
    brain.meta.targetId = targetId;
    brain.meta.anchor = opts.anchor || { x: player.pos.x, y: player.pos.y };
    brain.meta.style = opts.style || 'mirror';
    brain.meta.lane = opts.lane || player.pos.x;
    brain.meta.depth = opts.depth || player.pos.y;
    return brain;
}

function attachSpy(player, anchor, opts = {}) {
    const brain = resetBrain(player);
    brain.mode = 'spy';
    brain.targets = anchor ? [{ ...anchor }] : [];
    brain.meta.loose = opts.loose ?? 0;
    return brain;
}

function offensivePlayers(off) {
    return Object.keys(off || {})
        .filter((key) => off[key]?.alive)
        .map((key) => off[key]);
}

function defensivePlayers(def) {
    return Object.keys(def || {})
        .filter((key) => def[key]?.alive)
        .map((key) => def[key]);
}

function carrierFromBall(off, ball) {
    if (!ball) return null;
    if (ball.carrierId && off[ball.carrierId]) return off[ball.carrierId];
    if (ball.carrierId && typeof ball.carrierId === 'string') {
        const match = offensivePlayers(off).find((p) => p.id === ball.carrierId);
        if (match) return match;
    }
    return null;
}

function defendersNear(def, point, radius) {
    const r2 = radius * radius;
    return defensivePlayers(def).filter((d) => {
        if (!d?.pos) return false;
        const dx = d.pos.x - point.x;
        const dy = d.pos.y - point.y;
        return dx * dx + dy * dy <= r2;
    });
}

function bestOpenReceiver(off, def, play, qb, { preferPrimary = true } = {}) {
    const call = play.playCall || {};
    const candidates = ['WR1', 'WR2', 'WR3', 'TE', 'RB']
        .map((key) => off[key])
        .filter((p) => p && p.alive);
    if (!candidates.length) return null;
    const losY = play.formation?.off?.C?.pos?.y ?? qb.pos.y + PX_PER_YARD;
    let best = null;
    candidates.forEach((rcv) => {
        const defenders = defensivePlayers(def);
        const nearest = defenders.reduce((acc, d) => {
            if (!d?.pos) return acc;
            const dd = dist(d.pos, rcv.pos);
            return dd < acc.dist ? { dist: dd, who: d } : acc;
        }, { dist: Infinity, who: null });
        const separation = nearest.dist;
        const depth = Math.max(0, rcv.pos.y - losY);
        const leverage = Math.abs((qb.pos.x - rcv.pos.x) / PX_PER_YARD);
        const primaryBonus = (preferPrimary && call.primary === rcv.role) ? 0.18 : 0;
        const scrambleBonus = play.qb?.mode === 'scramble' ? 0.1 : 0;
        const catchRating = clamp(rcv.attrs?.catch ?? 0.9, 0.5, 1.4);
        const score = separation * 0.012 + depth * 0.008 - leverage * 0.015 + primaryBonus + scrambleBonus + (catchRating - 1) * 0.35;
        if (!best || score > best.score) {
            best = { player: rcv, score };
        }
    });
    return best?.player || null;
}

function offensiveLineKeys() {
    return ['LT', 'LG', 'C', 'RG', 'RT'];
}

function defensiveLineKeys() {
    return ['LE', 'DT', 'RTk', 'RE'];
}

function linebackerKeys() {
    return ['LB1', 'LB2'];
}

function defensiveBackKeys() {
    return ['CB1', 'CB2', 'NB', 'S1', 'S2'];
}

/* -------------------------------------------------------------------------
   Route + assignment initialisation
   ------------------------------------------------------------------------- */
function computeReleaseDepth(call) {
    if (!call) return PX_PER_YARD * 2.5;
    if (call.quickGame) return PX_PER_YARD * 2;
    if (call.type === 'RUN') return PX_PER_YARD * 1.2;
    return PX_PER_YARD * clamp(call.qbDrop ?? 5, 3, 9);
}

function initialiseReceiverRoute(off, key, call) {
    const player = off[key];
    if (!player) return;
    const path = call?.wrRoutes?.[key] || call?.teRoute || [{ dx: 0, dy: 4 }];
    const brain = attachRoute(player, path, {
        settleRadius: PX_PER_YARD * 0.5,
        speedMultiplier: 1 + clamp((player.attrs?.agility ?? 1) - 1, -0.3, 0.35),
    });
    brain.meta.role = 'receiver';
    brain.meta.primary = call?.primary === key;
}

function initialiseTightEnd(off, call) {
    const player = off.TE;
    if (!player) return;
    const path = call?.teRoute || [{ dx: 0, dy: 4 }];
    const brain = attachRoute(player, path, {
        settleRadius: PX_PER_YARD * 0.6,
        speedMultiplier: 0.95 + clamp((player.attrs?.agility ?? 1) - 1, -0.25, 0.25),
    });
    brain.meta.role = 'te';
    brain.meta.primary = call?.primary === 'TE';
}

function initialiseRunningBack(off, call) {
    const player = off.RB;
    if (!player) return;
    if (call?.type === 'RUN') {
        const path = call?.rbPath || [{ dx: 0, dy: 4 }];
        const brain = attachRoute(player, path, {
            settleRadius: PX_PER_YARD * 0.6,
            speedMultiplier: 1.05,
        });
        brain.meta.role = 'runner';
        brain.meta.followRun = true;
    } else {
        const path = call?.rbCheckdown || call?.rbPath || [{ dx: 0, dy: 2 }];
        const brain = attachRoute(player, path, {
            settleRadius: PX_PER_YARD * 0.45,
            speedMultiplier: 1 + clamp((player.attrs?.agility ?? 1) - 1, -0.25, 0.3),
        });
        brain.meta.role = 'checkdown';
        brain.meta.blockFirst = !!call?.playAction;
    }
}

function assignOffensiveLine(off, def, losY, call) {
    const defFront = defensiveLineKeys()
        .map((key) => def[key])
        .filter(Boolean);
    const linebackers = linebackerKeys()
        .map((key) => def[key])
        .filter(Boolean);

    offensiveLineKeys().forEach((key) => {
        const ol = off[key];
        if (!ol) return;
        const brain = attachBlock(ol, null, { lane: ol.pos.x, depth: losY - PX_PER_YARD * 0.6 });
        brain.meta.role = 'ol';
        brain.meta.engagedId = null;
        brain.meta.slide = call?.type === 'PASS' ? (key === 'LT' || key === 'LG' ? -1 : key === 'RT' || key === 'RG' ? 1 : 0) : 0;
        brain.meta.passSet = call?.type !== 'RUN';
        brain.meta.zone = call?.type === 'RUN' && /zone|stretch/i.test(call?.name || '') ? true : false;
        brain.meta.doubleHelp = linebackers.length ? linebackers[Math.floor(Math.random() * linebackers.length)]?.id ?? null : null;
        brain.meta.assignmentPool = defFront.map((p) => p.id);
    });
}

function initPocketPlan(off, call, losY) {
    const qb = off.QB;
    const brain = resetBrain(qb);
    const drop = clamp(call?.qbDrop ?? 5, 2, 9) * PX_PER_YARD;
    const base = { x: qb.pos.x, y: qb.pos.y - drop };
    brain.mode = 'qb-drop';
    brain.targets = [
        { x: clampFieldX(base.x + rand(-PX_PER_YARD * 0.5, PX_PER_YARD * 0.5)), y: Math.min(base.y, losY - PX_PER_YARD * 1.1) },
    ];
    brain.index = 0;
    brain.meta.releaseDepth = computeReleaseDepth(call);
    brain.meta.call = call;
    brain.meta.hasSettled = false;
    brain.meta.scrambleBias = clamp((qb.modifiers?.scrambleAggression ?? 0.45) - 0.45, -0.2, 0.4);
    brain.meta.throwTimers = { checkdown: 2.8, throwAway: 4.4 };
    brain.meta.progressionClock = 0;
    brain.meta.playAction = !!call?.playAction;
    brain.meta.lastThrowDecision = 0;
    return brain;
}

export function initRoutesAfterSnap(s) {
    const play = s.play;
    const off = play.formation.off;
    const def = play.formation.def;
    const call = play.playCall || {};
    const losY = off.C?.pos?.y ?? yardsToPixY(25);

    off.__playContext = play;

    ['WR1', 'WR2', 'WR3'].forEach((key) => initialiseReceiverRoute(off, key, call));
    initialiseTightEnd(off, call);
    initialiseRunningBack(off, call);
    assignOffensiveLine(off, def, losY, call);
    initPocketPlan(off, call, losY);

    play.routesInitialized = true;
    play.qb = { mode: 'drop', pocketTimer: 0, scrambleTarget: null };
    play.runDesign = call.type === 'RUN';
    play.passDesign = call.type !== 'RUN';
    play.runLane = call.type === 'RUN' ? (call.name || '').toLowerCase().includes('stretch') ? 'edge' : 'interior' : null;
}

/* -------------------------------------------------------------------------
   Offensive line + blocking physics
   ------------------------------------------------------------------------- */
function defenderById(def, id) {
    if (!id) return null;
    return defensivePlayers(def).find((d) => d.id === id || d.role === id) || null;
}

function selectRushTarget(def, laneX, depthY) {
    let best = null;
    defensivePlayers(def).forEach((d) => {
        if (!d?.pos) return;
        const laneScore = -Math.abs(d.pos.x - laneX) + (depthY - d.pos.y) * 0.08;
        if (!best || laneScore > best.score) {
            best = { defender: d, score: laneScore };
        }
    });
    return best?.defender || null;
}

function updatePassSet(ol, def, dt) {
    const brain = ensureBrain(ol);
    const laneX = brain.meta.lane;
    const target = defenderById(def, brain.meta.engagedId) || selectRushTarget(def, laneX, brain.meta.depth);
    if (target) brain.meta.engagedId = target.id;
    const targetX = laneX + (brain.meta.slide || 0) * PX_PER_YARD * 0.45;
    const setPoint = {
        x: clampFieldX(target ? (target.pos.x + targetX) / 2 : targetX),
        y: brain.meta.depth,
    };
    steerPlayer(ol, setPoint, dt, { anticipation: 0.4, speedMultiplier: 0.9 });
}

function updateRunBlock(ol, def, dt, play) {
    const brain = ensureBrain(ol);
    const target = defenderById(def, brain.meta.engagedId) || selectRushTarget(def, brain.meta.lane, brain.meta.depth);
    if (target) brain.meta.engagedId = target.id;
    const runLane = play.runLane;
    const offset = runLane === 'edge' ? PX_PER_YARD * (brain.meta.slide || 0.5) : 0;
    const pushPoint = {
        x: clampFieldX(brain.meta.lane + offset),
        y: play.runDesign ? play.formation.off.RB?.pos?.y ?? brain.meta.depth + PX_PER_YARD * 0.6 : brain.meta.depth,
    };
    steerPlayer(ol, pushPoint, dt, { anticipation: 0.3, speedMultiplier: 1.02 });
    if (target) {
        const leverage = { x: target.pos.x + (target.pos.x > ol.pos.x ? PX_PER_YARD * 0.3 : -PX_PER_YARD * 0.3), y: target.pos.y };
        steerPlayer(target, leverage, dt, { anticipation: 0.4, speedMultiplier: 0.88 });
    }
}

export function moveOL(off, def, dt) {
    const play = off.__playContext;
    offensiveLineKeys().forEach((key) => {
        const ol = off[key];
        if (!ol) return;
        if (!ol.ai) ensureBrain(ol);
        if (play?.passDesign) {
            updatePassSet(ol, def, dt);
        } else {
            updateRunBlock(ol, def, dt, play);
        }
    });

    const engaged = [
        ...offensiveLineKeys().map((key) => off[key]).filter(Boolean),
        ...defensiveLineKeys().map((key) => def[key]).filter(Boolean),
    ];
    resolvePlayerContacts(engaged, dt, { overlap: 0.85, slop: 0.15, momentumScale: 1.2 });
}

/* -------------------------------------------------------------------------
   Receivers + tight ends
   ------------------------------------------------------------------------- */
function updateReceiver(off, def, player, dt, play) {
    const brain = ensureBrain(player);
    if (play.runDesign && brain.meta.role !== 'te') {
        const seal = {
            x: clampFieldX(play.runLane === 'edge' ? player.pos.x + PX_PER_YARD * (player.pos.x > FIELD_PIX_W / 2 ? 1 : -1) : player.pos.x),
            y: player.pos.y + PX_PER_YARD * 0.8,
        };
        steerPlayer(player, seal, dt, { anticipation: 0.25, speedMultiplier: 0.9 });
        return;
    }

    const finished = followTargets(player, dt, brain.meta.speedMultiplier ?? 1, 0.35);
    if (finished && brain.targets.length) {
        const settle = brain.targets[brain.targets.length - 1];
        steerPlayer(player, settle, dt, { anticipation: 0.1, speedMultiplier: 0.6 });
    }

    if (play.qb?.mode === 'scramble') {
        const scrambleTarget = {
            x: clampFieldX(play.qb.scrambleTarget?.x ?? player.pos.x + rand(-PX_PER_YARD * 2.2, PX_PER_YARD * 2.2)),
            y: player.pos.y + PX_PER_YARD * rand(0.8, 1.6),
        };
        steerPlayer(player, scrambleTarget, dt, { anticipation: 0.25, speedMultiplier: 1.05 });
    }
}

export function moveReceivers(off, dt, state) {
    const play = state.play;
    off.__playContext = play;
    const def = play.formation.def;
    ['WR1', 'WR2', 'WR3'].forEach((key) => {
        const player = off[key];
        if (!player || !player.alive) return;
        if (state.play.ball.carrierId === key) return;
        updateReceiver(off, def, player, dt, play);
    });
}

export function moveTE(off, dt, state) {
    const play = state.play;
    const player = off.TE;
    if (!player || !player.alive) return;
    if (state.play.ball.carrierId === 'TE') return;
    updateReceiver(off, play.formation.def, player, dt, play);
}

/* -------------------------------------------------------------------------
   Quarterback decision engine
   ------------------------------------------------------------------------- */
function qbPocketStress(def, qb) {
    const rushers = defensivePlayers(def).filter((d) => d.role && /LE|DT|RTk|RE|LB/.test(d.role));
    if (!rushers.length) return 0;
    const danger = rushers.reduce((acc, d) => {
        const dDist = Math.max(4, dist(d.pos, qb.pos));
        return acc + (1 / dDist) * (resolveMaxSpeed(d, {}) / 120);
    }, 0);
    return danger;
}

function qbEvaluateThrow(state, qb, dt) {
    const { play } = state;
    const off = play.formation.off;
    const def = play.formation.def;
    const ball = play.ball;
    if (ball.inAir) return;
    const brain = ensureBrain(qb);

    brain.meta.progressionClock += dt;
    const open = bestOpenReceiver(off, def, play, qb, { preferPrimary: true });
    if (!open) return;
    const releaseReady = brain.meta.hasSettled && brain.meta.progressionClock > 0.4;
    if (!releaseReady) return;
    const window = dist(open.pos, qb.pos);
    if (window < PX_PER_YARD * 1.2) {
        startPass(state, qb.pos, { x: open.pos.x, y: open.pos.y }, open.id || open.role);
        brain.meta.lastThrowDecision = state.play.elapsed;
        return;
    }
    const lead = distanceAhead(open.pos, open.motion?.heading || { x: 0, y: 1 }, PX_PER_YARD * 1.5);
    startPass(state, qb.pos, lead, open.id || open.role);
    brain.meta.lastThrowDecision = state.play.elapsed;
}

function qbScramblePlan(state, qb) {
    const { play } = state;
    const pocket = play.qb;
    if (pocket.mode !== 'scramble') {
        pocket.mode = 'scramble';
        const lateral = rand(-PX_PER_YARD * 3.5, PX_PER_YARD * 3.5);
        const push = PX_PER_YARD * rand(2.5, 4.6);
        pocket.scrambleTarget = { x: clampFieldX(qb.pos.x + lateral), y: qb.pos.y + push };
    }
    return pocket.scrambleTarget;
}

function qbThrowAway(state, qb) {
    const sidelineX = qb.pos.x < FIELD_PIX_W / 2 ? 12 : FIELD_PIX_W - 12;
    const target = { x: sidelineX, y: qb.pos.y + PX_PER_YARD * 2.5 };
    startPass(state, qb.pos, target, null);
}

export function qbLogic(state, dt) {
    const { play } = state;
    const off = play.formation.off;
    const def = play.formation.def;
    const qb = off.QB;
    const brain = ensureBrain(qb);

    if (play.ball.carrierId !== 'QB' && !play.ball.inAir) {
        dampMotion(qb, dt, 8.5);
        return;
    }

    if (brain.mode === 'qb-drop') {
        const finished = followTargets(qb, dt, 0.9, 0.25);
        if (finished) {
            brain.mode = 'qb-pocket';
            brain.meta.hasSettled = true;
            play.qb.mode = 'pocket';
        }
    } else if (brain.mode === 'qb-pocket') {
        play.qb.mode = 'pocket';
        const settle = brain.targets[brain.targets.length - 1] || { x: qb.pos.x, y: qb.pos.y };
        steerPlayer(qb, settle, dt, { anticipation: 0.22, speedMultiplier: 0.55 });
    }

    const stress = qbPocketStress(def, qb);
    const timeSinceSnap = play.elapsed;
    const timeInPocket = timeSinceSnap - (brain.meta.lastThrowDecision || 0);

    if (stress > 0.35 || timeInPocket > 3.2) {
        const target = qbScramblePlan(state, qb);
        steerPlayer(qb, target, dt, { anticipation: 0.32, speedMultiplier: 1.08 });
        play.qb.mode = 'scramble';
        if (dist(qb.pos, target) < PX_PER_YARD) {
            play.qb.scrambleTarget = { x: clampFieldX(qb.pos.x + rand(-PX_PER_YARD, PX_PER_YARD)), y: qb.pos.y + PX_PER_YARD * 2 };
        }
    }

    if (!play.ball.inAir) {
        qbEvaluateThrow(state, qb, dt);
        if (play.qb.mode === 'scramble' && !play.ball.inAir && rand(0, 1) < dt * 0.45) {
            const open = bestOpenReceiver(off, def, play, qb, { preferPrimary: false });
            if (open) {
                const lead = distanceAhead(open.pos, open.motion?.heading || { x: 0, y: 1 }, PX_PER_YARD * 1.8);
                startPass(state, qb.pos, lead, open.id || open.role);
                return;
            }
        }
    }

    if (!play.ball.inAir && play.qb.mode === 'scramble' && timeInPocket > 4.6) {
        qbThrowAway(state, qb);
    }
}

/* -------------------------------------------------------------------------
   Running back behaviour
   ------------------------------------------------------------------------- */
function searchRunLane(off, def, rb, play) {
    const losY = off.C?.pos?.y ?? rb.pos.y - PX_PER_YARD;
    const forwardY = rb.pos.y + PX_PER_YARD * 1.8;
    const lanes = [];
    for (let offset = -PX_PER_YARD * 3; offset <= PX_PER_YARD * 3; offset += PX_PER_YARD) {
        const laneX = clampFieldX(rb.pos.x + offset);
        const point = { x: laneX, y: forwardY };
        const defPressure = defendersNear(def, point, PX_PER_YARD * 1.2).length;
        const olHelp = offensiveLineKeys().reduce((acc, key) => {
            const ol = off[key];
            if (!ol?.pos) return acc;
            return acc + Math.max(0, PX_PER_YARD * 1.5 - dist(ol.pos, point));
        }, 0);
        lanes.push({ x: laneX, score: olHelp - defPressure * PX_PER_YARD * 0.8 });
    }
    lanes.sort((a, b) => b.score - a.score);
    return lanes[0]?.x ?? rb.pos.x;
}

function rbAdvance(state, rb, dt) {
    const { play } = state;
    const off = play.formation.off;
    const def = play.formation.def;
    const brain = ensureBrain(rb);

    if (play.runDesign && play.ball.carrierId === 'RB') {
        if (!brain.meta.finalHole || state.play.elapsed - (brain.meta.lastRetarget ?? 0) > 0.35) {
            brain.meta.finalHole = searchRunLane(off, def, rb, play);
            brain.meta.lastRetarget = state.play.elapsed;
        }
        const burst = 1 + clamp((rb.attrs?.accel ?? 14) - 14, -4, 6) * 0.02;
        const target = { x: brain.meta.finalHole, y: rb.pos.y + PX_PER_YARD * 2.4 };
        steerPlayer(rb, target, dt, { anticipation: 0.22, speedMultiplier: burst });
        return;
    }

    if (!play.runDesign && brain.meta.blockFirst && state.play.elapsed < 1.4) {
        const threat = selectRushTarget(def, rb.pos.x, rb.pos.y + PX_PER_YARD * 0.5);
        if (threat) {
            steerPlayer(rb, { x: threat.pos.x, y: rb.pos.y - PX_PER_YARD * 0.3 }, dt, { anticipation: 0.2, speedMultiplier: 0.9 });
            return;
        }
    }

    followTargets(rb, dt, brain.meta.speedMultiplier ?? 1, 0.2);
}

export function rbLogic(state, dt) {
    const off = state.play.formation.off;
    const rb = off.RB;
    if (!rb || !rb.alive) return;
    rbAdvance(state, rb, dt);
}

/* -------------------------------------------------------------------------
   Defensive logic
   ------------------------------------------------------------------------- */
function defenderAssignment(def, key, play) {
    const brain = ensureBrain(def[key]);
    switch (key) {
        case 'LE':
        case 'DT':
        case 'RTk':
        case 'RE':
            brain.mode = 'rush';
            brain.meta.gap = key === 'LE' || key === 'RE' ? (key === 'LE' ? -1 : 1) : 0;
            break;
        case 'LB1':
        case 'LB2':
            brain.mode = 'read';
            brain.meta.blitz = play.playCall?.type === 'RUN' ? rand(0, 1) < 0.35 : rand(0, 1) < 0.55;
            break;
        case 'NB':
        case 'CB1':
        case 'CB2':
            brain.mode = 'man';
            brain.meta.cover = key === 'NB' ? 'WR3' : key === 'CB1' ? 'WR1' : 'WR2';
            break;
        case 'S1':
        case 'S2':
            brain.mode = 'safety';
            brain.targets = [{ x: clampFieldX(FIELD_PIX_W / 2 + (key === 'S1' ? -PX_PER_YARD * 4 : PX_PER_YARD * 4)), y: play.formation.off.C.pos.y - PX_PER_YARD * 5 }];
            brain.index = 0;
            break;
        default:
            brain.mode = 'spy';
    }
}

function ensureDefensePlan(play) {
    const def = play.formation.def;
    defensivePlayers(def).forEach((player) => defenderAssignment(def, player.role, play));
}

function rushQuarterback(defender, state, dt) {
    const qb = state.play.formation.off.QB;
    const aim = { x: qb.pos.x + (defender.ai.meta.gap || 0) * PX_PER_YARD * 0.6, y: qb.pos.y - PX_PER_YARD * 0.4 };
    steerPlayer(defender, aim, dt, { anticipation: 0.25, speedMultiplier: 1.05 });
}

function fillRun(defender, state, dt) {
    const rb = state.play.formation.off.RB;
    const target = rb && state.play.ball.carrierId === 'RB' ? rb.pos : state.play.formation.off.QB.pos;
    steerPlayer(defender, { x: target.x, y: target.y - PX_PER_YARD * 0.6 }, dt, { anticipation: 0.22, speedMultiplier: 1.0 });
}

function manCover(defender, state, dt, coverKey) {
    const off = state.play.formation.off;
    const mark = off[coverKey];
    if (!mark) {
        dampMotion(defender, dt, 7.0);
        return;
    }
    const leverage = { x: clampFieldX(mark.pos.x + (mark.pos.x > defender.pos.x ? -PX_PER_YARD * 0.6 : PX_PER_YARD * 0.6)), y: mark.pos.y - PX_PER_YARD * 0.8 };
    steerPlayer(defender, leverage, dt, { anticipation: 0.3, speedMultiplier: 1.08 });
}

function safetyRange(defender, state, dt) {
    const qb = state.play.formation.off.QB;
    const brain = ensureBrain(defender);
    const target = brain.targets[0] || { x: FIELD_PIX_W / 2, y: qb.pos.y - PX_PER_YARD * 8 };
    steerPlayer(defender, target, dt, { anticipation: 0.18, speedMultiplier: 0.92 });
}

function attemptTackle(state, defender, dt) {
    const off = state.play.formation.off;
    const carrier = carrierFromBall(off, state.play.ball);
    if (!carrier) return;
    const proximity = dist(defender.pos, carrier.pos);
    if (proximity > PX_PER_YARD * 0.9) return;
    const tackleSkill = clamp(defender.attrs?.tackle ?? 1, 0.6, 1.35);
    const strengthDelta = (tackleSkill - (carrier.attrs?.strength ?? 1)) * 0.45;
    const momentum = (resolveAcceleration(defender, {}) / resolveAcceleration(carrier, {})) * 0.4;
    const chance = clamp(0.35 + strengthDelta + momentum, 0.05, 0.9);
    if (Math.random() < chance) {
        state.play.deadAt = state.play.elapsed;
        state.play.phase = 'DEAD';
        state.play.resultWhy = 'Tackled';
        state.play.ball.carrierId = carrier.id || carrier.role;
        state.play.tackleBy = defender.id || defender.role;
    } else {
        state.play.runExtra = (state.play.runExtra || 0) + PX_PER_YARD * 0.6;
        steerPlayer(carrier, { x: carrier.pos.x, y: carrier.pos.y + PX_PER_YARD * 0.6 }, dt, { anticipation: 0.2, speedMultiplier: 1.1 });
    }
}

export function defenseLogic(state, dt) {
    const def = state.play.formation.def;
    ensureDefensePlan(state.play);

    defensivePlayers(def).forEach((player) => {
        if (!player?.ai) ensureBrain(player);
        switch (player.ai.mode) {
            case 'rush':
                rushQuarterback(player, state, dt);
                break;
            case 'read':
                if (state.play.ball.carrierId === 'RB' || state.play.runDesign) fillRun(player, state, dt);
                else rushQuarterback(player, state, dt);
                break;
            case 'man':
                manCover(player, state, dt, player.ai.meta.cover);
                break;
            case 'safety':
                safetyRange(player, state, dt);
                break;
            case 'spy':
            default:
                fillRun(player, state, dt);
                break;
        }
        attemptTackle(state, player, dt);
    });

    const contactPlayers = defensivePlayers(def).concat(offensivePlayers(state.play.formation.off));
    resolvePlayerContacts(contactPlayers, dt, { overlap: 0.88, momentumScale: 1.1, slop: 0.12 });

    updateWrapFlags(state);
}

/* -------------------------------------------------------------------------
   Utility exports used by other modules
   ------------------------------------------------------------------------- */
export function moveToward(player, target, dt, speedMul = 1) {
    steerPlayer(player, target, dt, { speedMultiplier: speedMul });
}

export function isWrapped(state, playerId) {
    if (!playerId) return false;
    const off = state.play.formation.off;
    const carrier = off[playerId] || offensivePlayers(off).find((p) => p.id === playerId);
    if (!carrier) return false;
    const def = state.play.formation.def;
    const contacts = defendersNear(def, carrier.pos, PX_PER_YARD * 0.8);
    return contacts.length >= 2;
}

export function updateWrapFlags(state) {
    const off = state.play.formation.off;
    const carrierId = state.play.ball.carrierId;
    if (!carrierId) {
        off.__carrierWrapped = null;
        off.__carrierWrappedId = null;
        return;
    }
    const wrapped = isWrapped(state, carrierId);
    off.__carrierWrapped = wrapped ? carrierId : null;
    off.__carrierWrappedId = wrapped ? carrierId : null;
}

