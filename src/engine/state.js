import {
    FIELD_PIX_W, ENDZONE_YARDS, PLAYING_YARDS_H,
    TEAM_RED, TEAM_BLK, PLAYBOOK, PX_PER_YARD,
} from './constants';
import { clamp, yardsToPixY, pixYToYards } from './helpers';
import { createTeams, rosterForPossession, lineUpFormation } from './rosters';
import { initRoutesAfterSnap, moveOL, moveReceivers, moveTE, qbLogic, rbLogic, defenseLogic } from './ai';
import { moveBall, getBallPix } from './ball';
import { beginFrame, endFrame } from './motion';
import { beginPlayDiagnostics, finalizePlayDiagnostics, recordPlayEvent } from './diagnostics';
import { pickFormations, PLAYBOOK_PLUS, pickPlayCall } from './playbooks';

/* =========================================================
   Utilities / guards
   ========================================================= */
const QUARTER_SECONDS = 15 * 60;
const DEFAULT_CLOCK_MANAGEMENT = {
    hurryThreshold: 150,          // offense trailing inside 2:30
    defensiveThreshold: 120,      // defense trailing inside 2:00
    mustTimeoutThreshold: 35,     // always burn a timeout when trailing inside :35
    trailingMargin: 8,
};

const PENALTY_CHANCE = 0.07;

function ensureDrive(s) {
    if (!s.drive || typeof s.drive.losYards !== 'number') {
        s.drive = { losYards: 25, down: 1, toGo: 10 };
    }
    return s.drive;
}

function isNoAdvance(why) {
    if (!why) return false;
    const w = String(why).toLowerCase();
    return w === 'incomplete' || w === 'throwaway' || w === 'throw away' || w === 'spike';
}

function pushPlayLog(state, entry) {
    state.playLog ||= [];
    const nextNum = (state.playLog[state.playLog.length - 1]?.num || 0) + 1;
    const startLos = entry.startLos ?? state.play?.startLos ?? state.drive?.losYards ?? 25;
    const endLos = entry.endLos ?? (startLos + (entry.gained ?? 0));
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
    });
    if (state.playLog.length > 50) state.playLog.shift();
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

