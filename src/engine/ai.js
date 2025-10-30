// src/engine/ai.js
import {
    clamp,
    dist,
    rand,
    unitVec,
    yardsToPixY,
    findPlayerById,
    forEachPlayer,
} from './helpers';
import { FIELD_PIX_W, FIELD_PIX_H, PX_PER_YARD } from './constants';
import { steerPlayer, dampMotion, applyCollisionSlowdown } from './motion';
import { getPlayerMass, getPlayerRadius } from './physics';
import { startPass, startPitch, startFumble, isBallLoose } from './ball';

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

function pursueLooseBallGroup(players, ball, dt, speedMul = 1, jitter = 8) {
    if (!Array.isArray(players) || !players.length) return false;
    if (!isBallLoose(ball)) return false;
    const target = ball.loose?.pos || ball.renderPos || ball.shadowPos;
    if (!target) return false;

    let acted = false;
    for (let i = 0; i < players.length; i++) {
        const p = players[i];
        if (!p?.pos) continue;
        if (p.targets) p.targets = null;
        p.routeIdx = null;
        const aim = {
            x: clamp(target.x + rand(-jitter, jitter), 16, FIELD_PIX_W - 16),
            y: clamp(target.y + rand(-jitter, jitter), 0, FIELD_PIX_H - 6),
        };
        moveToward(p, aim, dt, speedMul, { behavior: 'PURSUIT' });
        acted = true;
    }
    return acted;
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
    ai._scrDecision = null;
}

function _markRouteFinished(player, aiRoute, heading = null) {
    if (!aiRoute) return;
    aiRoute.finished = true;
    aiRoute.scrambleTimer = 0;
    if (heading) {
        const mag = Math.hypot(heading.x, heading.y) || 1;
        aiRoute.exitHeading = { x: heading.x / mag, y: heading.y / mag };
    } else if (!aiRoute.exitHeading) {
        aiRoute.exitHeading = { x: 0, y: 1 };
    }
}

function _timeSinceLive(play) {
    if (!play) return 0;
    const now = play.elapsed || 0;
    const liveAnchor = play.liveAt ?? play.postSnapStartedAt ?? 0;
    return Math.max(0, now - liveAnchor);
}

function _runStateMachine(ai, states = []) {
    if (!ai || !Array.isArray(states)) return false;
    for (const state of states) {
        if (!state) continue;
        const { name, valid, action } = state;
        const ok = typeof valid === 'function' ? !!valid() : !!valid;
        if (!ok) continue;
        if (name) ai.phase = name;
        if (typeof action === 'function') action();
        return true;
    }
    return false;
}

function _nearestAssignmentDefender(def, player) {
    if (!player) return null;
    let best = null;
    forEachPlayer(def, (d) => {
        if (!d?.pos) return;
        const dd = dist(d.pos, player.pos);
        if (!best || dd < best.dist) best = { dist: dd, defender: d };
    });
    return best;
}

function _skillPreSnapAlign(player, anchor, dt) {
    if (!player?.pos || !anchor) return;
    const settle = {
        x: clamp(anchor.x, 16, FIELD_PIX_W - 16),
        y: clamp(anchor.y, 0, FIELD_PIX_H - 6),
    };
    moveToward(player, settle, dt, 0.55, { behavior: 'ALIGN', settleDamping: 6.2 });
}

function _receiverFirstStep(player, context, dt) {
    if (!player?.pos) return;
    const def = context?.def || {};
    const ai = _ensureAI(player);
    const releaseIdx = typeof player.routeIdx === 'number' ? player.routeIdx : 0;
    const firstTarget = Array.isArray(player.targets) && player.targets.length
        ? player.targets[Math.min(releaseIdx, player.targets.length - 1)]
        : null;
    let aim = firstTarget
        ? { x: firstTarget.x, y: Math.min(firstTarget.y, player.pos.y + PX_PER_YARD * 1.2) }
        : { x: player.pos.x, y: player.pos.y + PX_PER_YARD };

    const nearest = _nearestAssignmentDefender(def, player);
    if (nearest?.defender?.pos) {
        const pressRange = PX_PER_YARD * 1.4;
        const offRange = PX_PER_YARD * 4.6;
        if (nearest.dist <= pressRange) {
            const shade = Math.sign(player.pos.x - nearest.defender.pos.x) || (player.pos.x < FIELD_PIX_W / 2 ? -1 : 1);
            aim.x += shade * PX_PER_YARD * 0.8;
            aim.y = Math.max(aim.y, player.pos.y + PX_PER_YARD * 0.6);
        } else if (nearest.dist <= offRange) {
            const cushion = clamp(nearest.dist * 0.55, PX_PER_YARD * 1.2, PX_PER_YARD * 2.4);
            aim.y = Math.min(player.pos.y + cushion, aim.y + PX_PER_YARD * 0.4);
        }
    }

    moveToward(player, aim, dt, 0.92, {
        behavior: 'RELEASE',
        pursuitTarget: nearest?.defender || null,
    });
    ai.prevHeading = ai.prevHeading || { x: 0, y: 1 };
}

function _receiverReact(player, context, dt) {
    if (!player?.pos) return;
    const ai = _ensureAI(player);
    const def = context?.def || {};
    const carrier = context?.carrier;
    const acted = carrier && carrier !== player && _assistCarrierBlock(player, def, dt, context);
    if (acted) return;

    if (_shouldThrottleAfterRoute(context)) {
        _settleAfterRoute(player, context, dt);
        return;
    }

    const qb = context?.qb;
    if (qb?.pos) {
        const look = {
            x: clamp(qb.pos.x, 18, FIELD_PIX_W - 18),
        };
        const midpointY = clamp((player.pos.y + qb.pos.y) / 2, 0, FIELD_PIX_H - 6);
        look.y = midpointY;
        moveToward(player, look, dt, 0.6, { behavior: 'ADJUST' });
        ai._scrDecision = null;
    }
}

function _receiverScramble(player, ai, context, dt, speedMul = 0.96) {
    if (!player?.pos) return;
    _updateScrambleDecision(player, ai, context, dt, speedMul);
}

function _receiverFinish(player, context, dt, { speedCatch = 1.0 } = {}) {
    const { ball, off, def, carrier } = context;
    const ai = _ensureAI(player);
    ai._scrDecision = null;

    if (context.wrapLocked) {
        return;
    }

    if (context.ballLoose && ball) {
        pursueLooseBallGroup([player], ball, dt, 1.12, 10);
        return;
    }

    if (context.isCarrier) {
        _racAdvance(off, def || {}, player, dt, context.play);
        return;
    }

    if (context.targeted && ball) {
        const spot = ball.flight?.targetSpot
            ? { ...ball.flight.targetSpot }
            : ball.to
                ? { ...ball.to }
                : ball.renderPos
                    ? { ...ball.renderPos }
                    : { x: player.pos.x, y: player.pos.y };
        const dest = {
            x: clamp(spot.x, 16, FIELD_PIX_W - 16),
            y: clamp(spot.y, 0, FIELD_PIX_H - 6),
        };
        const distance = dist(player.pos, dest);
        const speedMul = distance > PX_PER_YARD * 4
            ? 1.08 * speedCatch
            : distance > PX_PER_YARD * 2
                ? 0.98 * speedCatch
                : 0.8 * speedCatch;
        moveToward(player, dest, dt, speedMul, { behavior: 'CATCH', settleDamping: 2.4 });
        player.targets = player.targets || null;
        player.routeIdx = null;
        return;
    }

    if (carrier && carrier !== player) {
        if (_assistCarrierBlock(player, def || {}, dt, context)) return;
        if (context.runFlag) {
            _runSupportReceiver(player, context.off, def || {}, dt, context);
            return;
        }
    }

    if (_shouldThrottleAfterRoute(context)) {
        _settleAfterRoute(player, context, dt);
        return;
    }

    const heading = ai.prevHeading || { x: 0, y: 1 };
    const look = 36;
    const target = {
        x: clamp(player.pos.x + heading.x * look, 16, FIELD_PIX_W - 16),
        y: player.pos.y + heading.y * look,
    };
    moveToward(player, target, dt, 0.72, { behavior: 'FINISH' });
}

function _rbFirstStep(rb, context, dt, burst) {
    const call = context.call || {};
    const qb = context.qb;
    if (!rb?.pos || !qb?.pos) return;

    if (call.type === 'RUN') {
        const firstTarget = Array.isArray(context.play?.rbTargets) ? context.play.rbTargets[0] : null;
        const trackX = clamp(firstTarget?.x ?? qb.pos.x, 18, FIELD_PIX_W - 18);
        const trackY = Math.min(firstTarget?.y ?? (qb.pos.y + PX_PER_YARD * 0.6), qb.pos.y + PX_PER_YARD * 0.6);
        moveToward(rb, { x: trackX, y: trackY }, dt, 1.04 * burst, { behavior: 'RUNFIT' });
        return;
    }

    const anchor = context.anchor || { x: rb.pos.x, y: rb.pos.y + PX_PER_YARD * 0.6 };
    moveToward(rb, anchor, dt, 0.86 * burst, { behavior: 'ALIGN' });
}

function _rbExecuteRun(rb, context, dt, burst, patienceBase) {
    const ai = _ensureAI(rb);
    ai.patience = ai.patience ?? patienceBase;
    ai.patienceClock = (ai.patienceClock || 0) + dt;
    const patiencePhase = ai.patienceClock < ai.patience;

    if (!context.play?.handed) {
        _rbFirstStep(rb, context, dt, burst);
        return;
    }

    const mods = context.mods || {};
    const lane = _computeLaneForRB(context.off, context.def, rb, context.losY);
    const vision = clamp((mods.vision ?? 0.5) - 0.5, -0.3, 0.3);
    const blendBase = patiencePhase ? 0.45 : 0.8;
    const laneX = clamp(_lerp(rb.pos.x, lane.x, clamp(blendBase + vision * 0.25, 0.2, 1.0)), 18, FIELD_PIX_W - 18);
    const laneY = Math.max(context.off.__runLaneY ?? (rb.pos.y + PX_PER_YARD * 2.5), context.losY + PX_PER_YARD * 2.2);
    const depthTarget = { x: laneX, y: laneY };

    if (patiencePhase) {
        const settle = { x: laneX, y: Math.min(rb.pos.y + PX_PER_YARD, context.losY + PX_PER_YARD * 0.8) };
        moveToward(rb, settle, dt, 0.8 * burst, { behavior: 'RUNFIT' });
    } else {
        moveToward(rb, depthTarget, dt, 1.18 * burst, { behavior: 'RUNFIT' });
    }

    if (context.play?.rbTargets && context.play.rbTargets.length > 1 && ai.patienceClock < ai.patience + 0.35) {
        const next = context.play.rbTargets[Math.min(1, context.play.rbTargets.length - 1)];
        moveToward(rb, next, dt, 1.05 * burst, { behavior: 'RUNFIT' });
    }
}

function _rbExecutePass(rb, context, dt, burst) {
    if (context.carrier && context.carrier !== rb) {
        if (_assistCarrierBlock(rb, context.def || {}, dt, context)) return;
    }
    const protectedLane = _rbPassProtect(rb, context.off, context.def, dt, context);
    if (protectedLane) return;

    if (rb.targets && rb.routeIdx != null) {
        const routeFollowed = _updateRouteRunner(rb, context, dt);
        if (routeFollowed) return;
        if (_shouldThrottleAfterRoute(context)) {
            _settleAfterRoute(rb, context, dt);
            return;
        }
    }

    const qb = context.qb;
    if (!qb?.pos) return;
    const check = {
        x: clamp(qb.pos.x + rand(-28, 28), 24, FIELD_PIX_W - 24),
        y: qb.pos.y + PX_PER_YARD * 2.4,
    };
    moveToward(rb, check, dt, 0.92 * burst, { behavior: 'ROUTE' });
}

function _rbReactAdjust(rb, context, dt, burst) {
    const { def, off, carrier, tackler } = context;
    if (carrier && carrier !== rb) {
        if (_assistCarrierBlock(rb, def || {}, dt, context)) return;
    }

    const qb = context.qb;
    if (qb?.pos) {
        const checkdown = {
            x: clamp(qb.pos.x + rand(-18, 18), 20, FIELD_PIX_W - 20),
            y: Math.min(qb.pos.y + PX_PER_YARD * 2.8, context.losY + PX_PER_YARD * 4.6),
        };
        moveToward(rb, checkdown, dt, 0.86 * burst, { behavior: 'CHECKDOWN' });
    }
}

function _rbScrambleAdjust(rb, context, dt, burst) {
    const qb = context.qb;
    if (!qb?.pos) return;
    const distToQB = dist(rb.pos, qb.pos);
    if (distToQB <= PX_PER_YARD * 5) {
        const protectSpot = {
            x: clamp(qb.pos.x + (rb.pos.x < qb.pos.x ? -PX_PER_YARD * 1.4 : PX_PER_YARD * 1.4), 18, FIELD_PIX_W - 18),
            y: Math.max(qb.pos.y - PX_PER_YARD * 0.6, context.losY + PX_PER_YARD * 0.6),
        };
        moveToward(rb, protectSpot, dt, 1.05 * burst, { behavior: 'PROTECT' });
        return;
    }

    const sideline = rb.pos.x < FIELD_PIX_W / 2 ? 18 : FIELD_PIX_W - 18;
    const settle = {
        x: clamp((qb.pos.x + sideline) / 2, 18, FIELD_PIX_W - 18),
        y: Math.max(qb.pos.y + PX_PER_YARD * 2.2, context.losY + PX_PER_YARD * 4),
    };
    moveToward(rb, settle, dt, 0.94 * burst, { behavior: 'SCRAMBLE' });
}

