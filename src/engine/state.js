import {
    FIELD_PIX_W, FIELD_PIX_H, ENDZONE_YARDS, PLAYING_YARDS_H,
    TEAM_RED, TEAM_BLK, PLAYBOOK, PX_PER_YARD,
} from './constants';
import { clamp, yardsToPixY, pixYToYards, rand } from './helpers';
import { createTeams, rosterForPossession, lineUpFormation, buildPlayerDirectory } from './rosters';
import { initRoutesAfterSnap, moveOL, moveReceivers, moveTE, qbLogic, rbLogic, defenseLogic } from './ai';
import { moveBall, getBallPix } from './ball';
import { beginFrame, endFrame } from './motion';
import { beginPlayDiagnostics, finalizePlayDiagnostics, recordPlayEvent } from './diagnostics';
import { pickFormations, PLAYBOOK_PLUS, pickPlayCall } from './playbooks';
import { createInitialPlayerStats, createPlayStatContext, finalizePlayStats, recordKickingAttempt } from './stats';
import {
    createSeasonState,
    prepareSeasonMatchup,
    applyGameResultToSeason,
    advanceSeasonPointer,
    seasonCompleted,
} from './league';

/* =========================================================
   Utilities / guards
   ========================================================= */
const QUARTER_SECONDS = 4 * 60;
const DEFAULT_CLOCK_MANAGEMENT = {
    hurryThreshold: 150,          // offense trailing inside 2:30
    defensiveThreshold: 120,      // defense trailing inside 2:00
    mustTimeoutThreshold: 35,     // always burn a timeout when trailing inside :35
    trailingMargin: 8,
};

const PENALTY_CHANCE = 0.07;
const lerp = (a, b, t) => a + (b - a) * t;
const smoothStep = (t) => t * t * (3 - 2 * t);
const easeOutQuad = (t) => 1 - (1 - t) * (1 - t);
const easeInOutQuad = (t) => (t < 0.5) ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

function ensureDrive(s) {
    if (!s.drive || typeof s.drive.losYards !== 'number') {
        s.drive = { losYards: 25, down: 1, toGo: 10 };
    }
    return s.drive;
}

function isNoAdvance(why) {
    if (!why) return false;
    const w = String(why).toLowerCase();
    return w === 'incomplete' || w === 'throwaway' || w === 'throw away' || w === 'spike' || w === 'drop';
}

function uniqueNonEmpty(values) {
    if (!Array.isArray(values)) return [];
    const seen = new Set();
    const result = [];
    for (const value of values) {
        if (!value || seen.has(value)) continue;
        seen.add(value);
        result.push(value);
    }
    return result;
}

function lookupPlayerMeta(state, playerId) {
    if (!playerId) return null;
    return state?.playerDirectory?.[playerId] || null;
}

function lastNameFromMeta(meta) {
    if (!meta) return null;
    const full = meta.fullName || meta.name || '';
    if (!full) return null;
    const parts = String(full).trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return null;
    return parts[parts.length - 1];
}

function buildPlayDetails(state, entry = {}) {
    if (!state?.play) return null;
    const playCallName = state.play.playCall?.name || null;
    if (entry?.name && playCallName && entry.name !== playCallName) return null;
    const ctx = state.play.statContext;
    const details = {};

    if (state.play.playCall?.type) details.playType = state.play.playCall.type;

    if (ctx?.pass) {
        const passCtx = ctx.pass;
        if (passCtx.passerId) {
            const meta = lookupPlayerMeta(state, passCtx.passerId);
            const name = lastNameFromMeta(meta);
            if (name) details.passer = name;
        }
        if (passCtx.targetId) {
            const meta = lookupPlayerMeta(state, passCtx.targetId);
            const name = lastNameFromMeta(meta);
            if (name) details.receiver = name;
        }
        if (typeof passCtx.complete === 'boolean') details.passCompleted = passCtx.complete;
        if (passCtx.dropped) details.passDropped = true;
        if (passCtx.throwaway) details.passThrowaway = true;
        if (passCtx.interceptedBy) {
            const meta = lookupPlayerMeta(state, passCtx.interceptedBy);
            const name = lastNameFromMeta(meta);
            if (name) details.interceptedBy = name;
        }
    }

    const carrierId = ctx?.rushCarrierId || state.play.ball?.lastCarrierId || null;
    if (carrierId) {
        const meta = lookupPlayerMeta(state, carrierId);
        const name = lastNameFromMeta(meta);
        if (name) details.carrier = name;
    }

    const tacklerIds = uniqueNonEmpty(ctx?.tackles);
    if (tacklerIds.length) {
        const tacklers = tacklerIds
            .map((id) => lastNameFromMeta(lookupPlayerMeta(state, id)))
            .filter(Boolean);
        if (tacklers.length) details.tacklers = tacklers;
    }

    if (ctx?.fumbleBy) {
        const meta = lookupPlayerMeta(state, ctx.fumbleBy);
        const name = lastNameFromMeta(meta);
        if (name) details.fumbledBy = name;
    }

    if (Object.keys(details).length === 0) return null;
    return details;
}

function pushPlayLog(state, entry) {
    state.playLog ||= [];
    const nextNum = (state.playLog[state.playLog.length - 1]?.num || 0) + 1;
    const startLos = entry.startLos ?? state.play?.startLos ?? state.drive?.losYards ?? 25;
    const endLos = entry.endLos ?? (startLos + (entry.gained ?? 0));
    const details = buildPlayDetails(state, entry);
    state.playLog.push({
        num: nextNum,
        name: entry.name ?? state.play?.playCall?.name ?? 'Play',
        startDown: entry.startDown ?? state.play?.startDown ?? state.drive?.down ?? 1,
        startToGo: entry.startToGo ?? state.play?.startToGo ?? state.drive?.toGo ?? 10,
        startLos, endLos,
        gained: (entry.gained != null) ? entry.gained : (endLos - startLos),
        result: entry.result ?? entry.why ?? state.play?.resultWhy ?? '—',
        turnover: !!entry.turnover,
        offense: entry.offense ?? state.possession,
        ...(details ? { details } : {}),
    });
    if (state.playLog.length > 50) state.playLog.shift();
}

function defaultScores() {
    return { [TEAM_RED]: 0, [TEAM_BLK]: 0 };
}

function prepareGameForMatchup(state, matchup) {
    if (!matchup) {
        state.matchup = null;
        state.teams = null;
        state.roster = null;
        state.drive = { losYards: 25, down: 1, toGo: 10 };
        state.scores = defaultScores();
        state.clock = createClock();
        state.play = { phase: 'COMPLETE', resultText: 'Season complete' };
        state.playerDirectory = {};
        state.playerStats = {};
        state.playLog = [];
        return state;
    }

    state.matchup = matchup;
    state.possession = TEAM_RED;
    state.teams = createTeams(matchup);
    state.drive = { losYards: 25, down: 1, toGo: 10 };
    state.clock = createClock();
    state.scores = defaultScores();
    state.pendingExtraPoint = null;
    state.playLog = [];
    state.playerDirectory = buildPlayerDirectory(state.teams, matchup.slotToTeam, matchup.identities);
    state.playerStats = createInitialPlayerStats(state.playerDirectory);
    state.roster = rosterForPossession(state.teams, state.possession);
    state.roster.__ownerState = state;
    state.play = createPlayState(state.roster, state.drive);
    beginPlayDiagnostics(state);
    return state;
}

function isGameClockExpired(state) {
    if (!state?.clock) return false;
    if (state.pendingExtraPoint) return false;
    if (state.clock.quarter < 4) return false;
    return state.clock.time <= 0;
}

function finalizeCurrentGame(state) {
    if (!state?.season || !state?.matchup) return state;
    const currentSeason = state.season;
    const currentIndex = currentSeason.currentGameIndex;
    const game = currentSeason.schedule[currentIndex];
    const lastMatchup = state.matchup
        ? {
            ...state.matchup,
            slotToTeam: { ...state.matchup.slotToTeam },
            identities: { ...state.matchup.identities },
        }
        : null;
    state.lastCompletedGame = {
        matchup: lastMatchup,
        scores: { ...state.scores },
    };
    const updatedSeason = applyGameResultToSeason(
        currentSeason,
        game,
        state.scores,
        state.playerDirectory,
        state.playerStats,
        state.playLog,
    );

    state = { ...state, season: updatedSeason };

    const nextMatchup = advanceSeasonPointer(state.season);
    if (!nextMatchup && seasonCompleted(state.season)) {
        state.matchup = null;
        state.gameComplete = true;
        state.clock.running = false;
        state.clock.time = 0;
        state.clock.stopReason = 'Season complete';
        state.play = { phase: 'COMPLETE', resultText: 'Season complete' };
        return { ...state, season: { ...state.season } };
    }

    prepareGameForMatchup(state, nextMatchup);
    return { ...state, season: { ...state.season } };
}

function getTeamKicker(state, team) {
    if (!team) return null;
    if (!state.teams) state.teams = createTeams(state.matchup);
    return state.teams?.[team]?.special?.K || null;
}

function fieldGoalDistanceYards(losYards) {
    return Math.round(Math.max(0, 100 - (losYards ?? 0)) + 17);
}

function kickerSuccessChance(kicker, distance) {
    if (!kicker) return 0;
    const maxDist = Math.max(1, kicker.maxDistance || 50);
    const ratio = distance / maxDist;
    const base = clamp(kicker.accuracy ?? 0.75, 0.35, 0.99);
    const shortBonus = clamp(1 - ratio, 0, 1) * 0.45;
    const longPenalty = Math.max(0, ratio - 1) * 0.75;
    return clamp(base + shortBonus - longPenalty, 0.05, 0.99);
}

