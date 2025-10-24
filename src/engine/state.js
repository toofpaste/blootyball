import {
    FIELD_PIX_W, FIELD_PIX_H, ENDZONE_YARDS, PLAYING_YARDS_H,
    TEAM_RED, TEAM_BLK, PLAYBOOK, PX_PER_YARD, ROLES_OFF, ROLES_DEF,
} from './constants';
import { clamp, yardsToPixY, pixYToYards, rand, choice } from './helpers';
import { createTeams, rosterForPossession, lineUpFormation, buildPlayerDirectory } from './rosters';
import { initRoutesAfterSnap, moveOL, moveReceivers, moveTE, qbLogic, rbLogic, defenseLogic } from './ai';
import { moveBall, getBallPix } from './ball';
import { beginFrame, endFrame } from './motion';
import { applyPlayerPhysics } from './physics';
import { beginPlayDiagnostics, finalizePlayDiagnostics, recordPlayEvent } from './diagnostics';
import { pickFormations, PLAYBOOK_PLUS, pickPlayCall } from './playbooks';
import { createInitialPlayerStats, createPlayStatContext, finalizePlayStats, recordKickingAttempt } from './stats';
import {
    createSeasonState,
    prepareSeasonMatchup,
    applyGameResultToSeason,
    advanceSeasonPointer,
    seasonCompleted,
    createLeagueContext,
    ensurePlayoffsScheduled,
    ensureChampionshipScheduled,
    registerChampion,
    recomputeAssignmentTotals,
    computeAssignmentTotals,
    mergePlayerStatsIntoCareer,
    incrementPlayerAges,
    applyOffseasonDevelopment,
    recordTeamSeasonHistory,
    updateRecordBookForSeason,
    updateTeamWikiAfterSeason,
} from './league';
import {
    ensureSeasonProgression,
    applyLongTermAdjustments,
    initializeGameDynamics,
    finalizeGameDynamics,
    prepareCoachesForMatchup,
    coachClockPlan,
} from './progression';
import {
    ensureSeasonPersonnel,
    registerPlayerInjury,
    decrementInjuryTimers,
    beginLeagueOffseason,
    progressLeagueOffseason,
    applyPostGameMoodAdjustments,
    assignReplacementForAbsence,
    ensureTeamRosterComplete,
    maybeGenerateLeagueHeadlines,
    enforceGameDayRosterMinimums,
    replaceScout,
    recordLeagueNews,
} from './personnel';
import { getTeamIdentity } from './data/teamLibrary';
import { applyTeamMoodToMatchup } from './temperament';

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