function useTimeout(s, team, reason) {
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
        w.includes('touchdown') ||
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
        if (useTimeout(s, team, reason)) {
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
    s.teams = s.teams || createTeams();
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
function resolveEndSpotYards(s) {
    const bp = getBallPix(s);
    // convert portrait-space pixel Y to yards going in, then clamp to 0..100
    let y = pixYToYards(bp?.y ?? yardsToPixY(ENDZONE_YARDS + s.drive.losYards)) - ENDZONE_YARDS;
    if (!Number.isFinite(y)) y = s.drive?.losYards ?? 25;
    return clamp(Math.round(y), 0, 100);
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

/* =========================================================
   Game state factories
   ========================================================= */
export function createInitialGameState() {
    // Keep both: teams (persistent) + current roster view (for compatibility)
    const teams = createTeams();
    const possession = TEAM_RED; // RED starts with ball
    const roster = rosterForPossession(teams, possession);
    const drive = { losYards: 25, down: 1, toGo: 10 };
    roster.__ownerState = null; // ensure field exists
    const play = createPlayState(roster, drive);
    const clock = createClock();

    const state = {
        teams,
        possession,
        roster,
        drive,
        play,
        clock,
        playLog: [],
        scores: { [TEAM_RED]: 0, [TEAM_BLK]: 0 },
        debug: { trace: false },
    };

    beginPlayDiagnostics(state);
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

    // NEW: pick by forced name if armed and valid
    let playCall;
    if (roster && roster.__ownerState && roster.__ownerState.debug?.forceNextArmed) {
        const dbg = roster.__ownerState.debug;
        const named = Array.isArray(PLAYBOOK) ? PLAYBOOK.find(p => p.name === dbg.forceNextPlayName) : null;
        playCall = named || (Array.isArray(PLAYBOOK) && PLAYBOOK.length
            ? PLAYBOOK[(Math.random() * PLAYBOOK.length) | 0]
            : { name: 'Run Middle', type: 'RUN' });

        // one-shot consumption
        dbg.forceNextArmed = false;
        // keep dbg.forceNextPlayName around so UI can still show it; clear if you prefer:
        // dbg.forceNextPlayName = null;
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

    return {
        phase: 'PRESNAP',
        elapsed: 0,
        resultText: '',
        resultWhy: null,
        ball,
        formation,
        playCall,
        startLos: safeDrive.losYards,
        startDown: safeDrive.down,
        startToGo: safeDrive.toGo,
        mustReachSticks: safeDrive.down === 4 && safeDrive.toGo > 1,
        sticksDepthPx: safeDrive.toGo * PX_PER_YARD,
    };
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
        case 'PRESNAP': {
            if (s.play.elapsed > 1.0) {
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
export function betweenPlays(s) {
    ensureDrive(s); // keep a valid drive object around
    const offenseAtSnap = s.possession; // who ran the play
    const call = s.play.playCall || { name: 'Play' };
    let resultWhy = s.play.resultWhy || 'Tackled';

    const startLos = s.play.startLos ?? s.drive.losYards;
    const startDown = s.play.startDown ?? s.drive.down;
    const startToGo = s.play.startToGo ?? s.drive.toGo;

    // Where did the ball end up in yards going-in (0..100)?
    const endYd = resolveEndSpotYards(s);  // see helper below
    const netGain = clamp(endYd - startLos, -100, 100);

    // Helpers
    const noAdvance = isNoAdvance(resultWhy); // make sure this handles 'Throw away' too
    const gained = noAdvance ? 0 : netGain;
    const firstDownAchieved = !noAdvance && (gained >= startToGo);

    // Text says turnover on downs OR 4th down failed to gain enough
    const turnoverOnDownsByString = /turnover\s*:? on downs/i.test(resultWhy) || /downs\b/i.test(resultWhy);
    const turnoverOnDownsCalc = (startDown === 4) && !firstDownAchieved && (resultWhy !== 'Touchdown');

    let los = s.drive.losYards;
    let down = s.drive.down;
    let toGo = s.drive.toGo;
    let turnover = !!s.play.turnover;

    // Touchdown: add score, then hand the ball to the other team at the 25
    if (resultWhy === 'Touchdown') {
        if (!s.scores) s.scores = { [TEAM_RED]: 0, [TEAM_BLK]: 0 };
        const scoringTeam = offenseAtSnap;
        s.scores[scoringTeam] = (s.scores[scoringTeam] ?? 0) + 6;

        s.possession = (scoringTeam === TEAM_RED ? TEAM_BLK : TEAM_RED);
        s.teams = s.teams || createTeams();
        s.roster = rosterForPossession(s.teams, s.possession);
        los = 25; down = 1; toGo = 10;
        pushPlayLog(s, {
            name: call.name,
            startDown, startToGo, startLos,
            endLos: los,
            why: 'Touchdown',
            gained,
            offense: offenseAtSnap
        });
    }

    // Turnover on downs
    // Turnover on downs → new offense starts at the 25
    else if (turnoverOnDownsByString || turnoverOnDownsCalc) {
        s.possession = (s.possession === TEAM_RED ? TEAM_BLK : TEAM_RED);
        s.teams = s.teams || createTeams();
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
        los = clamp(noAdvance ? startLos : endYd, 0, 100);
        if (firstDownAchieved) {
            down = 1;
            toGo = Math.min(10, 100 - los);
        } else {
            down = startDown + 1;
            if (down > 4) {
                // Safety net: if we somehow get here, treat as turnover on downs
                s.possession = (s.possession === TEAM_RED ? TEAM_BLK : TEAM_RED);
                s.teams = s.teams || createTeams();
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

    // Commit updated drive
    s.drive = { losYards: clamp(los, 1, 99), down, toGo };

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
        scoring: resultWhy === 'Touchdown',
    });

    if (!stoppage && !penaltyInfo) {
        maybeAutoTimeout(s, {
            offense: offenseAtSnap,
            resultWhy,
            turnover: turnover || turnoverOnDownsByString || turnoverOnDownsCalc,
            startDown,
            startToGo,
            startLos,
        });
    }

    const yardText = noAdvance ? 'no gain' : `${gained >= 0 ? '+' : ''}${gained} yds`;
    const baseSummary = `${call.name}: ${resultWhy}${resultWhy === 'Touchdown' ? '' : ` (${yardText})`}`;
    let summaryText = baseSummary;
    if (penaltyInfo?.text) summaryText = penaltyInfo.text;
    else if (s.play.resultText && /timeout/i.test(s.play.resultText)) summaryText = s.play.resultText;

    finalizePlayDiagnostics(s, {
        result: resultWhy,
        gained,
        endLos: los,
        turnover,
    });

    // Ensure the active roster knows which state owns it for debug hooks
    if (s.roster) s.roster.__ownerState = s;

    // Start next play for whoever now has the ball
    s.play = createPlayState(s.roster, s.drive);
    s.play.resultText = summaryText;
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