function createFieldGoalVisual({ losYards, distance }) {
    const yard = yardsToPixY(1);
    const losPixY = yardsToPixY(ENDZONE_YARDS + (losYards ?? 25));
    const holderDepth = 7;
    const holderY = losPixY - yard * holderDepth;
    const centerX = FIELD_PIX_W / 2;
    const holderX = centerX - yard * 0.3;
    const snapperY = losPixY - yard * 0.6;
    const snapOrigin = { x: holderX - yard * 0.25, y: snapperY };
    const catchPoint = { x: holderX, y: holderY - yard * 0.1 };
    const kickerStart = { x: holderX - yard * 2.6, y: holderY - yard * 1.55 };
    const kickerPlant = { x: holderX - yard * 0.55, y: holderY + yard * 0.28 };
    const kickerFollow = { x: holderX + yard * 0.9, y: holderY - yard * 0.2 };

    const lineBaseY = losPixY - yard * 0.35;
    const wingY = lineBaseY - yard * 0.18;
    const guardSpacing = yard * 1.05;
    const protectorDepth = holderY + yard * 0.85;
    const rushStartY = lineBaseY - yard * 0.65;
    const rushTargetY = holderY + yard * 0.18;
    const rushSpeed = yard * 8.25;

    const makeRusher = ({ role, pos, target, delay = 0, hold = 0.55, engage = 0.35, speed = 0.7 }) => {
        const engagePoint = {
            x: lerp(pos.x, target.x, engage),
            y: lerp(pos.y, target.y, engage),
        };
        const blockVariance = hold * 0.35;
        const blockDuration = Math.max(0.25, hold + (Math.random() - 0.5) * blockVariance);
        return {
            role,
            pos,
            renderPos: { ...pos },
            target,
            delay,
            engagePoint,
            blockDuration,
            speedMultiplier: speed,
        };
    };

    return {
        phase: 'PREP',
        phaseTime: 0,
        totalTime: 0,
        prepDuration: 0.55,
        snapDuration: 0.32,
        approachDuration: 0.85,
        swingDuration: 0.24,
        flightDuration: Math.min(1.9, Math.max(1.15, distance * 0.02 + 0.95)),
        resultDuration: 1.2,
        kicker: { pos: { ...kickerStart }, start: kickerStart, plant: kickerPlant, follow: kickerFollow, renderPos: { ...kickerStart } },
        holder: {
            pos: { x: holderX, y: holderY },
            kneel: { x: holderX, y: holderY + yard * 0.45 },
            renderPos: { x: holderX, y: holderY },
        },
        snapper: {
            pos: { x: holderX - yard * 0.25, y: snapperY },
            renderPos: { x: holderX - yard * 0.25, y: snapperY },
        },
        line: [
            { role: 'LW', pos: { x: holderX - guardSpacing * 3.35, y: wingY }, renderPos: { x: holderX - guardSpacing * 3.35, y: wingY } },
            { role: 'LT', pos: { x: holderX - guardSpacing * 2.2, y: lineBaseY }, renderPos: { x: holderX - guardSpacing * 2.2, y: lineBaseY } },
            { role: 'LG', pos: { x: holderX - guardSpacing * 1.05, y: lineBaseY + yard * 0.08 }, renderPos: { x: holderX - guardSpacing * 1.05, y: lineBaseY + yard * 0.08 } },
            { role: 'C', pos: { x: holderX - guardSpacing * 0.1, y: lineBaseY + yard * 0.12 }, renderPos: { x: holderX - guardSpacing * 0.1, y: lineBaseY + yard * 0.12 } },
            { role: 'RG', pos: { x: holderX + guardSpacing * 0.85, y: lineBaseY + yard * 0.08 }, renderPos: { x: holderX + guardSpacing * 0.85, y: lineBaseY + yard * 0.08 } },
            { role: 'RT', pos: { x: holderX + guardSpacing * 2.0, y: lineBaseY }, renderPos: { x: holderX + guardSpacing * 2.0, y: lineBaseY } },
            { role: 'RW', pos: { x: holderX + guardSpacing * 3.25, y: wingY }, renderPos: { x: holderX + guardSpacing * 3.25, y: wingY } },
        ],
        protectors: [
            { role: 'PP', pos: { x: holderX - guardSpacing * 1.45, y: protectorDepth }, renderPos: { x: holderX - guardSpacing * 1.45, y: protectorDepth } },
            { role: 'PP', pos: { x: holderX + guardSpacing * 1.45, y: protectorDepth }, renderPos: { x: holderX + guardSpacing * 1.45, y: protectorDepth } },
        ],
        rushers: [
            makeRusher({
                role: 'LE',
                pos: { x: holderX - guardSpacing * 3.5, y: rushStartY },
                target: { x: holderX - guardSpacing * 0.8, y: rushTargetY },
                delay: 0,
                hold: 0.68,
                engage: 0.42,
                speed: 0.72,
            }),
            makeRusher({
                role: 'NG',
                pos: { x: holderX - guardSpacing * 0.3, y: rushStartY + yard * 0.05 },
                target: { x: holderX - guardSpacing * 0.05, y: rushTargetY + yard * 0.05 },
                delay: 0.08,
                hold: 0.74,
                engage: 0.48,
                speed: 0.66,
            }),
            makeRusher({
                role: 'RE',
                pos: { x: holderX + guardSpacing * 3.4, y: rushStartY },
                target: { x: holderX + guardSpacing * 0.7, y: rushTargetY },
                delay: 0.04,
                hold: 0.64,
                engage: 0.4,
                speed: 0.7,
            }),
        ],
        ball: {
            pos: { ...snapOrigin },
            shadow: { ...snapOrigin },
            height: 0,
        },
        snap: {
            from: snapOrigin,
            to: catchPoint,
            duration: 0.32,
        },
        rushSpeed,
        contactPoint: catchPoint,
        uprights: {
            goalLineY: yardsToPixY(ENDZONE_YARDS + PLAYING_YARDS_H),
            crossbarY: yardsToPixY(ENDZONE_YARDS + PLAYING_YARDS_H) - yardsToPixY(3.33),
            halfWidth: 38,
            centerX,
        },
        goalHighlight: 0,
        distance,
        yard,
    };
}

function resolveFieldGoalAttempt(state, { team, distance, isPat = false }) {
    if (!team || !Number.isFinite(distance)) {
        return { success: false, distance: distance ?? 0, summary: 'No kick attempted', isPat, team, chance: 0, roll: 1, kicker: null };
    }
    const kicker = getTeamKicker(state, team);
    const label = isPat ? 'Extra point' : 'Field goal';
    const blockChance = 0.065;
    const blockRoll = Math.random();
    if (blockRoll <= blockChance) {
        const summary = `${label} blocked`;
        return {
            team,
            distance,
            isPat,
            kicker,
            chance: 0,
            roll: blockRoll,
            success: false,
            summary,
            points: isPat ? 1 : 3,
            missType: 'blocked',
            blocked: true,
        };
    }
    const chance = kickerSuccessChance(kicker, distance);
    const roll = Math.random();
    const success = roll <= chance;
    let missType = null;
    if (!success) {
        const delta = roll - chance;
        if (delta > 0.12) missType = 'wide-right';
        else if (delta > 0.02) missType = 'wide-left';
        else missType = 'short';
    }
    const missText = missType === 'wide-right'
        ? ' wide right'
        : missType === 'wide-left'
            ? ' wide left'
            : missType === 'short'
                ? ' short'
                : '';
    const summary = success
        ? `${label} good from ${distance} yards`
        : `${label} missed${missText} from ${distance} yards`;

    return {
        team,
        distance,
        isPat,
        kicker,
        chance,
        roll,
        success,
        summary,
        points: isPat ? 1 : 3,
        missType,
    };
}

function applyFieldGoalOutcome(state, ctx, outcome, { logAttempt = true } = {}) {
    if (!outcome) return outcome;
    const { team, distance, isPat, success, chance, roll, kicker, summary, points } = outcome;
    if (!team) return outcome;

    if (!state.scores) state.scores = { [TEAM_RED]: 0, [TEAM_BLK]: 0 };

    recordPlayEvent(state, {
        type: 'kick:field-goal',
        team,
        kickerId: kicker?.id || null,
        distance,
        success,
        chance,
        roll,
        isPat,
    });

    if (kicker) recordKickingAttempt(state, kicker.id, { distance, made: success, isPat });
    if (success) state.scores[team] = (state.scores[team] ?? 0) + points;

    if (logAttempt && ctx.startDown != null && ctx.startToGo != null) {
        const label = isPat ? 'Extra point' : 'Field goal';
        pushPlayLog(state, {
            name: label,
            startDown: ctx.startDown,
            startToGo: ctx.startToGo,
            startLos: ctx.startLos,
            endLos: ctx.startLos,
            gained: 0,
            result: summary,
            offense: team,
            turnover: !success && !isPat,
        });
    }

    state.play.resultText = summary;
    return outcome;
}

function advanceFieldGoalState(state, ctx, outcome) {
    if (!outcome || !ctx) return;
    const { team, success, summary, isPat } = outcome;
    stopClock(state, summary);
    const defense = otherTeam(team);
    if (!state.teams) state.teams = createTeams(state.matchup);
    state.possession = defense;
    state.roster = rosterForPossession(state.teams, state.possession);
    if (isPat) {
        state.drive = { losYards: 25, down: 1, toGo: 10 };
    } else if (success) {
        state.drive = { losYards: 25, down: 1, toGo: 10 };
    } else {
        const takeoverLos = clamp(100 - (ctx.startLos ?? 20), 1, 99);
        state.drive = { losYards: takeoverLos, down: 1, toGo: Math.min(10, 100 - takeoverLos) };
    }

    finalizePlayDiagnostics(state, {
        result: summary,
        gained: 0,
        endLos: state.drive.losYards,
        turnover: !success,
    });

    state.roster.__ownerState = state;
    state.play = createPlayState(state.roster, state.drive);
    state.play.resultText = summary;
    beginPlayDiagnostics(state);
}

