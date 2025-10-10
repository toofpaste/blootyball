// src/engine/playbooks.js
import { PX_PER_YARD } from './constants';

/** Extra plays to extend your existing PLAYBOOK (keeps existing names intact). */
export const PLAYBOOK_PLUS = [
    // --- QUICK GAME (PASS) ---
    {
        name: 'Stick (2x2)', type: 'PASS', quickGame: true, primary: 'TE',
        wrRoutes: { WR1: [{ dx: -2, dy: 5 }], WR2: [{ dx: 2, dy: 5 }], WR3: [{ dx: 4, dy: 2 }] },
        teRoute: [{ dx: 0, dy: 5 }], rbCheckdown: [{ dx: -2, dy: 2 }], qbDrop: 3
    },
    {
        name: 'Spacing (Trips)', type: 'PASS', quickGame: true, primary: 'WR3',
        wrRoutes: { WR1: [{ dx: -6, dy: 4 }], WR2: [{ dx: -2, dy: 4 }], WR3: [{ dx: 2, dy: 4 }] },
        teRoute: [{ dx: 0, dy: 4 }], rbCheckdown: [{ dx: 3, dy: 2 }], qbDrop: 3
    },

    // --- CORE DROPBACK ---
    {
        name: 'Flood (Trips Right)', type: 'PASS', primary: 'WR2',
        wrRoutes: { WR1: [{ dx: -10, dy: 10 }], WR2: [{ dx: 8, dy: 14 }], WR3: [{ dx: 3, dy: 6 }] },
        teRoute: [{ dx: -4, dy: 8 }], rbCheckdown: [{ dx: -2, dy: 2 }], qbDrop: 6
    },
    {
        name: 'Levels (2x2)', type: 'PASS', primary: 'WR1',
        wrRoutes: { WR1: [{ dx: -6, dy: 12 }], WR2: [{ dx: 6, dy: 10 }], WR3: [{ dx: 2, dy: 6 }] },
        teRoute: [{ dx: -2, dy: 6 }], rbCheckdown: [{ dx: 2, dy: 2 }], qbDrop: 6
    },
    {
        name: 'Dagger (2x2)', type: 'PASS', primary: 'WR2',
        wrRoutes: { WR1: [{ dx: -4, dy: 8 }], WR2: [{ dx: 6, dy: 16 }], WR3: [{ dx: 2, dy: 6 }] },
        teRoute: [{ dx: -6, dy: 14 }], rbCheckdown: [{ dx: 3, dy: 3 }], qbDrop: 7
    },
    {
        name: 'Smash (2x2)', type: 'PASS', primary: 'WR2',
        wrRoutes: { WR1: [{ dx: -8, dy: 4 }], WR2: [{ dx: 8, dy: 12 }], WR3: [{ dx: -2, dy: 10 }] },
        teRoute: [{ dx: 2, dy: 5 }], rbCheckdown: [{ dx: -2, dy: 2 }], qbDrop: 5
    },

    // --- PLAY ACTION ---
    {
        name: 'PA Shot Post', type: 'PASS', playAction: true, primary: 'WR1',
        wrRoutes: { WR1: [{ dx: -2, dy: 18 }], WR2: [{ dx: 6, dy: 12 }], WR3: [{ dx: -3, dy: 6 }] },
        teRoute: [{ dx: 0, dy: 10 }], rbCheckdown: [{ dx: 2, dy: 2 }], qbDrop: 7
    },
    {
        name: 'PA Cross (TE Over)', type: 'PASS', playAction: true, primary: 'TE',
        wrRoutes: { WR1: [{ dx: -8, dy: 12 }], WR2: [{ dx: 8, dy: 12 }], WR3: [{ dx: 2, dy: 6 }] },
        teRoute: [{ dx: 6, dy: 14 }], rbCheckdown: [{ dx: -3, dy: 3 }], qbDrop: 6
    },

    // --- RUN GAME ---
    {
        name: 'Power O', type: 'RUN', handoffTo: 'RB',
        rbPath: [{ dx: -2, dy: 3 }, { dx: -4, dy: 8 }]
    },
    {
        name: 'Counter GT', type: 'RUN', handoffTo: 'RB',
        rbPath: [{ dx: 4, dy: 2 }, { dx: -4, dy: 8 }]
    },
    {
        name: 'Stretch (Outside Zone)', type: 'RUN', handoffTo: 'RB',
        rbPath: [{ dx: 6, dy: 1 }, { dx: 8, dy: 6 }]
    },
    {
        name: 'Draw (from Gun)', type: 'RUN', handoffTo: 'RB',
        rbPath: [{ dx: 0, dy: 2 }, { dx: 0, dy: 8 }]
    },
];

/** Offense formations (names only; positioning done in rosters.js helper). */
export const OFF_FORMATIONS = [
    'I-Form Twins', 'Trips Right', 'Trips Left', '2x2 Gun', 'Empty 3x2', 'Bunch Right', 'Bunch Left', 'Heavy TE Right', 'Heavy TE Left'
];

/** Defense formations (names only; positioning done in rosters.js helper). */
export const DEF_FORMATIONS = [
    'Nickel 2-4-5', 'Dime 3-2-6', 'Base 4-3', 'Bear 46', 'Cover-2 Shell'
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
    if (long) defPool.push('Dime 3-2-6', 'Nickel 2-4-5');
    if (short) defPool.push('Base 4-3', 'Bear 46');
    if (redzone) defPool.push('Cover-2 Shell', 'Base 4-3');
    if (!defPool.length) defPool.push('Nickel 2-4-5');

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
    const { down, toGo, yardline, offenseIQ = 1.0 } = ctx;
    const long = toGo >= 7;
    const short = toGo <= 2;
    const redzone = yardline >= 80;

    // Score each play for the situation
    function score(p) {
        let s = 0;
        if (p.type === 'RUN') {
            s += short ? 12 : long ? -8 : 2;
            if (p.name.includes('Stretch') || p.name.includes('Outside')) s += 2;
            if (redzone) s += 3;
        } else { // PASS
            s += long ? 12 : short ? -4 : 2;
            if (p.quickGame) s += short ? 4 : (long ? -2 : 1);
            if (p.playAction) s += (!long && !short) ? 3 : (short ? 2 : 0);
            if (redzone) s += p.name.includes('Smash') || p.name.includes('Spacing') ? 3 : 0;
        }
        // small randomness
        s += (Math.random() - 0.5) * 2;
        return s;
    }

    const plays = allPlays.slice();
    plays.sort((a, b) => score(b) - score(a));

    // IQ nudges: higher IQ → pick closer to top
    const r = Math.random() ** (1 / Math.max(0.01, Math.min(1.6, offenseIQ)));
    const idx = Math.floor(r * Math.min(6, plays.length)); // choose among top 6
    return plays[idx];
}
