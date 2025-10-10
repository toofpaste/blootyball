import { TEAM_RED, TEAM_BLK, ROLES_OFF, ROLES_DEF } from './constants';
import { clamp, rand, yardsToPixX, yardsToPixY, } from './helpers';
import { ENDZONE_YARDS, FIELD_PIX_W } from './constants';

export function createRosters() {
    const makeAttrs = (base = 0) => ({
        speed: clamp(rand(4.5, 6) + base, 4, 8),
        accel: clamp(rand(10, 20), 8, 25),
        agility: clamp(rand(0.6, 1), 0.5, 1.2),
        strength: clamp(rand(0.5, 1), 0.5, 1.2),
        awareness: clamp(rand(0.5, 1), 0.4, 1.3),
        catch: clamp(rand(0.5, 1), 0.4, 1.2),
        throwPow: clamp(rand(0.6, 1), 0.5, 1.2),
        throwAcc: clamp(rand(0.5, 1), 0.4, 1.2),
        tackle: clamp(rand(0.5, 1), 0.4, 1.3),
    });
    const off = {}; const def = {};
    ROLES_OFF.forEach((r, i) => {
        off[r] = { id: r, team: TEAM_RED, role: r, attrs: makeAttrs(r === 'WR1' ? 0.4 : r === 'WR2' ? 0.3 : r === 'WR3' ? 0.1 : r === 'RB' ? 0.25 : 0), pos: { x: yardsToPixX(26 + i * 0.5), y: yardsToPixY(ENDZONE_YARDS + 20) }, v: { x: 0, y: 0 }, target: null, alive: true };
    });
    ROLES_DEF.forEach((r, i) => {
        def[r] = { id: r, team: TEAM_BLK, role: r, attrs: makeAttrs(r.startsWith('CB') || r.startsWith('S') ? 0.2 : 0), pos: { x: yardsToPixX(26 + i * 0.5), y: yardsToPixY(ENDZONE_YARDS + 24) }, v: { x: 0, y: 0 }, target: null, alive: true };
    });
    return { off, def };
}

export function lineUpFormation(roster, losPixY) {
    const midX = Math.round(FIELD_PIX_W / 2);
    const off = { ...roster.off };
    const def = { ...roster.def };
    const spacingX = 20; const startX = midX - 2 * spacingX; const olY = losPixY - yardsToPixY(1);

    const setP = (p, x, y) => {
        if (!p) return;
        p.pos = { x, y };
        p.v = { x: 0, y: 0 };
        p.home = { x, y };
    };

    // Offense
    setP(off.C, startX + 2 * spacingX, olY);
    setP(off.LG, startX + spacingX, olY);
    setP(off.RG, startX + 3 * spacingX, olY);
    setP(off.LT, startX, olY);
    setP(off.RT, startX + 4 * spacingX, olY);
    setP(off.QB, (off.C?.pos?.x ?? startX + 2 * spacingX), olY - yardsToPixY(3));
    setP(off.RB, (off.C?.pos?.x ?? startX + 2 * spacingX), olY - yardsToPixY(5));
    setP(off.TE, (off.RT?.pos?.x ?? startX + 4 * spacingX) + 18, olY);
    setP(off.WR1, 40, olY);
    setP(off.WR2, FIELD_PIX_W - 40, olY);
    setP(off.WR3, midX + 130, olY - 30);

    // Defense
    const defFrontY = losPixY + yardsToPixY(1.5);
    setP(def.LE, off.LT?.pos?.x - 10, defFrontY);
    setP(def.DT, off.C?.pos?.x - 22, defFrontY);
    setP(def.RTk, off.C?.pos?.x + 22, defFrontY);
    setP(def.RE, off.RT?.pos?.x + 10, defFrontY);

    const lbY = defFrontY + yardsToPixY(2.5);
    setP(def.LB1, midX - 30, lbY);
    setP(def.LB2, midX + 30, lbY);

    setP(def.CB1, off.WR1?.pos?.x ?? 40, losPixY + yardsToPixY(2));
    setP(def.CB2, off.WR2?.pos?.x ?? (FIELD_PIX_W - 40), losPixY + yardsToPixY(2));

    const sY = losPixY + yardsToPixY(10);
    setP(def.S1, midX - 60, sY);
    setP(def.S2, midX + 60, sY);
    setP(def.NB, off.WR3?.pos?.x ?? (midX + 130), losPixY + yardsToPixY(4));

    return { off, def };
}
