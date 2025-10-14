import { recordPlayDynamics } from './progression';

const PASSING_TEMPLATE = () => ({
    attempts: 0,
    completions: 0,
    yards: 0,
    touchdowns: 0,
    interceptions: 0,
    sacks: 0,
    sackYards: 0,
});

const RUSHING_TEMPLATE = () => ({ attempts: 0, yards: 0, touchdowns: 0, fumbles: 0 });
const RECEIVING_TEMPLATE = () => ({ targets: 0, receptions: 0, yards: 0, touchdowns: 0, drops: 0 });
const DEFENSE_TEMPLATE = () => ({ tackles: 0, sacks: 0, interceptions: 0 });
const MISC_TEMPLATE = () => ({ fumbles: 0 });
const KICKING_TEMPLATE = () => ({ attempts: 0, made: 0, long: 0, patAttempts: 0, patMade: 0 });

function ensureDirectoryEntry(stats, directory, playerId) {
    if (!playerId) return null;
    if (!stats[playerId]) {
        const meta = directory?.[playerId] || {};
        stats[playerId] = {
            team: meta.team || null,
            role: meta.role || null,
            side: meta.side || null,
            name: meta.fullName || playerId,
            number: meta.number ?? null,
            passing: PASSING_TEMPLATE(),
            rushing: RUSHING_TEMPLATE(),
            receiving: RECEIVING_TEMPLATE(),
            defense: DEFENSE_TEMPLATE(),
            misc: MISC_TEMPLATE(),
            kicking: KICKING_TEMPLATE(),
        };
    }
    return stats[playerId];
}

export function createInitialPlayerStats(directory = {}) {
    const stats = {};
    Object.entries(directory).forEach(([playerId, meta]) => {
        stats[playerId] = {
            team: meta.team || null,
            role: meta.role || null,
            side: meta.side || null,
            name: meta.fullName || playerId,
            number: meta.number ?? null,
            passing: PASSING_TEMPLATE(),
            rushing: RUSHING_TEMPLATE(),
            receiving: RECEIVING_TEMPLATE(),
            defense: DEFENSE_TEMPLATE(),
            misc: MISC_TEMPLATE(),
            kicking: KICKING_TEMPLATE(),
        };
    });
    return stats;
}

export function createPlayStatContext() {
    return {
        pass: null,
        tackles: [],
        fumbleBy: null,
        rushCarrierId: null,
        touchdown: false,
    };
}

function ensurePlayContext(state) {
    if (!state?.play) return null;
    if (!state.play.statContext) state.play.statContext = createPlayStatContext();
    return state.play.statContext;
}

function getPlayerStats(state, playerId) {
    if (!playerId) return null;
    if (!state.playerStats) state.playerStats = createInitialPlayerStats(state.playerDirectory || {});
    return ensureDirectoryEntry(state.playerStats, state.playerDirectory, playerId);
}

export function applyStatEvent(state, event) {
    const ctx = ensurePlayContext(state);
    if (!ctx) return;

    switch (event.type) {
        case 'play:start': {
            state.play.statContext = createPlayStatContext();
            break;
        }
        case 'pass:thrown': {
            const qbId = state.play?.formation?.off?.QB?.id || null;
            ctx.pass = {
                passerId: qbId,
                attempt: true,
                complete: false,
                interceptedBy: null,
                targetId: null,
                dropped: false,
                throwaway: false,
            };
            break;
        }
        case 'pass:complete': {
            if (!ctx.pass) {
                const qbId = state.play?.formation?.off?.QB?.id || null;
                ctx.pass = { passerId: qbId, attempt: true };
            }
            ctx.pass.complete = true;
            if (event.targetId) ctx.pass.targetId = event.targetId;
            break;
        }
        case 'pass:incomplete': {
            if (!ctx.pass) {
                const qbId = state.play?.formation?.off?.QB?.id || null;
                ctx.pass = { passerId: qbId, attempt: true };
            }
            ctx.pass.complete = false;
            if (event.targetId) ctx.pass.targetId = event.targetId;
            break;
        }
        case 'pass:drop': {
            if (!ctx.pass) {
                const qbId = state.play?.formation?.off?.QB?.id || null;
                ctx.pass = { passerId: qbId, attempt: true };
            }
            ctx.pass.complete = false;
            ctx.pass.dropped = true;
            if (event.targetId) ctx.pass.targetId = event.targetId;
            break;
        }
        case 'pass:throwaway': {
            if (!ctx.pass) {
                const qbId = state.play?.formation?.off?.QB?.id || null;
                ctx.pass = { passerId: qbId, attempt: true };
            }
            ctx.pass.throwaway = true;
            break;
        }
        case 'pass:interception': {
            if (!ctx.pass) {
                const qbId = state.play?.formation?.off?.QB?.id || null;
                ctx.pass = { passerId: qbId, attempt: true };
            }
            ctx.pass.interceptedBy = event.by || null;
            ctx.pass.complete = false;
            break;
        }
        case 'ball:fumble': {
            ctx.fumbleBy = event.by || null;
            break;
        }
        case 'ball:touchdown': {
            ctx.touchdown = true;
            break;
        }
        case 'tackle:wrapHold':
        case 'tackle:wrapHoldWin':
        case 'tackle:wrap2': {
            if (event.byId) ctx.tackles.push(event.byId);
            break;
        }
        case 'fp:whistle': {
            // forward progress whistle – treat like gang tackle, but no id given
            break;
        }
        default:
            break;
    }
}

