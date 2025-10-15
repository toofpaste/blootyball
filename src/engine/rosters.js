import { TEAM_RED, TEAM_BLK, ROLES_OFF, ROLES_DEF } from './constants';
import { clamp, rand, yardsToPixY } from './helpers';
import { ENDZONE_YARDS, FIELD_PIX_W } from './constants';
import { resetMotion } from './motion';
import { getTeamData, getTeamIdentity } from './data/teamLibrary';
import { initializeLeaguePersonnel } from './personnel';

/* =========================================================
   Player factories (persistent per-team pools)
   ========================================================= */
function normaliseAttrs(ratings = {}, role) {
    return {
        speed: clamp(ratings.speed ?? (role.startsWith('WR') ? 5.8 : 5.4), 4.2, 7.2),
        accel: clamp(ratings.accel ?? rand(12, 17), 10, 22),
        agility: clamp(ratings.agility ?? rand(0.7, 1.0), 0.5, 1.25),
        strength: clamp(ratings.strength ?? rand(0.7, 1.05), 0.5, 1.3),
        awareness: clamp(ratings.awareness ?? rand(0.8, 1.05), 0.4, 1.35),
        catch: clamp(ratings.catch ?? rand(0.6, 1.0), 0.4, 1.3),
        throwPow: clamp(ratings.throwPow ?? rand(0.5, 1.0), 0.4, 1.3),
        throwAcc: clamp(ratings.throwAcc ?? rand(0.5, 1.0), 0.4, 1.3),
        tackle: clamp(ratings.tackle ?? rand(0.6, 1.1), 0.4, 1.35),
    };
}

const ROLE_BODY_TEMPLATES = {
    QB: { height: [73, 77], weight: [205, 235] },
    RB: { height: [69, 73], weight: [198, 222] },
    WR: { height: [70, 75], weight: [185, 210] },
    TE: { height: [75, 79], weight: [238, 265] },
    OL: { height: [75, 80], weight: [295, 330] },
    DL: { height: [74, 79], weight: [275, 310] },
    LB: { height: [72, 77], weight: [230, 255] },
    DB: { height: [70, 74], weight: [188, 208] },
    DEFAULT: { height: [71, 75], weight: [200, 225] },
};

function roleToBodyTemplate(role = '') {
    if (/^WR/.test(role)) return ROLE_BODY_TEMPLATES.WR;
    if (/^CB/.test(role) || /^S/.test(role) || role === 'NB') return ROLE_BODY_TEMPLATES.DB;
    if (/^LB/.test(role)) return ROLE_BODY_TEMPLATES.LB;
    if (/^RTk$/.test(role) || /^DT$/.test(role)) return ROLE_BODY_TEMPLATES.DL;
    if (/^LE$/.test(role) || /^RE$/.test(role)) return ROLE_BODY_TEMPLATES.DL;
    if (/^LT$/.test(role) || /^LG$/.test(role) || /^RG$/.test(role) || /^RT$/.test(role) || role === 'C') return ROLE_BODY_TEMPLATES.OL;
    if (role === 'RB') return ROLE_BODY_TEMPLATES.RB;
    if (role === 'TE') return ROLE_BODY_TEMPLATES.TE;
    if (role === 'QB') return ROLE_BODY_TEMPLATES.QB;
    return ROLE_BODY_TEMPLATES.DEFAULT;
}

function resolvePhysicalProfile(role, body = {}) {
    const template = roleToBodyTemplate(role) || ROLE_BODY_TEMPLATES.DEFAULT;
    const [minH, maxH] = template.height;
    const [minW, maxW] = template.weight;
    const height = clamp(body.height ?? rand(minH, maxH), minH, maxH);
    const weight = clamp(body.weight ?? rand(minW, maxW), minW, maxW);
    const mass = clamp(weight / 220, 0.55, 1.95);
    const radius = clamp(7 + (height - 70) * 0.32, 6.5, 11.5);
    return {
        height,
        weight,
        mass,
        radius,
    };
}

function makePlayer(team, role, data = {}, meta = {}) {
    const firstName = data.firstName || role;
    const lastName = data.lastName || '';
    const id = data.id || `${team}-${role}`;
    const profile = {
        firstName,
        lastName,
        fullName: `${firstName}${lastName ? ` ${lastName}` : ''}`,
        number: data.number ?? null,
    };

    const player = {
        id,
        team,
        role,
        attrs: normaliseAttrs(data.ratings || {}, role),
        modifiers: { ...(data.modifiers || {}) },
        profile,
        number: profile.number,
        pos: { x: FIELD_PIX_W / 2, y: yardsToPixY(ENDZONE_YARDS + 20) },
        v: { x: 0, y: 0 },
        home: null,
        alive: true,
    };

    player.baseAttrs = { ...player.attrs };

    player.phys = resolvePhysicalProfile(role, data.body || {});

    player.meta = {
        teamId: meta.teamId || null,
        teamSlot: team,
        colors: meta.colors || null,
        displayName: meta.displayName || null,
        abbr: meta.abbr || null,
    };
    player.temperament = data.temperament ? { ...data.temperament } : null;

    resetMotion(player);
    return player;
}