function _rbFinish(rb, context, dt, burst) {
    const { ball, off, def } = context;
    if (context.ballLoose && ball) {
        pursueLooseBallGroup([rb], ball, dt, 1.3, 12);
        return;
    }

    if (context.isCarrier) {
        _racAdvance(off, def || {}, rb, dt, context.play);
        return;
    }

    if (context.targeted && ball) {
        const spot = ball.flight?.targetSpot
            ? { ...ball.flight.targetSpot }
            : ball.to
                ? { ...ball.to }
                : ball.renderPos
                    ? { ...ball.renderPos }
                    : { x: rb.pos.x, y: rb.pos.y };
        const dest = {
            x: clamp(spot.x, 16, FIELD_PIX_W - 16),
            y: clamp(spot.y, 0, FIELD_PIX_H - 6),
        };
        const distance = dist(rb.pos, dest);
        const speedMul = distance > PX_PER_YARD * 4
            ? 1.1 * burst
            : distance > PX_PER_YARD * 2
                ? 0.98 * burst
                : 0.82 * burst;
        moveToward(rb, dest, dt, speedMul, { behavior: 'CATCH', settleDamping: 2.2 });
        rb.targets = null;
        rb.routeIdx = null;
        return;
    }

    _rbReactAdjust(rb, context, dt, burst);
}

function _cornerPreSnapAlign(defender, target, options, ctx, dt) {
    const losY = ctx.cover?.losY ?? defender.pos.y;
    const cushion = options?.cushionY ?? PX_PER_YARD * 2.4;
    const leverage = options?.leverage ?? 0;
    const aim = {
        x: clamp((target?.pos?.x ?? defender.pos.x) + leverage * PX_PER_YARD, 18, FIELD_PIX_W - 18),
        y: Math.max(losY - cushion, 0),
    };
    moveToward(defender, aim, dt, 0.72, { behavior: 'ALIGN' });
}

function _cornerFirstStep(defender, target, ctx, dt) {
    if (!target?.pos) {
        moveToward(defender, { x: defender.pos.x, y: Math.max(defender.pos.y - PX_PER_YARD * 0.6, ctx.cover.losY - PX_PER_YARD * 4) }, dt, 0.78, { behavior: 'PEDAL' });
        return;
    }
    const separation = dist(defender.pos, target.pos);
    if (separation < PX_PER_YARD * 1.4) {
        moveToward(defender, { x: target.pos.x, y: Math.max(target.pos.y - PX_PER_YARD * 0.4, ctx.cover.losY) }, dt, 1.08, { behavior: 'PRESS' });
    } else {
        const depth = Math.max(defender.pos.y - PX_PER_YARD * 0.8, ctx.cover.losY - PX_PER_YARD * 4);
        moveToward(defender, { x: defender.pos.x, y: depth }, dt, 0.8, { behavior: 'PEDAL' });
    }
}

function _cornerExecute(defender, target, options, ctx) {
    if (target?.pos) {
        const aim = _manAim(defender, target, ctx.cover.losY, ctx.dt, options || {});
        moveToward(defender, aim, ctx.dt, _speedFromAttrs(defender, options.baseSpeed ?? 1.02), {
            behavior: 'MAN',
            pursuitTarget: target,
        });
        return;
    }

    const fallbackY = ctx.cover.losY + PX_PER_YARD * 6.2;
    const fallbackX = defender.pos.x >= FIELD_PIX_W / 2 ? FIELD_PIX_W - PX_PER_YARD * 6 : PX_PER_YARD * 6;
    moveToward(defender, { x: fallbackX, y: fallbackY }, ctx.dt, _speedFromAttrs(defender, 0.94), { behavior: 'ZONE' });
}

function _cornerReact(defender, target, ctx, dt) {
    const carrier = ctx.carrier || null;
    if (carrier?.pos && carrier !== target) {
        _pursueTarget(defender, carrier, ctx, 1.08, 'PURSUIT');
        return;
    }
    if (target?.pos) {
        const shade = _manAim(defender, target, ctx.cover.losY, dt, {});
        moveToward(defender, shade, dt, _speedFromAttrs(defender, 0.98), { behavior: 'ADJUST' });
    }
}

function _cornerScramble(defender, target, ctx) {
    if (target?.pos) {
        _pursueTarget(defender, target, ctx, 1.12, 'SCRAMBLE');
        return;
    }
    if (ctx.carrier?.pos) {
        _pursueTarget(defender, ctx.carrier, ctx, 1.1, 'PURSUIT');
    }
}

function _cornerFinish(defender, target, ctx) {
    const ball = ctx.ball;
    const carrier = ctx.carrier || null;
    if (isBallLoose(ball)) {
        const targetPos = ball.loose?.pos || ball.renderPos || ball.shadowPos || { x: FIELD_PIX_W / 2, y: ctx.cover.losY };
        moveToward(defender, targetPos, ctx.dt, _speedFromAttrs(defender, 1.08), { behavior: 'PURSUIT' });
        return;
    }
    if (ctx.ball?.inAir && ctx.passTargetRole && target && target.id === ctx.passTarget?.id) {
        const intercept = ctx.catchPrediction?.pos || ctx.passTarget?.pos || target.pos;
        const aim = {
            x: clamp(intercept.x, 18, FIELD_PIX_W - 18),
            y: Math.max(intercept.y - PX_PER_YARD * 0.6, ctx.cover.losY + PX_PER_YARD * 0.6),
        };
        moveToward(defender, aim, ctx.dt, _speedFromAttrs(defender, 1.12), { behavior: 'FINISH', pursuitTarget: target });
        return;
    }
    if (carrier?.pos) {
        _pursueTarget(defender, carrier, ctx, 1.12, 'PURSUIT');
    }
}

function _safetyPreSnap(defender, ctx, dt, sideIdx) {
    const baseDepth = ctx.cover?.safetyShade?.baseDepth ?? (ctx.cover?.losY ?? defender.pos.y) + PX_PER_YARD * 12;
    const baseHash = ctx.cover?.safetyShade?.hash ?? (FIELD_PIX_W / 2);
    const offset = sideIdx === 0 ? -PX_PER_YARD * 6 : PX_PER_YARD * 6;
    const aim = {
        x: clamp(baseHash + offset, 18, FIELD_PIX_W - 18),
        y: Math.max(baseDepth - PX_PER_YARD * 0.6, ctx.cover?.losY ?? defender.pos.y),
    };
    moveToward(defender, aim, dt, 0.7, { behavior: 'ALIGN' });
}

function _safetyFirstStep(defender, ctx, dt) {
    moveToward(defender, { x: defender.pos.x, y: Math.max(defender.pos.y - PX_PER_YARD * 0.8, ctx.cover.losY + PX_PER_YARD * 6) }, dt, 0.82, { behavior: 'PEDAL' });
}

function _safetyExecute(defKey, sideIdx, ctx) {
    _safetyExecuteCore(defKey, sideIdx, ctx);
}

function _safetyReact(defender, ctx, dt) {
    const carrier = ctx.carrier;
    if (carrier?.pos) {
        _pursueTarget(defender, carrier, ctx, 1.14, 'PURSUIT');
    } else {
        const hash = ctx.cover?.safetyShade?.hash ?? FIELD_PIX_W / 2;
        const aim = { x: clamp(hash, 18, FIELD_PIX_W - 18), y: ctx.cover.losY + PX_PER_YARD * 9 };
        moveToward(defender, aim, dt, _speedFromAttrs(defender, 0.9), { behavior: 'ADJUST' });
    }
}

function _safetyScramble(defender, ctx, dt) {
    const qb = ctx.qb;
    if (qb?.pos) {
        const cap = { x: clamp(qb.pos.x, 18, FIELD_PIX_W - 18), y: Math.max(qb.pos.y - PX_PER_YARD * 0.6, ctx.cover.losY + PX_PER_YARD * 7) };
        moveToward(defender, cap, dt, _speedFromAttrs(defender, 0.98), { behavior: 'SCRAMBLE' });
    }
}

function _safetyFinish(defender, ctx, dt) {
    const ball = ctx.ball;
    if (isBallLoose(ball)) {
        const target = ball.loose?.pos || ball.renderPos || ball.shadowPos;
        if (target) moveToward(defender, target, dt, _speedFromAttrs(defender, 1.0), { behavior: 'PURSUIT' });
        return;
    }
    if (ctx.ball?.inAir && ctx.catchPrediction?.pos) {
        const intercept = ctx.catchPrediction.pos;
        moveToward(defender, { x: clamp(intercept.x, 18, FIELD_PIX_W - 18), y: Math.max(intercept.y - PX_PER_YARD * 0.4, ctx.cover.losY + PX_PER_YARD * 1.6) }, dt, _speedFromAttrs(defender, 1.04), { behavior: 'FINISH' });
        return;
    }
    if (ctx.carrier?.pos) {
        _pursueTarget(defender, ctx.carrier, ctx, 1.16, 'PURSUIT');
    }
}

