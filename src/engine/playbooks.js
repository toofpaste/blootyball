// src/engine/playbooks.js
import { PX_PER_YARD } from './constants';

/** Extra plays to extend your existing PLAYBOOK (keeps existing names intact). */
export const PLAYBOOK_PLUS = [
    // --- QUICK / INTERMEDIATE PASS ---
    {
        name: 'Sail Switch (Trips)',
        type: 'PASS',
        quickGame: true,
        primary: 'WR2',
        wrRoutes: {
            WR1: [
                { dx: -1, dy: 4, label: 'Switch Release' },
                { dx: 6, dy: 11, label: 'Switch Go' },
            ],
            WR2: [
                { dx: 2, dy: 6, label: 'Sail Stem' },
                { dx: 8, dy: 5, label: 'Sail Break' },
            ],
            WR3: [
                { dx: 4, dy: 2, label: 'Flat Stem' },
                { dx: 6, dy: 1, settle: true },
            ],
        },
        teRoute: [
            { dx: -3, dy: 5, label: 'Backside Post Stem' },
            { dx: -9, dy: 6, label: 'Backside Post' },
        ],
        rbCheckdown: [
            { dx: -4, dy: 2 },
            { dx: -6, dy: 3 },
        ],
        qbDrop: 5,
    },
    {
        name: 'Drive Scissors',
        type: 'PASS',
        primary: 'WR1',
        wrRoutes: {
            WR1: [
                { dx: -1, dy: 6, label: 'Drive Stem' },
                { dx: -5, dy: 6, label: 'Dig' },
            ],
            WR2: [
                { dx: 3, dy: 3, label: 'Shallow' },
                { dx: 9, dy: 2, settle: true },
            ],
            WR3: [
                { dx: 5, dy: 6, label: 'Scissors Stem' },
                { dx: 8, dy: 8, label: 'Post' },
            ],
        },
        teRoute: [
            { dx: 0, dy: 5, settle: true },
        ],
        rbCheckdown: [
            { dx: -5, dy: 2 },
            { dx: -6, dy: 2 },
        ],
        qbDrop: 5,
    },

    // --- POWER / GAP RUNS ---
    {
        name: 'Duo Insert',
        type: 'RUN',
        handoffTo: 'RB',
        rbPath: [
            { dx: 0, dy: 2 },
            { dx: 1, dy: 3 },
            { dx: -1, dy: 4 },
            { dx: -1, dy: 3 },
        ],
        wrRoutes: {
            WR1: [
                { dx: -1, dy: 3 },
                { dx: -2, dy: 4 },
            ],
            WR2: [
                { dx: 2, dy: 2 },
                { dx: 3, dy: 4 },
            ],
            WR3: [
                { dx: -2, dy: 1 },
                { dx: -2, dy: 3 },
            ],
        },
        teRoute: [
            { dx: 2, dy: 1 },
            { dx: 1, dy: 3 },
            { dx: -1, dy: 3 },
        ],
        qbDrop: 1,
    },
    {
        name: 'Crack Toss',
        type: 'RUN',
        handoffTo: 'RB',
        rbPath: [
            { dx: 6, dy: 1 },
            { dx: 10, dy: 4 },
            { dx: 8, dy: 4 },
        ],
        wrRoutes: {
            WR1: [
                { dx: -2, dy: 3 },
                { dx: -5, dy: 6 },
            ],
            WR2: [
                { dx: 4, dy: 2 },
                { dx: 8, dy: 3 },
            ],
            WR3: [
                { dx: -1, dy: 1 },
                { dx: -1, dy: 4 },
            ],
        },
        teRoute: [
            { dx: 5, dy: 2 },
            { dx: 9, dy: 3 },
        ],
        qbDrop: 1,
    },

    // --- SHOT / PLAY-ACTION GAME ---
    {
        name: 'Bunch Switch Verts',
        type: 'PASS',
        primary: 'WR2',
        wrRoutes: {
            WR1: [
                { dx: 2, dy: 5, label: 'Point Seam' },
                { dx: 2, dy: 12 },
            ],
            WR2: [
                { dx: 5, dy: 4, label: 'Switch Go' },
                { dx: 8, dy: 12 },
            ],
            WR3: [
                { dx: 1, dy: 4, label: 'Choice Stem' },
                { dx: -4, dy: 4, option: 'in-or-out', settle: true },
            ],
        },
        teRoute: [
            { dx: -4, dy: 6, label: 'Backside Dig Stem' },
            { dx: -7, dy: 8, label: 'Backside Dig' },
        ],
        rbCheckdown: [
            { dx: 4, dy: 2 },
            { dx: 6, dy: 3 },
        ],
        qbDrop: 7,
    },
    {
        name: 'PA Yankee Shot',
        type: 'PASS',
        playAction: true,
        primary: 'WR2',
        wrRoutes: {
            WR1: [
                { dx: -2, dy: 8, label: 'Post Stem' },
                { dx: -8, dy: 12, label: 'Post' },
            ],
            WR2: [
                { dx: 4, dy: 6, label: 'Over Stem' },
                { dx: 10, dy: 14, label: 'Deep Over' },
            ],
            WR3: [
                { dx: 6, dy: 8, label: 'Clear Go' },
                { dx: 6, dy: 10 },
            ],
        },
        teRoute: [
            { dx: -1, dy: 4, label: 'Under' },
            { dx: -4, dy: 6, settle: true },
        ],
        rbCheckdown: [
            { dx: 5, dy: 2 },
            { dx: 7, dy: 5 },
        ],
        qbDrop: 7,
    },
];