export function recordKickingAttempt(state, kickerId, { distance = 0, made = false, isPat = false } = {}) {
    if (!kickerId) return;
    if (!state.playerStats) state.playerStats = createInitialPlayerStats(state.playerDirectory || {});
    const stats = ensureDirectoryEntry(state.playerStats, state.playerDirectory, kickerId);
    if (!stats) return;
    stats.kicking.attempts += 1;
    if (made) stats.kicking.made += 1;
    if (!isPat && made) {
        if ((stats.kicking.long || 0) < distance) stats.kicking.long = distance;
    }
    if (isPat) {
        stats.kicking.patAttempts += 1;
        if (made) stats.kicking.patMade += 1;
    }
}

function isPassResult(resultWhy) {
    if (!resultWhy) return false;
    const txt = String(resultWhy).toLowerCase();
    return (
        txt.includes('incomplete') ||
        txt.includes('throw away') ||
        txt.includes('throwaway') ||
        txt.includes('drop')
    );
}

export function finalizePlayStats(state, summary) {
    const ctx = state.play?.statContext;
    if (!ctx) return;

    if (!state.playerStats) state.playerStats = createInitialPlayerStats(state.playerDirectory || {});

    const gained = summary.gained ?? 0;
    const resultWhy = summary.result || '';
    const touchdown = resultWhy === 'Touchdown';
    const playType = summary.callType || 'PLAY';
    const lastCarrierId = summary.carrierId || state.play?.ball?.lastCarrierId || null;
    const qbId = ctx.pass?.passerId || state.play?.formation?.off?.QB?.id || null;

    if (ctx.pass?.attempt) {
        const passerStats = getPlayerStats(state, ctx.pass.passerId || qbId);
        if (passerStats) {
            passerStats.passing.attempts += 1;
            if (ctx.pass.complete) {
                passerStats.passing.completions += 1;
                passerStats.passing.yards += gained;
                if (touchdown) passerStats.passing.touchdowns += 1;
            }
            if (ctx.pass.interceptedBy) {
                passerStats.passing.interceptions += 1;
            }
            if (resultWhy === 'Sack') {
                passerStats.passing.sacks += 1;
                if (gained < 0) passerStats.passing.sackYards += Math.abs(gained);
            }
        }

        if (ctx.pass.targetId) {
            const receiverStats = getPlayerStats(state, ctx.pass.targetId);
            if (receiverStats) {
                receiverStats.receiving.targets += 1;
                if (ctx.pass.complete) {
                    receiverStats.receiving.receptions += 1;
                    receiverStats.receiving.yards += gained;
                    if (touchdown) receiverStats.receiving.touchdowns += 1;
                }
                if (ctx.pass.dropped) receiverStats.receiving.drops += 1;
            }
        }

        if (ctx.pass.interceptedBy) {
            const defenderStats = getPlayerStats(state, ctx.pass.interceptedBy);
            if (defenderStats) defenderStats.defense.interceptions += 1;
        }
    }

    const passFinished = ctx.pass?.attempt && ctx.pass.complete;
    const passAttempted = ctx.pass?.attempt;
    const passingResult = passAttempted && isPassResult(resultWhy);

    const eligibleCarrierId = ctx.rushCarrierId || (!passFinished && !passingResult ? lastCarrierId : null);
    const isRunPlay = playType === 'RUN' || !passAttempted;

    if (eligibleCarrierId && !ctx.pass?.complete && isRunPlay) {
        const rusherStats = getPlayerStats(state, eligibleCarrierId);
        if (rusherStats) {
            rusherStats.rushing.attempts += 1;
            rusherStats.rushing.yards += gained;
            if (touchdown) rusherStats.rushing.touchdowns += 1;
            if (ctx.fumbleBy && ctx.fumbleBy === eligibleCarrierId) {
                rusherStats.rushing.fumbles += 1;
                rusherStats.misc.fumbles += 1;
            }
        }
    }

    if (ctx.fumbleBy && (!eligibleCarrierId || ctx.fumbleBy !== eligibleCarrierId)) {
        const fum = getPlayerStats(state, ctx.fumbleBy);
        if (fum) {
            fum.misc.fumbles += 1;
            fum.rushing.fumbles += 1;
        }
    }

    if (Array.isArray(ctx.tackles) && ctx.tackles.length) {
        const credited = new Set();
        ctx.tackles.forEach((id) => {
            if (!id) return;
            const defStats = getPlayerStats(state, id);
            if (!defStats) return;
            if (!credited.has(id)) {
                defStats.defense.tackles += 1;
                credited.add(id);
            }
        });
        if (resultWhy === 'Sack') {
            const first = ctx.tackles[0];
            const defStats = getPlayerStats(state, first);
            if (defStats) defStats.defense.sacks += 1;
        }
    }

    if (ctx.pass?.interceptedBy) {
        const tacklerIds = ctx.tackles || [];
        // award tackle to interceptor if play ended immediately
        if (tacklerIds.length === 0) {
            const defenderStats = getPlayerStats(state, ctx.pass.interceptedBy);
            if (defenderStats) defenderStats.defense.tackles += 1;
        }
    }

    recordPlayDynamics(state, summary, ctx);

    // Preserve context for UI debugging if needed but reset for safety
    state.play.statContext = createPlayStatContext();
}
