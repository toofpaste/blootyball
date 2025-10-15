// src/engine/diagnostics.js
import { applyStatEvent } from './stats';

const MIN_SAMPLE_INTERVAL = 1 / 120;

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

function ensureTraceConfig(state) {
    state.debug ||= {};
    if (!state.debug.trace) return null;
    const trace = state.debug.trace;
    trace.sampleInterval = Math.max(MIN_SAMPLE_INTERVAL, trace.sampleInterval || 1 / 30);
    trace.maxSamples = Math.max(30, trace.maxSamples || 720);
    trace.maxHistory = Math.max(1, trace.maxHistory || 5);
    trace.history ||= [];
    return trace;
}

export function enablePlayTrace(state, config = {}) {
    if (!state) return null;
    state.debug ||= {};
    const prev = state.debug.trace || {};
    state.debug.trace = {
        ...prev,
        enabled: true,
        sampleInterval: Math.max(MIN_SAMPLE_INTERVAL, Number.isFinite(config.sampleInterval) ? config.sampleInterval : prev.sampleInterval || 1 / 30),
        maxSamples: Math.max(30, config.maxSamples ?? prev.maxSamples ?? 720),
        maxHistory: Math.max(1, config.maxHistory ?? prev.maxHistory ?? 5),
        history: prev.history || [],
    };
    delete state.debug.trace.current;
    delete state.debug.trace.lastSampleAt;
    delete state.debug.trace.playMeta;
    return state.debug.trace;
}

export function disablePlayTrace(state) {
    if (!state?.debug?.trace) return;
    state.debug.trace.enabled = false;
}

export function getPlayTraceHistory(state) {
    return state?.debug?.trace?.history || [];
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
    const trace = ensureTraceConfig(state);
    if (trace?.enabled) {
        trace.current = [];
        trace.playMeta = {
            id: playRecord.id,
            call: playRecord.call,
            type: playRecord.type,
            startDown: playRecord.startDown,
            startToGo: playRecord.startToGo,
            startLos: playRecord.startLos,
        };
        trace.lastSampleAt = null;
    }
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
    applyStatEvent(state, event);
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
    const trace = ensureTraceConfig(state);
    if (trace?.enabled && Array.isArray(trace.current) && trace.current.length) {
        trace.history.push({
            meta: { ...trace.playMeta, ...(play.summary || {}) },
            samples: trace.current.slice(),
        });
        if (trace.history.length > trace.maxHistory) trace.history.splice(0, trace.history.length - trace.maxHistory);
    }
    if (trace) {
        delete trace.current;
        delete trace.playMeta;
        trace.lastSampleAt = null;
    }
}

export function summarizeDiagnostics(state, limit = 10) {
    const diag = ensureDiagnostics(state);
    const plays = diag.plays.slice(-limit);
    const totals = {
        plays: plays.length,
        completions: 0,
        incompletions: 0,
        drops: 0,
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
                case 'pass:drop':
                    totals.incompletions += 1;
                    totals.drops += 1;
                    break;
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