function computeFieldGoalTarget(visual, outcome) {
    const { uprights, contactPoint } = visual;
    if (!uprights) return { ...contactPoint };
    const endzoneDepth = yardsToPixY(ENDZONE_YARDS);
    const carryPastGoal = yardsToPixY(3.5);
    const fullCarryY = Math.min(uprights.goalLineY + endzoneDepth + carryPastGoal, FIELD_PIX_H - yardsToPixY(0.5));
    let targetX = uprights.centerX;
    let targetY = fullCarryY;
    if (outcome?.success) {
        const sway = (Math.random() - 0.5) * uprights.halfWidth * 0.6;
        targetX += sway;
    } else {
        const missType = outcome?.missType;
        if (missType === 'wide-right') {
            targetX = uprights.centerX + uprights.halfWidth + 34;
        } else if (missType === 'wide-left') {
            targetX = uprights.centerX - uprights.halfWidth - 34;
        } else if (missType === 'blocked') {
            targetX = contactPoint.x + (Math.random() - 0.5) * PX_PER_YARD * 1.75;
            targetY = contactPoint.y + PX_PER_YARD * (0.8 + Math.random() * 1.1);
        } else {
            targetX = uprights.centerX + (Math.random() - 0.5) * uprights.halfWidth * 0.35;
            targetY = Math.max(contactPoint.y + 40, uprights.goalLineY - yardsToPixY(1 + Math.random() * 1.5));
        }
    }
    return {
        x: clamp(targetX, 18, FIELD_PIX_W - 18),
        y: targetY,
    };
}

function computeFieldGoalApex(distance, outcome) {
    const base = clamp(distance * 0.32, 18, 42);
    let modifier = 1;
    if (outcome?.missType === 'blocked') {
        modifier = 0.35;
    } else if (!outcome?.success) {
        if (outcome?.missType === 'short') modifier = 0.65;
        else modifier = 0.8;
    }
    return yardsToPixY(base * modifier);
}

function updateFieldGoalAttempt(state, dt) {
    const play = state.play;
    if (!play?.specialTeams) return false;
    const special = play.specialTeams;
    const losYards = play.startLos ?? state.drive?.losYards ?? 25;
    const distance = special.distance ?? fieldGoalDistanceYards(losYards);
    if (!special.visual) {
        special.visual = createFieldGoalVisual({ losYards, distance });
    }
    const visual = special.visual;
    const ctx = {
        team: state.possession,
        distance,
        isPat: !!special.isPat,
        startLos: losYards,
        startDown: play.startDown ?? state.drive?.down ?? 1,
        startToGo: play.startToGo ?? state.drive?.toGo ?? 10,
    };

    if (visual.snapper) {
        const crouch = visual.phase === 'PREP' ? Math.min(8, visual.phaseTime * 12) : 8;
        const snapExtend = visual.phase === 'SNAP' ? Math.min(10, visual.phaseTime / (visual.snapDuration || 0.3) * 10) : 0;
        visual.snapper.renderPos = {
            x: visual.snapper.pos.x,
            y: visual.snapper.pos.y + crouch - snapExtend * 0.25,
        };
    }

    const updateProtection = () => {
        const yardPix = visual.yard || yardsToPixY(1);
        const sinceSnap = visual.snapStartedAt == null ? 0 : Math.max(0, (visual.totalTime || 0) - visual.snapStartedAt);
        const engage = smoothStep(clamp(sinceSnap / 0.55, 0, 1));

        if (visual.line) {
            visual.line.forEach((blocker) => {
                if (!blocker?.pos) return;
                const lateral = (blocker.role === 'LW' ? -1 : blocker.role === 'RW' ? 1 : 0) * engage * yardPix * 0.28;
                const anchor = blocker.role === 'C' ? engage * yardPix * 0.08 : 0;
                blocker.renderPos = {
                    x: blocker.pos.x + lateral,
                    y: blocker.pos.y + engage * yardPix * 0.22 - anchor,
                };
            });
        }
        if (visual.protectors) {
            visual.protectors.forEach((pp, idx) => {
                if (!pp?.pos) return;
                const settle = smoothStep(clamp(sinceSnap / 0.65, 0, 1));
                const direction = idx === 0 ? -1 : 1;
                pp.renderPos = {
                    x: pp.pos.x + direction * settle * yardPix * 0.22,
                    y: pp.pos.y + settle * yardPix * 0.32,
                };
            });
        }
    };

    const updateRushers = () => {
        if (!visual.rushers || !visual.rushSpeed) return;
        if (visual.snapStartedAt == null) return;
        const sinceSnap = Math.max(0, (visual.totalTime || 0) - visual.snapStartedAt);
        visual.rushers.forEach((r) => {
            if (!r?.target) return;
            const delay = r.delay || 0;
            const timeSinceDelay = sinceSnap - delay;
            if (timeSinceDelay <= 0) {
                r.renderPos = { ...r.pos };
                return;
            }
            const engagePoint = r.engagePoint || r.pos;
            const blockDuration = r.blockDuration || 0;
            if (timeSinceDelay < blockDuration) {
                const holdT = clamp(timeSinceDelay / Math.max(blockDuration, 0.0001), 0, 1);
                const easedHold = smoothStep(holdT);
                r.renderPos = {
                    x: lerp(r.pos.x, engagePoint.x, easedHold),
                    y: lerp(r.pos.y, engagePoint.y, easedHold),
                };
                return;
            }

            const startPos = engagePoint;
            const dx = r.target.x - startPos.x;
            const dy = r.target.y - startPos.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const effectiveSpeed = visual.rushSpeed * (r.speedMultiplier || 0.65);
            const travelTime = dist / effectiveSpeed;
            const travelElapsed = timeSinceDelay - blockDuration;
            const progress = clamp(travelElapsed / travelTime, 0, 1);
            const eased = smoothStep(progress);
            r.renderPos = {
                x: lerp(startPos.x, r.target.x, eased),
                y: lerp(startPos.y, r.target.y, eased),
            };
        });
    };

    const phase = visual.phase || 'PREP';
    const dtClamped = Math.min(dt, 0.05);
    visual.totalTime = (visual.totalTime || 0) + dtClamped;
    visual.phaseTime = (visual.phaseTime || 0) + dtClamped;

    const updateHolder = (t) => {
        if (!visual.holder) return;
        const eased = smoothStep(clamp(t, 0, 1));
        visual.holder.renderPos = {
            x: lerp(visual.holder.pos.x, visual.holder.kneel.x, eased),
            y: lerp(visual.holder.pos.y, visual.holder.kneel.y, eased),
        };
    };

    const setKicker = (p) => {
        if (!visual.kicker) return;
        visual.kicker.renderPos = { x: p.x, y: p.y };
    };

    const ensureBallState = () => {
        play.ball.renderPos = { ...visual.ball.pos };
        play.ball.shadowPos = { ...visual.ball.shadow };
        play.ball.flight = { height: visual.ball.height };
    };

    updateProtection();
    updateRushers();

    switch (phase) {
        case 'PREP': {
            updateHolder(visual.phaseTime / visual.prepDuration);
            if (visual.phaseTime >= visual.prepDuration) {
                visual.phase = 'SNAP';
                visual.phaseTime = 0;
                visual.snapStartedAt = visual.totalTime || 0;
            }
            break;
        }
        case 'SNAP': {
            updateHolder(clamp(visual.phaseTime / (visual.snapDuration || 0.3), 0, 1));
            const snap = visual.snap || { from: visual.contactPoint, to: visual.contactPoint, duration: 0.3 };
            const snapT = clamp(visual.phaseTime / (snap.duration || 0.3), 0, 1);
            const eased = easeOutQuad(snapT);
            const pos = {
                x: lerp(snap.from.x, snap.to.x, eased),
                y: lerp(snap.from.y, snap.to.y, eased),
            };
            visual.ball.pos = pos;
            visual.ball.shadow = { x: pos.x, y: snap.to.y + PX_PER_YARD * 0.35 };
            visual.ball.height = Math.sin(Math.PI * snapT) * PX_PER_YARD * 0.6;
            if (snapT >= 1) {
                visual.ball.pos = { ...visual.contactPoint };
                visual.ball.shadow = { x: visual.contactPoint.x, y: visual.holder.pos.y };
                visual.ball.height = 0;
                visual.phase = 'APPROACH';
                visual.phaseTime = 0;
            }
            break;
        }
        case 'APPROACH': {
            updateHolder(1);
            const t = clamp(visual.phaseTime / visual.approachDuration, 0, 1);
            const eased = easeOutQuad(t);
            const pos = {
                x: lerp(visual.kicker.start.x, visual.kicker.plant.x, eased),
                y: lerp(visual.kicker.start.y, visual.kicker.plant.y, eased),
            };
            visual.kicker.pos = pos;
            setKicker(pos);
            if (t >= 1) {
                visual.phase = 'SWING';
                visual.phaseTime = 0;
            }
            break;
        }
        case 'SWING': {
            updateHolder(1);
            const t = clamp(visual.phaseTime / visual.swingDuration, 0, 1);
            const eased = easeInOutQuad(t);
            const pos = {
                x: lerp(visual.kicker.plant.x, visual.kicker.follow.x, eased),
                y: lerp(visual.kicker.plant.y, visual.kicker.follow.y, eased),
            };
            visual.kicker.pos = pos;
            setKicker(pos);
            if (t >= 0.45 && !special.outcome) {
                special.outcome = resolveFieldGoalAttempt(state, ctx);
                visual.flight = {
                    from: { ...visual.contactPoint },
                    to: computeFieldGoalTarget(visual, special.outcome),
                    duration: visual.flightDuration,
                    elapsed: 0,
                    apex: computeFieldGoalApex(distance, special.outcome),
                };
                if (special.outcome.missType === 'blocked') {
                    visual.flight.duration = Math.min(0.7, visual.flight.duration * 0.6);
                }
                visual.ball.pos = { ...visual.contactPoint };
                visual.ball.shadow = { ...visual.contactPoint };
                if (special.outcome.missType === 'blocked') {
                    play.resultText = 'Kick is blocked!';
                } else {
                    play.resultText = special.outcome.isPat ? 'Extra point is up...' : 'Kick is on the way...';
                }
            }
            if (t >= 1 && special.outcome) {
                visual.phase = 'FLIGHT';
                visual.phaseTime = 0;
            }
            break;
        }
        case 'FLIGHT': {
            updateHolder(1);
            if (!visual.flight) {
                visual.phase = 'RESULT';
                visual.phaseTime = 0;
                break;
            }
            visual.flight.elapsed += dtClamped;
            const tRaw = clamp(visual.flight.elapsed / visual.flight.duration, 0, 1);
            const eased = smoothStep(tRaw);
            const pos = {
                x: lerp(visual.flight.from.x, visual.flight.to.x, eased),
                y: lerp(visual.flight.from.y, visual.flight.to.y, eased),
            };
            const outcome = special.outcome;
            const shadowTarget = outcome?.missType === 'blocked'
                ? visual.flight.to.y
                : visual.uprights.goalLineY;
            const shadowY = lerp(visual.flight.from.y, shadowTarget, eased);
            visual.ball.pos = pos;
            visual.ball.shadow = { x: pos.x, y: shadowY };
            visual.ball.height = Math.sin(Math.PI * tRaw) * visual.flight.apex;
            setKicker(visual.kicker.follow);
            if (tRaw >= 1) {
                visual.phase = 'RESULT';
                visual.phaseTime = 0;
            }
            break;
        }
        case 'RESULT': {
            updateHolder(1);
            setKicker(visual.kicker.follow);
            if (special.outcome?.success) {
                visual.goalHighlight = clamp((visual.phaseTime || 0) / 0.35, 0, 1);
            } else {
                visual.goalHighlight = 0;
            }
            if (!visual.outcomeApplied && special.outcome) {
                applyFieldGoalOutcome(state, ctx, special.outcome, { logAttempt: true });
                visual.outcomeApplied = true;
            }
            if (visual.phaseTime >= visual.resultDuration) {
                if (!visual.finalized && special.outcome) {
                    visual.finalized = true;
                    advanceFieldGoalState(state, ctx, special.outcome);
                    return true;
                }
            }
            break;
        }
        default:
            break;
    }

    ensureBallState();
    return false;
}

