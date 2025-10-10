import { TEAM_RED, TEAM_BLK, ROLES_OFF, ROLES_DEF } from './constants';
import { clamp, rand, yardsToPixY } from './helpers';
import { ENDZONE_YARDS, FIELD_PIX_W } from './constants';
import { resetMotion } from './motion';

/* =========================================================
   Player factories (persistent per-team pools)
   ========================================================= */
let _pid = 0;

function makeAttrs(role) {
    return {
        speed: clamp(rand(4.5, 6.0) + (role.startsWith('WR') ? 0.25 : 0), 4.0, 8.0),
        accel: clamp(rand(10, 20), 8, 25),
        agility: clamp(rand(0.6, 1.0), 0.5, 1.2),
        strength: clamp(rand(0.5, 1.0), 0.5, 1.2),
        awareness: clamp(rand(0.6, 1.1), 0.4, 1.3),
        catch: clamp(rand(0.5, 1.05), 0.4, 1.2),
        throwPow: clamp(rand(0.6, 1.1), 0.5, 1.2),
        throwAcc: clamp(rand(0.5, 1.0), 0.4, 1.2),
        tackle: clamp(rand(0.6, 1.2), 0.5, 1.3),
    };
}

function makePlayer(team, role) {
    const player = {
        id: `${team}-${role}-${_pid++}`,
        team,
        role,
        attrs: makeAttrs(role),
        pos: { x: FIELD_PIX_W / 2, y: yardsToPixY(ENDZONE_YARDS + 20) },
        v: { x: 0, y: 0 },
        home: null,
        alive: true,
    };
    resetMotion(player);
    return player;
}

/* =========================================================
   Public API (kept compatible) + new helpers for possession
   ========================================================= */

/** Build both full team pools once */
export function createTeams() {
    const buildSide = (team) => {
        const off = {}; const def = {};
        ROLES_OFF.forEach(r => { off[r] = makePlayer(team, r); });
        ROLES_DEF.forEach(r => { def[r] = makePlayer(team, r); });
        return { off, def };
    };
    return {
        [TEAM_RED]: buildSide(TEAM_RED),
        [TEAM_BLK]: buildSide(TEAM_BLK),
    };
}

/**
 * Compose the active roster for the current possession.
 * Shallow-clone players so per-snap movement doesn’t mutate pools.
 */
export function rosterForPossession(teams, offenseTeam) {
    const defenseTeam = offenseTeam === TEAM_RED ? TEAM_BLK : TEAM_RED;
    const off = {}, def = {};
    ROLES_OFF.forEach(r => {
        const base = teams[offenseTeam].off[r];
        off[r] = { ...base, pos: { ...base.pos }, home: base.home ? { ...base.home } : null };
        resetMotion(off[r]);
    });
    ROLES_DEF.forEach(r => {
        const base = teams[defenseTeam].def[r];
        def[r] = { ...base, pos: { ...base.pos }, home: base.home ? { ...base.home } : null };
        resetMotion(def[r]);
    });
    return { off, def };
}

/**
 * Backward-compat wrapper some code still uses.
 * Creates two teams and returns the RED-offense snapshot.
 */
export function createRosters() {
    const teams = createTeams();
    return rosterForPossession(teams, TEAM_RED);
}

/**
 * Place players on the field for the given LOS (in pixels, y-down).
 * (Pure on the roster passed in.)
 */