function makeKicker(team, data = {}, meta = {}) {
    const firstName = data.firstName || 'Kicker';
    const lastName = data.lastName || '';
    const id = data.id || `${team}-K`;
    const profile = {
        firstName,
        lastName,
        fullName: `${firstName}${lastName ? ` ${lastName}` : ''}`,
        number: data.number ?? null,
    };

    return {
        id,
        team,
        role: 'K',
        profile,
        number: profile.number,
        maxDistance: clamp(data.maxDistance ?? 50, 30, 70),
        accuracy: clamp(data.accuracy ?? 0.75, 0.4, 0.99),
        meta: {
            teamId: meta.teamId || null,
            teamSlot: team,
            colors: meta.colors || null,
            displayName: meta.displayName || null,
            abbr: meta.abbr || null,
        },
        temperament: data.temperament ? { ...data.temperament } : null,
    };
}

/* =========================================================
   Public API (kept compatible) + new helpers for possession
   ========================================================= */

/** Build both full team pools once */
export function createTeams(matchup = null, league = null) {
    const slotToTeam = matchup?.slotToTeam || { [TEAM_RED]: TEAM_RED, [TEAM_BLK]: TEAM_BLK };
    const identities = matchup?.identities || {};
    if (league) initializeLeaguePersonnel(league);
    const leagueRosters = league?.teamRosters || null;

    const buildSide = (team) => {
        const actualId = slotToTeam[team] || team;
        const rosterSource = leagueRosters?.[actualId] || null;
        const teamData = rosterSource ? null : (getTeamData(actualId) || {});
        const identity = identities[team] || getTeamIdentity(actualId) || { id: actualId, displayName: actualId };
        const off = {}; const def = {};
        ROLES_OFF.forEach((r) => {
            const data = rosterSource?.offense?.[r] || teamData?.offense?.[r] || {};
            off[r] = makePlayer(team, r, data, {
                teamId: actualId,
                colors: identity.colors,
                displayName: identity.displayName,
                abbr: identity.abbr,
            });
        });
        ROLES_DEF.forEach((r) => {
            const data = rosterSource?.defense?.[r] || teamData?.defense?.[r] || {};
            def[r] = makePlayer(team, r, data, {
                teamId: actualId,
                colors: identity.colors,
                displayName: identity.displayName,
                abbr: identity.abbr,
            });
        });
        const kickerData = rosterSource?.special?.K || teamData?.specialTeams?.K || {};
        const special = {
            K: makeKicker(team, kickerData, {
                teamId: actualId,
                colors: identity.colors,
                displayName: identity.displayName,
                abbr: identity.abbr,
            }),
        };
        return { off, def, special };
    };
    return {
        [TEAM_RED]: buildSide(TEAM_RED),
        [TEAM_BLK]: buildSide(TEAM_BLK),
    };
}