function executeFieldGoalAttempt(state, {
    team,
    distance,
    isPat = false,
    startLos,
    startDown,
    startToGo,
    logAttempt = true,
    autoAdvanceAfter = false,
}) {
    const ctx = { team, distance, isPat, startLos, startDown, startToGo };
    const outcome = resolveFieldGoalAttempt(state, ctx);
    applyFieldGoalOutcome(state, ctx, outcome, { logAttempt });
    if (autoAdvanceAfter) {
        advanceFieldGoalState(state, ctx, outcome);
    }
    return outcome;
}

function scheduleExtraPoint(state, team, { startLos = null, startDown = null, startToGo = null } = {}) {
    if (!team) return null;
    const losYards = 84; // snaps from the 15-yard line → 33 yard kick
    const pending = {
        team,
        distance: 33,
        losYards,
        startLos: losYards,
        startDown: startDown ?? state.drive?.down ?? 1,
        startToGo: startToGo ?? state.drive?.toGo ?? 10,
        sourceStartLos: startLos ?? state.drive?.losYards ?? losYards,
    };
    state.pendingExtraPoint = pending;
    return pending;
}

function otherTeam(team) {
    return team === TEAM_RED ? TEAM_BLK : TEAM_RED;
}

function createClock() {
    const settings = {
        [TEAM_RED]: { ...DEFAULT_CLOCK_MANAGEMENT },
        [TEAM_BLK]: { ...DEFAULT_CLOCK_MANAGEMENT },
    };
    return {
        quarter: 1,
        time: QUARTER_SECONDS,
        running: false,
        awaitSnap: true,
        stopReason: 'Pre-game',
        timeouts: { [TEAM_RED]: 3, [TEAM_BLK]: 3 },
        management: settings,
    };
}

function clockSettings(clock, team) {
    if (!clock) return DEFAULT_CLOCK_MANAGEMENT;
    return clock.management?.[team] || DEFAULT_CLOCK_MANAGEMENT;
}

function stopClock(s, reason = null) {
    if (!s.clock) return;
    s.clock.running = false;
    s.clock.awaitSnap = true;
    s.clock.stopReason = reason;
}

function startClockOnSnap(s) {
    if (!s.clock) return;
    if (s.clock.time <= 0) return;
    s.clock.running = true;
    s.clock.awaitSnap = false;
    s.clock.stopReason = null;
}

function updateClock(s, dt) {
    if (!s.clock) return;
    if (!s.clock.running || s.clock.time <= 0) return;
    const next = Math.max(0, s.clock.time - dt);
    s.clock.time = next;
    if (next === 0) {
        s.clock.running = false;
        s.clock.awaitSnap = true;
        s.clock.stopReason = 'Quarter end';
        if (s.clock.quarter < 4) {
            s.clock.quarter += 1;
            s.clock.time = QUARTER_SECONDS;
        }
    }
}

function consumeTimeout(s, team, reason) {
    if (!s.clock) return false;
    const remaining = s.clock.timeouts?.[team] ?? 0;
    if (remaining <= 0) return false;
    s.clock.timeouts[team] = remaining - 1;
    stopClock(s, reason || `${team} timeout`);
    recordPlayEvent(s, { type: 'timeout', team, reason: reason || 'Timeout' });
    return true;
}

function shouldStopClockForResult(why, turnover = false) {
    if (turnover) return true;
    if (!why) return false;
    const w = String(why).toLowerCase();
    return (
        w.includes('out of bounds') ||
        w.includes('incomplete') ||
        w.includes('drop') ||
        w.includes('touchdown') ||
        w.includes('safety') ||
        w.includes('interception') ||
        w.includes('turnover') ||
        w.includes('throw away') ||
        w.includes('throwaway') ||
        w.includes('spike') ||
        w.includes('fumble')
    );
}

function maybeAutoTimeout(s, ctx) {
    if (!s.clock || s.clock.awaitSnap || s.clock.time <= 0) return false;
    if (shouldStopClockForResult(ctx.resultWhy, ctx.turnover)) return false;

    const offense = ctx.offense;
    const defense = otherTeam(offense);
    const offScore = s.scores?.[offense] ?? 0;
    const defScore = s.scores?.[defense] ?? 0;
    const clockTime = s.clock.time;

    const tryTimeout = (team, reason) => {
        if (consumeTimeout(s, team, reason)) {
            pushPlayLog(s, {
                name: 'Timeout',
                startDown: ctx.startDown,
                startToGo: ctx.startToGo,
                startLos: ctx.startLos,
                endLos: ctx.startLos,
                gained: 0,
                why: `${team} timeout`,
                offense: offense,
            });
            s.play.resultText = `${team} timeout`;
            return true;
        }
        return false;
    };

    const offSettings = clockSettings(s.clock, offense);
    const defSettings = clockSettings(s.clock, defense);

    const offenseTrailing = offScore < defScore;
    const defenseTrailing = defScore < offScore;

    if (offenseTrailing && clockTime <= (offSettings.hurryThreshold ?? DEFAULT_CLOCK_MANAGEMENT.hurryThreshold)) {
        if (tryTimeout(offense, 'Offense timeout')) return true;
    }

    if (clockTime <= (offSettings.mustTimeoutThreshold ?? DEFAULT_CLOCK_MANAGEMENT.mustTimeoutThreshold)) {
        if ((defScore - offScore) <= (offSettings.trailingMargin ?? DEFAULT_CLOCK_MANAGEMENT.trailingMargin)) {
            if (tryTimeout(offense, 'Clock management timeout')) return true;
        }
    }

    if (defenseTrailing && clockTime <= (defSettings.defensiveThreshold ?? DEFAULT_CLOCK_MANAGEMENT.defensiveThreshold)) {
        if (tryTimeout(defense, 'Defense timeout')) return true;
    }

    return false;
}

function maybeTimeoutToAvoidRunoff(s, ctx, runoffSeconds = 25) {
    if (!s.clock || s.clock.awaitSnap || !s.clock.running || s.clock.time <= 0) return false;

    const offense = ctx.offense;
    const remaining = s.clock.timeouts?.[offense] ?? 0;
    if (remaining <= 0) return false;

    const clockTime = s.clock.time;
    const offenseScore = s.scores?.[offense] ?? 0;
    const defenseScore = s.scores?.[otherTeam(offense)] ?? 0;
    const trailing = offenseScore < defenseScore;

    const settings = clockSettings(s.clock, offense);
    const hurryThreshold = settings.hurryThreshold ?? DEFAULT_CLOCK_MANAGEMENT.hurryThreshold;
    const mustThreshold = settings.mustTimeoutThreshold ?? DEFAULT_CLOCK_MANAGEMENT.mustTimeoutThreshold;

    const avoidExpiration = clockTime <= runoffSeconds;
    const mustUse = clockTime <= Math.max(runoffSeconds, mustThreshold);
    const hurry = trailing && clockTime <= hurryThreshold;

    if (!(avoidExpiration || mustUse || hurry)) return false;

    if (!consumeTimeout(s, offense, 'Timeout to stop runoff')) return false;

    pushPlayLog(s, {
        name: 'Timeout',
        startDown: ctx.startDown,
        startToGo: ctx.startToGo,
        startLos: ctx.startLos,
        endLos: ctx.startLos,
        gained: 0,
        why: 'Timeout to stop runoff',
        offense: offense,
    });
    s.play.resultText = 'Timeout to stop runoff';
    return true;
}

