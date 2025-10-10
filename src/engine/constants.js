// src/engine/constants.js
export const FIELD_YARDS_W = 53.3;   // 160 ft
export const FIELD_YARDS_H = 120;    // 100 + 2*10 endzones
export const PLAYING_YARDS_H = 100;
export const ENDZONE_YARDS = 10;

// ↓ Smaller, crisper field
export const PX_PER_YARD = 6;

export const FIELD_PIX_W = Math.round(FIELD_YARDS_W * PX_PER_YARD);
export const FIELD_PIX_H = Math.round(FIELD_YARDS_H * PX_PER_YARD);

// Landscape renderer shows the whole portrait field rotated
export const FIELD_PIX_H_VIEW = FIELD_PIX_H;

export const OFFENSE_DIR = 1;
export const TEAM_RED = 'RED';
export const TEAM_BLK = 'BLK';

export const ROLES_OFF = ['QB', 'RB', 'WR1', 'WR2', 'WR3', 'TE', 'LT', 'LG', 'C', 'RG', 'RT'];
export const ROLES_DEF = ['LE', 'DT', 'RTk', 'RE', 'LB1', 'LB2', 'CB1', 'CB2', 'S1', 'S2', 'NB'];

export const COLORS = {
    fieldGreen: '#0a7f2e',
    lineWhite: '#ffffff',
    hash: '#dfe',
    red: '#e53935',
    black: '#222',
    ball: '#8B4513',
    text: '#f8f8f8',
    shadow: 'rgba(0,0,0,0.35)',
};

// (playbook + routes helpers unchanged)


// Built-in playbook (unchanged)
export const PLAYBOOK = [
    { name: 'Inside Zone', type: 'RUN', handoffTo: 'RB', rbPath: [{ dx: 0, dy: 10 }], wrRoutes: routesAllHitches(), teRoute: [{ dx: 0, dy: 6 }], qbDrop: 2 },
    { name: 'Outside Zone', type: 'RUN', handoffTo: 'RB', rbPath: [{ dx: 10, dy: 10 }], wrRoutes: routesAllBlocks(), teRoute: [{ dx: 2, dy: 8 }], qbDrop: 1 },
    { name: 'Slant Flat', type: 'PASS', primary: 'WR1', wrRoutes: { WR1: [{ dx: 3, dy: 6 }], WR2: [{ dx: -2, dy: 4 }], WR3: [{ dx: 0, dy: 2 }] }, teRoute: [{ dx: -1, dy: 5 }], rbCheckdown: [{ dx: 2, dy: 2 }], qbDrop: 5 },
    { name: 'Four Verts', type: 'PASS', primary: 'WR1', wrRoutes: { WR1: [{ dx: 0, dy: 18 }], WR2: [{ dx: -5, dy: 18 }], WR3: [{ dx: 5, dy: 18 }] }, teRoute: [{ dx: 0, dy: 15 }], rbCheckdown: [{ dx: 2, dy: 3 }], qbDrop: 7 },
    { name: 'PA Crossers', type: 'PASS', primary: 'WR2', wrRoutes: { WR1: [{ dx: -8, dy: 10 }], WR2: [{ dx: 8, dy: 12 }], WR3: [{ dx: 0, dy: 6 }] }, teRoute: [{ dx: -3, dy: 8 }], rbCheckdown: [{ dx: 2, dy: 2 }], qbDrop: 7, playAction: true },
];

export function routesAllHitches() {
    return { WR1: [{ dx: 0, dy: 6 }], WR2: [{ dx: -2, dy: 6 }], WR3: [{ dx: 2, dy: 6 }] };
}
export function routesAllBlocks() {
    return { WR1: [{ dx: 0, dy: 2 }], WR2: [{ dx: -2, dy: 2 }], WR3: [{ dx: 2, dy: 2 }] };
}