function teamsWithEmptyRosterSpots(league, teamIds = []) {
    if (!league || !Array.isArray(teamIds) || !teamIds.length) return [];
    const rosters = league.teamRosters || {};
    return teamIds.filter((teamId) => {
        const roster = rosters?.[teamId];
        if (!roster) return true;
        const offense = roster.offense || {};
        const defense = roster.defense || {};
        const special = roster.special || {};
        const offenseHole = ROLES_OFF.some((role) => !offense?.[role]);
        const defenseHole = ROLES_DEF.some((role) => !defense?.[role]);
        const specialHole = !special?.K;
        return offenseHole || defenseHole || specialHole;
    });
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

    if (ctx?.fumbleRecoveredBy) {
        const meta = lookupPlayerMeta(state, ctx.fumbleRecoveredBy);
        const name = lastNameFromMeta(meta);
        if (name) details.fumbleRecoveredBy = name;
    } else if (ctx?.fumbleRecoveredTeam) {
        details.fumbleRecoveredTeam = ctx.fumbleRecoveredTeam;
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

const MAX_TEAM_INJURIES_PER_SEASON = 4;
const INJURY_BASE_CHANCE = 0.004;

const INJURY_DESCRIPTORS = {
    minor: ['ankle sprain', 'tight hamstring', 'bruised ribs', 'hip pointer'],
    moderate: ['shoulder sprain', 'knee sprain', 'high ankle sprain', 'quad strain'],
    major: ['torn meniscus', 'fractured forearm', 'back strain', 'AC joint sprain'],
    severe: ['torn ACL', 'Achilles tear', 'compound fracture', 'spinal contusion'],
};

function randomDescriptor(severity) {
    const list = INJURY_DESCRIPTORS[severity] || INJURY_DESCRIPTORS.minor;
    return choice(list);
}

function gatherInjuryCandidates(state) {
    const ctx = state.play?.statContext || {};
    const map = new Map();
    const add = (playerId, weight, tag) => {
        if (!playerId || weight <= 0) return;
        if (!map.has(playerId)) {
            map.set(playerId, { playerId, weight, tags: new Set([tag]) });
        } else {
            const existing = map.get(playerId);
            existing.weight += weight;
            existing.tags.add(tag);
        }
    };
    const ballCarrier = ctx.rushCarrierId || state.play?.ball?.lastCarrierId || null;
    if (ballCarrier) add(ballCarrier, 1.0, 'carrier');
    if (ctx.pass?.passerId) add(ctx.pass.passerId, 0.35, 'passer');
    if (ctx.pass?.targetId) add(ctx.pass.targetId, ctx.pass.complete ? 0.55 : 0.25, 'receiver');
    (ctx.tackles || []).forEach((id, index) => {
        const weight = index === 0 ? 0.4 : 0.22;
        add(id, weight, 'tackler');
    });
    return Array.from(map.values()).map((entry) => ({
        playerId: entry.playerId,
        weight: entry.weight,
        tags: Array.from(entry.tags),
    }));
}

function severityProfile(playerAge) {
    const roll = Math.random();
    if (roll < 0.55) {
        return { label: 'minor', games: 1, degrade: { agility: -0.02, awareness: -0.015 } };
    }
    if (roll < 0.85) {
        return { label: 'moderate', games: Math.round(rand(2, 4)), degrade: { speed: -0.03, agility: -0.05, awareness: -0.03 } };
    }
    if (roll < 0.97) {
        return { label: 'major', games: Math.round(rand(5, 8)), degrade: { speed: -0.06, agility: -0.07, awareness: -0.05, strength: -0.04 } };
    }
    const extraGames = playerAge && playerAge > 30 ? rand(8, 12) : rand(6, 10);
    return { label: 'severe', games: Math.round(extraGames), degrade: { speed: -0.09, agility: -0.1, awareness: -0.07, strength: -0.05 } };
}

function maybeTriggerInjury(state, {
    offense,
    startDown,
    startToGo,
    startLos,
    gained,
}) {
    const league = state.league;
    if (!league || !state.playerDirectory) return null;
    const seasonNumber = state.season?.seasonNumber || league.seasonNumber || 1;
    ensureSeasonPersonnel(league, seasonNumber);
    league.injuryCounts ||= {};
    league.injuryCounts[seasonNumber] ||= {};
    const candidates = gatherInjuryCandidates(state);
    if (!candidates.length) return null;
    const chance = INJURY_BASE_CHANCE;
    if (Math.random() > chance) return null;
    const ordered = candidates.sort((a, b) => b.weight - a.weight);
    let chosen = null;
    for (const entry of ordered) {
        const meta = state.playerDirectory[entry.playerId];
        if (!meta) continue;
        const teamId = meta.team;
        if (!teamId) continue;
        const counts = league.injuryCounts[seasonNumber][teamId] || 0;
        if (counts >= MAX_TEAM_INJURIES_PER_SEASON) continue;
        if (league.injuredReserve && league.injuredReserve[entry.playerId]) continue;
        const side = meta.side === 'defense' ? 'defense' : meta.side === 'special' ? 'special' : 'offense';
        const roster = league.teamRosters?.[teamId];
        if (!roster) continue;
        const role = meta.role;
        const playerData = side === 'offense'
            ? roster.offense?.[role]
            : side === 'defense'
                ? roster.defense?.[role]
                : roster.special?.K;
        if (!playerData || playerData.id !== entry.playerId) continue;
        chosen = { entry, meta, teamId, role, side, playerData };
        break;
    }
    if (!chosen) return null;

    const { meta, teamId, role, playerData } = chosen;
    const profile = severityProfile(playerData.age ?? league.playerAges?.[playerData.id]);
    const descriptor = randomDescriptor(profile.label);
    const irEntry = registerPlayerInjury(league, {
        player: playerData,
        teamId,
        role,
        severity: profile.label,
        gamesMissed: Math.max(1, profile.games),
        description: descriptor,
        seasonNumber,
        degrade: profile.degrade,
    });
    const replacement = assignReplacementForAbsence(league, irEntry, { reason: 'injury replacement' });
    state.teams = createTeams(state.matchup, league);
    state.roster = rosterForPossession(state.teams, state.possession);
    state.playerDirectory = buildPlayerDirectory(state.teams, state.matchup?.slotToTeam, state.matchup?.identities);
    const replacementText = replacement
        ? `${replacement.firstName} ${replacement.lastName}`
        : 'a reserve player';
    const gamesText = irEntry?.gamesRemaining
        ? `out ${irEntry.gamesRemaining} ${irEntry.gamesRemaining === 1 ? 'game' : 'games'}`
        : 'day-to-day';
    const message = `${meta.fullName || meta.name || meta.role} ${descriptor} (${gamesText}); ${replacementText} steps in`;

    const logEntry = {
        name: 'Injury Update',
        startDown,
        startToGo,
        startLos,
        endLos: startLos,
        gained: 0,
        result: message,
        offense,
    };

    return { message, logEntry };
}

function defaultScores() {
    return { [TEAM_RED]: 0, [TEAM_BLK]: 0 };
}

const TEAM_STAT_KEYS = ['passingYards', 'passingTD', 'rushingYards', 'rushingTD', 'receivingYards', 'receivingTD', 'tackles', 'sacks', 'interceptions'];
const PLAYOFF_STAGE_ORDER = { regular: 0, semifinals: 1, championship: 2, complete: 3 };

function isPlayoffTag(tag) {
    const text = String(tag || '');
    return text.startsWith('playoff');
}

function stageRank(stage) {
    return PLAYOFF_STAGE_ORDER[stage] ?? -1;
}

function collectGlobalSeasons(state) {
    if (typeof window === 'undefined') return [state.season];
    const games = window.__blootyball?.games || [];
    const targetSeasonNumber = state?.season?.seasonNumber;
    const seasons = games
        .map((entry) => entry?.state?.season)
        .filter((season) => season && season.schedule)
        .filter((season) => {
            if (!Number.isFinite(targetSeasonNumber)) return true;
            const seasonNumber = season?.seasonNumber;
            if (!Number.isFinite(seasonNumber)) return false;
            return seasonNumber === targetSeasonNumber;
        });
    if (!seasons.includes(state.season)) seasons.push(state.season);
    return seasons;
}

function aggregateSeasonsData(seasons) {
    const infoLookup = {};
    seasons.forEach((season) => {
        Object.entries(season?.teams || {}).forEach(([teamId, team]) => {
            if (!infoLookup[teamId]) infoLookup[teamId] = team?.info || null;
        });
        Object.entries(season?.assignmentTotals || {}).forEach(([teamId, team]) => {
            if (!infoLookup[teamId]) infoLookup[teamId] = team?.info || null;
        });
    });

    const clonePlayerStats = (stats = {}) => {
        const map = {};
        Object.entries(stats).forEach(([playerId, entry]) => {
            map[playerId] = JSON.parse(JSON.stringify(entry));
        });
        return map;
    };

    const resultsMap = new Map();
    seasons.forEach((season) => {
        (season.results || []).forEach((result) => {
            if (!result) return;
            const key = result.gameId || `idx-${result.index}`;
            if (!key) return;
            const existing = resultsMap.get(key);
            if (!existing || (result.index ?? Infinity) < (existing.index ?? Infinity)) {
                resultsMap.set(key, {
                    ...result,
                    score: { ...(result.score || {}) },
                    playLog: Array.isArray(result.playLog) ? [...result.playLog] : [],
                    playerStats: clonePlayerStats(result.playerStats || {}),
                    playerTeams: { ...(result.playerTeams || {}) },
                });
            }
        });
    });

    const results = Array.from(resultsMap.values()).sort((a, b) => {
        const ai = a.index ?? 0;
        const bi = b.index ?? 0;
        return ai - bi;
    });

    const teams = {};
    const aggregatedPlayers = {};

    const ensureTeam = (teamId) => {
        if (!teamId) return null;
        if (!teams[teamId]) {
            const info = infoLookup[teamId] || null;
            teams[teamId] = {
                id: teamId,
                info,
                record: { wins: 0, losses: 0, ties: 0 },
                postseasonRecord: { wins: 0, losses: 0, ties: 0 },
                pointsFor: 0,
                pointsAgainst: 0,
                stats: TEAM_STAT_KEYS.reduce((acc, key) => ({ ...acc, [key]: 0 }), {}),
            };
        } else if (!teams[teamId].postseasonRecord) {
            teams[teamId].postseasonRecord = { wins: 0, losses: 0, ties: 0 };
        }
        return teams[teamId];
    };

    const applyStatsToTeam = (teamEntry, stat) => {
        if (!teamEntry || !stat) return;
        const passing = stat.passing || {};
        const rushing = stat.rushing || {};
        const receiving = stat.receiving || {};
        const defense = stat.defense || {};
        teamEntry.stats.passingYards += passing.yards || 0;
        teamEntry.stats.passingTD += passing.touchdowns || 0;
        teamEntry.stats.rushingYards += rushing.yards || 0;
        teamEntry.stats.rushingTD += rushing.touchdowns || 0;
        teamEntry.stats.receivingYards += receiving.yards || 0;
        teamEntry.stats.receivingTD += receiving.touchdowns || 0;
        teamEntry.stats.tackles += defense.tackles || 0;
        teamEntry.stats.sacks += defense.sacks || 0;
        teamEntry.stats.interceptions += defense.interceptions || 0;
    };

    const mergePlayerStat = (playerId, stat) => {
        if (!playerId) return;
        if (!aggregatedPlayers[playerId]) {
            aggregatedPlayers[playerId] = JSON.parse(JSON.stringify(stat || {}));
            return;
        }
        const target = aggregatedPlayers[playerId];
        ['passing', 'rushing', 'receiving', 'defense', 'misc', 'kicking'].forEach((category) => {
            const src = stat?.[category] || {};
            const dst = target[category] || (target[category] = {});
            Object.entries(src).forEach(([key, value]) => {
                const current = Number.isFinite(dst[key]) ? dst[key] : 0;
                const incoming = Number.isFinite(value) ? value : 0;
                if (key === 'long') {
                    dst[key] = Math.max(current || 0, incoming || 0);
                } else {
                    dst[key] = current + incoming;
                }
            });
        });
    };

    results.forEach((result) => {
        const homeId = result.homeTeamId;
        const awayId = result.awayTeamId;
        const score = result.score || {};
        const homeScore = score[homeId] ?? 0;
        const awayScore = score[awayId] ?? 0;

        const homeTeam = ensureTeam(homeId);
        const awayTeam = ensureTeam(awayId);
        const isPostseason = (result.tag || '').startsWith('playoff-');
        const recordKey = isPostseason ? 'postseasonRecord' : 'record';

        if (homeTeam) {
            homeTeam.pointsFor += homeScore;
            homeTeam.pointsAgainst += awayScore;
        }
        if (awayTeam) {
            awayTeam.pointsFor += awayScore;
            awayTeam.pointsAgainst += homeScore;
        }

        if (homeScore > awayScore) {
            if (homeTeam) homeTeam[recordKey].wins += 1;
            if (awayTeam) awayTeam[recordKey].losses += 1;
        } else if (awayScore > homeScore) {
            if (awayTeam) awayTeam[recordKey].wins += 1;
            if (homeTeam) homeTeam[recordKey].losses += 1;
        } else {
            if (homeTeam) homeTeam[recordKey].ties += 1;
            if (awayTeam) awayTeam[recordKey].ties += 1;
        }

        const playerTeams = result.playerTeams || {};
        Object.entries(result.playerStats || {}).forEach(([playerId, stat]) => {
            const teamId = playerTeams[playerId];
            if (teamId) {
                const teamEntry = ensureTeam(teamId);
                applyStatsToTeam(teamEntry, stat);
            }
            mergePlayerStat(playerId, stat);
        });
    });

    Object.entries(infoLookup).forEach(([teamId, info]) => {
        if (!teams[teamId]) {
            teams[teamId] = {
                id: teamId,
                info: info || null,
                record: { wins: 0, losses: 0, ties: 0 },
                postseasonRecord: { wins: 0, losses: 0, ties: 0 },
                pointsFor: 0,
                pointsAgainst: 0,
                stats: TEAM_STAT_KEYS.reduce((acc, key) => ({ ...acc, [key]: 0 }), {}),
            };
        } else if (!teams[teamId].postseasonRecord) {
            teams[teamId].postseasonRecord = { wins: 0, losses: 0, ties: 0 };
        } else if (!teams[teamId].info && info) {
            teams[teamId].info = info;
        }
    });

    return { teams, results, playerStats: aggregatedPlayers };
}

function synchronizeSeasonTotals(state) {
    const seasons = collectGlobalSeasons(state);
    if (!seasons.length) return;
    const aggregated = aggregateSeasonsData(seasons);
    const updatedTeams = {};
    Object.entries(aggregated.teams).forEach(([teamId, data]) => {
        const baseInfo = data.info || state.season.teams?.[teamId]?.info || null;
        updatedTeams[teamId] = {
            id: teamId,
            info: baseInfo,
            record: { ...data.record },
            postseasonRecord: { ...(data.postseasonRecord || { wins: 0, losses: 0, ties: 0 }) },
            pointsFor: data.pointsFor || 0,
            pointsAgainst: data.pointsAgainst || 0,
            stats: { ...data.stats },
        };
    });
    state.season.teams = updatedTeams;
    state.season.assignmentTotals = Object.entries(updatedTeams).reduce((acc, [teamId, data]) => {
        acc[teamId] = {
            id: data.id,
            info: data.info,
            record: { ...data.record },
            postseasonRecord: { ...(data.postseasonRecord || { wins: 0, losses: 0, ties: 0 }) },
            pointsFor: data.pointsFor,
            pointsAgainst: data.pointsAgainst,
            stats: { ...data.stats },
        };
        return acc;
    }, {});

    const filteredResults = aggregated.results.filter((result) => {
        const idx = Number.isFinite(result?.index) ? result.index : null;
        if (idx == null) return true;
        const entry = state.season.schedule?.[idx];
        if (!entry) return true;
        const entryIsPlayoff = isPlayoffTag(entry.tag);
        const resultIsPlayoff = isPlayoffTag(result?.tag);
        if (entryIsPlayoff !== resultIsPlayoff) return false;
        return true;
    });

    state.season.results = filteredResults;
    filteredResults.forEach((result) => {
        const idx = result.index;
        if (idx != null && state.season.schedule[idx]) {
            const existing = state.season.schedule[idx];
            const entryIsPlayoff = isPlayoffTag(existing.tag);
            const resultIsPlayoff = isPlayoffTag(result?.tag);
            if (entryIsPlayoff === resultIsPlayoff) {
                state.season.schedule[idx] = { ...existing, played: true, result };
            }
        }
    });
    state.season.completedGames = filteredResults.length;
    state.season.playerStats = aggregated.playerStats || {};
    recomputeAssignmentTotals(state.season);

    const scheduleEntries = state.season.schedule || [];
    const scheduleHasPlayoffEntries = scheduleEntries.some((entry) => entry && isPlayoffTag(entry.tag));
    const scheduleHasUnplayedRegular = scheduleEntries.some((entry) => entry && !isPlayoffTag(entry.tag) && !entry.played);
    const hasPlayoffResults = filteredResults.some((result) => isPlayoffTag(result?.tag));

    let chosenBracket = state.season.playoffBracket || null;
    let chosenPhase = state.season.phase || 'regular';
    let championTeamId = state.season.championTeamId || null;
    let championResult = state.season.championResult || null;

    seasons.forEach((season) => {
        if (season.phase && stageRank(season.phase) > stageRank(chosenPhase)) {
            chosenPhase = season.phase;
        }
        const bracket = season.playoffBracket;
        if (bracket && (!chosenBracket || stageRank(bracket.stage) >= stageRank(chosenBracket.stage))) {
            chosenBracket = JSON.parse(JSON.stringify(bracket));
        }
        if (season.championTeamId) championTeamId = season.championTeamId;
        if (season.championResult) championResult = { ...season.championResult };
    });

    if (chosenBracket) state.season.playoffBracket = chosenBracket;
    state.season.phase = chosenPhase;
    if (championTeamId) state.season.championTeamId = championTeamId;
    if (championResult) state.season.championResult = championResult;

    const bracketStage = state.season.playoffBracket?.stage || null;
    const bracketImpliesPlayoffs = bracketStage && stageRank(bracketStage) >= stageRank('semifinals');
    if (!scheduleHasPlayoffEntries && !hasPlayoffResults && scheduleHasUnplayedRegular) {
        if (bracketImpliesPlayoffs) {
            state.season.playoffBracket = null;
        }
        state.season.phase = 'regular';
        state.season.championTeamId = null;
        state.season.championResult = null;
    }
}

function scheduleNextMatchupFromSeason(state) {
    if (!state?.season) return null;

    let nextMatchup = null;

    synchronizeSeasonTotals(state);

    const bracketStage = state.season.playoffBracket?.stage || state.season.phase || 'regular';
    if (stageRank(bracketStage) <= stageRank('semifinals')) {
        const semifinalTargetsSet = new Set();
        const added = ensurePlayoffsScheduled(state.season, state.league) || [];
        added
            .filter((index) => Number.isFinite(index) && index >= 0)
            .forEach((index) => semifinalTargetsSet.add(index));

        const semifinalGames = state.season.playoffBracket?.semifinalGames || [];
        semifinalGames.forEach((game) => {
            const idx = Number.isFinite(game?.index) ? game.index : null;
            if (idx == null || idx < 0) return;
            const entry = state.season.schedule?.[idx] || null;
            if (entry?.played) return;
            semifinalTargetsSet.add(idx);
        });

        const semifinalTargets = Array.from(semifinalTargetsSet).sort((a, b) => a - b);
        const assigned = pickAssignedIndex(state.season, semifinalTargets);
        if (assigned != null) {
            state.season.currentGameIndex = assigned;
            nextMatchup = prepareSeasonMatchup(state.season);
        } else if (semifinalTargets.length) {
            const fallbackIndex = semifinalTargets.reduce(
                (min, index) => (min == null || index < min ? index : min),
                null,
            );
            if (fallbackIndex != null) {
                state.season.currentGameIndex = fallbackIndex;
                nextMatchup = prepareSeasonMatchup(state.season);
            }
        }
    }

    if (nextMatchup) return nextMatchup;

    const finals = ensureChampionshipScheduled(state.season) || [];
    const assignedFinal = pickAssignedIndex(state.season, finals);
    if (assignedFinal != null) {
        state.season.currentGameIndex = assignedFinal;
        return prepareSeasonMatchup(state.season);
    }

    if (finals.length) {
        const fallbackIndex = finals.find((index) => Number.isFinite(index) && index >= 0);
        if (fallbackIndex != null) {
            state.season.currentGameIndex = fallbackIndex;
            return prepareSeasonMatchup(state.season);
        }
        state.season.currentGameIndex = state.season.schedule.length;
    }

    return null;
}

function pickAssignedIndex(season, indices = []) {
    const stride = Math.max(1, season.assignmentStride || season.assignment?.stride || 1);
    const offset = season.assignmentOffset ?? season.assignment?.offset ?? 0;
    const normalized = indices.find((index) => {
        if (!Number.isFinite(index)) return false;
        if (index < 0) return false;
        const diff = index - offset;
        if (diff < 0) return false;
        return diff % stride === 0;
    });
    return normalized != null ? normalized : null;
}

function finalizeLeagueForSeason(state, result) {
    const { league, season } = state;
    if (!league || !season) return;
    if (league.finalizedSeasonNumber === season.seasonNumber) return;
    registerChampion(season, league, result);
    recordTeamSeasonHistory(league, season);
    updateRecordBookForSeason(league, season);
    updateTeamWikiAfterSeason(league, season);
    mergePlayerStatsIntoCareer(league.careerStats, season.playerStats || {});
    league.finalizedSeasonNumber = season.seasonNumber;
    incrementPlayerAges(league);
    applyOffseasonDevelopment(league);
    beginLeagueOffseason(league, season, {
        championTeamId: season.championTeamId || result?.winner,
        championResult: season.championResult || result || null,
    });
}

function buildSeasonFinalSummary(state, latestResult, currentTag, game) {
    const season = state?.season || null;
    const bracket = season?.playoffBracket || null;
    const championship = bracket?.championshipGame || null;
    const fallbackScore = latestResult?.score || championship?.score || {};
    const fallbackHome = latestResult?.homeTeamId
        ?? championship?.homeTeam
        ?? game?.homeTeam
        ?? null;
    const fallbackAway = latestResult?.awayTeamId
        ?? championship?.awayTeam
        ?? game?.awayTeam
        ?? null;

    if (currentTag === 'playoff-championship' && latestResult) {
        return latestResult;
    }

    if (championship) {
        return {
            gameId: championship.id ?? latestResult?.gameId ?? null,
            index: championship.index ?? latestResult?.index ?? null,
            homeTeamId: fallbackHome,
            awayTeamId: fallbackAway,
            score: championship.score || fallbackScore || {},
            winner: championship.winner ?? bracket?.champion ?? latestResult?.winner ?? null,
            tag: 'playoff-championship',
        };
    }

    const resolvedWinner = bracket?.champion ?? latestResult?.winner ?? null;
    return {
        gameId: latestResult?.gameId ?? null,
        index: latestResult?.index ?? null,
        homeTeamId: fallbackHome,
        awayTeamId: fallbackAway,
        score: fallbackScore || {},
        winner: resolvedWinner,
        tag: resolvedWinner ? 'playoff-championship' : (latestResult?.tag ?? currentTag ?? null),
    };
}

function prepareGameForMatchup(state, matchup) {
    if (!matchup) {
        state.matchup = null;
        state.teams = null;
        state.roster = null;
        state.drive = { losYards: 25, down: 1, toGo: 10 };
        state.scores = defaultScores();
        state.coaches = null;
        state.clock = createClock();
        state.play = { phase: 'COMPLETE', resultText: 'Season complete' };
        state.playerDirectory = {};
        state.playerStats = {};
        state.playLog = [];
        state.gameDynamics = null;
        state.__finalSecondsMeta = null;
        state.pendingMatchup = null;
        state.awaitingNextMatchup = false;
        state.gameComplete = true;
        state.overtime = null;
        return state;
    }

    synchronizeSeasonTotals(state);

    const matchupIndex = Number.isFinite(matchup?.index) ? matchup.index : null;
    if (state.season && matchupIndex != null && state.season.schedule?.[matchupIndex]) {
        const existing = state.season.schedule[matchupIndex];
        state.season.schedule[matchupIndex] = { ...existing, inProgress: true };
    }

    state.matchup = matchup;
    state.possession = TEAM_RED;
    state.overtime = null;
    if (state.league && state.season) {
        state.league.seasonSnapshot = state.season;
        ensureSeasonPersonnel(state.league, state.season.seasonNumber || state.league.seasonNumber || 1);
    }
    if (state.league && matchup?.slotToTeam) {
        const uniqueTeams = uniqueNonEmpty(Object.values(matchup.slotToTeam));
        uniqueTeams.forEach((teamId) => {
            ensureTeamRosterComplete(state.league, teamId, { reason: 'pre-game roster fill' });
        });
        const punishmentTargets = teamsWithEmptyRosterSpots(state.league, uniqueTeams);
        if (punishmentTargets.length) {
            const seasonNumber = state.season?.seasonNumber ?? state.league?.seasonNumber ?? 1;
            const rosterFailures = punishmentTargets.map((teamId) => {
                const roster = state.league?.teamRosters?.[teamId] || {};
                const missingRoles = [];
                ROLES_OFF.forEach((role) => {
                    if (!roster?.offense?.[role]) missingRoles.push(role);
                });
                ROLES_DEF.forEach((role) => {
                    if (!roster?.defense?.[role]) missingRoles.push(role);
                });
                if (!roster?.special?.K) missingRoles.push('K');
                return { teamId, missingRoles };
            });
            rosterFailures.forEach(({ teamId, missingRoles }) => {
                if (!missingRoles.length) return;
                const scout = state.league?.teamScouts?.[teamId] || null;
                if (scout) {
                    scout.rosterFailureCount = (scout.rosterFailureCount || 0) + 1;
                    scout.lastRosterFailure = {
                        seasonNumber,
                        missingRoles: missingRoles.slice(),
                        timestamp: Date.now(),
                        reason: 'game-day roster failure',
                    };
                }
                const identity = getTeamIdentity(teamId) || { abbr: teamId, displayName: teamId };
                recordLeagueNews(state.league, {
                    type: 'roster',
                    teamId,
                    text: `${identity.abbr || teamId} discipline scouting staff after missing roles: ${missingRoles.join(', ')}`,
                    detail: 'GM warns scouting department to keep the roster full on game day.',
                    seasonNumber,
                });
                replaceScout(state.league, teamId, scout, seasonNumber, {
                    reason: 'Scout fired for game-day roster failure',
                    context: {
                        rosterFailure: true,
                        missingRoles,
                    },
                });
                const newScout = state.league?.teamScouts?.[teamId] || null;
                if (newScout) {
                    newScout.rosterIntegrityFocus = Math.max(newScout.rosterIntegrityFocus ?? 0.65, 0.9);
                    newScout.lastRosterFailure = {
                        seasonNumber,
                        missingRoles: missingRoles.slice(),
                        timestamp: Date.now(),
                        reason: 'predecessor dismissed for roster failure',
                    };
                }
            });
            enforceGameDayRosterMinimums(state.league, punishmentTargets, { reason: 'pre-kickoff roster penalty' });
        }
    }
    ensureSeasonProgression(state.season);
    state.coaches = prepareCoachesForMatchup(matchup, state.league);
    state.teams = createTeams(matchup, state.league);
    applyLongTermAdjustments(state.teams, state.coaches, state.season?.playerDevelopment || {});
    applyTeamMoodToMatchup(state.teams, matchup, state.league);
    state.drive = { losYards: 25, down: 1, toGo: 10 };
    state.clock = createClock(state.coaches);
    state.scores = defaultScores();
    state.__finalSecondsMeta = null;
    state.pendingExtraPoint = null;
    state.playLog = [];
    state.playerDirectory = buildPlayerDirectory(state.teams, matchup.slotToTeam, matchup.identities);
    state.playerStats = createInitialPlayerStats(state.playerDirectory);
    state.roster = rosterForPossession(state.teams, state.possession);
    initializeGameDynamics(state, matchup);
    state.roster.__ownerState = state;
    state.play = createPlayState(state.roster, state.drive);
    beginPlayDiagnostics(state);
    state.gameComplete = false;
    state.pendingMatchup = null;
    state.awaitingNextMatchup = false;
    return state;
}

function isGameClockExpired(state) {
    if (!state?.clock) return false;
    if (state.pendingExtraPoint) return false;
    if (state.overtime?.active) return false;
    if (state.clock.quarter < 4) return false;
    return state.clock.time <= 0;
}

function cloneScoreMap(scores = {}) {
    return {
        [TEAM_RED]: scores?.[TEAM_RED] ?? 0,
        [TEAM_BLK]: scores?.[TEAM_BLK] ?? 0,
    };
}

function concludeOvertime(state, winnerSlot = null) {
    if (!state) return;
    state.overtime ||= {};
    state.overtime.winnerSlot = winnerSlot || state.overtime.winnerSlot || null;
    state.overtime.concluded = true;
    if (state.clock) {
        state.clock.running = false;
        state.clock.time = 0;
        state.clock.awaitSnap = true;
        state.clock.stopReason = 'Overtime decided';
    }
    state.pendingExtraPoint = null;
}

function beginOvertime(state) {
    if (!state) return state;
    if (state.overtime?.active) return state;
    if (!state.scores) state.scores = defaultScores();
    state.teams = state.teams || createTeams(state.matchup, state.league);
    const first = Math.random() < 0.5 ? TEAM_RED : TEAM_BLK;
    const second = otherTeam(first);
    const baseScores = cloneScoreMap(state.scores);
    state.overtime = {
        active: true,
        order: [first, second],
        round: 1,
        awaitingResponse: false,
        roundStartScores: baseScores,
        afterStarterScores: baseScores,
        starterPoints: 0,
        concluded: false,
        finalized: false,
        winnerSlot: null,
        lastDrive: null,
    };
    state.clock ||= createClock(state.coaches);
    state.clock.quarter = Math.max(5, (state.clock.quarter || 5));
    state.clock.time = QUARTER_SECONDS;
    state.clock.running = false;
    state.clock.awaitSnap = true;
    state.clock.stopReason = 'Overtime';
    state.clock.timeouts = { [TEAM_RED]: 2, [TEAM_BLK]: 2 };

    state.pendingExtraPoint = null;
    state.possession = first;
    state.drive = { losYards: 25, down: 1, toGo: 10 };
    state.roster = rosterForPossession(state.teams, state.possession);
    state.roster.__ownerState = state;
    state.play = createPlayState(state.roster, state.drive);
    const receiveLabel = resolveTeamLabel(state, first);
    state.play.resultText = `Overtime – ${receiveLabel} receive`; 
    beginPlayDiagnostics(state);

    pushPlayLog(state, {
        name: 'Overtime',
        startDown: 1,
        startToGo: 10,
        startLos: 25,
        endLos: 25,
        gained: 0,
        why: `${receiveLabel} receive to start OT`,
        offense: first,
    });

    return state;
}

function handleOvertimeDriveEnd(state, { driveTeam = null, pendingExtraPoint = false } = {}) {
    const ot = state?.overtime;
    if (!ot?.active || ot.concluded) return false;
    if (pendingExtraPoint) return false;

    const starter = ot.order?.[0];
    const responder = ot.order?.[1];
    if (!starter || !responder) return false;

    const currentScores = cloneScoreMap(state.scores || {});
    if (!ot.roundStartScores) ot.roundStartScores = cloneScoreMap(currentScores);
    if (!ot.afterStarterScores) ot.afterStarterScores = cloneScoreMap(ot.roundStartScores);

    const starterTotal = (currentScores[starter] ?? 0) - (ot.roundStartScores?.[starter] ?? 0);
    const responderTotal = (currentScores[responder] ?? 0) - (ot.roundStartScores?.[responder] ?? 0);

    if (!ot.awaitingResponse) {
        ot.starterPoints = starterTotal;
        ot.afterStarterScores = cloneScoreMap(currentScores);
        ot.awaitingResponse = true;
        ot.lastDrive = { team: driveTeam || starter, role: 'starter', points: starterTotal };
        if (responderTotal > starterTotal) {
            concludeOvertime(state, responder);
            return true;
        }
        return false;
    }

    const starterGainDuringResponse = (currentScores[starter] ?? 0) - (ot.afterStarterScores?.[starter] ?? 0);
    ot.lastDrive = { team: driveTeam || responder, role: 'responder', points: responderTotal };

    if (starterGainDuringResponse > 0) {
        concludeOvertime(state, starter);
        return true;
    }

    if (responderTotal > ot.starterPoints) {
        concludeOvertime(state, responder);
        return true;
    }

    if (responderTotal < ot.starterPoints) {
        concludeOvertime(state, starter);
        return true;
    }

    ot.round += 1;
    ot.roundStartScores = cloneScoreMap(currentScores);
    ot.afterStarterScores = cloneScoreMap(currentScores);
    ot.starterPoints = 0;
    ot.awaitingResponse = false;
    return false;
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
    finalizeGameDynamics(state);
    const updatedSeason = applyGameResultToSeason(
        currentSeason,
        game,
        state.scores,
        state.playerDirectory,
        state.playerStats,
        state.playLog,
    );

    state = { ...state, season: updatedSeason };
    if (state.league && game) {
        applyPostGameMoodAdjustments(state.league, game, state.scores, state.playerStats, state.matchup?.slotToTeam || {});
    }
    if (state.league && game) {
        decrementInjuryTimers(state.league, game.homeTeam);
        decrementInjuryTimers(state.league, game.awayTeam);
        state.league.seasonSnapshot = updatedSeason;
        maybeGenerateLeagueHeadlines(state.league, updatedSeason, { game });
    }
    const latestResult = state.season.schedule?.[currentIndex]?.result || null;
    const currentTag = game?.tag || state.matchup?.tag || null;

    let nextMatchup = advanceSeasonPointer(state.season);

    if (!nextMatchup) {
        nextMatchup = scheduleNextMatchupFromSeason(state);

        if (!nextMatchup && seasonCompleted(state.season)) {
            if (state.league) {
                const summary = buildSeasonFinalSummary(state, latestResult, currentTag, game);
                finalizeLeagueForSeason(state, summary);
            }
            state.matchup = null;
            state.gameComplete = true;
            state.clock.running = false;
            state.clock.time = 0;
            state.clock.stopReason = 'Season complete';
            state.play = { phase: 'COMPLETE', resultText: 'Season complete' };
            return { ...state, season: { ...state.season } };
        }
    }

    if (state.lockstepAssignments) {
        state.pendingMatchup = nextMatchup || null;
        state.awaitingNextMatchup = !!nextMatchup;
        state.gameComplete = true;
        if (state.clock) {
            state.clock.running = false;
            if (!state.clock.stopReason) state.clock.stopReason = nextMatchup ? 'Awaiting next game' : state.clock.stopReason;
        }
        return { ...state, season: { ...state.season } };
    }

    if (nextMatchup) {
        prepareGameForMatchup(state, nextMatchup);
    }

    return { ...state, season: { ...state.season } };
}

function getTeamKicker(state, team) {
    if (!team) return null;
    if (!state.teams) state.teams = createTeams(state.matchup, state.league);
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
    const guardSpacing = yard * 1.25;
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
            { role: 'LW', pos: { x: holderX - guardSpacing * 3.6, y: wingY }, renderPos: { x: holderX - guardSpacing * 3.6, y: wingY } },
            { role: 'LT', pos: { x: holderX - guardSpacing * 2.35, y: lineBaseY }, renderPos: { x: holderX - guardSpacing * 2.35, y: lineBaseY } },
            { role: 'LG', pos: { x: holderX - guardSpacing * 1.15, y: lineBaseY + yard * 0.08 }, renderPos: { x: holderX - guardSpacing * 1.15, y: lineBaseY + yard * 0.08 } },
            { role: 'C', pos: { x: holderX - guardSpacing * 0.1, y: lineBaseY + yard * 0.12 }, renderPos: { x: holderX - guardSpacing * 0.1, y: lineBaseY + yard * 0.12 } },
            { role: 'RG', pos: { x: holderX + guardSpacing * 0.95, y: lineBaseY + yard * 0.08 }, renderPos: { x: holderX + guardSpacing * 0.95, y: lineBaseY + yard * 0.08 } },
            { role: 'RT', pos: { x: holderX + guardSpacing * 2.25, y: lineBaseY }, renderPos: { x: holderX + guardSpacing * 2.25, y: lineBaseY } },
            { role: 'RW', pos: { x: holderX + guardSpacing * 3.55, y: wingY }, renderPos: { x: holderX + guardSpacing * 3.55, y: wingY } },
        ],
        protectors: [
            { role: 'PP', pos: { x: holderX - guardSpacing * 1.45, y: protectorDepth }, renderPos: { x: holderX - guardSpacing * 1.45, y: protectorDepth } },
            { role: 'PP', pos: { x: holderX + guardSpacing * 1.45, y: protectorDepth }, renderPos: { x: holderX + guardSpacing * 1.45, y: protectorDepth } },
        ],
        rushers: [
            makeRusher({
                role: 'LE',
                pos: { x: holderX - guardSpacing * 3.8, y: rushStartY },
                target: { x: holderX - guardSpacing * 0.9, y: rushTargetY },
                delay: 0,
                hold: 0.68,
                engage: 0.42,
                speed: 0.72,
            }),
            makeRusher({
                role: 'NG',
                pos: { x: holderX - guardSpacing * 0.35, y: rushStartY + yard * 0.05 },
                target: { x: holderX - guardSpacing * 0.05, y: rushTargetY + yard * 0.05 },
                delay: 0.08,
                hold: 0.74,
                engage: 0.48,
                speed: 0.66,
            }),
            makeRusher({
                role: 'RE',
                pos: { x: holderX + guardSpacing * 3.75, y: rushStartY },
                target: { x: holderX + guardSpacing * 0.85, y: rushTargetY },
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
    if (!outcome || !ctx) return state;
    const { team, success, summary, isPat } = outcome;
    stopClock(state, summary);
    const defense = otherTeam(team);
    if (!state.teams) state.teams = createTeams(state.matchup, state.league);
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

    if (state.overtime?.active) {
        const concluded = handleOvertimeDriveEnd(state, { driveTeam: team });
        if (concluded) {
            state.play = { phase: 'COMPLETE', resultText: summary };
            return state;
        }
    }

    state.roster.__ownerState = state;
    state.play = createPlayState(state.roster, state.drive);
    state.play.resultText = summary;
    beginPlayDiagnostics(state);
    return state;
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

function resolveTeamLabel(s, slot) {
    if (!slot) return slot;
    const matchup = s?.matchup || s?.lastCompletedGame?.matchup || null;
    const identities = matchup?.identities || {};
    const identity = identities?.[slot] || null;
    if (identity) {
        const abbr = identity.abbr || identity.shortName;
        if (abbr && abbr.trim()) return abbr;
        if (identity.displayName) return identity.displayName;
        if (identity.name) return identity.name;
    }
    const slotToTeam = matchup?.slotToTeam || {};
    const teamId = slotToTeam?.[slot];
    if (teamId) {
        const seasonInfo = s?.season?.teams?.[teamId]?.info || null;
        if (seasonInfo) {
            const abbr = seasonInfo.abbr || seasonInfo.shortName;
            if (abbr && abbr.trim()) return abbr;
            if (seasonInfo.displayName) return seasonInfo.displayName;
            if (seasonInfo.name) return seasonInfo.name;
        }
        return teamId;
    }
    return slot;
}

function createClock(coaches = null) {
    const plan = coachClockPlan(coaches || {});
    const settings = {
        [TEAM_RED]: { ...DEFAULT_CLOCK_MANAGEMENT, ...(plan[TEAM_RED] || {}) },
        [TEAM_BLK]: { ...DEFAULT_CLOCK_MANAGEMENT, ...(plan[TEAM_BLK] || {}) },
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
    const flaggedLabel = resolveTeamLabel(s, flaggedTeam);
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
    s.teams = s.teams || createTeams(s.matchup, s.league);
    s.roster = rosterForPossession(s.teams, s.possession);
    s.roster.__ownerState = s;

    const text = `${flaggedLabel} penalty: ${chosen.name} (${chosen.yards} yards)`;
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
    const {
        startGameIndex = 0,
        assignmentOffset = null,
        assignmentStride = 1,
        league: inputLeague = null,
        lockstepAssignments = false,
        seasonConfig = null,
    } = options || {};

    const freshLeague = !inputLeague;
    const league = inputLeague || createLeagueContext();
    const existingSeasonConfig = league?.settings?.season || {};
    const longSeasonSetting = seasonConfig?.longSeason ?? existingSeasonConfig.longSeason ?? false;
    const resolvedSeasonConfig = { ...existingSeasonConfig, ...(seasonConfig || {}), longSeason: longSeasonSetting };
    league.settings ||= {};
    league.settings.season = { ...resolvedSeasonConfig };
    if (freshLeague) {
        beginLeagueOffseason(league, { seasonNumber: 0 }, { inaugural: true, completedSeasonNumber: 0 });
    }
    const season = createSeasonState({
        seasonNumber: league.seasonNumber || 1,
        playerDevelopment: league.playerDevelopment || {},
        playerAges: league.playerAges || {},
        previousAwards: league.awardsHistory?.slice(-3) || [],
        seasonConfig: resolvedSeasonConfig,
    });
    ensureSeasonPersonnel(league, season.seasonNumber);
    league.seasonSnapshot = season;
    const scheduleLength = season.schedule?.length ?? 0;

    const stride = Math.max(1, Number.isFinite(assignmentStride) ? Math.floor(assignmentStride) : 1);
    const hasExplicitAssignment = Number.isFinite(assignmentOffset) && assignmentOffset >= 0;
    const effectiveOffset = hasExplicitAssignment
        ? Math.min(Math.floor(assignmentOffset), scheduleLength)
        : null;

    if (effectiveOffset != null) {
        season.currentGameIndex = effectiveOffset;
        season.completedGames = 0;
        const totalGames = computeAssignmentTotals(scheduleLength, effectiveOffset, stride);
        season.assignment = { stride, offset: effectiveOffset, totalGames };
        season.assignmentStride = stride;
        season.assignmentOffset = effectiveOffset;
        season.assignmentTotalGames = totalGames;
    } else if (Number.isFinite(startGameIndex) && startGameIndex > 0) {
        const desiredIndex = Math.max(0, Math.floor(startGameIndex));
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

    if (!season.assignment) {
        const baseOffset = season.currentGameIndex || 0;
        const totalGames = computeAssignmentTotals(scheduleLength, baseOffset, 1);
        season.assignment = { stride: 1, offset: baseOffset, totalGames };
        season.assignmentStride = 1;
        season.assignmentOffset = baseOffset;
        season.assignmentTotalGames = totalGames;
    }

    const suppressInitialMatchup = freshLeague && league.offseason?.active && !league.offseason?.nextSeasonReady;
    const matchup = suppressInitialMatchup ? null : prepareSeasonMatchup(season);
    const state = {
        season,
        playLog: [],
        debug: { trace: false },
        league,
        lockstepAssignments: !!lockstepAssignments,
        pendingMatchup: null,
        awaitingNextMatchup: false,
        seasonConfig: { ...resolvedSeasonConfig },
        overtime: null,
    };
    if (matchup) {
        prepareGameForMatchup(state, matchup);
    } else {
        prepareGameForMatchup(state, null);
        if (suppressInitialMatchup) {
            state.play = { phase: 'COMPLETE', resultText: 'Offseason underway' };
        }
    }
    return state;
}

export function createPlayState(roster, drive) {
    const safeDrive = (drive && typeof drive.losYards === 'number')
        ? drive
        : { losYards: 25, down: 1, toGo: 10 };

    const losPixY = yardsToPixY(ENDZONE_YARDS + safeDrive.losYards);
    const ownerState = roster?.__ownerState || null;
    const offenseTeamSlot = roster?.off?.QB?.team || roster?.off?.RB?.team || TEAM_RED;
    const defenseTeamSlot = offenseTeamSlot === TEAM_RED ? TEAM_BLK : TEAM_RED;
    const offenseCoach = ownerState?.coaches?.[offenseTeamSlot] || null;
    const defenseCoach = ownerState?.coaches?.[defenseTeamSlot] || null;
    const formationNames = pickFormations({
        down: safeDrive.down,
        toGo: safeDrive.toGo,
        yardline: safeDrive.losYards,
        offenseIQ: offenseCoach?.tacticalIQ ?? 1.0,
        defenseIQ: defenseCoach?.tacticalIQ ?? 1.0,
    }) || {};

    const formation = lineUpFormation(roster, losPixY, formationNames) || { off: {}, def: {} };

    const pendingPat = ownerState?.pendingExtraPoint || null;
    const offenseTeam = offenseTeamSlot || roster?.special?.K?.team || TEAM_RED;
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
        const offenseDynamics = ownerState?.gameDynamics?.teams?.[offenseTeam] || null;
        const personnel = {
            qbId: formation.off?.QB?.id || null,
            runnerId: formation.off?.RB?.id || null,
            receivers: {
                WR1: formation.off?.WR1 || null,
                WR2: formation.off?.WR2 || null,
                WR3: formation.off?.WR3 || null,
                TE: formation.off?.TE || null,
            },
        };
        const context = {
            down: safeDrive.down,
            toGo: safeDrive.toGo,
            yardline: safeDrive.losYards,
            offenseIQ: offenseCoach?.playcallingIQ ?? offenseCoach?.tacticalIQ ?? 1.0,
            relationships: offenseDynamics?.relationshipValues || null,
            personnel,
            coachTendencies: offenseCoach?.tendencies || null,
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
        handed: false,
        handoffTime: null,
        handoffStyle: null,
        handoffReadyAt: null,
        handoffDeadline: null,
        handoffPending: null,
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

export function resumeAssignedMatchup(state) {
    if (!state) return state;
    const offseason = state?.league?.offseason;
    const seasonNumber = state?.season?.seasonNumber;
    const completedSeasonNumber = offseason?.completedSeasonNumber;
    const offseasonAppliesToCurrentSeason = Number.isFinite(completedSeasonNumber)
        && (!Number.isFinite(seasonNumber) || completedSeasonNumber >= seasonNumber);
    const leagueSeasonNumber = state?.league?.seasonNumber;
    const leagueAheadOfSeason = Number.isFinite(leagueSeasonNumber)
        && (!Number.isFinite(seasonNumber) || leagueSeasonNumber > seasonNumber);

    let globalSeasonAhead = null;
    if (typeof window !== 'undefined') {
        const games = window.__blootyball?.games || [];
        const currentSeasonNumber = Number.isFinite(seasonNumber) ? seasonNumber : -Infinity;
        games.forEach((entry) => {
            const other = entry?.state;
            if (!other || other === state) return;
            const otherSeasonNumber = other?.season?.seasonNumber;
            if (!Number.isFinite(otherSeasonNumber)) return;
            if (otherSeasonNumber > currentSeasonNumber) {
                if (!globalSeasonAhead || (otherSeasonNumber > (globalSeasonAhead?.season?.seasonNumber ?? -Infinity))) {
                    globalSeasonAhead = other;
                }
            }
        });
    }

    if (globalSeasonAhead) {
        const stride = Math.max(1, state?.season?.assignmentStride || state?.season?.assignment?.stride || 1);
        const offset = state?.season?.assignmentOffset ?? state?.season?.assignment?.offset ?? 0;
        const seasonConfig = state?.seasonConfig || globalSeasonAhead?.seasonConfig || null;
        const league = globalSeasonAhead?.league || state?.league || null;
        const restarted = createInitialGameState({
            assignmentOffset: offset,
            assignmentStride: stride,
            league,
            lockstepAssignments: state.lockstepAssignments,
            seasonConfig,
        });
        restarted.debug = state.debug;
        restarted.lockstepAssignments = state.lockstepAssignments;
        return restarted;
    }

    if (leagueAheadOfSeason) {
        const restarted = progressOffseason(state);
        if (restarted !== state) {
            return resumeAssignedMatchup(restarted);
        }
        return state;
    }
    if (offseason?.active && !offseason.nextSeasonStarted && offseasonAppliesToCurrentSeason) {
        return state;
    }
    const next = { ...state };
    if (next.season) {
        next.season = { ...next.season };
    }
    if (next.seasonConfig) {
        next.seasonConfig = { ...next.seasonConfig };
    }

    if (!next.lockstepAssignments) {
        const matchup = prepareSeasonMatchup(next.season);
        if (matchup) {
            prepareGameForMatchup(next, matchup);
        } else {
            next.gameComplete = true;
        }
        return next;
    }

    let nextMatchup = next.pendingMatchup || prepareSeasonMatchup(next.season);

    if (!nextMatchup) {
        nextMatchup = scheduleNextMatchupFromSeason(next);
    }

    if (!nextMatchup && next.season) {
        nextMatchup = advanceSeasonPointer(next.season);
        if (!nextMatchup) {
            nextMatchup = scheduleNextMatchupFromSeason(next);
        }
    }

    if (nextMatchup) {
        next.pendingMatchup = null;
        next.awaitingNextMatchup = false;
        prepareGameForMatchup(next, nextMatchup);
    } else {
        next.pendingMatchup = null;
        next.awaitingNextMatchup = false;
        next.gameComplete = true;
    }

    return next;
}


export function progressOffseason(state, now = Date.now()) {
    if (!state?.league) return state;
    const { progressed, readyForNextSeason } = progressLeagueOffseason(state.league, state.season, now);
    const league = state.league;

    const stride = state.season?.assignmentStride || state.season?.assignment?.stride || 1;
    const offset = state.season?.assignmentOffset ?? state.season?.assignment?.offset ?? 0;
    const baseSeasonConfig = state.seasonConfig || league?.settings?.season || {};

    const restartSeasonState = () => {
        league.offseason ||= {};
        league.offseason.nextSeasonStarted = true;
        const restart = createInitialGameState({
            assignmentOffset: offset,
            assignmentStride: stride,
            league,
            lockstepAssignments: state.lockstepAssignments,
            seasonConfig: baseSeasonConfig,
        });
        restart.debug = state.debug;
        restart.lockstepAssignments = state.lockstepAssignments;
        restart.league.offseason ||= {};
        restart.league.offseason.nextSeasonStarted = true;
        return restart;
    };

    const seasonNumber = state.season?.seasonNumber ?? null;
    const leagueSeasonNumber = league.seasonNumber ?? seasonNumber;
    const nextSeasonStarted = !!league.offseason?.nextSeasonStarted;
    const seasonMissing = !state.season || seasonNumber == null;
    const seasonBehindLeague = Number.isFinite(leagueSeasonNumber)
        && (!Number.isFinite(seasonNumber) || seasonNumber < leagueSeasonNumber);

    if (readyForNextSeason) {
        return restartSeasonState();
    }

    if (nextSeasonStarted && (seasonMissing || seasonBehindLeague)) {
        return restartSeasonState();
    }

    if (!progressed) {
        return state;
    }

    return { ...state, league: { ...league } };
}


/* =========================================================
   Main step
   ========================================================= */
export function stepGame(state, dt) {
    const updated = progressOffseason(state);
    if (updated !== state) {
        state = updated;
    }
    const offseason = state?.league?.offseason;
    const seasonNumber = state?.season?.seasonNumber;
    const completedSeasonNumber = offseason?.completedSeasonNumber;
    const offseasonAppliesToCurrentSeason = Number.isFinite(completedSeasonNumber)
        && (!Number.isFinite(seasonNumber) || completedSeasonNumber >= seasonNumber);
    if (offseason?.active && !offseason.nextSeasonStarted && offseasonAppliesToCurrentSeason) {
        return state;
    }
    if (state?.overtime?.concluded && !state.overtime.finalized) {
        const overtimeInfo = { ...state.overtime, active: false, finalized: true };
        const finalized = finalizeCurrentGame(state);
        finalized.overtime = overtimeInfo;
        return finalized;
    }
    if (state?.gameComplete) {
        return state;
    }

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
                s.play.liveAt = s.play.elapsed;
                s.play.handed = false;
                s.play.handoffTime = null;
                s.play.handoffPending = null;
                startClockOnSnap(s);
                recordPlayEvent(s, { type: 'phase:live' });
            }
            return s;
        }
        case 'LIVE': {
            if (!s.play.formation) s.play.formation = { off: {}, def: {} };
            if (!s.play.routesInitialized) initRoutesAfterSnap(s);

            const off = s.play.formation.off;
            const call = s.play.playCall || {};
            const handoffRole = typeof call.handoffTo === 'string' ? call.handoffTo : 'RB';
            const runner = off?.[handoffRole] || off?.RB || null;
            const runnerId = runner?.id || null;
            const ballCarrier = s.play.ball.carrierId;
            const runnerHasBall =
                (typeof ballCarrier === 'string' && ballCarrier === handoffRole) ||
                (runnerId != null && ballCarrier === runnerId);

            off.__runFlag = s.play.playCall.type === 'RUN' && (
                runnerHasBall ||
                !s.play.handed ||
                (s.play.handoffPending && s.play.handoffPending.type === 'PITCH')
            );
            off.__losPixY = yardsToPixY(ENDZONE_YARDS + s.drive.losYards);
            off.__carrierWrapped = null;
            off.__carrierWrappedId = null;

            const activePlayers = gatherActivePlayers(s.play);
            beginFrame(activePlayers);

            moveOL(s.play.formation.off, s.play.formation.def, dt, s);
            moveReceivers(s.play.formation.off, dt, s);
            moveTE(s.play.formation.off, dt, s);
            qbLogic(s, dt);
            rbLogic(s, dt);
            defenseLogic(s, dt);
            applyPlayerPhysics(s.play, dt);
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
        s.teams = s.teams || createTeams(s.matchup, s.league);
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
            s.teams = s.teams || createTeams(s.matchup, s.league);
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
        s.teams = s.teams || createTeams(s.matchup, s.league);
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
            s.teams = s.teams || createTeams(s.matchup, s.league);
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
                    s.teams = s.teams || createTeams(s.matchup, s.league);
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
        startDown,
        startToGo,
    });

    finalizePlayDiagnostics(s, {
        result: resultWhy,
        gained,
        endLos: los,
        turnover,
    });

    const injuryReport = maybeTriggerInjury(s, {
        offense: offenseAtSnap,
        startDown,
        startToGo,
        startLos,
        gained,
    });

    if (injuryReport?.logEntry) {
        pushPlayLog(s, injuryReport.logEntry);
    }

    const pendingPat = queuedExtraPoint || !!s.pendingExtraPoint;
    const offenseChanged = s.possession !== offenseAtSnap;

    if (s.overtime?.active && offenseChanged && !pendingPat) {
        const concluded = handleOvertimeDriveEnd(s, { driveTeam: offenseAtSnap });
        if (concluded) {
            if (!s.play || s.play.phase !== 'COMPLETE') {
                s.play = { phase: 'COMPLETE', resultText: summaryText };
            }
            return s;
        }
    }

    const regulationExpired = !s.overtime?.active && isGameClockExpired(s);
    if (regulationExpired) {
        const redScore = s.scores?.[TEAM_RED] ?? 0;
        const blkScore = s.scores?.[TEAM_BLK] ?? 0;
        if (redScore === blkScore) {
            beginOvertime(s);
            return s;
        }
        return finalizeCurrentGame(s);
    }

    if (s.overtime?.concluded) {
        if (!s.play || s.play.phase !== 'COMPLETE') {
            s.play = { phase: 'COMPLETE', resultText: summaryText };
        }
        return s;
    }

    // Ensure the active roster knows which state owns it for debug hooks
    if (s.roster) s.roster.__ownerState = s;

    // Start next play for whoever now has the ball
    s.play = createPlayState(s.roster, s.drive);
    if (queuedExtraPoint) {
        s.play.resultText = `${call.name}: ${resultWhy}`;
    } else {
        s.play.resultText = summaryText;
    }
    if (injuryReport?.message) {
        s.play.resultText = `${s.play.resultText} – ${injuryReport.message}`;
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