function _laneSample(off, def, yDepth) {
    const samples = [];
    for (let x = 24; x <= FIELD_PIX_W - 24; x += 12) {
        const point = { x, y: yDepth };
        let offHelp = 0;
        forEachPlayer(off, (p) => {
            if (!p?.pos) return;
            const d = dist(p.pos, point);
            if (d < 18) offHelp += (18 - d);
        });
        let defThreat = 0;
        forEachPlayer(def, (p) => {
            if (!p?.pos) return;
            const d = dist(p.pos, point);
            if (d < 24) defThreat += (24 - d);
        });
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
    OL_BLOCK_PUSHBACK: 28,      // lighten OL drive so DL can compress pocket quicker
    OL_BLOCK_MIRROR: 0.9,
    OL_REACH_SPEED: 0.93,
    DL_ENGAGED_SLOW: 0.96,      // DL keep their feet driving through blocks
    DL_SEPARATION_R: 12,
    DL_SEPARATION_PUSH: 0.42,

    // ---- Shedding (new) ----
    SHED_INTERVAL: 0.22,        // attempt sheds more frequently
    SHED_BASE: 0.32,            // baseline win rate for DL hand fighting
    SHED_SIDE_STEP: 16,         // more decisive lateral wins

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
    CONTACT_R: 19,
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

    // ---- Open field jukes & convoy help ----
    JUKE_TRIGGER_R: 26,
    JUKE_BASE_CHANCE: 0.28,
    JUKE_AGI_WEIGHT: 0.36,
    JUKE_IQ_WEIGHT: 0.22,
    JUKE_DEF_SPEED_WEIGHT: 0.25,
    JUKE_DURATION: 0.38,
    JUKE_COOLDOWN: 0.75,
    JUKE_LATERAL_IMPULSE: 1.35,
    JUKE_FAIL_PENALTY: 0.55,
    JUKE_FAIL_SLOW_FACTOR: 0.32,

    HELP_BLOCK_R: 60,
    HELP_BLOCK_THREAT_R: 36,
    HELP_BLOCK_PUSH: 22,

    // ---- Coverage & pursuit (new) ----
    COVER_CUSHION_YDS: 2.8,     // desired vertical cushion in man
    COVER_SWITCH_DIST: 26,      // when crossers get closer to another DB, switch
    PURSUIT_LEAD_T: 0.32,       // defenders anticipate carrier angles more aggressively
    PURSUIT_SPEED: 1.2,         // rally speed greatly increased
    PURSUIT_TRIGGER_R: 220,     // defenders rally from further away
    PURSUIT_RECENT_TIME: 1.4,   // extend rally window after possession changes
};

const SHOTGUN_HINTS = ['gun', 'shotgun', 'empty'];
const SCRAMBLE_MIN_COMMIT_PX = PX_PER_YARD * 5;

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
        const handoffDelay = call.handoffDelay ?? 0.45;
        const handoffWindow = call.handoffWindow ?? 0.35;
        s.play.handoffStyle = 'PITCH';
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
export function moveToward(p, target, dt, speedMul = 1, options = {}) {
    if (!p) return;
    if (!target || Number.isNaN(target.x) || Number.isNaN(target.y)) {
        if (options.settleDamping) {
            dampMotion(p, dt, options.settleDamping);
        } else {
            dampMotion(p, dt);
        }
        return;
    }
    const steerOpts = { speedMultiplier: speedMul, ...options };
    steerPlayer(p, target, dt, steerOpts);
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

function _racAdvance(off, def, p, dt, play = null) {
    const ai = _ensureAI(p);
    if (ai) ai._scrDecision = null;
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

    const jukeAdjust = _updateCarrierJuke(p, def, dt, play);

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

    desired.x += jukeAdjust.lateral;
    desired.y += jukeAdjust.forward;

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

    const speedMul = clamp(CFG.RAC_SPEED * jukeAdjust.speedScale, 0.6, 1.35);
    moveToward(p, stepTarget, dt, speedMul, { behavior: 'CARRY' });
}

function _updateCarrierJuke(player, def, dt, play) {
    const ai = _ensureAI(player);
    const state = ai.juke ||= {
        cooldown: 0,
        active: 0,
        duration: 0,
        dir: 0,
        burst: 0,
        slow: 0,
        slowTotal: 0,
    };

    state.cooldown = Math.max(0, (state.cooldown || 0) - dt);
    state.active = Math.max(0, (state.active || 0) - dt);
    state.slow = Math.max(0, (state.slow || 0) - dt);

    const adjustments = { lateral: 0, forward: 0, speedScale: 1 };

    if (state.active > 0 && state.dir) {
        const phase = clamp(state.active / Math.max(state.duration || CFG.JUKE_DURATION, 1e-3), 0, 1);
        adjustments.lateral += state.dir * CFG.JUKE_LATERAL_IMPULSE * (0.6 + 0.4 * phase);
        adjustments.speedScale += (state.burst || 0) * (0.5 + 0.5 * phase);
    }

    if (state.slow > 0 && state.slowTotal > 0) {
        const slowPhase = clamp(state.slow / state.slowTotal, 0, 1);
        adjustments.speedScale -= slowPhase * CFG.JUKE_FAIL_SLOW_FACTOR;
        adjustments.forward -= slowPhase * 0.18;
    }

    if (!play || play.ball?.inAir || isBallLoose(play.ball)) {
        adjustments.speedScale = clamp(adjustments.speedScale, 0.55, 1.4);
        adjustments.forward = Math.max(-0.4, adjustments.forward);
        return adjustments;
    }

    const defenders = def || {};
    let tackler = null;
    if (play.primaryTacklerId) tackler = findDefById(defenders, play.primaryTacklerId);
    if (!tackler?.pos) {
        const nearest = _nearestDefender(defenders, player.pos, CFG.JUKE_TRIGGER_R);
        tackler = nearest?.p || null;
    }
    if (!tackler?.pos) {
        adjustments.speedScale = clamp(adjustments.speedScale, 0.55, 1.4);
        adjustments.forward = Math.max(-0.4, adjustments.forward);
        return adjustments;
    }

    const distTo = dist(player.pos, tackler.pos);
    const engaged = tackler.engagedId && tackler.engagedId !== player.id;
    const ahead = tackler.pos.y <= player.pos.y + PX_PER_YARD * 1.8;

    if (state.cooldown <= 0 && !engaged && ahead && distTo < CFG.JUKE_TRIGGER_R) {
        const carrierAgility = clamp(player.attrs?.agility ?? 1.0, 0.5, 1.6);
        const carrierIQ = clamp(player.attrs?.awareness ?? 1.0, 0.4, 1.5);
        const defenderAgility = clamp(tackler.attrs?.agility ?? 0.9, 0.4, 1.5);
        const defenderIQ = clamp(tackler.attrs?.awareness ?? 0.9, 0.4, 1.5);
        const defenderSpeed = clamp(tackler.attrs?.speed ?? 0.9, 0.4, 1.6);

        let chance = CFG.JUKE_BASE_CHANCE;
        chance += (carrierAgility - defenderAgility) * CFG.JUKE_AGI_WEIGHT;
        chance += (carrierIQ - defenderIQ) * CFG.JUKE_IQ_WEIGHT;
        chance -= (defenderSpeed - 1.0) * CFG.JUKE_DEF_SPEED_WEIGHT;
        chance = clamp(chance, 0.05, 0.85);

        if (Math.random() < chance) {
            const duration = CFG.JUKE_DURATION * clamp(0.85 + (carrierAgility - 1.0) * 0.4, 0.6, 1.4);
            state.active = duration;
            state.duration = duration;
            state.dir = Math.sign(player.pos.x - tackler.pos.x) || (Math.random() < 0.5 ? -1 : 1);
            state.burst = clamp(0.12 + (carrierAgility - 1.0) * 0.18 + (carrierIQ - 1.0) * 0.06, 0.06, 0.3);
            state.cooldown = CFG.JUKE_COOLDOWN;
            state.slow = 0;
            state.slowTotal = 0;
            adjustments.lateral += state.dir * CFG.JUKE_LATERAL_IMPULSE;
            adjustments.speedScale += state.burst;
            if (play) (play.events ||= []).push({ t: play.elapsed, type: 'juke:success', carrierId: player.id, againstId: tackler.id });
        } else {
            const slow = CFG.JUKE_FAIL_PENALTY * clamp(1 + (defenderAgility - carrierAgility) * 0.35, 0.7, 1.5);
            state.active = 0;
            state.duration = 0;
            state.dir = 0;
            state.burst = 0;
            state.slow = slow;
            state.slowTotal = slow;
            state.cooldown = CFG.JUKE_COOLDOWN * 1.2;
            adjustments.speedScale -= CFG.JUKE_FAIL_SLOW_FACTOR * 0.5;
            adjustments.forward -= 0.25;
            if (play) (play.events ||= []).push({ t: play.elapsed, type: 'juke:fail', carrierId: player.id, againstId: tackler.id });
        }
    }

    adjustments.speedScale = clamp(adjustments.speedScale, 0.55, 1.4);
    adjustments.forward = Math.max(-0.4, adjustments.forward);
    return adjustments;
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

function _ensureScrambleDecision(decision) {
    if (!decision) return decision;
    const heading = unitVec({
        x: decision.target.x - decision.origin.x,
        y: decision.target.y - decision.origin.y,
    });
    const commitTarget = {
        x: clamp(decision.origin.x + heading.x * SCRAMBLE_MIN_COMMIT_PX, 16, FIELD_PIX_W - 16),
        y: clamp(decision.origin.y + heading.y * SCRAMBLE_MIN_COMMIT_PX, 0, FIELD_PIX_H - 6),
    };
    const baseDist = dist(decision.origin, decision.target);
    decision.heading = heading;
    if (baseDist < SCRAMBLE_MIN_COMMIT_PX) {
        decision.target = commitTarget;
    } else {
        decision.target = {
            x: clamp(decision.target.x, 16, FIELD_PIX_W - 16),
            y: clamp(decision.target.y, 0, FIELD_PIX_H - 6),
        };
    }
    return decision;
}

function _pickScrambleDecision(player, context, prev = null) {
    const qbPos = context?.qb?.pos || {
        x: FIELD_PIX_W / 2,
        y: Math.max(context?.losY + PX_PER_YARD * 6 || player.pos.y, player.pos.y),
    };
    const losY = context?.losY ?? qbPos.y - PX_PER_YARD * 6;
    const origin = { x: player.pos.x, y: player.pos.y };

    const vertical = {
        name: 'VERTICAL',
        target: {
            x: clamp(player.pos.x + rand(-18, 18), 24, FIELD_PIX_W - 24),
            y: clamp(Math.max(player.pos.y + PX_PER_YARD * rand(6, 9), losY + PX_PER_YARD * 4), 0, FIELD_PIX_H - 6),
        },
    };

    const comebackDepth = Math.max(
        losY + PX_PER_YARD * 2.5,
        Math.min(player.pos.y - PX_PER_YARD * rand(5, 7), qbPos.y - PX_PER_YARD * 1.2),
    );
    const comeback = {
        name: 'COMEBACK',
        target: {
            x: clamp(qbPos.x + rand(-14, 14), 24, FIELD_PIX_W - 24),
            y: clamp(comebackDepth, 0, FIELD_PIX_H - 6),
        },
    };

    const crossDir = player.pos.x < qbPos.x ? 1 : -1;
    const cross = {
        name: 'CROSS',
        target: {
            x: clamp(qbPos.x + crossDir * rand(32, 52), 24, FIELD_PIX_W - 24),
            y: clamp(Math.max(player.pos.y + PX_PER_YARD * rand(4, 7), losY + PX_PER_YARD * 5.5), 0, FIELD_PIX_H - 6),
        },
    };

    const choices = [vertical, comeback, cross];
    let weights;
    if (context?.scrambleMode === 'FORWARD') {
        weights = [0.5, 0.2, 0.3];
    } else if (context?.scrambleMode === 'LATERAL') {
        weights = [0.25, 0.2, 0.55];
    } else {
        weights = [0.4, 0.25, 0.35];
    }
    if (prev?.name) {
        const idx = choices.findIndex((c) => c.name === prev.name);
        if (idx >= 0) weights[idx] *= 0.6;
    }

    const total = weights.reduce((sum, w) => sum + w, 0);
    let roll = rand(0, total);
    let chosen = choices[choices.length - 1];
    for (let i = 0; i < choices.length; i++) {
        roll -= weights[i];
        if (roll <= 0) { chosen = choices[i]; break; }
    }

    const decision = {
        name: chosen.name,
        origin,
        target: { ...chosen.target },
        startedAt: context?.play?.elapsed ?? 0,
    };
    return _ensureScrambleDecision(decision);
}

function _updateScrambleDecision(player, ai, context, dt, speedMul = 0.96) {
    if (!player?.pos) return;
    if (!ai._scrDecision) {
        ai._scrDecision = _pickScrambleDecision(player, context, null);
    } else {
        _ensureScrambleDecision(ai._scrDecision);
    }

    let decision = ai._scrDecision;
    let commitDist = dist(player.pos, decision.origin);
    let toTarget = dist(player.pos, decision.target);

    if (toTarget < PX_PER_YARD * 1.4) {
        if (commitDist >= SCRAMBLE_MIN_COMMIT_PX) {
            ai._scrDecision = _pickScrambleDecision(player, context, decision);
            decision = ai._scrDecision;
            commitDist = 0;
            toTarget = dist(player.pos, decision.target);
        } else {
            const heading = decision.heading || unitVec({
                x: decision.target.x - decision.origin.x,
                y: decision.target.y - decision.origin.y,
            });
            const commitTarget = {
                x: clamp(decision.origin.x + heading.x * SCRAMBLE_MIN_COMMIT_PX, 16, FIELD_PIX_W - 16),
                y: clamp(decision.origin.y + heading.y * SCRAMBLE_MIN_COMMIT_PX, 0, FIELD_PIX_H - 6),
            };
            decision.target = commitTarget;
            decision.heading = heading;
            toTarget = dist(player.pos, decision.target);
        }
    } else if (commitDist >= SCRAMBLE_MIN_COMMIT_PX * 1.35) {
        ai._scrDecision = _pickScrambleDecision(player, context, decision);
        decision = ai._scrDecision;
        commitDist = 0;
        toTarget = dist(player.pos, decision.target);
    }

    decision.target = {
        x: clamp(decision.target.x, 16, FIELD_PIX_W - 16),
        y: clamp(decision.target.y, 0, FIELD_PIX_H - 6),
    };

    moveToward(player, decision.target, dt, speedMul, { behavior: 'SCRAMBLE' });
}

function _updateRouteRunner(player, context, dt) {
    const ai = _ensureAI(player);
    if (!ai || ai.type !== 'route' || !ai.route) return false;
    const { route } = ai;
    const def = context.def || {};
    const losY = context.losY;

    // Already finished? work scramble drill
    if (route.finished) {
        const storedHeading = route.exitHeading || ai.prevHeading || { x: 0, y: 1 };
        let heading = { ...storedHeading };
        if (heading.y < 0.1) heading.y = 0.1;
        // Nudge back inside the sideline but keep momentum mostly forward.
        if (player.pos.x < 24) heading.x = Math.abs(heading.x) || 0.18;
        if (player.pos.x > FIELD_PIX_W - 24) heading.x = -Math.abs(heading.x) || -0.18;
        const mag = Math.hypot(heading.x, heading.y) || 1;
        heading = { x: heading.x / mag, y: heading.y / mag };
        route.exitHeading = heading;
        const look = 52;
        const stepTarget = {
            x: clamp(player.pos.x + heading.x * look, 16, FIELD_PIX_W - 16),
            y: player.pos.y + heading.y * look,
        };
        const cruise = clamp((route.throttle || 1) * 0.96, 0.7, 1.12);
        moveToward(player, stepTarget, dt, cruise, { behavior: 'ROUTE' });
        ai.prevHeading = heading;
        return true;
    }

    const idx = Math.min(player.routeIdx || 0, route.targets.length - 1);
    const baseTarget = route.targets[idx];
    if (!baseTarget) { _markRouteFinished(player, route, ai.prevHeading || { x: 0, y: 1 }); return false; }

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
    moveToward(player, stepTarget, dt, speedMul, {
        behavior: 'ROUTE',
        pursuitTarget: nearest?.defender || null,
    });

    const closeEnough = dist(player.pos, aim) < 6 + Math.min(8, Math.max(0, (nearest?.dist || 40) - 18) * 0.1);
    if (closeEnough) {
        player.routeIdx = Math.min((player.routeIdx || 0) + 1, route.targets.length);
        if (adjusted.settle) {
            route.settleHold += dt;
            if (route.settleHold > 0.35) {
                _markRouteFinished(player, route, heading);
            }
        } else {
            route.settleHold = 0;
        }
        if (player.routeIdx >= route.targets.length) {
            _markRouteFinished(player, route, heading);
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
        if (route.settleHold > 0.6) _markRouteFinished(player, route, ai.prevHeading || heading);
    } else {
        route.settleHold = 0;
    }

    return true;
}

function _shouldThrottleAfterRoute(context) {
    const mode = context?.play?.qbMoveMode || 'SET';
    if (mode === 'SCRAMBLE') return false;
    if (context?.play?.ball?.inAir) return false;
    return true;
}

function _settleAfterRoute(player, context, dt) {
    if (!player?.pos) return;
    const qbX = context?.qb?.pos?.x ?? FIELD_PIX_W / 2;
    const losY = context?.losY ?? player.pos.y;
    const targetY = clamp(Math.max(player.pos.y + PX_PER_YARD * 0.6, losY + PX_PER_YARD * 5), 0, FIELD_PIX_H - 6);
    const drift = clamp((qbX - player.pos.x) * 0.08, -6, 6);
    const baseX = clamp(player.pos.x + drift, 18, FIELD_PIX_W - 18);
    let aimX = baseX;
    const nearest = _nearestDefender(context?.def || {}, player.pos, 48);
    if (nearest?.p?.pos) {
        const push = clamp((player.pos.x - nearest.p.pos.x) * 0.12, -4.2, 4.2);
        aimX = clamp(baseX + push, 18, FIELD_PIX_W - 18);
    }
    const aim = { x: aimX, y: targetY };
    moveToward(player, aim, dt, 0.55, { behavior: 'SETTLE', settleDamping: 8.5 });
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
    if (!group) return null;
    for (const key in group) {
        if (!Object.prototype.hasOwnProperty.call(group, key)) continue;
        const player = group[key];
        if (player?.id === id) return key;
    }
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

const SCRATCH_DEF_AHEAD = [];

function _chooseRunBlockTarget(player, off, def, context) {
    const ai = _ensureAI(player);
    const { runHoleX, losY } = context;
    const rb = off.RB;
    const laneX = runHoleX ?? rb?.pos?.x ?? player.pos.x;
    let current = ai.blockTargetId ? findPlayerById(def, ai.blockTargetId) : null;
    if (current && (!current.pos || dist(current.pos, player.pos) > 120)) current = null;
    if (!current) {
        const ahead = SCRATCH_DEF_AHEAD;
        ahead.length = 0;
        forEachPlayer(def, (d) => {
            if (!d?.pos) return;
            if (d.pos.y <= player.pos.y + PX_PER_YARD * 4) ahead.push(d);
        });
        let bestScore = -Infinity;
        let bestTarget = null;
        for (let i = 0; i < ahead.length; i++) {
            const d = ahead[i];
            const toLane = Math.abs((d.pos.x || laneX) - laneX);
            const downfield = Math.max(0, d.pos.y - losY);
            const score = downfield * 0.7 - toLane * 1.2 - dist(player.pos, d.pos) * 0.6;
            if (score > bestScore) {
                bestScore = score;
                bestTarget = d;
            }
        }
        current = bestTarget;
    }
    ai.blockTargetId = current?.id || null;
    return current;
}

function _runSupportReceiver(player, off, def, dt, context) {
    if (_assistCarrierBlock(player, def, dt, context)) return;
    const target = _chooseRunBlockTarget(player, off, def, context);
    if (!target) {
        const seal = { x: context.runHoleX ?? player.pos.x, y: player.pos.y + PX_PER_YARD * 2.5 };
        moveToward(player, seal, dt, 0.92, { behavior: 'RUNFIT' });
        return;
    }
    const leverage = Math.sign((context.runHoleX ?? player.pos.x) - target.pos.x) || (player.pos.x < target.pos.x ? -1 : 1);
    const fit = {
        x: clamp(target.pos.x + leverage * 8, 18, FIELD_PIX_W - 18),
        y: target.pos.y - PX_PER_YARD * 0.8,
    };
    moveToward(player, fit, dt, 0.96, {
        behavior: 'BLOCK',
        pursuitTarget: target,
    });
}

function _runSupportTightEnd(player, off, def, dt, context) {
    const ai = _ensureAI(player);
    if (_assistCarrierBlock(player, def, dt, context)) return;
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
        moveToward(
            player,
            { x: context.runHoleX ?? player.pos.x, y: player.pos.y + PX_PER_YARD * 1.5 },
            dt,
            0.95,
            { behavior: 'RUNFIT' },
        );
        return;
    }
    const leverage = rightSide ? -1 : 1;
    const fit = {
        x: clamp(target.pos.x + leverage * 6, 16, FIELD_PIX_W - 16),
        y: target.pos.y - PX_PER_YARD * 0.6,
    };
    moveToward(player, fit, dt, 0.98, {
        behavior: 'BLOCK',
        pursuitTarget: target,
    });
}

function _updatePassBlocker(ol, key, context, dt) {
    const { qb, losY, assignments, def } = context;
    const homeX = ol.home?.x ?? ol.pos.x;
    const baseX = clamp(homeX, 20, FIELD_PIX_W - 20);
    const minX = baseX - CFG.GAP_GUARDRAIL_X;
    const maxX = baseX + CFG.GAP_GUARDRAIL_X;
    const passSetDepth = CFG.PASS_SET_DEPTH_YDS * PX_PER_YARD;
    const setY = Math.max(losY - passSetDepth, qb.pos.y - passSetDepth);
    const olStrength = clamp(ol.attrs?.strength ?? 1, 0.5, 1.6);
    const olBalance = clamp(ol.attrs?.awareness ?? 1, 0.4, 1.5);
    const reachSpeed = CFG.OL_REACH_SPEED * clamp(1 + (olBalance - 1) * 0.35, 0.6, 1.45);

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
    let pushScale = 1;
    if (currentDef) {
        const vx = qb.pos.x - currentDef.pos.x;
        const vy = qb.pos.y - currentDef.pos.y || 1e-6;
        const t = (baseSet.y - currentDef.pos.y) / vy;
        let ix = currentDef.pos.x + vx * t;
        ix = clamp(ix, minX, maxX);
        const defStrength = clamp(currentDef.attrs?.strength ?? currentDef.attrs?.tackle ?? 1, 0.5, 1.6);
        const defQuickness = clamp(currentDef.attrs?.agility ?? 1, 0.5, 1.5);
        const strengthDelta = olStrength - defStrength;
        const balanceDelta = olBalance - defQuickness;
        const mirrorScale = clamp(1 + strengthDelta * 0.3 - (defQuickness - 1) * 0.4, 0.45, 1.35);
        pushScale = clamp(1 + strengthDelta * 0.85 + balanceDelta * 0.4, 0.35, 2.1);
        const blend = clamp(1 - (dist(ol.pos, currentDef.pos) / 70), 0, 1) * CFG.OL_BLOCK_MIRROR * mirrorScale;
        target = {
            x: clamp(ix * (1 - blend) + baseSet.x * blend, minX, maxX),
            y: baseSet.y,
        };
    }

    moveToward(ol, target, dt, reachSpeed, {
        behavior: 'BLOCK',
        pursuitTarget: currentDef,
    });

    if (currentDef) {
        const d = dist(ol.pos, currentDef.pos);
        if (d < CFG.OL_ENGAGE_R) {
            ol.engagedId = currentDef.id;
            currentDef.engagedId = ol.id;

            const toQBdx = qb.pos.x - currentDef.pos.x;
            const toQBdy = qb.pos.y - currentDef.pos.y || 1e-6;
            const mag = Math.hypot(toQBdx, toQBdy) || 1;
            const pushV = CFG.OL_BLOCK_PUSHBACK * dt * pushScale;
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
    const olStrength = clamp(ol.attrs?.strength ?? 1, 0.5, 1.6);
    const olAgility = clamp(ol.attrs?.agility ?? 1, 0.5, 1.5);

    const baseFit = {
        x: clamp(laneX + (key === 'LT' || key === 'LG' ? -8 : key === 'RT' || key === 'RG' ? 8 : 0), 16, FIELD_PIX_W - 16),
        y: laneY,
    };

    if (!target?.pos) {
        moveToward(ol, baseFit, dt, 1.02, { behavior: 'RUNFIT' });
        return;
    }

    const leverage = Math.sign((laneX) - target.pos.x) || (key === 'LT' || key === 'LG' ? 1 : -1);
    const fit = {
        x: clamp(target.pos.x + leverage * 6, 16, FIELD_PIX_W - 16),
        y: Math.min(target.pos.y + PX_PER_YARD * 0.6, laneY),
    };
    moveToward(ol, fit, dt, 1.08, {
        behavior: 'BLOCK',
        pursuitTarget: target,
    });

    const d = dist(ol.pos, target.pos);
    if (d < CFG.OL_ENGAGE_R + 2) {
        ol.engagedId = target.id;
        target.engagedId = ol.id;

        const drive = { x: -leverage * 0.6, y: 1 };
        const mag = Math.hypot(drive.x, drive.y) || 1;
        const defStrength = clamp(target.attrs?.strength ?? target.attrs?.tackle ?? 1, 0.5, 1.6);
        const defAnchor = clamp(target.attrs?.awareness ?? 1, 0.4, 1.5);
        const pushScale = clamp(1 + (olStrength - defStrength) * 0.95 + (olAgility - defAnchor) * 0.35, 0.35, 2.3);
        const pushV = CFG.OL_BLOCK_PUSHBACK * dt * 0.85 * pushScale;
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
        moveToward(
            ol,
            { x: laneX, y: laneY + PX_PER_YARD * 1.2 },
            dt,
            1.02,
            { behavior: 'RUNFIT' },
        );
    }
}

const SCRATCH_BLOCKERS = [];
const SCRATCH_RUSHERS = [];

export function moveOL(off, def, dt, state = null) {
    const olKeys = _olKeys(off);
    const dlKeys = _dlKeys(def);
    if (!olKeys.length) return;

    const blockers = SCRATCH_BLOCKERS;
    blockers.length = 0;
    for (let i = 0; i < olKeys.length; i++) {
        const player = off[olKeys[i]];
        if (player) blockers.push(player);
    }

    const ball = state?.play?.ball || null;
    if (isBallLoose(ball)) {
        for (let i = 0; i < blockers.length; i++) {
            const blocker = blockers[i];
            if (blocker) blocker.engagedId = null;
        }
        pursueLooseBallGroup(blockers, ball, dt, 1.05, 10);
        return;
    }

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

    for (let i = 0; i < blockers.length; i++) {
        const ol = blockers[i];
        const key = olKeys[i];
        if (!ol) continue;
        if (isRun) {
            _updateRunBlocker(ol, key, context, dt);
        } else {
            _updatePassBlocker(ol, key, context, dt);
        }
    }

    repelTeammates(blockers, CFG.OL_SEPARATION_R, CFG.OL_SEPARATION_PUSH);

    const rushers = SCRATCH_RUSHERS;
    rushers.length = 0;
    for (let i = 0; i < dlKeys.length; i++) {
        const player = def[dlKeys[i]];
        if (player) rushers.push(player);
    }
    repelTeammates(rushers, CFG.DL_SEPARATION_R, CFG.DL_SEPARATION_PUSH);
}

/* =========================================================
   Receivers
   ========================================================= */
export function moveReceivers(off, dt, s = null) {
    const qb = off.QB;
    const def = s?.play?.formation?.def || null;
    const play = s?.play || null;
    const ball = play?.ball || null;
    const losY = off.__losPixY ?? (qb?.pos?.y ?? yardsToPixY(25)) - PX_PER_YARD;
    const carrierInfo = s ? normalizeCarrier(off, ball) : null;
    const carrier = carrierInfo?.player || null;
    const tackler = play?.primaryTacklerId ? findDefById(def || {}, play.primaryTacklerId) : null;
    const liveClock = _timeSinceLive(play);
    const baseContext = {
        qb,
        def,
        losY,
        runHoleX: play?.runHoleX ?? null,
        scrambleMode: play?.qbMoveMode,
        off,
        play,
        carrier,
        tackler,
        ball,
        runFlag: !!off.__runFlag,
        timeSinceLive: liveClock,
    };

    ['WR1', 'WR2', 'WR3'].forEach((key) => {
        const player = off[key];
        if (!player || !player.alive) return;
        const ai = _ensureAI(player);

        const targeted = !!(ball?.inAir && ball.targetId === player.id);
        const ballLoose = !!(play && isBallLoose(ball));
        const isCarrier = !!(play && _isCarrier(off, ball, player));
        const scrambleActive = play?.qbMoveMode === 'SCRAMBLE';
        const route = ai.route || null;
        const hasRoute = !!(route && !route.finished);
        const anchor = Array.isArray(player.targets) && player.targets.length ? player.targets[0] : player.home || player.pos;

        const wrapLocked = off.__carrierWrapped === key || off.__carrierWrappedId === player.id;

        const context = {
            ...baseContext,
            targeted,
            ballLoose,
            isCarrier,
            playerKey: key,
            wrapLocked,
        };

        const finishNow = targeted || ballLoose || isCarrier || wrapLocked;

        const states = [
            {
                name: 'pre_snap',
                valid: () => !finishNow && baseContext.timeSinceLive < 0.08,
                action: () => {
                    _skillPreSnapAlign(player, anchor, dt);
                    ai._scrDecision = null;
                },
            },
            {
                name: 'snap',
                valid: () => !finishNow && baseContext.timeSinceLive < 0.32,
                action: () => {
                    _receiverFirstStep(player, context, dt);
                    ai._scrDecision = null;
                },
            },
            {
                name: 'execute',
                valid: () => !finishNow && (baseContext.runFlag || hasRoute),
                action: () => {
                    if (baseContext.runFlag) {
                        ai._scrDecision = null;
                        _runSupportReceiver(player, off, def || {}, dt, context);
                    } else {
                        ai._scrDecision = null;
                        _updateRouteRunner(player, context, dt);
                    }
                },
            },
            {
                name: 'react',
                valid: () => !finishNow && !baseContext.runFlag && !scrambleActive,
                action: () => {
                    _receiverReact(player, context, dt);
                },
            },
            {
                name: 'scramble',
                valid: () => !finishNow && scrambleActive,
                action: () => {
                    _receiverScramble(player, ai, context, dt, 0.96);
                },
            },
            {
                name: 'finish',
                valid: () => finishNow || (!hasRoute && !baseContext.runFlag),
                action: () => {
                    _receiverFinish(player, context, dt, { speedCatch: 1.0 });
                },
            },
        ];

        _runStateMachine(ai, states);
    });
}

/* =========================================================
   Tight End
   ========================================================= */
export function moveTE(off, dt, s = null) {
    const player = off.TE;
    if (!player || !player.alive) return;

    const def = s?.play?.formation?.def || null;
    const play = s?.play || null;
    const ball = play?.ball || null;
    const ai = _ensureAI(player);
    const qb = off.QB;
    const losY = off.__losPixY ?? (qb?.pos?.y ?? yardsToPixY(25)) - PX_PER_YARD;
    const carrierInfo = s ? normalizeCarrier(off, ball) : null;
    const carrier = carrierInfo?.player || null;
    const tackler = play?.primaryTacklerId ? findDefById(def || {}, play.primaryTacklerId) : null;
    const liveClock = _timeSinceLive(play);

    const targeted = !!(ball?.inAir && ball.targetId === player.id);
    const ballLoose = !!(play && isBallLoose(ball));
    const isCarrier = !!(play && _isCarrier(off, ball, player));
    const scrambleActive = play?.qbMoveMode === 'SCRAMBLE';
    const anchor = Array.isArray(player.targets) && player.targets.length ? player.targets[0] : player.home || player.pos;
    const route = ai.route || null;
    const hasRoute = !!(route && !route.finished);
    const wrapLocked = off.__carrierWrappedId === player.id;
    const finishNow = targeted || ballLoose || isCarrier || wrapLocked;

    const context = {
        qb,
        def,
        losY,
        runHoleX: play?.runHoleX ?? null,
        scrambleMode: play?.qbMoveMode,
        off,
        play,
        carrier,
        tackler,
        ball,
        runFlag: !!off.__runFlag,
        timeSinceLive: liveClock,
        targeted,
        ballLoose,
        isCarrier,
        playerKey: 'TE',
        wrapLocked,
    };

    const states = [
        {
            name: 'pre_snap',
            valid: () => !finishNow && liveClock < 0.08,
            action: () => {
                _skillPreSnapAlign(player, anchor, dt);
                ai._scrDecision = null;
            },
        },
        {
            name: 'snap',
            valid: () => !finishNow && liveClock < 0.32,
            action: () => {
                _receiverFirstStep(player, context, dt);
                ai._scrDecision = null;
            },
        },
        {
            name: 'execute',
            valid: () => !finishNow && (context.runFlag || hasRoute),
            action: () => {
                if (context.runFlag) {
                    ai._scrDecision = null;
                    _runSupportTightEnd(player, off, def || {}, dt, context);
                } else {
                    ai._scrDecision = null;
                    _updateRouteRunner(player, context, dt);
                }
            },
        },
        {
            name: 'react',
            valid: () => !finishNow && !context.runFlag && !scrambleActive,
            action: () => {
                _receiverReact(player, context, dt);
            },
        },
        {
            name: 'scramble',
            valid: () => !finishNow && scrambleActive,
            action: () => {
                _receiverScramble(player, ai, context, dt, 0.94);
            },
        },
        {
            name: 'finish',
            valid: () => finishNow || (!hasRoute && !context.runFlag),
            action: () => {
                _receiverFinish(player, context, dt, { speedCatch: 0.96 });
            },
        },
    ];

    _runStateMachine(ai, states);
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
        if (isBallLoose(s.play?.ball)) {
            pursueLooseBallGroup([qb], s.play.ball, dt, 1.15, 12);
        }
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
        if (call.type === 'RUN' && !s.play.handed) return false;
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
        moveToward(qb, meshPoint, dt, 0.92, { behavior: 'QB_DROP' });
    } else if (s.play.qbMoveMode === 'DROP') {
        const t =
            Array.isArray(qb.targets) && qb.targets.length > 0
                ? qb.targets[Math.max(0, Math.min(qb.routeIdx, qb.targets.length - 1))]
                : dropTarget;
        moveToward(qb, { x: t.x, y: Math.max(t.y, minY) }, dt, 0.9, { behavior: 'QB_DROP' });
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
        moveToward(qb, aim, dt, 0.82, { behavior: 'QB_DROP' });
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
        moveToward(qb, tgt, dt, 1.05, { behavior: 'SCRAMBLE' });
        if (time > (s.play.scrambleUntil || 0)) s.play.scrambleMode = 'FORWARD';
    }

    if (call.type === 'RUN') {
        const runner = handoffRunner;
        if (!runner || !runner.pos) return;

        if (s.play.handoffStyle !== 'PITCH') s.play.handoffStyle = 'PITCH';

        const readyAt = s.play.handoffReadyAt ?? (s.play.elapsed + (call.handoffDelay ?? 0.45));
        if (s.play.handoffReadyAt == null) s.play.handoffReadyAt = readyAt;
        const window = call.handoffWindow ?? 0.35;
        const deadline = s.play.handoffDeadline ?? (readyAt + window);
        if (s.play.handoffDeadline == null) s.play.handoffDeadline = deadline;

        const meshReady = s.play.elapsed >= readyAt;
        const forced = s.play.elapsed >= deadline;

        if (!s.play.handed && (meshReady || forced)) {
            const carrierKey = runner.id || handoffRole || 'RB';
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
        moveToward(rb, meet, dt, 1.05, {
            behavior: 'BLOCK',
            pursuitTarget: target,
        });
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
        moveToward(rb, settle, dt, 0.9, { behavior: 'BLOCK' });
        return true;
    }
    ai.blockTargetId = null;
    return false;
}

export function rbLogic(s, dt) {
    const off = s.play.formation.off;
    const call = s.play.playCall;
    const rb = off.RB;
    const def = s.play.formation.def;
    if (!rb || !rb.alive) return;

    const mods = rb.modifiers || {};
    const burst = clamp(1 + ((mods.burst ?? 0.5) - 0.5) * 0.4, 0.7, 1.4);
    const patienceBase = clamp(0.22 + ((mods.patience ?? 0.5) - 0.5) * 0.18, 0.1, 0.42);

    const play = s.play;
    const ball = play?.ball || null;
    const qb = off.QB;
    const losY = off.__losPixY ?? (qb?.pos?.y ?? yardsToPixY(25)) - PX_PER_YARD;
    const carrierInfo = normalizeCarrier(off, ball);
    const carrier = carrierInfo.player;
    const tackler = play?.primaryTacklerId ? findDefById(def || {}, play.primaryTacklerId) : null;
    const targeted = !!(ball?.inAir && ball.targetId === rb.id);
    const ballLoose = !!(play && isBallLoose(ball));
    const isCarrier = !!_isCarrier(off, ball, rb);
    const scrambleActive = play?.qbMoveMode === 'SCRAMBLE';
    const timeSinceLive = _timeSinceLive(play);
    const anchor = Array.isArray(play?.rbTargets) && play.rbTargets.length ? play.rbTargets[0] : { x: rb.pos.x, y: rb.pos.y + PX_PER_YARD * 0.6 };
    const finishNow = targeted || ballLoose || isCarrier;

    const context = {
        qb,
        def,
        losY,
        runHoleX: off.__runHoleX,
        runLaneY: off.__runLaneY,
        off,
        play,
        carrier,
        tackler,
        call,
        mods,
        burst,
        anchor,
        ball,
        timeSinceLive,
        targeted,
        ballLoose,
        isCarrier,
    };

    const ai = _ensureAI(rb);

    const states = [
        {
            name: 'pre_snap',
            valid: () => !finishNow && timeSinceLive < 0.08,
            action: () => {
                _skillPreSnapAlign(rb, anchor, dt);
            },
        },
        {
            name: 'snap',
            valid: () => !finishNow && timeSinceLive < 0.35,
            action: () => {
                _rbFirstStep(rb, context, dt, burst);
            },
        },
        {
            name: 'execute',
            valid: () => !finishNow && !scrambleActive && (call.type === 'RUN' || (rb.targets && rb.routeIdx != null)),
            action: () => {
                if (call.type === 'RUN') {
                    _rbExecuteRun(rb, context, dt, burst, patienceBase);
                } else {
                    _rbExecutePass(rb, context, dt, burst);
                }
            },
        },
        {
            name: 'react',
            valid: () => !finishNow && !scrambleActive,
            action: () => {
                _rbReactAdjust(rb, context, dt, burst);
            },
        },
        {
            name: 'scramble',
            valid: () => !finishNow && scrambleActive,
            action: () => {
                _rbScrambleAdjust(rb, context, dt, burst);
            },
        },
        {
            name: 'finish',
            valid: () => finishNow,
            action: () => {
                _rbFinish(rb, context, dt, burst);
            },
        },
    ];

    _runStateMachine(ai, states);
}

/* =========================================================
   Defense — respect engagement & try to shed
   ========================================================= */
function findOffRoleById(off, id) {
    if (!off) return null;
    for (const role in off) {
        if (!Object.prototype.hasOwnProperty.call(off, role)) continue;
        const player = off[role];
        if (player && player.id === id) return role;
    }
    return null;
}

function findDefById(def, id) {
    return findPlayerById(def, id);
}
function normalizeCarrier(off, ball) {
    if (isBallLoose(ball)) return { role: null, player: null, id: null };
    let role = null, player = null, id = null;
    if (typeof ball.carrierId === 'string' && off?.[ball.carrierId]) {
        role = ball.carrierId;
        player = off[role];
        id = player?.id ?? null;
    }
    if (!player && ball.carrierId != null) {
        player = findPlayerById(off, ball.carrierId);
        role = player ? findOffRoleById(off, player.id) : role;
        id = player?.id ?? id;
    }
    if (!player) { role = 'QB'; player = off.QB || null; id = player?.id ?? 'QB'; }
    return { role, player, id };
}

function _assistCarrierBlock(player, def, dt, context = {}) {
    if (!player?.pos) return false;
    const play = context.play || null;
    if (!play || play.ball?.inAir || isBallLoose(play.ball)) return false;

    let carrier = context.carrier || null;
    if (!carrier && context.off && play.ball) {
        carrier = normalizeCarrier(context.off, play.ball).player;
    }
    if (!carrier?.pos || carrier === player) return false;

    const qb = context.off?.QB || null;
    const qbMode = context.play?.qbMoveMode || null;
    if (carrier === qb && (qbMode === 'DROP' || qbMode === 'SET')) return false;

    const defenders = def || context.def || {};
    let tackler = context.tackler || null;
    if (!tackler?.pos && play.primaryTacklerId) {
        tackler = findDefById(defenders, play.primaryTacklerId);
    }
    if (!tackler?.pos) return false;

    const distToCarrier = dist(player.pos, carrier.pos);
    if (distToCarrier > CFG.HELP_BLOCK_R) return false;

    const tacklerDist = dist(tackler.pos, carrier.pos);
    if (tacklerDist > CFG.HELP_BLOCK_THREAT_R) return false;

    if (tackler.engagedId && tackler.engagedId !== player.id && tackler.engagedId !== carrier.id) return false;

    const ai = _ensureAI(player);
    ai.blockTargetId = tackler.id;

    if (player.targets) player.targets = null;
    player.routeIdx = null;

    const leverage = Math.sign(carrier.pos.x - tackler.pos.x) || (player.pos.x < carrier.pos.x ? -1 : 1);
    const meet = {
        x: clamp(tackler.pos.x + leverage * 6, 16, FIELD_PIX_W - 16),
        y: Math.min(carrier.pos.y, tackler.pos.y + PX_PER_YARD * 0.6),
    };
    moveToward(player, meet, dt, 1.02, {
        behavior: 'BLOCK',
        pursuitTarget: tackler,
    });

    const d = dist(player.pos, tackler.pos);
    if (d < CFG.OL_ENGAGE_R - 1.5) {
        player.engagedId = tackler.id;
        if (!tackler.engagedId || tackler.engagedId === player.id) tackler.engagedId = player.id;
        const pushDx = carrier.pos.x - tackler.pos.x;
        const pushDy = carrier.pos.y - tackler.pos.y;
        const mag = Math.hypot(pushDx, pushDy) || 1;
        const push = CFG.HELP_BLOCK_PUSH * dt;
        tackler.pos.x -= (pushDx / mag) * push;
        tackler.pos.y -= (pushDy / mag) * push;
        applyCollisionSlowdown(tackler, 0.24);
        applyCollisionSlowdown(player, 0.18);
    } else if (player.engagedId === tackler.id && d > CFG.OL_ENGAGE_R + 4) {
        player.engagedId = null;
        if (tackler.engagedId === player.id) tackler.engagedId = null;
    }

    return true;
}

function maybeForceFumble(s, { carrier, carrierRole, tackler, severity = 1 } = {}) {
    if (!carrier?.pos) return false;
    if (!s?.play || !s.play.ball) return false;
    if (isBallLoose(s.play.ball)) return false;

    const forced = s.debug?.forceNextOutcome === 'FUMBLE' && !s.play.__forcedFumbleDone;
    const carrierSecurity = clamp(carrier.attrs?.ballSecurity ?? 0.78, 0.4, 1.6);
    const carrierAwareness = clamp(carrier.attrs?.awareness ?? 0.9, 0.4, 1.4);
    const carrierStrength = clamp(carrier.attrs?.strength ?? 0.9, 0.4, 1.5);
    const tacklerSkill = clamp(tackler?.attrs?.tackle ?? 0.9, 0.4, 1.6);
    const tacklerStrength = clamp(tackler?.attrs?.strength ?? 1, 0.5, 1.6);
    const stripTrait = clamp((tackler?.modifiers?.tackle ?? 0.5) - 0.5, -0.3, 0.3);
    const ballTrait = clamp((carrier?.modifiers?.ballSecurity ?? 0.5) - 0.5, -0.3, 0.3);

    let chance = 0.028;
    chance += (tacklerSkill - 1) * 0.22;
    chance += (tacklerStrength - 1) * 0.18;
    chance -= (carrierSecurity - 0.85) * 0.4;
    chance -= (carrierAwareness - 1) * 0.18;
    chance -= (carrierStrength - 1) * 0.28;
    chance += stripTrait * 0.22;
    chance -= ballTrait * 0.2;
    chance += (severity - 1) * 0.12;
    if (carrierRole === 'QB') chance += 0.05;
    chance = clamp(chance, 0.01, 0.5);

    if (!forced && Math.random() > chance) return false;

    startFumble(s, { pos: { x: carrier.pos.x, y: carrier.pos.y }, byId: carrier.id ?? carrierRole ?? null, forcedById: tackler?.id ?? null });
    if (tackler) tackler.engagedId = null;
    if (s.play.wrap) endWrap(s, 'wrap:fumble');
    (s.play.events ||= []).push({
        t: s.play.elapsed,
        type: 'fumble:forced',
        carrierId: carrier.id ?? carrierRole ?? null,
        byId: tackler?.id ?? null,
        severity,
    });
    return true;
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

function _predictCatchPoint(ball) {
    if (!ball?.inAir) return null;
    const dest = ball.to || ball.renderPos || ball.shadowPos;
    if (!dest) return null;
    const speed = ball.flight?.speed || 0;
    const total = ball.flight?.totalDist || 0;
    const travelled = ball.flight?.travelled || 0;
    const remaining = Math.max(0, total - travelled);
    const eta = speed > 0 ? remaining / speed : 0.35;
    return {
        pos: { x: clamp(dest.x, 16, FIELD_PIX_W - 16), y: clamp(dest.y, 0, FIELD_PIX_H) },
        eta,
    };
}

function _handleRushEngagement(ctx, defender, laneBias) {
    if (!defender.engagedId) {
        defender._shedT = 0;
        return false;
    }

    const { off, dt, s } = ctx;
    defender._shedT = (defender._shedT || 0) + dt;
    const blocker = Object.values(off || {}).find((o) => o && o.id === defender.engagedId) || null;

    const blockStrength = clamp(blocker?.attrs?.strength ?? 1, 0.5, 1.6);
    const defenderPower = clamp(defender?.attrs?.tackle ?? defender?.attrs?.strength ?? 1, 0.5, 1.7);
    const engageScale = clamp(1 - (blockStrength - defenderPower) * 0.35, 0.5, 1.35);

    const blockerX = blocker?.pos?.x ?? defender.pos.x;
    const around = {
        x: clamp(blockerX + laneBias * 1.2, 18, FIELD_PIX_W - 18),
        y: defender.pos.y + PX_PER_YARD * 0.7,
    };
    moveToward(defender, around, dt, CFG.DL_ENGAGED_SLOW * engageScale, {
        behavior: 'BLOCK',
        pursuitTarget: blocker,
    });

    if (defender._shedT < CFG.SHED_INTERVAL) return true;
    defender._shedT = 0;

    const blockerAgility = clamp(blocker?.attrs?.agility ?? 1, 0.5, 1.5);
    const defenderAgility = clamp(defender?.attrs?.agility ?? 1, 0.5, 1.6);
    const leverage = Math.sign(defender.pos.x - blockerX) || (laneBias >= 0 ? 1 : -1);
    const angleHelp = clamp(Math.abs(defender.pos.x - blockerX) / Math.max(8, Math.abs(defender.pos.y - (blocker?.pos?.y ?? defender.pos.y))), 0, 1.5);
    const shedChance = clamp(
        CFG.SHED_BASE
            + (defenderPower - blockStrength) * 0.34
            + (defenderAgility - blockerAgility) * 0.2
            + angleHelp * 0.12,
        0.08,
        0.8,
    );

    if (Math.random() < shedChance) {
        const burstDir = leverage || (Math.random() < 0.5 ? -1 : 1);
        defender.pos.x = clamp(defender.pos.x + burstDir * CFG.SHED_SIDE_STEP, 18, FIELD_PIX_W - 18);
        defender.engagedId = null;
        defender._burstUntil = (s.play?.elapsed ?? 0) + 0.55;
        return false;
    }

    return true;
}

function _computeRushAim(ctx, defender, laneBias, takenLanes = []) {
    const { ball, carrier, qb, qbPos, dt, cover } = ctx;
    const targetPlayer = (!ball.inAir && carrier?.pos) ? carrier : qb;
    const lead = targetPlayer?.pos ? _leadPoint(targetPlayer, ball.inAir ? 0.18 : 0.26, dt) : qbPos;

    let trackX = lead.x + laneBias;
    takenLanes.forEach((x) => {
        if (Math.abs(trackX - x) < 14) {
            trackX += laneBias >= 0 ? 12 : -12;
        }
    });
    trackX = clamp(trackX, 18, FIELD_PIX_W - 18);

    let trackY = lead.y;
    if (!ball.inAir && carrier?.pos) {
        trackY = Math.min(carrier.pos.y - PX_PER_YARD * 0.2, lead.y);
    } else {
        trackY = Math.min(lead.y, qbPos.y - PX_PER_YARD * 0.4);
    }
    const aim = {
        x: trackX,
        y: clamp(trackY, 0, FIELD_PIX_H),
    };

    const openLane = takenLanes.every((x) => Math.abs(x - trackX) > 24);
    let speed = openLane ? 1.16 : 1.06;
    if (!ball.inAir && carrier?.pos && carrier !== qb) {
        const depth = Math.max(0, carrier.pos.y - (cover?.losY ?? carrier.pos.y));
        speed += depth > PX_PER_YARD * 3 ? 0.12 : 0.06;
    }
    if (defender._burstUntil && ctx.s.play?.elapsed < defender._burstUntil) speed += 0.22;

    return {
        point: aim,
        speed,
        trackX,
        target: targetPlayer,
    };
}

const MAN_KEYS = ['CB1', 'CB2', 'NB', 'LB1', 'LB2'];

function _isDefensiveBack(key) {
    return key === 'CB1' || key === 'CB2' || key === 'NB';
}

function _coverageRolePenalty(defKey, targetRole) {
    if (!targetRole) return 0;
    const isWR = /^WR[1-3]$/.test(targetRole);
    const isTE = targetRole === 'TE';
    const isRB = targetRole === 'RB';
    const isDB = _isDefensiveBack(defKey);
    const isLB = defKey?.startsWith('LB');

    if (isWR) {
        if (isDB) return 0;
        if (isLB) return PX_PER_YARD * 32;
        return PX_PER_YARD * 24;
    }
    if (isTE) {
        if (isLB) return 0;
        if (isDB) return PX_PER_YARD * 18;
        return PX_PER_YARD * 8;
    }
    if (isRB) {
        if (isLB) return PX_PER_YARD * 4;
        if (isDB) return PX_PER_YARD * 16;
        return PX_PER_YARD * 10;
    }
    return 0;
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
    const currentScore = _manMatchScore(current, target, cover.losY) + _coverageRolePenalty(key, targetRole);
    let bestKey = key;
    let bestScore = currentScore;

    for (const otherKey of MAN_KEYS) {
        if (otherKey === key) continue;
        const other = def[otherKey];
        if (!other?.pos) continue;
        const score = _manMatchScore(other, target, cover.losY) + _coverageRolePenalty(otherKey, targetRole);
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
    const isLB = key?.startsWith('LB');
    const isDB = _isDefensiveBack(key);

    const preferencePenalty = (role) => {
        if (!role) return PX_PER_YARD * 12;
        if (isLB) {
            if (role === 'TE') return 0;
            if (role === 'RB') return PX_PER_YARD * 4;
            if (role.startsWith('WR')) {
                const idxMatch = role.match(/^WR(\d)$/);
                const slotBias = idxMatch ? parseInt(idxMatch[1], 10) : 3;
                return PX_PER_YARD * (24 + slotBias * 2);
            }
        } else if (isDB) {
            if (role.startsWith('WR')) {
                const idxMatch = role.match(/^WR(\d)$/);
                const order = idxMatch ? parseInt(idxMatch[1], 10) - 1 : 2;
                return PX_PER_YARD * (order * 4);
            }
            if (role === 'TE') return PX_PER_YARD * 18;
            if (role === 'RB') return PX_PER_YARD * 20;
        } else {
            if (role === 'TE') return PX_PER_YARD * 8;
            if (role === 'RB') return PX_PER_YARD * 12;
            if (role.startsWith('WR')) return PX_PER_YARD * 18;
        }
        return PX_PER_YARD * 12;
    };

    for (const role of roles) {
        const t = off[role];
        if (!t?.pos || !t.alive) continue;
        if (already.has(role)) continue;
        const distance = dist(defender.pos, t.pos);
        const depthBias = Math.max(0, t.pos.y - cover.losY) * 0.12;
        const lateral = Math.abs(defender.pos.x - t.pos.x) * 0.3;
        const score = distance + lateral - depthBias + preferencePenalty(role);
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

    if (ctx.ball.inAir && (ctx.passTarget?.pos || ctx.catchPrediction?.pos)) {
        const dest = ctx.catchPrediction?.pos || targetPos || ctx.passTarget.pos;
        const dx = dest.x - anchorPoint.x;
        const dy = dest.y - anchorPoint.y;
        const distScore = Math.hypot(dx, dy);
        const targeted = assignedRole && ctx.passTargetRole && assignedRole === ctx.passTargetRole;
        const reachFactor = targeted ? 3.0 : 2.2;
        if (distScore <= radius * reachFactor || targeted) {
            targetedIntercept = targeted;
            chase = { player: targeted ? ctx.passTarget : null, intercept: true, dest };
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
            const burst = targetedIntercept ? 1.18 : attackSpeed + 0.06;
            moveToward(defender, aim, ctx.dt, burst, {
                behavior: 'PURSUIT',
                pursuitTarget: chase.player || ctx.passTarget?.player || null,
            });
        } else {
            const aim = {
                x: clamp(chase.player.pos.x, 16, FIELD_PIX_W - 16),
                y: Math.max(chase.player.pos.y - PX_PER_YARD * 0.6, ctx.cover.losY + PX_PER_YARD * 1.2),
            };
            const speed = chase.priority ? Math.max(chaseSpeed, 1.02) : chaseSpeed;
            moveToward(defender, aim, ctx.dt, speed, {
                behavior: 'MIRROR',
                pursuitTarget: chase.player,
            });
        }
        return true;
    }

    const drop = ctx.cover.zoneDrops?.[key] || anchorPoint;
    const settle = {
        x: clamp(drop.x, 16, FIELD_PIX_W - 16),
        y: Math.max(drop.y, ctx.cover.losY + PX_PER_YARD * 1.4),
    };
    moveToward(defender, settle, ctx.dt, dropSpeed, { behavior: 'ZONE' });
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
    const downhill = carrierPos.y > defender.pos.y + PX_PER_YARD * 0.2;

    if (!assigned) {
        const rally = recentPossession && (closeEnough || sameSide);
        const qbBeyondRelease = carrierRole === 'QB' && carrierPos.y >= release.qb - PX_PER_YARD * 0.5;
        const force = clearedRelease || qbBeyondRelease || downhill;
        if (!force && !closeEnough && !rally) return false;
        if (distToCarrier > CFG.PURSUIT_TRIGGER_R * 1.6) return false;
    }

    const leadT = assigned ? CFG.PURSUIT_LEAD_T * 1.35 : CFG.PURSUIT_LEAD_T;
    const lead = _leadPoint(carrier, leadT, ctx.dt);
    const aim = {
        x: lead.x,
        y: Math.min(lead.y, carrierPos.y + PX_PER_YARD * 0.2),
    };
    const burst = assigned || beyondLos || recentPossession;
    if (burst) {
        defender._burstUntil = Math.max(defender._burstUntil || 0, (ctx.s.play?.elapsed ?? 0) + 0.45);
    }
    const burstActive = defender._burstUntil && ctx.s.play?.elapsed < defender._burstUntil;
    const closing = distToCarrier < 80 ? 1.28 : distToCarrier < 140 ? 1.14 : 1.0;
    const speedMul = CFG.PURSUIT_SPEED * (assigned ? 1.2 : recentPossession ? 1.08 : 1.0) * closing * (burstActive ? 1.08 : 1.0);
    moveToward(defender, aim, ctx.dt, speedMul, {
        behavior: 'PURSUIT',
        pursuitTarget: carrier,
    });
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
        if (ctx.ball.inAir && ctx.catchPrediction?.pos) {
            const interceptPos = ctx.catchPrediction.pos;
            const targeted = ctx.passTargetRole && targetRole === ctx.passTargetRole;
            const interceptDist = dist(defender.pos, interceptPos);
            if (targeted || interceptDist <= PX_PER_YARD * 9.5) {
                const aim = {
                    x: interceptPos.x,
                    y: Math.max(interceptPos.y - PX_PER_YARD * 0.8, ctx.cover.losY + PX_PER_YARD * 0.8),
                };
                const burst = _isDefensiveBack(key) ? 1.26 : 1.12;
                moveToward(defender, aim, ctx.dt, burst, {
                    behavior: 'PURSUIT',
                    pursuitTarget: ctx.passTarget || target,
                });
                return;
            }
        }

        const aim = _computeManAim(ctx, defender, target, {
            isDB: _isDefensiveBack(key),
            cushion: ctx.cushion,
            zoneDrop,
            targetRole,
        });
        moveToward(defender, aim.point, ctx.dt, aim.speedMul, {
            behavior: 'MIRROR',
            pursuitTarget: target,
        });
        return;
    }

    const zone = _findZoneHelpAim(ctx, defender, key);
    moveToward(defender, zone.point, ctx.dt, zone.speedMul, { behavior: 'ZONE' });
}

function _updateSafetyCoverage(ctx, key, idx, coverables) {
    const defender = ctx.def[key];
    if (!defender?.pos) return;

    if (ctx.ball.inAir) {
        const intercept = ctx.catchPrediction?.pos || ctx.ball.to || ctx.qbPos;
        const aim = {
            x: clamp(intercept.x, 18, FIELD_PIX_W - 18),
            y: Math.max(intercept.y - PX_PER_YARD * 1.0, ctx.cover.losY + PX_PER_YARD * 1.4),
        };
        const burst = 1.16;
        moveToward(defender, aim, ctx.dt, burst, {
            behavior: 'PURSUIT',
            pursuitTarget: ctx.passTarget || null,
        });
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
                moveToward(defender, aim, ctx.dt, 0.95, {
                    behavior: 'MIRROR',
                    pursuitTarget: threat.player,
                });
            } else {
                moveToward(defender, landmark, ctx.dt, 0.92, { behavior: 'ZONE' });
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
                moveToward(defender, aim, ctx.dt, 0.96, {
                    behavior: 'MIRROR',
                    pursuitTarget: threat.player,
                });
            } else {
                moveToward(defender, landmark, ctx.dt, 0.9, { behavior: 'ZONE' });
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
            moveToward(defender, aim, ctx.dt, 0.94, {
                behavior: 'MIRROR',
                pursuitTarget: threat.player,
            });
        } else {
            moveToward(defender, landmark, ctx.dt, 0.92, { behavior: 'ZONE' });
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
            moveToward(defender, aim, ctx.dt, ctx.cover.isTwoMan ? 0.96 : 0.94, {
                behavior: 'MIRROR',
                pursuitTarget: threat.player,
            });
        } else if (landmark) {
            moveToward(defender, landmark, ctx.dt, 0.92, { behavior: 'ZONE' });
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
        moveToward(defender, aim, ctx.dt, 0.96, {
            behavior: 'MIRROR',
            pursuitTarget: deepThreat,
        });
    } else {
        const robber = {
            x: clamp(ctx.qbPos.x + (defender.pos.x < FIELD_PIX_W / 2 ? -22 : 22), 20, FIELD_PIX_W - 20),
            y: ctx.cover.losY + PX_PER_YARD * 7.2,
        };
        moveToward(defender, robber, ctx.dt, 0.9, { behavior: 'ZONE' });
    }
}

// Simplified deterministic coverage plan that mirrors base alignments.
function _computeCoverageAssignments(s) {
    const off = s.play?.formation?.off || {};
    const def = s.play?.formation?.def || {};
    const losY = off.__losPixY ?? (off.QB?.pos?.y ?? 0);

    Object.values(def).forEach((p) => {
        if (!p) return;
        p._manMirror = null;
        p._burstUntil = null;
    });

    const assigned = {};
    const claimed = new Set();

    const playerFor = (role) => {
        const pl = off[role];
        return pl?.pos ? pl : null;
    };

    const assignKey = (defKey, buildCandidates) => {
        const defender = def[defKey];
        if (!defender?.pos) return null;

        const candidates = (typeof buildCandidates === 'function' ? buildCandidates(defender) : buildCandidates)
            .flatMap((entry) => {
                if (!entry?.role) return [];
                if (claimed.has(entry.role)) return [];
                const target = playerFor(entry.role);
                if (!target) return [];
                const dx = Math.abs((target.pos?.x ?? defender.pos.x) - defender.pos.x);
                const dy = Math.abs((target.pos?.y ?? defender.pos.y) - defender.pos.y);
                const depthBonus = Math.max(0, target.pos.y - losY) * 0.1;
                const score = dx * 1.1 + dy * 0.25 - depthBonus + (entry.penalty ?? 0);
                return [{ role: entry.role, score }];
            })
            .sort((a, b) => a.score - b.score);

        for (const option of candidates) {
            if (claimed.has(option.role)) continue;
            assigned[defKey] = option.role;
            claimed.add(option.role);
            return option.role;
        }
        return null;
    };

    const wrRoles = ['WR1', 'WR2', 'WR3'].filter((role) => playerFor(role));
    const wrBySide = wrRoles
        .map((role) => ({ role, player: playerFor(role) }))
        .sort((a, b) => (a.player.pos.x - b.player.pos.x));
    const wrBySlot = wrRoles
        .map((role) => ({ role, player: playerFor(role) }))
        .sort((a, b) => (Math.abs(a.player.pos.x - FIELD_PIX_W / 2) - Math.abs(b.player.pos.x - FIELD_PIX_W / 2)));

    assignKey('CB1', (defender) => {
        const ordered = wrBySide.slice().sort((a, b) => Math.abs(a.player.pos.x - defender.pos.x) - Math.abs(b.player.pos.x - defender.pos.x));
        const entries = ordered.map((entry, idx) => ({ role: entry.role, penalty: idx * PX_PER_YARD * 4 }));
        entries.push({ role: 'TE', penalty: PX_PER_YARD * 20 });
        entries.push({ role: 'RB', penalty: PX_PER_YARD * 24 });
        return entries;
    });

    assignKey('CB2', (defender) => {
        const ordered = wrBySide.slice().sort((a, b) => Math.abs(a.player.pos.x - defender.pos.x) - Math.abs(b.player.pos.x - defender.pos.x));
        const entries = ordered.map((entry, idx) => ({ role: entry.role, penalty: idx * PX_PER_YARD * 4 }));
        entries.push({ role: 'TE', penalty: PX_PER_YARD * 20 });
        entries.push({ role: 'RB', penalty: PX_PER_YARD * 24 });
        return entries;
    });

    assignKey('NB', (defender) => {
        const ordered = wrBySlot.slice().sort((a, b) => Math.abs(a.player.pos.x - defender.pos.x) - Math.abs(b.player.pos.x - defender.pos.x));
        const entries = ordered.map((entry, idx) => ({ role: entry.role, penalty: idx * PX_PER_YARD * 3 }));
        entries.push({ role: 'TE', penalty: PX_PER_YARD * 16 });
        entries.push({ role: 'RB', penalty: PX_PER_YARD * 20 });
        return entries;
    });

    const lbCandidates = () => {
        const entries = [];
        if (playerFor('TE')) entries.push({ role: 'TE', penalty: 0 });
        if (playerFor('RB')) entries.push({ role: 'RB', penalty: PX_PER_YARD * 4 });
        wrBySlot.forEach((entry, idx) => {
            entries.push({ role: entry.role, penalty: PX_PER_YARD * (26 + idx * 2) });
        });
        return entries;
    };

    assignKey('LB1', lbCandidates);
    assignKey('LB2', lbCandidates);

    const blitzPlan = {};
    ['LB1', 'LB2'].forEach((key) => {
        const hasTarget = !!assigned[key];
        if (hasTarget) blitzPlan[key] = false;
        else blitzPlan[key] = Math.random() < 0.3;
    });

    const safetyShade = {
        baseDepth: losY + PX_PER_YARD * 12,
        hash: FIELD_PIX_W / 2,
    };

    s.play.coverage = {
        assigned,
        blitzPlan,
        isCover2: false,
        isTwoMan: false,
        isCover3: false,
        isCover4: false,
        deepLandmarks: null,
        losY,
        shell: 'man-simple',
        zoneDrops: {},
        safetyDrops: {},
        releaseBoost: { db: 0, lb: 0 },
        cushionBoost: 1,
        zoneAssignments: {},
        safetyShade,
    };
}

function _speedFromAttrs(player, base = 1) {
    const speed = clamp(player?.attrs?.speed ?? 0.9, 0.5, 1.6);
    return base + (speed - 1) * 0.25;
}

function _rushBallHandler(ctx, defender) {
    const { ball, carrier, qb, qbPos, dt, s, laneBias = 0 } = ctx;
    const targetPlayer = (!ball.inAir && carrier?.pos) ? carrier : qb;
    const lead = targetPlayer?.pos ? _leadPoint(targetPlayer, ball.inAir ? 0.16 : 0.24, dt) : qbPos;
    const aim = {
        x: clamp((lead?.x ?? qbPos.x) + laneBias * 0.4, 18, FIELD_PIX_W - 18),
        y: clamp(lead?.y ?? qbPos.y, 0, FIELD_PIX_H),
    };
    const burstActive = defender._burstUntil && s.play?.elapsed < defender._burstUntil;
    const speed = _speedFromAttrs(defender, burstActive ? 1.25 : 1.14);
    moveToward(defender, aim, dt, speed, {
        behavior: 'PURSUIT',
        pursuitTarget: targetPlayer || qb || null,
    });
}

function _pursueTarget(defender, target, ctx, baseSpeed, behavior = 'PURSUIT') {
    if (!defender?.pos || !target?.pos) return false;
    const lead = _leadPoint(target, 0.22, ctx.dt);
    const aim = {
        x: clamp(lead.x, 18, FIELD_PIX_W - 18),
        y: clamp(lead.y, 0, FIELD_PIX_H),
    };
    moveToward(defender, aim, ctx.dt, _speedFromAttrs(defender, baseSpeed), {
        behavior,
        pursuitTarget: target,
    });
    return true;
}

function _manAim(defender, target, losY, dt, { cushionY = PX_PER_YARD * 2.4, leverage = 0 } = {}) {
    const lead = _leadPoint(target, 0.2, dt);
    const cushion = Math.max(PX_PER_YARD * 1.4, cushionY);
    let aimY = Math.min(target.pos.y - cushion, lead.y - PX_PER_YARD * 0.4);
    const trailing = defender.pos.y > target.pos.y - PX_PER_YARD * 0.4;
    if (trailing) aimY = lead.y - PX_PER_YARD * 0.2;
    const minDepth = losY + PX_PER_YARD * 1.2;
    aimY = clamp(Math.max(minDepth, aimY), 0, FIELD_PIX_H - PX_PER_YARD * 0.5);

    let shade = leverage;
    if (shade === 0) {
        shade = target.pos.x >= FIELD_PIX_W / 2 ? -0.8 : 0.8;
    }
    const aimX = clamp(_lerp(target.pos.x, lead.x, 0.55) + shade * PX_PER_YARD, 18, FIELD_PIX_W - 18);
    return { x: aimX, y: aimY };
}

function _playManAssignment(defKey, options, ctx) {
    const defender = ctx.def[defKey];
    if (!defender?.pos) return;

    const blitzPlan = ctx.cover.blitzPlan || {};
    const targetRole = _resolveManAssignment(ctx, defKey);
    const target = targetRole ? ctx.off[targetRole] : null;

    if (blitzPlan[defKey]) {
        _rushBallHandler({ ...ctx, qb: ctx.off.QB }, defender);
        return;
    }

    const ai = _ensureAI(defender);
    const timeSinceLive = ctx.timeSinceLive ?? 0;
    const qbScramble = ctx.play?.qbMoveMode === 'SCRAMBLE';
    const carrier = ctx.carrier;
    const carrierClose = carrier?.pos ? dist(carrier.pos, defender.pos) < PX_PER_YARD * 4.5 : false;
    const ballLoose = isBallLoose(ctx.ball);
    const finishNow = ballLoose || (ctx.ball?.inAir && ctx.passTargetRole === targetRole) || carrier === target || carrierClose;
    const reactNeeded = carrier && carrier !== target;

    const states = [
        {
            name: 'pre_snap',
            valid: () => !finishNow && timeSinceLive < 0.08,
            action: () => _cornerPreSnapAlign(defender, target, options, ctx, ctx.dt),
        },
        {
            name: 'snap',
            valid: () => !finishNow && timeSinceLive < 0.32,
            action: () => _cornerFirstStep(defender, target, ctx, ctx.dt),
        },
        {
            name: 'execute',
            valid: () => !finishNow && !qbScramble && !reactNeeded,
            action: () => _cornerExecute(defender, target, options, ctx),
        },
        {
            name: 'react',
            valid: () => !finishNow && !qbScramble && reactNeeded,
            action: () => _cornerReact(defender, target, ctx, ctx.dt),
        },
        {
            name: 'scramble',
            valid: () => !finishNow && qbScramble,
            action: () => _cornerScramble(defender, target, ctx),
        },
        {
            name: 'finish',
            valid: () => finishNow,
            action: () => _cornerFinish(defender, target, ctx),
        },
    ];

    _runStateMachine(ai, states);
}

function _deepThreatForSafety(ctx, sideIdx) {
    const half = FIELD_PIX_W / 2;
    const roles = ['WR1', 'WR2', 'WR3', 'TE', 'RB'];
    return roles.reduce((best, role) => {
        const player = ctx.off[role];
        if (!player?.pos || player.alive === false) return best;
        const onSide = sideIdx === 0 ? player.pos.x <= half + 8 : player.pos.x >= half - 8;
        if (!onSide) return best;
        if (!best || player.pos.y > best.pos.y) return player;
        return best;
    }, null);
}

function _controlSafety(defKey, sideIdx, ctx) {
    const defender = ctx.def[defKey];
    if (!defender?.pos) return;

    const ai = _ensureAI(defender);
    const timeSinceLive = ctx.timeSinceLive ?? 0;
    const qbScramble = ctx.play?.qbMoveMode === 'SCRAMBLE';
    const ballLoose = isBallLoose(ctx.ball);
    const carrier = ctx.carrier;
    const carrierThreat = carrier?.pos && carrier.pos.y >= ctx.cover.losY;
    const finishNow = ballLoose || carrierThreat || (ctx.ball?.inAir && ctx.catchPrediction?.pos);

    const states = [
        {
            name: 'pre_snap',
            valid: () => !finishNow && timeSinceLive < 0.08,
            action: () => _safetyPreSnap(defender, ctx, ctx.dt, sideIdx),
        },
        {
            name: 'snap',
            valid: () => !finishNow && timeSinceLive < 0.32,
            action: () => _safetyFirstStep(defender, ctx, ctx.dt),
        },
        {
            name: 'execute',
            valid: () => !finishNow && !qbScramble,
            action: () => _safetyExecuteCore(defKey, sideIdx, ctx),
        },
        {
            name: 'react',
            valid: () => !finishNow && !qbScramble,
            action: () => _safetyReact(defender, ctx, ctx.dt),
        },
        {
            name: 'scramble',
            valid: () => !finishNow && qbScramble,
            action: () => _safetyScramble(defender, ctx, ctx.dt),
        },
        {
            name: 'finish',
            valid: () => finishNow,
            action: () => _safetyFinish(defender, ctx, ctx.dt),
        },
    ];

    _runStateMachine(ai, states);
}

function _safetyExecuteCore(defKey, sideIdx, ctx) {
    const defender = ctx.def[defKey];
    if (!defender?.pos) return;

    if (ctx.carrierPos && ctx.carrierPos.y >= ctx.cover.losY) {
        _pursueTarget(defender, ctx.carrier, ctx, 1.18);
        return;
    }

    if (ctx.ball.inAir && ctx.catchPrediction?.pos) {
        const intercept = ctx.catchPrediction.pos;
        const aim = {
            x: clamp(intercept.x, 18, FIELD_PIX_W - 18),
            y: Math.max(intercept.y - PX_PER_YARD * 0.6, ctx.cover.losY + PX_PER_YARD * 1.6),
        };
        moveToward(defender, aim, ctx.dt, _speedFromAttrs(defender, 1.06), {
            behavior: 'PURSUIT',
            pursuitTarget: ctx.passTarget || null,
        });
        return;
    }

    const baseDepth = ctx.cover.safetyShade?.baseDepth ?? (ctx.cover.losY + PX_PER_YARD * 12);
    const deepThreat = _deepThreatForSafety(ctx, sideIdx);
    const deepestY = deepThreat?.pos?.y ?? baseDepth;
    const endzoneFloor = FIELD_PIX_H - PX_PER_YARD * 2.5;
    let aimY = Math.max(baseDepth, deepestY + PX_PER_YARD * 1.4);
    aimY = Math.max(ctx.cover.losY + PX_PER_YARD * 8.0, Math.min(aimY, endzoneFloor));

    const baseHash = ctx.cover.safetyShade?.hash ?? (FIELD_PIX_W / 2);
    const defaultX = baseHash + (sideIdx === 0 ? -PX_PER_YARD * 6 : PX_PER_YARD * 6);
    let aimX = clamp(defaultX, 18, FIELD_PIX_W - 18);
    if (deepThreat?.pos) {
        const offset = sideIdx === 0 ? -PX_PER_YARD * 2.5 : PX_PER_YARD * 2.5;
        aimX = clamp(_lerp(defaultX, deepThreat.pos.x + offset, 0.7), 18, FIELD_PIX_W - 18);
    }

    moveToward(defender, { x: aimX, y: aimY }, ctx.dt, _speedFromAttrs(defender, 0.98), { behavior: 'ZONE' });
}

export function defenseLogic(s, dt) {
    const off = s.play.formation.off, def = s.play.formation.def, ball = s.play.ball;
    const cover = s.play.coverage || {
        assigned: {},
        blitzPlan: {},
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
        safetyShade: { baseDepth: (off.__losPixY ?? 0) + PX_PER_YARD * 12, hash: FIELD_PIX_W / 2 },
    };
    const carrierInfo = normalizeCarrier(off, ball);
    const carrier = carrierInfo.player;
    const carrierRole = carrierInfo.role;
    const carrierPos = carrier?.pos || null;

    if (isBallLoose(ball)) {
        const defenders = Object.values(def || {}).filter(p => p && p.pos);
        defenders.forEach((p) => { if (p) p.engagedId = null; });
        pursueLooseBallGroup(defenders, ball, dt, 1.24, 12);
        s.play.primaryTacklerId = null;
        s.play.primaryTacklerDist = null;
        off.__primaryTacklerId = null;
        return;
    }

    if (carrierInfo.id) {
        if (s.play.__lastCarrierId !== carrierInfo.id) {
            s.play.__lastCarrierId = carrierInfo.id;
            s.play.__lastCarrierChange = s.play.elapsed;
        } else if (s.play.__lastCarrierChange == null) {
            s.play.__lastCarrierChange = s.play.elapsed;
        }
    }
    const lastCarrierChange = s.play.__lastCarrierChange ?? 0;
    // 1) Defensive line: pursue the ball handler aggressively every snap
    const rushKeys = ['LE', 'DT', 'RTk', 'RE'];
    const qbPos = _ensureVec(off.QB);
    const rushCtx = {
        s,
        dt,
        off,
        def,
        ball,
        qb: off.QB,
        qbPos,
        carrier,
        carrierRole,
    };

    rushKeys.forEach((k) => {
        const defender = def[k];
        if (!defender?.pos) return;
        const laneBias = k === 'LE' ? -12 : k === 'RE' ? 12 : k === 'DT' ? -6 : 6;
        const engagedCtx = { ...rushCtx, cover, laneBias };
        if (_handleRushEngagement(engagedCtx, defender, laneBias)) return;
        _rushBallHandler({ ...rushCtx, laneBias }, defender);
    });

    // 2) Coverage / pursuit for back seven
    const passTargetRole = ball.inAir && ball.targetId ? findOffRoleById(off, ball.targetId) : null;
    const passTarget = passTargetRole ? off[passTargetRole] : null;
    const catchPrediction = _predictCatchPoint(ball);

    const coveragePlan = {
        s,
        dt,
        off,
        def,
        cover,
        ball,
        qbPos,
        qb: off.QB,
        carrier,
        carrierRole,
        carrierPos,
        lastCarrierChange,
        passTarget,
        passTargetRole,
        catchPrediction,
        timeSinceLive: _timeSinceLive(s.play),
        play: s.play,
    };

    _playManAssignment('CB1', { cushionY: PX_PER_YARD * 2.8, leverage: -1 }, coveragePlan);
    _playManAssignment('CB2', { cushionY: PX_PER_YARD * 2.8, leverage: 1 }, coveragePlan);
    _playManAssignment('NB', { cushionY: PX_PER_YARD * 2.4, leverage: 0 }, coveragePlan);
    _playManAssignment('LB1', { cushionY: PX_PER_YARD * 1.8, leverage: -0.6, blitzSpeed: 1.08 }, coveragePlan);
    _playManAssignment('LB2', { cushionY: PX_PER_YARD * 1.8, leverage: 0.6, blitzSpeed: 1.08 }, coveragePlan);
    _controlSafety('S1', 0, coveragePlan);
    _controlSafety('S2', 1, coveragePlan);

    // 3) Contact & tackle logic (slightly tougher)
    if (ball.inAir) return;

    const { player: ballCarrier, id: carrierId } = carrierInfo;
    if (!ballCarrier) return;

    let primaryTackler = null;
    if (!ball?.inAir && ballCarrier.pos) {
        Object.values(def || {}).forEach((d) => {
            if (!d?.pos) return;
            const distance = dist(d.pos, ballCarrier.pos);
            if (!Number.isFinite(distance)) return;
            const speed = clamp(d.attrs?.speed ?? 0.9, 0.4, 1.5);
            const agility = clamp(d.attrs?.agility ?? 0.9, 0.4, 1.5);
            const engagedPenalty = d.engagedId && d.engagedId !== ballCarrier.id ? 26 : 0;
            const depthBias = Math.max(0, ballCarrier.pos.y - d.pos.y) * 0.05;
            const score = distance - (speed - 1) * 12 - (agility - 1) * 8 - depthBias + engagedPenalty;
            if (!primaryTackler || score < primaryTackler.score) {
                primaryTackler = { defender: d, score, dist: distance };
            }
        });
    }

    if (primaryTackler?.defender) {
        s.play.primaryTacklerId = primaryTackler.defender.id;
        s.play.primaryTacklerDist = primaryTackler.dist;
        off.__primaryTacklerId = primaryTackler.defender.id;
    } else {
        s.play.primaryTacklerId = null;
        s.play.primaryTacklerDist = null;
        off.__primaryTacklerId = null;
    }

    off.__carrierWrapped = isWrapped(s, carrierId) ? (carrierRole || carrierId) : null;
    off.__carrierWrappedId = isWrapped(s, carrierId) ? carrierId : null;

    if (isWrapped(s, carrierId)) {
        freezeCarrierIfWrapped(s);
        const wr = s.play.wrap;
        const tackler = Object.values(def).find((d) => d && d.id === wr.byId);
        if (tackler) moveToward(tackler, ballCarrier.pos, dt, 1.2, {
            behavior: 'PURSUIT',
            pursuitTarget: ballCarrier,
        });

        const wrapsSoFar = (s.play.wrapCounts && s.play.wrapCounts[carrierId]) || 1;
        if (wrapsSoFar >= 2) {
            if (maybeForceFumble(s, { carrier: ballCarrier, carrierRole, tackler, severity: 1.15 })) return;
            s.play.deadAt = s.play.elapsed; s.play.phase = 'DEAD'; s.play.resultWhy = (carrierRole === 'QB') ? 'Sack' : 'Tackled';
            (s.play.events ||= []).push({ t: s.play.elapsed, type: 'tackle:wrap2', carrierId, byId: wr.byId }); endWrap(s); return;
        }
        if (s.play.elapsed - wr.startAt >= wr.holdDur) {
            const breaks = s.play.breaks || (s.play.breaks = {}); const alreadyBroke = (breaks[carrierId] || 0) >= 1;

            // assistants nearby increase tackle chance
            const assistants = Object.values(def).filter(dv => dv && dv.id !== wr.byId && dist(dv.pos, ballCarrier.pos) < 14).length;
            const tackler = Object.values(def).find((d) => d && d.id === wr.byId);

            if (alreadyBroke) {
                if (maybeForceFumble(s, { carrier: ballCarrier, carrierRole, tackler, severity: 1.05 })) return;
                s.play.deadAt = s.play.elapsed; s.play.phase = 'DEAD'; s.play.resultWhy = (carrierRole === 'QB') ? 'Sack' : 'Tackled';
                (s.play.events ||= []).push({ t: s.play.elapsed, type: 'tackle:wrapHold', carrierId, byId: wr.byId }); endWrap(s); return;
            }
            const tacklerSkill = (tackler?.attrs?.tackle ?? 0.9), carStr = (ballCarrier.attrs?.strength ?? 0.85), carIQ = clamp(ballCarrier.attrs?.awareness ?? 1.0, 0.4, 1.3);
            const tacklerStrength = clamp(tackler?.attrs?.strength ?? 1.0, 0.5, 1.6);
            const carrierAgility = clamp(ballCarrier.attrs?.agility ?? 1.0, 0.5, 1.4);
            const tackleTrait = clamp((tackler?.modifiers?.tackle ?? 0.5) - 0.5, -0.3, 0.3);
            const breakTrait = clamp((ballCarrier?.modifiers?.breakTackle ?? 0.5) - 0.5, -0.3, 0.3);
            const tacklerRole = tackler?.role || '';
            const isSecondary = tacklerRole.startsWith('CB') || tacklerRole.startsWith('S') || tacklerRole === 'NB';
            let tackleChance = 0.62
                + (tacklerSkill - carStr) * 0.32
                + (tacklerStrength - carStr) * 0.24
                - (carIQ - 1.0) * 0.12
                - (carrierAgility - 1.0) * 0.10
                + assistants * 0.08
                + (Math.random() * 0.10 - 0.05);
            tackleChance += tackleTrait * 0.28;
            tackleChance -= breakTrait * 0.26;
            const designedRun = s.play?.playCall?.type === 'RUN' && typeof s.play?.handoffTime === 'number';
            const rbRun = designedRun && (carrierRole === 'RB' || carrierId === (off.RB?.id ?? 'RB'));
            if (rbRun) {
                const visionTrait = clamp((ballCarrier?.modifiers?.vision ?? 0.5) - 0.5, -0.25, 0.25);
                const powerEdge = clamp((ballCarrier.attrs?.strength ?? 0.9) - 0.95, -0.4, 0.6);
                // Running backs were shrugging off too many tackles. Reduce the amount of
                // "run resistance" they generate so defenders convert more wraps into stops.
                const runResist = clamp(0.1 + breakTrait * 0.28 + visionTrait * 0.14 + powerEdge * 0.3, -0.05, 0.4);
                tackleChance -= runResist;
                if (isSecondary) {
                    const pursuit = clamp((tackler?.attrs?.speed ?? 0.9) - 0.85, -0.2, 0.35);
                    tackleChance += 0.14 + pursuit * 0.35 + (tacklerStrength - 1.0) * 0.12;
                }
            }
            let successThreshold = 0.5;
            if (rbRun) successThreshold -= 0.02;
            if (isSecondary && rbRun) successThreshold -= 0.06;
            tackleChance = clamp(tackleChance, 0, 1);
            if (tackleChance > successThreshold) {
                if (maybeForceFumble(s, { carrier: ballCarrier, carrierRole, tackler, severity: 1.0 + assistants * 0.12 })) return;
                s.play.deadAt = s.play.elapsed; s.play.phase = 'DEAD'; s.play.resultWhy = (carrierRole === 'QB') ? 'Sack' : 'Tackled';
                (s.play.events ||= []).push({ t: s.play.elapsed, type: 'tackle:wrapHoldWin', carrierId, byId: wr.byId }); endWrap(s); return;
            } else {
                breaks[carrierId] = (breaks[carrierId] || 0) + 1;
                moveToward(ballCarrier, { x: ballCarrier.pos.x, y: ballCarrier.pos.y + PX_PER_YARD * 3.7 }, dt, 7.0, {
                    behavior: 'CARRY',
                });
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