/** Offense formations (names only; positioning done in rosters.js helper). */
export const OFF_FORMATIONS = [
    'I-Form Twins', 'Trips Right', 'Trips Left', '2x2 Gun', 'Empty 3x2', 'Bunch Right', 'Bunch Left', 'Heavy TE Right', 'Heavy TE Left'
];

/** Defense formations (names only; positioning done in rosters.js helper). */
export const DEF_FORMATIONS = [
    'Nickel 2-4-5',
    'Nickel 3-3-5',
    'Dime 3-2-6',
    'Base 4-3',
    'Bear 46',
    'Cover-2 Shell',
    'Cover-3 Sky',
    'Cover-4 Quarters',
    '2-Man Under',
];

/** Default "coaches" used if you don't plug in custom ones. */
export function defaultCoaches() {
    return {
        offenseName: 'Coach Riley',
        defenseName: 'Coach Fangio',
        offenseIQ: 1.05,  // 0.6 - 1.4 typical
        defenseIQ: 1.00,
    };
}

/** Choose formations based on situation + coach IQ */
export function pickFormations(ctx) {
    const { down, toGo, yardline, offenseIQ = 1.0, defenseIQ = 1.0 } = ctx;
    const long = toGo >= 7;
    const short = toGo <= 2;
    const redzone = yardline >= 80;

    const offPool = [];
    if (short) offPool.push('Heavy TE Right', 'I-Form Twins');
    if (long) offPool.push('2x2 Gun', 'Empty 3x2', 'Trips Right', 'Trips Left');
    if (redzone) offPool.push('Bunch Right', 'Bunch Left', '2x2 Gun');
    if (!offPool.length) offPool.push('2x2 Gun', 'Trips Right');

    const defPool = [];
    if (long) defPool.push('Dime 3-2-6', 'Nickel 3-3-5', 'Cover-3 Sky', 'Cover-4 Quarters');
    if (short) defPool.push('Base 4-3', 'Bear 46', '2-Man Under');
    if (redzone) defPool.push('Cover-2 Shell', 'Cover-4 Quarters', '2-Man Under');
    if (!long && !short) defPool.push('Nickel 2-4-5', 'Cover-3 Sky');
    if (!defPool.length) defPool.push('Nickel 2-4-5', 'Cover-3 Sky');

    // IQ nudges: higher IQ biases toward the first half of lists (more optimal)
    function biasedPick(pool, iq) {
        if (pool.length === 1) return pool[0];
        const r = Math.random() ** (1 / Math.max(0.01, Math.min(1.6, iq)));
        const idx = Math.floor(r * pool.length);
        return pool[Math.min(idx, pool.length - 1)];
    }

    return {
        offFormation: biasedPick(offPool, offenseIQ),
        defFormation: biasedPick(defPool, defenseIQ),
    };
}