function applyBetweenPlayRunoff(s, seconds = 25) {
    if (!s.clock || s.clock.awaitSnap || !s.clock.running || s.clock.time <= 0) return;
    const runoff = Math.min(seconds, s.clock.time);
    if (runoff <= 0) return;
    updateClock(s, runoff);
    recordPlayEvent(s, { type: 'clock:runoff', seconds: runoff });
}

function maybeAssessPenalty(s, ctx) {
    if (!s.play || Math.random() > PENALTY_CHANCE) return null;
    if (ctx.turnover || ctx.scoring) return null;

    const offense = ctx.offense;
    const defense = otherTeam(offense);
    const penalties = [
        { team: 'OFF', name: 'Holding', yards: 10, repeatDown: true },
        { team: 'OFF', name: 'False start', yards: 5, repeatDown: true },
        { team: 'DEF', name: 'Offside', yards: 5, repeatDown: true },
        { team: 'DEF', name: 'Defensive pass interference', yards: 15, autoFirstDown: true },
        { team: 'DEF', name: 'Facemask', yards: 15, autoFirstDown: true },
    ];

    const chosen = penalties[(Math.random() * penalties.length) | 0];
    if (!chosen) return null;

    const flaggedTeam = chosen.team === 'OFF' ? offense : defense;
    const direction = chosen.team === 'OFF' ? -1 : 1;
    const appliedYards = chosen.yards * direction;
    const newLos = clamp(ctx.startLos + appliedYards, 1, 99);
    let down = chosen.autoFirstDown ? 1 : ctx.startDown;
    let toGo;

    if (chosen.autoFirstDown) {
        toGo = Math.min(10, 100 - newLos);
    } else if (chosen.team === 'OFF') {
        down = ctx.startDown;
        toGo = Math.max(1, ctx.startToGo + chosen.yards);
    } else {
        const reduced = Math.max(1, ctx.startToGo - chosen.yards);
        if (reduced <= 1) {
            down = 1;
            toGo = Math.min(10, 100 - newLos);
        } else {
            toGo = reduced;
        }
    }

    s.drive = { losYards: newLos, down, toGo };
    s.possession = offense;
    s.teams = s.teams || createTeams(s.matchup);
    s.roster = rosterForPossession(s.teams, s.possession);
    s.roster.__ownerState = s;

    const text = `${flaggedTeam} penalty: ${chosen.name} (${chosen.yards} yards)`;
    s.play.resultText = text;
    recordPlayEvent(s, { type: 'penalty', team: flaggedTeam, yards: chosen.yards, name: chosen.name });

    pushPlayLog(s, {
        name: 'Penalty',
        startDown: ctx.startDown,
        startToGo: ctx.startToGo,
        startLos: ctx.startLos,
        endLos: newLos,
        gained: appliedYards,
        why: text,
        offense,
    });

    stopClock(s, 'Penalty');
    return { flaggedTeam, penalty: chosen, text };
}

/** End-of-play spot in yards; freeze at LOS for no-advance results. */
function resolveEndSpot(s) {
    const bp = getBallPix(s);
    // convert portrait-space pixel Y to yards going in, relative to the offense's own goal line
    let y = pixYToYards(bp?.y ?? yardsToPixY(ENDZONE_YARDS + s.drive.losYards)) - ENDZONE_YARDS;
    if (!Number.isFinite(y)) y = s.drive?.losYards ?? 25;
    const yards = clamp(Math.round(y), 0, 100);
    return {
        yards,
        rawYards: y,
        inOwnEndzone: y < 0,
    };
}

function resolveEndSpotYards(s) {
    return resolveEndSpot(s).yards;
}


/* =========================================================
   Trace (kept minimal & safe)
   ========================================================= */
function recordTraceSample(s) {
    if (!s?.debug?.trace) return;
    const off = s?.play?.formation?.off || {};
    const def = s?.play?.formation?.def || {};
    (s.trace ||= []).push({
        t: s.play?.elapsed ?? 0,
        ball: { ...(s.play?.ball || {}) },
        off: Object.fromEntries(Object.entries(off).map(([k, p]) => [k, p?.pos ? { x: p.pos.x, y: p.pos.y } : null])),
        def: Object.fromEntries(Object.entries(def).map(([k, p]) => [k, p?.pos ? { x: p.pos.x, y: p.pos.y } : null])),
    });
    if (s.trace.length > 2000) s.trace.shift();
}

function gatherActivePlayers(play) {
    if (!play || !play.formation) return [];
    const off = Object.values(play.formation.off || {});
    const def = Object.values(play.formation.def || {});
    return [...off, ...def].filter(p => p && p.pos);
}

const MOTION_ROLES = ['WR3', 'WR2', 'WR1', 'TE', 'RB'];

function createMotionPlan(off) {
    if (!off) return null;
    if (Math.random() > 0.6) return null;
    const candidates = MOTION_ROLES.filter(role => off[role]?.pos);
    if (!candidates.length) return null;
    const role = candidates[(Math.random() * candidates.length) | 0];
    const player = off[role];
    if (!player?.pos) return null;

    const span = rand(2.5, 6.5) * PX_PER_YARD;
    const direction = Math.random() < 0.5 ? -1 : 1;
    const destX = clamp(player.pos.x + direction * span, 18, FIELD_PIX_W - 18);
    const destY = clamp(
        player.pos.y + (role === 'RB' ? rand(-0.6, 0.6) * PX_PER_YARD : 0),
        yardsToPixY(ENDZONE_YARDS),
        yardsToPixY(ENDZONE_YARDS + PLAYING_YARDS_H),
    );

    return {
        role,
        from: { x: player.pos.x, y: player.pos.y },
        to: { x: destX, y: destY },
        duration: rand(0.45, 0.85),
        elapsed: 0,
        done: false,
    };
}

function advanceMotion(play, dt) {
    const plan = play?.preSnap?.motion;
    if (!plan || plan.done) return;

    const player = play.formation?.off?.[plan.role];
    if (!player?.pos) {
        plan.done = true;
        return;
    }

    plan.elapsed = Math.min(plan.elapsed + dt, plan.duration);
    const t = plan.duration > 0 ? clamp(plan.elapsed / plan.duration, 0, 1) : 1;
    const eased = t * t * (3 - 2 * t);
    const nx = plan.from.x + (plan.to.x - plan.from.x) * eased;
    const ny = plan.from.y + (plan.to.y - plan.from.y) * eased;

    player.pos.x = nx;
    player.pos.y = ny;
    player.home = { x: nx, y: ny };

    if (plan.elapsed >= plan.duration - 1e-3) {
        plan.done = true;
    }
}

function createAudiblePlan(qb) {
    if (!qb) return null;
    const awareness = clamp(qb.attrs?.awareness ?? 0.9, 0.4, 1.35);
    const baseChance = 0.12 + (awareness - 0.85) * 0.25;
    const chance = clamp(baseChance, 0.08, 0.4);
    if (Math.random() >= chance) return null;
    return {
        timer: rand(0.45, 0.9),
        triggered: false,
        cooldown: 0,
    };
}

function chooseAudibleCall(state, currentCall) {
    const allPlays = [];
    if (Array.isArray(PLAYBOOK)) allPlays.push(...PLAYBOOK);
    if (Array.isArray(PLAYBOOK_PLUS)) allPlays.push(...PLAYBOOK_PLUS);
    if (!allPlays.length) return currentCall;

    const exclude = currentCall?.name || null;
    let pool = allPlays.filter(p => p && p.name !== exclude);
    if (!pool.length) pool = allPlays;

    const context = {
        down: state.drive?.down ?? 1,
        toGo: state.drive?.toGo ?? 10,
        yardline: state.drive?.losYards ?? 25,
    };

    const picked = pickPlayCall(pool, context) || pool[0];
    if (!picked) return currentCall;
    if (picked.name === exclude) return currentCall;
    return picked;
}

function updateAudible(state, dt) {
    const plan = state.play?.preSnap?.audible;
    if (!plan) return;

    if (plan.triggered) {
        if (plan.cooldown > 0) {
            plan.cooldown = Math.max(0, plan.cooldown - dt);
        }
        return;
    }

    plan.timer -= dt;
    if (plan.timer > 0) return;

    const nextCall = chooseAudibleCall(state, state.play?.playCall);
    if (!nextCall || nextCall === state.play?.playCall) {
        plan.triggered = true;
        plan.cooldown = 0;
        return;
    }

    state.play.playCall = nextCall;
    plan.triggered = true;
    plan.cooldown = 0.35;
    if (state.play?.preSnap) {
        state.play.preSnap.minDuration = Math.max(state.play.preSnap.minDuration || 1, state.play.elapsed + 0.3);
    }
    recordPlayEvent(state, { type: 'audible', play: nextCall.name });
}

