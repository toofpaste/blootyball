import { TEAM_RED, TEAM_BLK, ROLES_OFF, ROLES_DEF } from './constants';
import { clamp, rand, yardsToPixY } from './helpers';
import { ENDZONE_YARDS, FIELD_PIX_W } from './constants';

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
    return {
        id: `${team}-${role}-${_pid++}`,
        team,
        role,
        attrs: makeAttrs(role),
        pos: { x: FIELD_PIX_W / 2, y: yardsToPixY(ENDZONE_YARDS + 20) },
        v: { x: 0, y: 0 },
        home: null,
        alive: true,
    };
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
    ROLES_OFF.forEach(r => { off[r] = { ...teams[offenseTeam].off[r] }; });
    ROLES_DEF.forEach(r => { def[r] = { ...teams[defenseTeam].def[r] }; });
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
export function lineUpFormation(roster, losPixY) {
    const midX = Math.round(FIELD_PIX_W / 2);
    const off = { ...roster.off };
    const def = { ...roster.def };

    const spacingX = 20;
    const startX = midX - 2 * spacingX;
    const olY = losPixY - yardsToPixY(1);

    const setP = (p, x, y) => {
        if (!p) return;
        p.pos = { x, y };
        p.v = { x: 0, y: 0 };
        p.home = { x, y };
    };

    // Offensive line
    setP(off.C, startX + 2 * spacingX, olY);
    setP(off.LG, startX + 1 * spacingX, olY);
    setP(off.RG, startX + 3 * spacingX, olY);
    setP(off.LT, startX + 0 * spacingX, olY);
    setP(off.RT, startX + 4 * spacingX, olY);

    // QB/RB
    setP(off.QB, (off.C?.pos?.x ?? startX + 2 * spacingX), olY - yardsToPixY(3));
    setP(off.RB, (off.C?.pos?.x ?? startX + 2 * spacingX), olY - yardsToPixY(5));

    // TE/WR
    setP(off.TE, (off.RT?.pos?.x ?? startX + 4 * spacingX) + 18, olY);
    setP(off.WR1, 40, olY);
    setP(off.WR2, FIELD_PIX_W - 40, olY);
    setP(off.WR3, midX + 130, olY - 30);

    // Defensive front
    const defFrontY = losPixY + yardsToPixY(1.5);
    setP(def.LE, (off.LT?.pos?.x ?? startX) - 10, defFrontY);
    setP(def.DT, (off.C?.pos?.x ?? startX + 2 * spacingX) - 22, defFrontY);
    setP(def.RTk, (off.C?.pos?.x ?? startX + 2 * spacingX) + 22, defFrontY);
    setP(def.RE, (off.RT?.pos?.x ?? startX + 4 * spacingX) + 10, defFrontY);

    // LBs
    const lbY = defFrontY + yardsToPixY(2.5);
    setP(def.LB1, midX - 30, lbY);
    setP(def.LB2, midX + 30, lbY);

    // DBs
    setP(def.CB1, off.WR1?.pos?.x ?? 40, losPixY + yardsToPixY(2));
    setP(def.CB2, off.WR2?.pos?.x ?? (FIELD_PIX_W - 40), losPixY + yardsToPixY(2));

    const sY = losPixY + yardsToPixY(10);
    setP(def.S1, midX - 60, sY);
    setP(def.S2, midX + 60, sY);
    setP(def.NB, off.WR3?.pos?.x ?? (midX + 130), losPixY + yardsToPixY(4));

    return { off, def };
}
