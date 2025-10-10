// src/engine/diagnostics.js

const MAX_STORED_PLAYS = 40;

function ensureDiagnostics(state) {
    state.debug ||= {};
    if (!state.debug.diagnostics) {
        state.debug.diagnostics = {
            playSeq: 0,
            plays: [],
            current: null,
        };
    }
    return state.debug.diagnostics;
}

export function beginPlayDiagnostics(state) {
    if (!state?.play) return null;
    const diag = ensureDiagnostics(state);
    const playRecord = {
        id: ++diag.playSeq,
        call: state.play.playCall?.name || 'Play',
        type: state.play.playCall?.type || 'PLAY',
        startDown: state.drive?.down ?? null,
        startToGo: state.drive?.toGo ?? null,
        startLos: state.drive?.losYards ?? null,
        events: [],
        startTime: state.play.elapsed ?? 0,
    };
    diag.current = playRecord;
    state.play.__diagId = playRecord.id;
    recordPlayEvent(state, { type: 'play:start', call: playRecord.call, down: playRecord.startDown, toGo: playRecord.startToGo });
    return playRecord;
}

export function recordPlayEvent(state, event) {
    if (!state) return;
    const diag = ensureDiagnostics(state);
    const play = diag.current;
    if (!play) return;
    play.events.push({
        t: state.play?.elapsed ?? 0,
        phase: state.play?.phase || null,
        ...event,
    });
    if (play.events.length > 400) play.events.shift();
}

export function finalizePlayDiagnostics(state, summary = {}) {
    const diag = ensureDiagnostics(state);
    const play = diag.current;
    if (!play) return;
    play.summary = {
        result: summary.result ?? state.play?.resultWhy ?? null,
        gained: summary.gained ?? null,
        endLos: summary.endLos ?? null,
        turnover: !!summary.turnover,
    };
    diag.plays.push(play);
    if (diag.plays.length > MAX_STORED_PLAYS) diag.plays.shift();
    diag.current = null;
}

export function summarizeDiagnostics(state, limit = 10) {
    const diag = ensureDiagnostics(state);
    const plays = diag.plays.slice(-limit);
    const totals = {
        plays: plays.length,
        completions: 0,
        incompletions: 0,
        throwaways: 0,
        interceptions: 0,
        fumbles: 0,
        lostCarrierWarnings: 0,
    };

    for (const play of plays) {
        for (const evt of play.events) {
            switch (evt.type) {
                case 'pass:complete': totals.completions += 1; break;
                case 'pass:incomplete': totals.incompletions += 1; break;
                case 'pass:throwaway': totals.throwaways += 1; break;
                case 'pass:interception': totals.interceptions += 1; break;
                case 'ball:fumble': totals.fumbles += 1; break;
                case 'ball:lost-carrier': totals.lostCarrierWarnings += 1; break;
                default: break;
            }
        }
    }

    return { plays, totals };
}

export function getDiagnostics(state) {
    const diag = ensureDiagnostics(state);
    return {
        plays: diag.plays,
        current: diag.current,
        playSeq: diag.playSeq,
    };
}