function createDefenseAdjustmentPlan(formation) {
    if (!formation) return null;
    const def = formation.def || {};
    const off = formation.off || {};
    const defenders = Object.entries(def).filter(([, p]) => p && p.pos);
    if (!defenders.length) return null;

    const defFormation = formation.defFormation || '';
    const key = defFormation.toLowerCase();
    const strongRight = (off.WR3?.pos?.x ?? (FIELD_PIX_W / 2)) >= (FIELD_PIX_W / 2);
    const baseChance = key.includes('cover-4') ? 0.55
        : key.includes('cover-3') ? 0.45
        : key.includes('2-man') ? 0.4
        : key.includes('nickel 3-3-5') ? 0.35
        : 0.25;
    if (Math.random() >= baseChance) return null;

    const plan = {
        timer: rand(0.35, 0.85),
        duration: rand(0.4, 0.7),
        triggered: false,
        elapsed: 0,
        done: false,
        moves: [],
        defFormation,
    };

    const minY = yardsToPixY(ENDZONE_YARDS - 5);
    const maxY = yardsToPixY(ENDZONE_YARDS + PLAYING_YARDS_H + 5);
    const clampX = (x) => clamp(x, 18, FIELD_PIX_W - 18);
    const clampY = (y) => clamp(y, minY, maxY);
    const addMove = (role, dxYards = 0, dyYards = 0) => {
        const player = def[role];
        if (!player?.pos) return;
        const from = { x: player.pos.x, y: player.pos.y };
        const to = {
            x: clampX(player.pos.x + dxYards * PX_PER_YARD),
            y: clampY(player.pos.y + dyYards * PX_PER_YARD),
        };
        if (Math.hypot(to.x - from.x, to.y - from.y) < 1) return;
        plan.moves.push({ key: role, from, to });
    };

    if (key.includes('cover-4')) {
        addMove('CB1', -0.6, 1.0);
        addMove('CB2', 0.6, 1.0);
        addMove('NB', strongRight ? 0.6 : -0.6, 0.8);
        addMove('S1', strongRight ? -0.4 : -0.6, 2.2);
        addMove('S2', strongRight ? 0.6 : 0.4, 2.2);
    } else if (key.includes('cover-3')) {
        addMove('CB1', -0.5, 0.9);
        addMove('CB2', 0.5, 0.9);
        addMove('NB', strongRight ? -0.4 : 0.4, 0.6);
        addMove('S1', 0, 2.4);
        addMove('S2', strongRight ? 1.0 : -1.0, -0.9);
    } else if (key.includes('2-man')) {
        addMove('CB1', -0.4, -0.6);
        addMove('CB2', 0.4, -0.6);
        addMove('NB', strongRight ? 0.3 : -0.3, -0.5);
        addMove('S1', strongRight ? -0.6 : -0.5, 2.6);
        addMove('S2', strongRight ? 0.5 : 0.6, 2.6);
        addMove('LB1', -0.5, 0.8);
        addMove('LB2', 0.5, 0.8);
    } else if (key.includes('nickel 3-3-5')) {
        addMove('LB1', -0.4, 0.6);
        addMove('LB2', 0.4, 0.6);
        addMove('NB', 0, 0.6);
        addMove('S1', -0.4, 1.2);
        addMove('S2', 0.4, 1.2);
    } else {
        addMove('LB1', -0.3, 0.4);
        addMove('LB2', 0.3, 0.4);
        addMove('S1', -0.3, 0.8);
        addMove('S2', 0.3, 0.8);
    }

    if (!plan.moves.length) return null;
    return plan;
}

function updateDefenseAdjustments(state, dt) {
    const plan = state.play?.preSnap?.defense;
    if (!plan || plan.done) return;

    if (!plan.triggered) {
        plan.timer -= dt;
        if (plan.timer > 0) return;
        plan.triggered = true;
        plan.timer = 0;
        if (!plan.moves?.length) {
            plan.done = true;
            return;
        }
        plan.elapsed = 0;
        if (state.play?.preSnap) {
            state.play.preSnap.minDuration = Math.max(state.play.preSnap.minDuration || 1, state.play.elapsed + plan.duration);
        }
        return;
    }

    const def = state.play?.formation?.def;
    if (!def) {
        plan.done = true;
        return;
    }

    plan.elapsed = Math.min((plan.elapsed || 0) + dt, plan.duration || 0.01);
    const duration = plan.duration || 0.01;
    const t = duration > 0 ? clamp(plan.elapsed / duration, 0, 1) : 1;
    const eased = t * t * (3 - 2 * t);

    plan.moves.forEach((move) => {
        const player = def[move.key];
        if (!player?.pos) return;
        const nx = move.from.x + (move.to.x - move.from.x) * eased;
        const ny = move.from.y + (move.to.y - move.from.y) * eased;
        player.pos.x = nx;
        player.pos.y = ny;
        player.home = { x: nx, y: ny };
    });

    if (plan.elapsed >= duration - 1e-3) {
        plan.done = true;
    }
}

function createPreSnapPlan(formation) {
    const off = formation?.off || {};
    const plan = {
        motion: createMotionPlan(off),
        audible: createAudiblePlan(off.QB),
        defense: createDefenseAdjustmentPlan(formation),
        minDuration: 1.0,
    };
    return plan;
}

function ensurePreSnapPlan(play) {
    if (!play) return;
    if (!play.preSnap) play.preSnap = createPreSnapPlan(play.formation || {});
}

function presnapReady(play) {
    if (!play?.preSnap) return true;
    const motionReady = !play.preSnap.motion || play.preSnap.motion.done;
    const audibleReady = !play.preSnap.audible || play.preSnap.audible.triggered;
    const defenseReady = !play.preSnap.defense || play.preSnap.defense.done;
    const cooldown = play.preSnap.audible?.cooldown ?? 0;
    return motionReady && audibleReady && defenseReady && cooldown <= 0.01;
}

function updatePreSnap(state, dt) {
    if (!state?.play) return;
    ensurePreSnapPlan(state.play);
    advanceMotion(state.play, dt);
    updateAudible(state, dt);
    updateDefenseAdjustments(state, dt);
}

/* =========================================================
   Game state factories
   ========================================================= */
export function createInitialGameState(options = {}) {
    const { startGameIndex = 0 } = options || {};
    const season = createSeasonState();
    if (Number.isFinite(startGameIndex) && startGameIndex > 0) {
        const desiredIndex = Math.max(0, Math.floor(startGameIndex));
        const scheduleLength = season.schedule?.length ?? 0;
        if (scheduleLength > 0) {
            if (desiredIndex >= scheduleLength) {
                season.currentGameIndex = scheduleLength;
                season.completedGames = scheduleLength;
            } else {
                season.currentGameIndex = desiredIndex;
                season.completedGames = desiredIndex;
            }
        }
    }
    const matchup = prepareSeasonMatchup(season);
    const state = {
        season,
        playLog: [],
        debug: { trace: false },
    };
    prepareGameForMatchup(state, matchup);
    return state;
}