export function lineUpFormation(roster, losPixY, names = {}) {
    const midX = Math.round(FIELD_PIX_W / 2);
    const off = { ...roster.off };
    const def = { ...roster.def };

    const offFormation = names.offFormation || '2x2 Gun';
    const defFormation = names.defFormation || 'Nickel 2-4-5';

    const spacingX = 20;
    const startX = midX - 2 * spacingX;
    const olY = losPixY - yardsToPixY(1);

    const yard = yardsToPixY(1);
    const wideLeftX = 40;
    const wideRightX = FIELD_PIX_W - 40;
    const slotLeftX = midX - 65;
    const slotRightX = midX + 65;

    const setP = (p, x, y) => {
        if (!p) return;
        p.pos = { x, y };
        p.v = { x: 0, y: 0 };
        p.home = { x, y };
        resetMotion(p);
    };

    // Offensive line
    setP(off.C, startX + 2 * spacingX, olY);
    setP(off.LG, startX + 1 * spacingX, olY);
    setP(off.RG, startX + 3 * spacingX, olY);
    setP(off.LT, startX + 0 * spacingX, olY);
    setP(off.RT, startX + 4 * spacingX, olY);

    const centerX = off.C?.pos?.x ?? (startX + 2 * spacingX);
    const rtX = off.RT?.pos?.x ?? (startX + 4 * spacingX);
    const ltX = off.LT?.pos?.x ?? startX;

    const qbShotgunY = olY - yard * 5.5;
    const qbPistolY = olY - yard * 4;
    const qbUnderCenterY = olY - yard * 1.2;

    const rbDepth = olY - yard * 6.5;
    const rbOffset = yard * 2.5;

    // Default to a balanced 2x2 look
    setP(off.QB, centerX, qbShotgunY);
    setP(off.RB, centerX - rbOffset, qbShotgunY + yard * 0.6);
    setP(off.TE, rtX + 16, olY);
    setP(off.WR1, wideLeftX, olY);
    setP(off.WR2, wideRightX, olY);
    setP(off.WR3, slotRightX + 20, olY - yard * 0.8);

    switch (offFormation) {
        case 'I-Form Twins': {
            setP(off.QB, centerX, qbUnderCenterY);
            setP(off.RB, centerX, rbDepth);
            setP(off.TE, rtX + 14, olY);
            setP(off.WR1, wideLeftX, olY);
            setP(off.WR2, wideRightX - 25, olY);
            setP(off.WR3, wideRightX - 55, olY - yard * 0.8);
            break;
        }
        case 'Trips Right': {
            setP(off.QB, centerX, qbShotgunY);
            setP(off.RB, centerX - rbOffset, qbShotgunY + yard * 0.4);
            setP(off.TE, ltX - 14, olY);
            setP(off.WR1, wideLeftX, olY);
            setP(off.WR2, slotRightX, olY);
            setP(off.WR3, slotRightX + 24, olY - yard);
            break;
        }
        case 'Trips Left': {
            setP(off.QB, centerX, qbShotgunY);
            setP(off.RB, centerX + rbOffset, qbShotgunY + yard * 0.4);
            setP(off.TE, rtX + 16, olY);
            setP(off.WR2, wideRightX, olY);
            setP(off.WR1, slotLeftX, olY);
            setP(off.WR3, slotLeftX - 24, olY - yard);
            break;
        }
        case 'Empty 3x2': {
            setP(off.QB, centerX, qbShotgunY - yard * 0.4);
            setP(off.RB, slotLeftX - 18, olY - yard * 0.8);
            setP(off.TE, slotRightX + 12, olY - yard * 0.6);
            setP(off.WR1, wideLeftX, olY);
            setP(off.WR2, wideRightX, olY);
            setP(off.WR3, slotRightX - 8, olY - yard * 0.6);
            break;
        }
        case 'Bunch Right': {
            setP(off.QB, centerX, qbShotgunY);
            setP(off.RB, centerX - rbOffset, qbShotgunY + yard * 0.6);
            setP(off.TE, rtX + 10, olY - yard * 0.3);
            setP(off.WR1, wideLeftX, olY);
            setP(off.WR2, slotRightX + 8, olY - yard * 0.6);
            setP(off.WR3, slotRightX + 22, olY - yard * 1.2);
            break;
        }
        case 'Bunch Left': {
            setP(off.QB, centerX, qbShotgunY);
            setP(off.RB, centerX + rbOffset, qbShotgunY + yard * 0.6);
            setP(off.TE, ltX - 10, olY - yard * 0.3);
            setP(off.WR2, wideRightX, olY);
            setP(off.WR1, slotLeftX - 8, olY - yard * 0.6);
            setP(off.WR3, slotLeftX - 22, olY - yard * 1.2);
            break;
        }
        case 'Heavy TE Right': {
            setP(off.QB, centerX, qbPistolY);
            setP(off.RB, centerX - rbOffset * 0.6, rbDepth + yard);
            setP(off.TE, rtX + 18, olY);
            setP(off.WR1, wideLeftX + 12, olY);
            setP(off.WR2, slotRightX + 16, olY - yard * 0.4);
            setP(off.WR3, slotRightX - 14, olY - yard * 0.8);
            break;
        }
        case 'Heavy TE Left': {
            setP(off.QB, centerX, qbPistolY);
            setP(off.RB, centerX + rbOffset * 0.6, rbDepth + yard);
            setP(off.TE, ltX - 18, olY);
            setP(off.WR2, wideRightX - 12, olY);
            setP(off.WR1, slotLeftX - 16, olY - yard * 0.4);
            setP(off.WR3, slotLeftX + 14, olY - yard * 0.8);
            break;
        }
        default:
            break;
    }

    // Defensive front
    const defFrontY = losPixY + yardsToPixY(1.5);
    const lbY = defFrontY + yard * 2.5;
    const boxY = defFrontY + yard;
    const cbDepth = losPixY + yard * 2.2;
    const slotDepth = losPixY + yard * 3.5;
    const safetyDepth = losPixY + yard * 10;

    const wr1X = off.WR1?.pos?.x ?? wideLeftX;
    const wr2X = off.WR2?.pos?.x ?? wideRightX;
    const wr3X = off.WR3?.pos?.x ?? (slotRightX + 20);

    // default nickel look
    setP(def.LE, (ltX ?? startX) - 10, defFrontY);
    setP(def.DT, centerX - 18, defFrontY);
    setP(def.RTk, centerX + 18, defFrontY);
    setP(def.RE, (rtX ?? startX + 4 * spacingX) + 10, defFrontY);
    setP(def.LB1, midX - 32, lbY);
    setP(def.LB2, midX + 32, lbY);
    setP(def.CB1, wr1X, cbDepth);
    setP(def.CB2, wr2X, cbDepth);
    setP(def.S1, midX - 70, safetyDepth);
    setP(def.S2, midX + 70, safetyDepth);
    setP(def.NB, wr3X, slotDepth);

    switch (defFormation) {
        case 'Dime 3-2-6': {
            setP(def.LE, midX - 46, defFrontY + yard * 0.5);
            setP(def.DT, centerX - 12, defFrontY);
            setP(def.RTk, centerX + 12, defFrontY);
            setP(def.RE, midX + 46, defFrontY + yard * 0.5);
            setP(def.LB1, midX - 18, lbY + yard * 0.4);
            setP(def.LB2, midX + 18, lbY + yard * 0.4);
            const dimeDepth = losPixY + yard * 12;
            setP(def.CB1, wr1X, losPixY + yard * 3);
            setP(def.CB2, wr2X, losPixY + yard * 3);
            setP(def.NB, wr3X + 12, losPixY + yard * 6.5);
            setP(def.S1, midX - 90, dimeDepth);
            setP(def.S2, midX + 90, dimeDepth);
            break;
        }
        case 'Base 4-3': {
            setP(def.LE, (ltX ?? startX) - 12, defFrontY);
            setP(def.RE, (rtX ?? startX + 4 * spacingX) + 12, defFrontY);
            setP(def.DT, centerX - 20, defFrontY);
            setP(def.RTk, centerX + 20, defFrontY);
            setP(def.LB1, midX - 26, lbY - yard * 0.6);
            setP(def.LB2, midX + 26, lbY - yard * 0.6);
            setP(def.NB, midX, lbY - yard * 0.8);
            setP(def.S1, midX - 60, safetyDepth - yard * 1.5);
            setP(def.S2, midX + 60, safetyDepth - yard * 1.5);
            break;
        }
        case 'Bear 46': {
            setP(def.LE, ltX - 6, defFrontY);
            setP(def.DT, centerX - 8, defFrontY);
            setP(def.RTk, centerX + 8, defFrontY);
            setP(def.RE, rtX + 6, defFrontY);
            setP(def.LB1, midX - 18, boxY);
            setP(def.LB2, midX + 18, boxY);
            setP(def.NB, wr3X, losPixY + yard * 4.2);
            setP(def.S1, midX - 40, losPixY + yard * 6);
            setP(def.S2, midX + 40, losPixY + yard * 6);
            setP(def.CB1, wr1X, losPixY + yard * 2.2);
            setP(def.CB2, wr2X, losPixY + yard * 2.2);
            break;
        }
        case 'Cover-2 Shell': {
            setP(def.LB1, midX - 28, lbY);
            setP(def.LB2, midX + 28, lbY);
            setP(def.NB, wr3X, losPixY + yard * 5);
            const shellDepth = losPixY + yard * 14;
            setP(def.S1, midX - 80, shellDepth);
            setP(def.S2, midX + 80, shellDepth);
            setP(def.CB1, wr1X - 8, losPixY + yard * 3.2);
            setP(def.CB2, wr2X + 8, losPixY + yard * 3.2);
            break;
        }
        default:
            break;
    }

    return { off, def, offFormation, defFormation };
}
