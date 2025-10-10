import { FIELD_PIX_H, FIELD_PIX_H_VIEW, FIELD_PIX_W, ENDZONE_YARDS, PLAYING_YARDS_H, PX_PER_YARD, COLORS, PLAYBOOK } from './constants';
import { clamp, yardsToPixY, pixYToYards } from './helpers';
import { createRosters, lineUpFormation } from './rosters';
import { initRoutesAfterSnap, moveOL, moveReceivers, moveTE, qbLogic, rbLogic, defenseLogic } from './ai';
import { moveBall, getBallPix } from './ball';

// --- createInitialGameState (replace yours with this) ---
export function createInitialGameState() {
    const roster = createRosters(); // use real roster generator
    const drive = { losYards: 25, down: 1, toGo: 10 };
    const play = createPlayState(roster, drive);
    const clock = { quarter: 1, time: 15 * 60 };
    return {
        roster,
        drive,
        play,
        clock,
        cameraY: 0,
        playLog: [] // for the summary table
    };
}

// --- helper to push into play log (add anywhere in this file) ---
function pushPlayLog(state, entry) {
    const num = (state.playLog[state.playLog.length - 1]?.num || 0) + 1;
    const withNum = { num, ...entry };
    state.playLog.push(withNum);
    if (state.playLog.length > 50) state.playLog.shift(); // keep it light; UI will show last 10
}


export function createPlayState(roster, drive) {
    const losPixY = yardsToPixY(ENDZONE_YARDS + drive.losYards);
    const formation = lineUpFormation(roster, losPixY) || { off: {}, def: {} };
    const playCall = PLAYBOOK[(Math.random() * PLAYBOOK.length) | 0];
    const ball = { inAir: false, carrierId: 'QB', from: { x: 0, y: 0 }, to: { x: 0, y: 0 }, t: 0 };
    return { phase: 'PRESNAP', resultText: '', ball, formation, playCall, elapsed: 0 };
}


// inside src/engine/state.js
export function stepGame(state, dt) {
    let s = { ...state };
    s.play.elapsed += dt;
    const { playCall } = s.play;

    if (s.play.phase === 'PRESNAP') {
        if (s.play.elapsed > 1.0) {
            s.play.phase = 'POSTSNAP';
            s.play.ball.carrierId = 'QB';
            s.play.ball.inAir = false;
            s.play.resultText = `${playCall.name}`;

            // NEW: record starting situation for the log
            s.play.startDown = s.drive.down;
            s.play.startToGo = s.drive.toGo;
            s.play.startLos = s.drive.losYards;
        }
        return s;
    }

    if (s.play.phase === 'POSTSNAP') { if (s.play.elapsed > 1.2) s.play.phase = 'LIVE'; }
    if (s.play.phase === 'LIVE') s = simulateLive(s, dt);
    if (s.play.phase === 'DEAD') { if (s.play.elapsed > s.play.deadAt + 1.2) s = betweenPlays(s); }

    // No camera follow — full field always visible
    return s;
}

function simulateLive(s, dt) {
    if (!s.play.routesInitialized) initRoutesAfterSnap(s);

    const off = s.play.formation.off;
    const def = s.play.formation.def;

    // Context flags for AIs
    off.__runFlag = s.play.playCall.type === 'RUN' && (s.play.ball.carrierId === 'RB' || !s.play.handed);
    off.__runHoleX = s.play.runHoleX;
    off.__losPixY = yardsToPixY(ENDZONE_YARDS + s.drive.losYards);

    // Clear who is wrapped for this frame; defenseLogic will set if wrapping
    off.__carrierWrapped = null;

    // NEW: make sure a cooldown map exists (per-defender wrap cooldowns)
    if (!s.play.wrapCooldown) s.play.wrapCooldown = {};
    if (s.play.noWrapUntil == null) s.play.noWrapUntil = 0;
    if (!s.play.lastBreakPos) s.play.lastBreakPos = null;
    // s.play.breaks is created in defenseLogic when first needed


    moveOL(off, def, dt);
    moveReceivers(off, dt);
    moveTE(off, dt);
    qbLogic(s, dt);
    rbLogic(s, dt);
    defenseLogic(s, dt);
    moveBall(s, dt);
    checkDeadBall(s);
    return { ...s };
}