export function createPlayState(roster, drive) {
    const safeDrive = (drive && typeof drive.losYards === 'number')
        ? drive
        : { losYards: 25, down: 1, toGo: 10 };

    const losPixY = yardsToPixY(ENDZONE_YARDS + safeDrive.losYards);
    const formationNames = pickFormations({
        down: safeDrive.down,
        toGo: safeDrive.toGo,
        yardline: safeDrive.losYards,
    }) || {};

    const formation = lineUpFormation(roster, losPixY, formationNames) || { off: {}, def: {} };

    const ownerState = roster?.__ownerState || null;
    const pendingPat = ownerState?.pendingExtraPoint || null;
    const offenseTeam = roster?.off?.QB?.team || roster?.off?.RB?.team || roster?.special?.K?.team || TEAM_RED;
    const defenseTeam = otherTeam(offenseTeam);
    const kicker = roster?.special?.K || null;
    const debugForced = !!(ownerState && ownerState.debug?.forceNextArmed);

    let fieldGoalPlan = null;
    if (pendingPat && kicker) {
        fieldGoalPlan = {
            distance: pendingPat.distance ?? fieldGoalDistanceYards(safeDrive.losYards),
            kicker,
        };
    } else if (!debugForced && safeDrive.down === 4 && kicker) {
        const distance = fieldGoalDistanceYards(safeDrive.losYards);
        if (distance <= (kicker.maxDistance || 0) + 0.01) {
            const scores = ownerState?.scores || {};
            const offenseScore = scores?.[offenseTeam] ?? 0;
            const defenseScore = scores?.[defenseTeam] ?? 0;
            const shortToGo = safeDrive.toGo <= 2;
            const trailing = offenseScore + 3 < defenseScore;
            const lateClock = ownerState?.clock?.time != null && ownerState.clock.time < 120;
            let goForItChance = 0.12;
            if (shortToGo) goForItChance += 0.25;
            if (safeDrive.losYards < 60) goForItChance += 0.14;
            if (trailing) goForItChance += 0.18;
            if (lateClock && trailing) goForItChance += 0.12;
            goForItChance = clamp(goForItChance, 0, 0.75);
            if (!(rand(0, 1) < goForItChance)) {
                fieldGoalPlan = { distance, kicker };
            }
        }
    }

    // NEW: pick by forced name if armed and valid
    let playCall;
    if (debugForced) {
        const dbg = ownerState.debug;
        const named = Array.isArray(PLAYBOOK) ? PLAYBOOK.find(p => p.name === dbg.forceNextPlayName) : null;
        playCall = named || (Array.isArray(PLAYBOOK) && PLAYBOOK.length
            ? PLAYBOOK[(Math.random() * PLAYBOOK.length) | 0]
            : { name: 'Run Middle', type: 'RUN' });

        // one-shot consumption
        dbg.forceNextArmed = false;
        // keep dbg.forceNextPlayName around so UI can still show it; clear if you prefer:
        // dbg.forceNextPlayName = null;
    } else if (pendingPat && fieldGoalPlan) {
        playCall = { name: 'Extra Point', type: 'FIELD_GOAL' };
    } else if (fieldGoalPlan) {
        playCall = { name: fieldGoalPlan.distance <= 40 ? 'Field Goal' : 'Long Field Goal', type: 'FIELD_GOAL' };
    } else {
        const allPlays = [];
        if (Array.isArray(PLAYBOOK)) allPlays.push(...PLAYBOOK);
        if (Array.isArray(PLAYBOOK_PLUS)) allPlays.push(...PLAYBOOK_PLUS);
        const context = {
            down: safeDrive.down,
            toGo: safeDrive.toGo,
            yardline: safeDrive.losYards,
        };
        let pool = allPlays.length ? allPlays : [{ name: 'Run Middle', type: 'RUN' }];
        if (safeDrive.down === 4) {
            if (safeDrive.toGo >= 7) {
                const passOnly = pool.filter(p => p.type === 'PASS');
                if (passOnly.length) pool = passOnly;
            } else if (safeDrive.toGo >= 4) {
                const nonRun = pool.filter(p => p.type !== 'RUN');
                if (nonRun.length) pool = nonRun;
            }
        }
        playCall = pickPlayCall(pool, context) || pool[0] || { name: 'Run Middle', type: 'RUN' };
    }

    const qbPos = formation.off?.QB?.pos || { x: FIELD_PIX_W / 2, y: losPixY - yardsToPixY(3) };
    const ball = {
        inAir: false,
        carrierId: 'QB',
        lastCarrierId: 'QB',
        from: { x: qbPos.x, y: qbPos.y },
        to: { x: qbPos.x, y: qbPos.y },
        t: 0,
        targetId: null,
        renderPos: { x: qbPos.x, y: qbPos.y },
        shadowPos: { x: qbPos.x, y: qbPos.y },
        flight: null,
    };

    const play = {
        phase: 'PRESNAP',
        elapsed: 0,
        resultText: '',
        resultWhy: null,
        ball,
        formation,
        offFormation: formation.offFormation,
        defFormation: formation.defFormation,
        playCall,
        startLos: safeDrive.losYards,
        startDown: safeDrive.down,
        startToGo: safeDrive.toGo,
        mustReachSticks: safeDrive.down === 4 && safeDrive.toGo > 1,
        sticksDepthPx: safeDrive.toGo * PX_PER_YARD,
    };
    play.statContext = createPlayStatContext();
    if (pendingPat) {
        play.startLos = pendingPat.startLos ?? play.startLos;
        play.startDown = pendingPat.startDown ?? play.startDown;
        play.startToGo = pendingPat.startToGo ?? play.startToGo;
    }
    if (fieldGoalPlan && play.playCall?.type === 'FIELD_GOAL') {
        play.phase = 'FIELD_GOAL';
        play.specialTeams = {
            type: 'FIELD_GOAL',
            distance: Math.round(fieldGoalPlan.distance),
            isPat: !!pendingPat,
            kickerId: fieldGoalPlan.kicker?.id || null,
            visual: createFieldGoalVisual({ losYards: pendingPat?.losYards ?? safeDrive.losYards, distance: Math.round(fieldGoalPlan.distance) }),
        };
        const snapPoint = play.specialTeams.visual?.ball?.pos || play.specialTeams.visual?.contactPoint || { x: FIELD_PIX_W / 2, y: losPixY };
        play.ball.renderPos = { ...snapPoint };
        play.ball.shadowPos = { ...snapPoint };
        play.ball.flight = { height: 0 };
        play.ball.carrierId = null;
        if (pendingPat) {
            play.resultText = 'Extra point attempt';
            if (ownerState) ownerState.pendingExtraPoint = null;
        } else {
            play.resultText = `FG attempt from ${Math.round(fieldGoalPlan.distance)} yds`;
        }
        play.preSnap = null;
        return play;
    }
    play.preSnap = createPreSnapPlan(formation);
    return play;
}


/* =========================================================
   Main step
   ========================================================= */
export function stepGame(state, dt) {
    let s = { ...state };
    ensureDrive(s);

    if (!s.play) {
        s.roster.__ownerState = s;
        s.play = createPlayState(s.roster, s.drive);
        beginPlayDiagnostics(s);
    }

    updateClock(s, dt);

    s.play.elapsed += dt;

    switch (s.play.phase) {
        case 'FIELD_GOAL': {
            const done = updateFieldGoalAttempt(s, dt);
            if (done) return s;
            return s;
        }
        case 'PRESNAP': {
            updatePreSnap(s, dt);
            const minPresnap = s.play?.preSnap?.minDuration ?? 1.0;
            if (s.play.elapsed > minPresnap && presnapReady(s.play)) {
                s.play.phase = 'POSTSNAP';
                s.play.ball.carrierId = 'QB';
                s.play.ball.inAir = false;
                s.play.resultText = s.play.playCall?.name || 'Play';
                recordPlayEvent(s, { type: 'phase:post-snap' });
            }
            return s;
        }
        case 'POSTSNAP': {
            if (s.play.elapsed > 1.2) {
                s.play.phase = 'LIVE';
                startClockOnSnap(s);
                recordPlayEvent(s, { type: 'phase:live' });
            }
            return s;
        }
        case 'LIVE': {
            if (!s.play.formation) s.play.formation = { off: {}, def: {} };
            if (!s.play.routesInitialized) initRoutesAfterSnap(s);

            const off = s.play.formation.off;
            off.__runFlag = s.play.playCall.type === 'RUN' && (s.play.ball.carrierId === 'RB' || !s.play.handed);
            off.__losPixY = yardsToPixY(ENDZONE_YARDS + s.drive.losYards);
            off.__carrierWrapped = null;
            off.__carrierWrappedId = null;

            const activePlayers = gatherActivePlayers(s.play);
            beginFrame(activePlayers);

            moveOL(s.play.formation.off, s.play.formation.def, dt);
            moveReceivers(s.play.formation.off, dt, s);
            moveTE(s.play.formation.off, dt, s);
            qbLogic(s, dt);
            rbLogic(s, dt);
            defenseLogic(s, dt);
            moveBall(s, dt);

            checkDeadBall(s);
            recordTraceSample(s);

            if (s.play.phase === 'DEAD' && s.play.deadAt == null) s.play.deadAt = s.play.elapsed;
            if (s.play.phase === 'DEAD' && s.play.elapsed > s.play.deadAt + 1.0) {
                endFrame(activePlayers);
                return betweenPlays(s);
            }
            endFrame(activePlayers);
            return s;
        }
        case 'DEAD': {
            if (s.play.deadAt == null) s.play.deadAt = s.play.elapsed;
            if (s.play.elapsed > s.play.deadAt + 1.0) return betweenPlays(s);
            return s;
        }
        default:
            return s;
    }
}

/* =========================================================
   End-of-play → next play
   ========================================================= */
