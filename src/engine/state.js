import {
    FIELD_PIX_W, ENDZONE_YARDS, PLAYING_YARDS_H, PX_PER_YARD,
    TEAM_RED, TEAM_BLK, PLAYBOOK
} from './constants';
import { clamp, yardsToPixY, pixYToYards } from './helpers';
import { createTeams, rosterForPossession, createRosters, lineUpFormation } from './rosters';
import { initRoutesAfterSnap, moveOL, moveReceivers, moveTE, qbLogic, rbLogic, defenseLogic } from './ai';
import { moveBall, getBallPix } from './ball';

/* =========================================================
   Utilities / guards
   ========================================================= */
function otherTeam(t) { return t === TEAM_RED ? TEAM_BLK : TEAM_RED; }

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
    const clock = { quarter: 1, time: 15 * 60 };

    return {
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
}

export function createPlayState(roster, drive) {
    const safeDrive = (drive && typeof drive.losYards === 'number')
        ? drive
        : { losYards: 25, down: 1, toGo: 10 };

    const losPixY = yardsToPixY(ENDZONE_YARDS + safeDrive.losYards);
    const formation = lineUpFormation(roster, losPixY) || { off: {}, def: {} };

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
        playCall = (Array.isArray(PLAYBOOK) && PLAYBOOK.length)
            ? PLAYBOOK[(Math.random() * PLAYBOOK.length) | 0]
            : { name: 'Run Middle', type: 'RUN' };
    }

    const ball = { inAir: false, carrierId: 'QB', from: { x: 0, y: 0 }, to: { x: 0, y: 0 }, t: 0, targetId: null };

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
    }

    s.play.elapsed += dt;

    switch (s.play.phase) {
        case 'PRESNAP': {
            if (s.play.elapsed > 1.0) {
                s.play.phase = 'POSTSNAP';
                s.play.ball.carrierId = 'QB';
                s.play.ball.inAir = false;
            }
            return s;
        }
        case 'POSTSNAP': {
            if (s.play.elapsed > 1.2) s.play.phase = 'LIVE';
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
                return betweenPlays(s);
            }
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
    const why = s.play.resultWhy || 'Tackled';

    const startLos = s.play.startLos ?? s.drive.losYards;
    const startDown = s.play.startDown ?? s.drive.down;
    const startToGo = s.play.startToGo ?? s.drive.toGo;

    // Where did the ball end up in yards going-in (0..100)?
    const endYd = resolveEndSpotYards(s);  // see helper below
    const gained = clamp(endYd - startLos, -100, 100);

    // Helpers
    const noAdvance = isNoAdvance(why); // make sure this handles 'Throw away' too
    const firstDownAchieved = !noAdvance && (gained >= startToGo);

    // Text says turnover on downs OR 4th down failed to gain enough
    const turnoverOnDownsByString = /turnover\s*:? on downs/i.test(why) || /downs\b/i.test(why);
    const turnoverOnDownsCalc = (startDown === 4) && !firstDownAchieved && (why !== 'Touchdown');

    let los = s.drive.losYards;
    let down = s.drive.down;
    let toGo = s.drive.toGo;

    // Touchdown: keep same offense, reset to 25
    // Touchdown: add score, keep same offense, reset to 25
    if (why === 'Touchdown') {
        if (!s.scores) s.scores = { [TEAM_RED]: 0, [TEAM_BLK]: 0 };
        s.scores[s.possession] = (s.scores[s.possession] ?? 0) + 6;

        los = 25; down = 1; toGo = 10;
        pushPlayLog(s, {
            name: call.name,
            startDown, startToGo, startLos,
            endLos: los,
            why: 'Touchdown',
            gained: endYd - startLos,
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

        pushPlayLog(s, {
            name: call.name,
            startDown, startToGo, startLos,
            endLos: los,                        // log shows the new drive start
            gained: endYd - startLos,
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
                const spot = clamp(endYd, 1, 99);
                s.possession = (s.possession === TEAM_RED ? TEAM_BLK : TEAM_RED);
                s.teams = s.teams || createTeams();
                s.roster = rosterForPossession(s.teams, s.possession);

                los = 25;      // force new drive start at 25
                down = 1;
                toGo = 10;

                pushPlayLog(s, {
                    name: call.name,
                    startDown, startToGo, startLos,
                    endLos: los,
                    gained: endYd - startLos,
                    why: 'Turnover on downs',
                    turnover: true,
                    offense: offenseAtSnap
                });
            } else {
                toGo = Math.max(1, startToGo - (noAdvance ? 0 : gained));
                pushPlayLog(s, {
                    name: call.name,
                    startDown, startToGo, startLos,
                    endLos: los, gained: endYd - startLos,
                    why,
                    offense: offenseAtSnap
                });
            }
        }
    }

    // Commit updated drive
    s.drive = { losYards: clamp(los, 1, 99), down, toGo };

    // Start next play for whoever now has the ball
    s.play = createPlayState(s.roster, s.drive);
    return s;
}




/* =========================================================
   Dead-ball conditions
   ========================================================= */
function checkDeadBall(s) {
    if (!s?.play || !s.play.formation) return;
    if (s.play.ball?.inAir) return; // pass resolution decides incomplete/INT

    const pos = getBallPix(s);
    if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') return;

    if (pos.x < 10 || pos.x > FIELD_PIX_W - 10) {
        s.play.deadAt = s.play.elapsed; s.play.phase = 'DEAD'; s.play.resultWhy = 'Out of bounds'; return;
    }
    const yards = pixYToYards(pos.y);
    if (yards >= ENDZONE_YARDS + PLAYING_YARDS_H) {
        s.play.deadAt = s.play.elapsed; s.play.phase = 'DEAD'; s.play.resultWhy = 'Touchdown'; return;
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