export function buildPlayerDirectory(teams, slotToTeam = {}, identities = {}) {
    const dir = {};
    if (!teams) return dir;
    Object.entries(teams).forEach(([team, group]) => {
        if (!group) return;
        const register = (collection, side) => {
            Object.entries(collection || {}).forEach(([role, player]) => {
                if (!player) return;
                const actualTeamId = player.meta?.teamId || slotToTeam[team] || team;
                const identity = identities[team] || getTeamIdentity(actualTeamId) || { displayName: actualTeamId, abbr: actualTeamId };
                const profile = player.profile || {};
                const firstName = profile.firstName || player.firstName || role;
                const lastName = profile.lastName || player.lastName || '';
                const fullName = profile.fullName || player.fullName || `${firstName}${lastName ? ` ${lastName}` : ''}` || role;
                dir[player.id] = {
                    team: actualTeamId,
                    teamSlot: team,
                    role,
                    side,
                    firstName,
                    lastName,
                    fullName,
                    number: profile.number ?? player.number ?? null,
                    teamName: identity.displayName || actualTeamId,
                    teamAbbr: identity.abbr || actualTeamId,
                };
            });
        };
        register(group.off, 'offense');
        register(group.def, 'defense');
        if (group.special?.K) {
            const k = group.special.K;
            const actualTeamId = k.meta?.teamId || slotToTeam[team] || team;
            const identity = identities[team] || getTeamIdentity(actualTeamId) || { displayName: actualTeamId, abbr: actualTeamId };
            const profile = k.profile || {};
            const firstName = profile.firstName || k.firstName || 'Kicker';
            const lastName = profile.lastName || k.lastName || '';
            const fullName = profile.fullName || k.fullName || `${firstName}${lastName ? ` ${lastName}` : ''}` || 'Kicker';
            dir[k.id] = {
                team: actualTeamId,
                teamSlot: team,
                role: 'K',
                side: 'special',
                firstName,
                lastName,
                fullName,
                number: profile.number ?? k.number ?? null,
                teamName: identity.displayName || actualTeamId,
                teamAbbr: identity.abbr || actualTeamId,
            };
        }
    });
    return dir;
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
        if (base.baseAttrs) off[r].baseAttrs = { ...base.baseAttrs };
        resetMotion(off[r]);
    });
    ROLES_DEF.forEach(r => {
        const base = teams[defenseTeam].def[r];
        def[r] = { ...base, pos: { ...base.pos }, home: base.home ? { ...base.home } : null };
        if (base.baseAttrs) def[r].baseAttrs = { ...base.baseAttrs };
        resetMotion(def[r]);
    });
    const special = {};
    if (teams[offenseTeam].special?.K) {
        const base = teams[offenseTeam].special.K;
        special.K = { ...base };
    }
    return { off, def, special };
}

/**
 * Backward-compat wrapper some code still uses.
 * Creates two teams and returns the RED-offense snapshot.
 */
export function createRosters(matchup = null, league = null) {
    const teams = createTeams(matchup, league);
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
        case 'Nickel 3-3-5': {
            setP(def.LE, midX - 44, defFrontY + yard * 0.4);
            setP(def.DT, centerX - 6, defFrontY);
            setP(def.RTk, midX + 18, lbY + yard * 0.2);
            setP(def.RE, midX + 44, defFrontY + yard * 0.4);
            setP(def.LB1, midX - 22, lbY + yard * 0.3);
            setP(def.LB2, midX + 22, lbY + yard * 0.3);
            setP(def.NB, midX, lbY + yard * 0.1);
            setP(def.CB1, wr1X - 4, losPixY + yard * 3.2);
            setP(def.CB2, wr2X + 4, losPixY + yard * 3.2);
            setP(def.S1, midX - 70, safetyDepth + yard);
            setP(def.S2, midX + 70, safetyDepth + yard);
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
        case 'Cover-3 Sky': {
            const slotDir = wr3X >= midX ? 1 : -1;
            setP(def.LB1, midX - 30, lbY + yard * 0.3);
            setP(def.LB2, midX + 30, lbY + yard * 0.3);
            setP(def.NB, wr3X - slotDir * 6, losPixY + yard * 5.6);
            setP(def.CB1, wr1X - 6, losPixY + yard * 4.2);
            setP(def.CB2, wr2X + 6, losPixY + yard * 4.2);
            setP(def.S1, midX, losPixY + yard * 13.4);
            setP(def.S2, wr3X + slotDir * 16, losPixY + yard * 7);
            break;
        }
        case 'Cover-4 Quarters': {
            const slotDir = wr3X >= midX ? 1 : -1;
            setP(def.LB1, midX - 24, lbY + yard * 0.2);
            setP(def.LB2, midX + 24, lbY + yard * 0.2);
            setP(def.NB, wr3X + slotDir * 6, losPixY + yard * 7.4);
            setP(def.CB1, wr1X - 6, losPixY + yard * 4.6);
            setP(def.CB2, wr2X + 6, losPixY + yard * 4.6);
            setP(def.S1, midX - 58, losPixY + yard * 13.8);
            setP(def.S2, midX + 58, losPixY + yard * 13.8);
            break;
        }
        case '2-Man Under': {
            setP(def.LB1, midX - 26, lbY - yard * 0.3);
            setP(def.LB2, midX + 26, lbY - yard * 0.3);
            setP(def.NB, wr3X, losPixY + yard * 2.6);
            setP(def.CB1, wr1X - 2, losPixY + yard * 2.2);
            setP(def.CB2, wr2X + 2, losPixY + yard * 2.2);
            setP(def.S1, midX - 78, losPixY + yard * 13.2);
            setP(def.S2, midX + 78, losPixY + yard * 13.2);
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