// REPLACE your betweenPlays with this version
// --- DROP-IN REPLACEMENT ---
export function betweenPlays(prevState) {
    const s = {
        ...prevState,
        playLog: Array.isArray(prevState.playLog) ? [...prevState.playLog] : [],
    };

    ensureDrive(s); // keep a valid drive object around
    const offenseAtSnap = s.possession; // who ran the play
    const call = s.play.playCall || { name: 'Play' };
    let resultWhy = s.play.resultWhy || 'Tackled';
    let extraPointSummary = '';
    let queuedExtraPoint = false;

    if (!s.teams) s.teams = createTeams(s.matchup);
    if (!s.playerDirectory) s.playerDirectory = buildPlayerDirectory(s.teams, s.matchup?.slotToTeam, s.matchup?.identities);
    if (!s.playerStats) s.playerStats = createInitialPlayerStats(s.playerDirectory);

    const startLos = s.play.startLos ?? s.drive.losYards;
    const startDown = s.play.startDown ?? s.drive.down;
    const startToGo = s.play.startToGo ?? s.drive.toGo;

    // Where did the ball end up in yards going-in (0..100)?
    const endSpot = resolveEndSpot(s);  // see helper below
    const endYd = endSpot.yards;
    const netGain = clamp(endYd - startLos, -100, 100);

    // Helpers
    const noAdvance = isNoAdvance(resultWhy); // make sure this handles 'Throw away' too
    const isInterception = /interception/i.test(String(resultWhy));
    const gained = (() => {
        if (noAdvance) return 0;
        if ((s.play?.turnover || false) && isInterception) return 0;
        return netGain;
    })();
    const firstDownAchieved = !noAdvance && (gained >= startToGo);

    // Text says turnover on downs OR 4th down failed to gain enough
    const turnoverOnDownsByString = /turnover\s*:? on downs/i.test(resultWhy) || /downs\b/i.test(resultWhy);
    const turnoverOnDownsCalc = (startDown === 4) && !firstDownAchieved && (resultWhy !== 'Touchdown');

    let los = s.drive.losYards;
    let down = s.drive.down;
    let toGo = s.drive.toGo;
    let turnover = !!s.play.turnover;

    const safetyEligibleResult = (() => {
        const w = String(resultWhy).toLowerCase();
        return w.includes('tackle') || w.includes('sack') || w.includes('progress');
    })();

    if (!turnover && safetyEligibleResult && endSpot.inOwnEndzone) {
        const defense = otherTeam(offenseAtSnap);
        if (!s.scores) s.scores = defaultScores();
        s.scores[defense] = (s.scores[defense] ?? 0) + 2;

        recordPlayEvent(s, {
            type: 'score:safety',
            offense: offenseAtSnap,
            defense,
        });

        s.possession = defense;
        s.teams = s.teams || createTeams(s.matchup);
        s.roster = rosterForPossession(s.teams, s.possession);
        s.pendingExtraPoint = null;

        los = 25;
        down = 1;
        toGo = 10;
        turnover = true;
        resultWhy = 'Safety';
        s.play.resultWhy = 'Safety';

        pushPlayLog(s, {
            name: call.name,
            startDown, startToGo, startLos,
            endLos: los,
            gained: netGain,
            why: 'Safety',
            turnover: true,
            offense: offenseAtSnap,
        });
    }

    // Touchdown: add score, then hand the ball to the other team at the 25
    else if (resultWhy === 'Touchdown') {
        if (!s.scores) s.scores = { [TEAM_RED]: 0, [TEAM_BLK]: 0 };
        const scoringTeam = offenseAtSnap;
        s.scores[scoringTeam] = (s.scores[scoringTeam] ?? 0) + 6;

        const patPlan = scheduleExtraPoint(s, scoringTeam, { startLos, startDown, startToGo });
        if (patPlan) {
            queuedExtraPoint = true;
            los = patPlan.losYards ?? 84;
            down = 1;
            toGo = 10;
        } else {
            s.possession = (scoringTeam === TEAM_RED ? TEAM_BLK : TEAM_RED);
            s.teams = s.teams || createTeams(s.matchup);
            s.roster = rosterForPossession(s.teams, s.possession);
            los = 25; down = 1; toGo = 10;
        }
        pushPlayLog(s, {
            name: call.name,
            startDown, startToGo, startLos,
            endLos: queuedExtraPoint ? startLos : los,
            why: 'Touchdown',
            gained,
            offense: offenseAtSnap
        });
    }

    // Turnover on downs
    // Turnover on downs → new offense starts at the 25
    else if (turnoverOnDownsByString || turnoverOnDownsCalc) {
        s.possession = (s.possession === TEAM_RED ? TEAM_BLK : TEAM_RED);
        s.teams = s.teams || createTeams(s.matchup);
        s.roster = rosterForPossession(s.teams, s.possession);

        los = 25;           // force new drive start at 25
        down = 1;
        toGo = 10;
        turnover = true;

        pushPlayLog(s, {
            name: call.name,
            startDown, startToGo, startLos,
            endLos: los,                        // log shows the new drive start
            gained: netGain,
            why: 'Turnover on downs',
            turnover: true,
            offense: offenseAtSnap
        });
    }

    // Normal play resolution
    else {
        if (turnover) {
            const newOffense = otherTeam(offenseAtSnap);
            const takeoverLos = clamp(100 - clamp(endYd, 0, 100), 0, 100);
            s.possession = newOffense;
            s.teams = s.teams || createTeams(s.matchup);
            s.roster = rosterForPossession(s.teams, s.possession);

            los = clamp(takeoverLos, 1, 99);
            down = 1;
            toGo = Math.min(10, 100 - los);

            pushPlayLog(s, {
                name: call.name,
                startDown, startToGo, startLos,
                endLos: los,
                gained,
                why: resultWhy,
                turnover: true,
                offense: offenseAtSnap
            });
        } else {
            los = clamp(noAdvance ? startLos : endYd, 0, 100);
            if (firstDownAchieved) {
                down = 1;
                toGo = Math.min(10, 100 - los);
                pushPlayLog(s, {
                    name: call.name,
                    startDown, startToGo, startLos,
                    endLos: los,
                    gained,
                    why: resultWhy,
                    offense: offenseAtSnap,
                });
            } else {
                down = startDown + 1;
                if (down > 4) {
                    // Safety net: if we somehow get here, treat as turnover on downs
                    s.possession = (s.possession === TEAM_RED ? TEAM_BLK : TEAM_RED);
                    s.teams = s.teams || createTeams(s.matchup);
                    s.roster = rosterForPossession(s.teams, s.possession);

                    los = 25;      // force new drive start at 25
                    down = 1;
                    toGo = 10;
                    turnover = true;

                    pushPlayLog(s, {
                        name: call.name,
                        startDown, startToGo, startLos,
                        endLos: los,
                        gained: netGain,
                        why: 'Turnover on downs',
                        turnover: true,
                        offense: offenseAtSnap
                    });
                } else {
                    toGo = Math.max(1, startToGo - (noAdvance ? 0 : gained));
                    pushPlayLog(s, {
                        name: call.name,
                        startDown, startToGo, startLos,
                        endLos: los, gained,
                        why: resultWhy,
                        offense: offenseAtSnap
                    });
                }
            }
        }
    }

    // Commit updated drive
    if (queuedExtraPoint && s.pendingExtraPoint) {
        s.drive = {
            losYards: clamp(s.pendingExtraPoint.losYards ?? los ?? 84, 1, 99),
            down: 1,
            toGo: 10,
        };
    } else {
        s.drive = { losYards: clamp(los, 1, 99), down, toGo };
    }

    const stoppage = shouldStopClockForResult(resultWhy, turnover || turnoverOnDownsByString || turnoverOnDownsCalc);
    if (stoppage) {
        stopClock(s, resultWhy);
    }

    const penaltyInfo = maybeAssessPenalty(s, {
        offense: offenseAtSnap,
        startDown,
        startToGo,
        startLos,
        turnover: turnover || turnoverOnDownsByString || turnoverOnDownsCalc,
        scoring: resultWhy === 'Touchdown' || resultWhy === 'Safety',
    });

    const timeoutContext = {
        offense: offenseAtSnap,
        resultWhy,
        turnover: turnover || turnoverOnDownsByString || turnoverOnDownsCalc,
        startDown,
        startToGo,
        startLos,
    };

    if (!stoppage && !penaltyInfo) {
        let preventedRunoff = false;
        if (maybeAutoTimeout(s, timeoutContext)) {
            preventedRunoff = true;
        } else if (maybeTimeoutToAvoidRunoff(s, timeoutContext, 25)) {
            preventedRunoff = true;
        }

        if (!preventedRunoff) {
            applyBetweenPlayRunoff(s, 25);
        }
    }

    const yardText = noAdvance ? 'no gain' : `${gained >= 0 ? '+' : ''}${gained} yds`;
    const baseSummary = `${call.name}: ${resultWhy}${resultWhy === 'Touchdown' ? '' : ` (${yardText})`}`;
    let summaryText = baseSummary;
    if (penaltyInfo?.text) summaryText = penaltyInfo.text;
    else if (s.play.resultText && /timeout/i.test(s.play.resultText)) summaryText = s.play.resultText;
    else if (extraPointSummary && resultWhy === 'Touchdown') summaryText = `${baseSummary} (${extraPointSummary})`;

    finalizePlayStats(s, {
        offense: offenseAtSnap,
        defense: otherTeam(offenseAtSnap),
        gained,
        result: resultWhy,
        callType: call.type,
        carrierId: s.play?.ball?.lastCarrierId || null,
    });

    finalizePlayDiagnostics(s, {
        result: resultWhy,
        gained,
        endLos: los,
        turnover,
    });

    // Ensure the active roster knows which state owns it for debug hooks
    if (s.roster) s.roster.__ownerState = s;

    if (isGameClockExpired(s)) {
        return finalizeCurrentGame(s);
    }

    // Start next play for whoever now has the ball
    s.play = createPlayState(s.roster, s.drive);
    if (queuedExtraPoint) {
        s.play.resultText = `${call.name}: ${resultWhy}`;
    } else {
        s.play.resultText = summaryText;
    }
    beginPlayDiagnostics(s);
    return s;
}




/* =========================================================
   Dead-ball conditions
   ========================================================= */
function checkDeadBall(s) {
    if (!s?.play || !s.play.formation) return;
    if (s.play.phase !== 'LIVE') return;
    if (s.play.ball?.inAir) return; // pass resolution decides incomplete/INT

    const pos = getBallPix(s);
    if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') return;

    if (pos.x < 10 || pos.x > FIELD_PIX_W - 10) {
        s.play.deadAt = s.play.elapsed; s.play.phase = 'DEAD'; s.play.resultWhy = 'Out of bounds';
        recordPlayEvent(s, { type: 'ball:out-of-bounds' });
        return;
    }
    const yards = pixYToYards(pos.y);
    if (yards >= ENDZONE_YARDS + PLAYING_YARDS_H) {
        s.play.deadAt = s.play.elapsed; s.play.phase = 'DEAD'; s.play.resultWhy = 'Touchdown';
        recordPlayEvent(s, { type: 'ball:touchdown' });
        return;
    }
}
// Put this near your other exported helpers in state.js
// ⬇️ Add these near your other exported helpers

/**
 * withForceNextOutcome(state, outcome)
 * Arm a one-shot forced outcome for the NEXT play.
 * Supported outcomes used elsewhere in the sim:
 *   'SCRAMBLE' | 'FUMBLE' | 'INTERCEPTION' | null
 */
export function withForceNextOutcome(state, outcome) {
    const s = { ...state };
    s.debug ||= {};
    s.debug.forceNextOutcome = outcome ?? null;
    s.debug.forceNextArmed = true; // consumed once by play logic then cleared
    return s;
}

/**
 * withForceNextPlay(state, opts)
 * Convenience wrapper that can also set a targetRole.
 * opts = { outcome?: 'SCRAMBLE'|'FUMBLE'|'INTERCEPTION'|null, targetRole?: 'WR1'|'WR2'|'WR3'|'TE'|'RB'|null }
 */
// state.js
/**
 * withForceNextPlay(state, arg)
 * Accepts either a string play name OR an options object:
 *   - string: play name from PLAYBOOK
 *   - { name?, outcome?, targetRole? }
 */
export function withForceNextPlay(state, arg = null) {
    const s = { ...state };
    s.debug ||= {};
    if (arg == null || arg === '') {
        s.debug.forceNextPlayName = null;
        s.debug.forceTargetRole = null;
        s.debug.forceNextOutcome = null;
        s.debug.forceNextArmed = false;
        return s;
    }
    if (typeof arg === 'string') {
        s.debug.forceNextPlayName = arg;
    } else {
        if (arg.name != null) s.debug.forceNextPlayName = arg.name;
        if (arg.targetRole != null) s.debug.forceTargetRole = arg.targetRole;
        if (arg.outcome != null) s.debug.forceNextOutcome = arg.outcome;
    }
    s.debug.forceNextArmed = true; // one-shot
    return s;
}

