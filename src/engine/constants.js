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

// Core playbook (modernized route detail)
export const PLAYBOOK = [
    {
        name: 'Wide Zone Weak',
        type: 'RUN',
        handoffTo: 'RB',
        rbPath: [
            { dx: -2, dy: 1 },
            { dx: -6, dy: 3 },
            { dx: -4, dy: 5 },
            { dx: -1, dy: 4 },
        ],
        wrRoutes: {
            WR1: [
                { dx: -1, dy: 3 },
                { dx: -4, dy: 5 },
                { dx: -2, dy: 2 },
            ],
            WR2: [
                { dx: 2, dy: 2 },
                { dx: 3, dy: 3 },
            ],
            WR3: [
                { dx: -2, dy: 1 },
                { dx: -3, dy: 4 },
            ],
        },
        teRoute: [
            { dx: 2, dy: 1 },
            { dx: -8, dy: 3 },
            { dx: -4, dy: 2 },
        ],
        qbDrop: 1,
    },
    {
        name: 'Counter Bash (Gun)',
        type: 'RUN',
        handoffTo: 'RB',
        rbPath: [
            { dx: 4, dy: 1 },
            { dx: -3, dy: 2 },
            { dx: -8, dy: 4 },
            { dx: -10, dy: 5 },
        ],
        wrRoutes: {
            WR1: [
                { dx: -1, dy: 2 },
                { dx: -3, dy: 4 },
                { dx: -1, dy: 2 },
            ],
            WR2: [
                { dx: 2, dy: 1 },
                { dx: 6, dy: 2 },
            ],
            WR3: [
                { dx: -3, dy: 2 },
                { dx: -5, dy: 3 },
            ],
        },
        teRoute: [
            { dx: 1, dy: 2 },
            { dx: -2, dy: 4 },
            { dx: -4, dy: 2 },
        ],
        qbDrop: 1,
    },
    {
        name: 'Speed Option Pitch',
        type: 'RUN',
        handoffTo: 'RB',
        handoffStyle: 'PITCH',
        handoffDelay: 0.45,
        handoffWindow: 0.35,
        pitchTarget: { dx: 2.8, dy: 0.2 },
        rbPath: [
            { dx: 4, dy: 1 },
            { dx: 8, dy: 3 },
            { dx: 10, dy: 4 },
        ],
        wrRoutes: {
            WR1: [
                { dx: -2, dy: 2 },
                { dx: -4, dy: 3 },
            ],
            WR2: [
                { dx: 3, dy: 2 },
                { dx: 5, dy: 3 },
            ],
            WR3: [
                { dx: 6, dy: 1 },
                { dx: 7, dy: 3 },
            ],
        },
        teRoute: [
            { dx: 2, dy: 1 },
            { dx: 4, dy: 3 },
        ],
        qbDrop: 0.8,
    },
    {
        name: 'Mesh Rail',
        type: 'PASS',
        primary: 'WR1',
        wrRoutes: {
            WR1: [
                { dx: -1, dy: 5, speed: 1.02, label: 'Stem' },
                { dx: -2, dy: 2, speed: 0.98 },
                { dx: -6, dy: 6, label: 'Dig Break' },
            ],
            WR2: [
                { dx: 3, dy: 2, speed: 0.95 },
                { dx: 9, dy: 2, settle: true, speed: 0.9, label: 'Mesh Settle' },
            ],
            WR3: [
                { dx: 4, dy: 4, speed: 1.05 },
                { dx: 6, dy: 8, label: 'Rail' },
            ],
        },
        teRoute: [
            { dx: -2, dy: 3, speed: 0.96 },
            { dx: -9, dy: 2, settle: true },
        ],
        rbCheckdown: [
            { dx: 5, dy: 2 },
            { dx: 8, dy: 2 },
        ],
        qbDrop: 5,
    },
    {
        name: 'HOSS Y-Choice',
        type: 'PASS',
        quickGame: true,
        primary: 'TE',
        wrRoutes: {
            WR1: [
                { dx: -1, dy: 5, settle: true, label: 'Hitch' },
            ],
            WR2: [
                { dx: 2, dy: 5, speed: 1.02, label: 'Seam Stem' },
                { dx: 2, dy: 8 },
            ],
            WR3: [
                { dx: -2, dy: 5, speed: 1.02 },
                { dx: -2, dy: 8 },
            ],
        },
        teRoute: [
            { dx: 0, dy: 4, label: 'Choice Stem' },
            { dx: 0, dy: 2, option: 'in-or-out', settle: true },
        ],
        rbCheckdown: [
            { dx: 4, dy: 2 },
            { dx: 6, dy: 1 },
        ],
        qbDrop: 3,
    },
    {
        name: 'Boot Flood (PA)',
        type: 'PASS',
        primary: 'WR2',
        playAction: true,
        wrRoutes: {
            WR1: [
                { dx: -2, dy: 7, label: 'Post Stem' },
                { dx: -6, dy: 9, label: 'Post Break' },
            ],
            WR2: [
                { dx: 4, dy: 4, label: 'Corner Stem' },
                { dx: 10, dy: 10, label: 'Corner' },
            ],
            WR3: [
                { dx: 3, dy: 2, label: 'Flat Stem' },
                { dx: 4, dy: 1, settle: true },
            ],
        },
        teRoute: [
            { dx: -1, dy: 3 },
            { dx: 6, dy: 7 },
        ],
        rbCheckdown: [
            { dx: -5, dy: 2 },
            { dx: -7, dy: 6 },
        ],
        qbDrop: 6,
    },
];