/** pickPlayCall returns one play from [...PLAYBOOK, ...PLAYBOOK_PLUS] */
export function pickPlayCall(allPlays, ctx) {
    const {
        down,
        toGo,
        yardline,
        offenseIQ = 1.0,
        relationships = null,
        personnel = null,
        coachTendencies = null,
    } = ctx;
    const long = toGo >= 7;
    const short = toGo <= 2;
    const redzone = yardline >= 80;
    const firstDown = down === 1;
    const medium = !long && !short;

    const qbId = personnel?.qbId || null;
    const runnerId = personnel?.runnerId || null;
    const receivers = personnel?.receivers || {};
    const passMap = relationships?.passing || {};
    const runMap = relationships?.rushing || {};
    const passBias = coachTendencies?.passBias ?? 0;
    const runBias = coachTendencies?.runBias ?? 0;
    const aggression = coachTendencies?.aggression ?? 0;

    function chemistryForPlay(play) {
        if (!qbId || !play?.primary) return 0;
        const target = receivers[play.primary];
        if (!target?.id) return 0;
        return passMap[qbId]?.[target.id] || 0;
    }

    const runMomentum = runnerId ? (runMap[runnerId] || 0) : 0;

    // Score each play for the situation
    function score(p) {
        let s = 0;
        if (p.type === 'RUN') {
            s += 4; // baseline preference to keep the ground game alive
            if (short) s += 10;
            else if (medium) s += 5;
            if (firstDown && !long) s += 4;
            if (long) s -= 5;
            if (/Zone|Toss|Sweep/i.test(p.name || '')) s += 2;
            if (redzone) s += 3;
            s += runMomentum * 12;
            s += runBias * 8;
        } else { // PASS
            s += long ? 10 : short ? -4 : 0;
            if (firstDown && !long) s -= 3;

            const drop = typeof p.qbDrop === 'number' ? p.qbDrop : 5;
            const deepPenalty = Math.max(0, drop - 5) * (medium ? 3 : 2);
            const isShotPlay = /Shot|Post|Yankee|Flood|Rail|Switch|Over/i.test(p.name || '');

            if (p.quickGame) {
                s += short ? 7 : medium ? 5 : 1;
            } else {
                if (short) s -= 5;
                if (medium) s -= 3;
            }

            s -= deepPenalty;
            if (isShotPlay && !long) s -= 4;
            if (p.playAction) s += (!long && !short) ? 2 : (short ? 1 : -2);
            if (redzone) s += /HOSS|Drive|Sail/i.test(p.name || '') ? 3 : 0;
            const chemistry = chemistryForPlay(p);
            s += chemistry * 14;
            s += passBias * 8;
            if (aggression) {
                s += aggression * (Math.max(0, drop - 4)) * 2;
                if (isShotPlay) s += aggression * 4;
            }
        }
        // small randomness
        s += (Math.random() - 0.5) * 2;
        return s;
    }

    const plays = allPlays.slice();
    plays.sort((a, b) => score(b) - score(a));

    const topLimit = Math.min(8, plays.length);
    const selection = plays.slice(0, topLimit);

    // Guarantee at least one run play remains in the weighted selection so the ground game
    // never disappears entirely even if passes score slightly higher in the current context.
    if (selection.length && !selection.some(p => p.type === 'RUN')) {
        const bestRun = plays.find(p => p.type === 'RUN');
        if (bestRun) {
            selection[selection.length - 1] = bestRun;
        }
    }

    // IQ nudges: higher IQ → pick closer to top
    const r = Math.random() ** (1 / Math.max(0.01, Math.min(1.6, offenseIQ)));
    const idx = Math.floor(r * selection.length);
    return selection[idx];
}