// --- betweenPlays (replace entire function) ---
export function betweenPlays(s) {
    const startLos = s.drive.losYards;
    const startDown = s.drive.down;
    const startToGo = s.drive.toGo;
    const call = s.play.playCall;

    // Determine result type
    const why = s.play.resultWhy || 'Tackled';
    const wasINT = why === 'Interception';
    const wasFumble = why === 'Fumble';
    const turnover = !!s.play.turnover;

    // Yardline at end of play (in pixels → yards from top goal line)
    // NOTE: for incomplete/throw away, ball doesn’t change LOS.
    let endLos = startLos; // default: no movement
    let gained = 0;

    if (why === 'Incomplete' || why === 'Throw away') {
        gained = 0;
        endLos = startLos; // stay
    } else if (why === 'Sack') {
        // spot of sack moves LOS backward (negative gained)
        const ballY = getBallPix(s).y;
        const ballYards = pixYToYards(ballY) - ENDZONE_YARDS;
        gained = Math.round(ballYards - startLos); // typically negative
        endLos = clamp(startLos + gained, 1, 99);
    } else if (wasINT) {
        // Interception: change of possession; new LOS resets (keep simple for now)
        // We'll show it as "Turnover (Interception)" in the log, and reset to 25.
        endLos = 25;
    } else {
        // Normal run/catch-in-bounds: use ball spot
        const ballY = getBallPix(s).y;
        const ballYards = pixYToYards(ballY) - ENDZONE_YARDS;
        gained = Math.round(ballYards - startLos);
        endLos = clamp(startLos + Math.max(0, gained), 1, 99); // do not move back on behind-LOS catches unless it's actually a tackle before LOS
        if (gained < 0) endLos = clamp(startLos + gained, 1, 99);
    }

    // Touchdown: if ball is in endzone (you may already set resultWhy = 'Touchdown' elsewhere)
    if (why === 'Touchdown') {
        pushPlayLog(s, {
            name: call.name,
            startDown, startToGo, startLos,
            result: 'Touchdown',
            yards: gained,
            endLos: 25,
            turnover: false
        });
        s.drive = { losYards: 25, down: 1, toGo: 10 };
    } else if (wasINT || (wasFumble && turnover)) {
        pushPlayLog(s, {
            name: call.name,
            startDown, startToGo, startLos,
            result: `Turnover (${why})`,
            yards: gained,
            endLos,
            turnover: true
        });
        // New drive for other team — simplified reset for now
        s.drive = { losYards: 25, down: 1, toGo: 10 };
    } else {
        // Standard chains logic
        let nextDown = startDown + 1;
        let toGo = startToGo - gained;
        let los = endLos;

        // First down reached?
        if (toGo <= 0) {
            nextDown = 1;
            toGo = 10;
            // LOS already set to endLos
        }

        // Incomplete: gained=0, just advance down
        // Sack/negative: toGo increases appropriately; endLos already set backward

        if (nextDown > 4) {
            // Turnover on downs — reset for now
            pushPlayLog(s, {
                name: call.name,
                startDown, startToGo, startLos,
                result: `${why} — ToD`,
                yards: gained,
                endLos: los,
                turnover: true
            });
            s.drive = { losYards: 25, down: 1, toGo: 10 };
        } else {
            // Record and continue drive
            const label = (why === 'Incomplete' || why === 'Throw away') ? why : (why || (gained >= 0 ? 'Gain' : 'Loss'));
            pushPlayLog(s, {
                name: call.name,
                startDown, startToGo, startLos,
                result: `${label}`,
                yards: gained,
                endLos: los,
                turnover: false
            });
            s.drive = { losYards: los, down: nextDown, toGo: Math.max(1, Math.round(toGo)) };
        }
    }

    // Start next play
    s.play = createPlayState(s.roster, s.drive);
    // Optional banner text
    const yardsTxt = (gained > 0 ? `+${gained}` : gained);
    s.play.resultText = `${call.name}: ${why}${(why !== 'Touchdown' && why !== 'Interception' && why !== 'Fumble') ? ` (${yardsTxt} yds)` : ''}`;

    return s;
}



function checkDeadBall(s) {
    const ballPix = getBallPix(s);
    if (ballPix.x < 10 || ballPix.x > FIELD_PIX_W - 10) { s.play.deadAt = s.play.elapsed; s.play.phase = 'DEAD'; s.play.resultWhy = 'Out of bounds'; }
    const ballYards = pixYToYards(ballPix.y);
    if (ballYards >= ENDZONE_YARDS + PLAYING_YARDS_H) { s.play.deadAt = s.play.elapsed; s.play.phase = 'DEAD'; s.play.resultWhy = 'Touchdown'; }
}