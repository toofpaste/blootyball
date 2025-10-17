// === NFL Circles Simulator — Modular Refactor (Create React App) ===
// Copy these files into your CRA project, preserving folders.
// Structure:
// src/
//   index.js
//   App.jsx
//   ui/Toolbar.jsx
//   engine/constants.js
//   engine/helpers.js
//   engine/playbook.js
//   engine/rosters.js
//   engine/ball.js
//   engine/ai.js
//   engine/state.js
//   render/draw.js

// ------------------------------------------------------------
// File: src/index.js
// ------------------------------------------------------------
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);

// ------------------------------------------------------------
// File: src/App.jsx
// ------------------------------------------------------------
import React, { useEffect, useRef, useState } from 'react';
import Toolbar from './ui/Toolbar';
import { FIELD_PIX_W, FIELD_PIX_H_VIEW } from './engine/constants';
import { createInitialGameState, stepGame, betweenPlays } from './engine/state';
import { draw } from './render/draw';

export default function App() {
    const canvasRef = useRef(null);
    const [running, setRunning] = useState(false);
    const [simSpeed, setSimSpeed] = useState(1);
    const [state, setState] = useState(() => createInitialGameState());
    const [cameraFollowBall, setCameraFollowBall] = useState(true);

    useEffect(() => {
        let rafId; let last = performance.now();
        const loop = (now) => {
            const dt = Math.min(0.033, (now - last) / 1000) * simSpeed; last = now;
            if (running) setState(prev => stepGame(prev, dt));
            draw(canvasRef.current, state, cameraFollowBall);
            rafId = requestAnimationFrame(loop);
        };
        rafId = requestAnimationFrame(loop);
        return () => {
            cancelAnimationFrame(rafId);
            if (typeof performance !== 'undefined' && typeof performance.clearMeasures === 'function') {
                performance.clearMeasures();
            }
        };
    }, [running, simSpeed, state, cameraFollowBall]);

    const onNextPlay = () => setState(s => betweenPlays(s));
    const onReset = () => { setState(createInitialGameState()); setRunning(false); };

    return (
        <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr', height: '100vh', background: '#0b3d0b' }}>
            <Toolbar
                running={running}
                setRunning={setRunning}
                simSpeed={simSpeed}
                setSimSpeed={setSimSpeed}
                yardLine={Math.round(state.drive.losYards)}
                down={state.drive.down}
                toGo={Math.max(1, Math.round(state.drive.toGo))}
                quarter={state.clock.quarter}
                timeLeft={fmtClock(state.clock.time)}
                result={state.play.resultText}
                onNextPlay={onNextPlay}
                onReset={onReset}
                cameraFollowBall={cameraFollowBall}
                setCameraFollowBall={setCameraFollowBall}
            />
            <div style={{ display: 'grid', placeItems: 'center', padding: '8px' }}>
                <canvas ref={canvasRef} width={FIELD_PIX_W} height={FIELD_PIX_H_VIEW} style={{ maxWidth: '100%', borderRadius: 12, boxShadow: '0 6px 24px rgba(0,0,0,0.4)', background: '#0a7f2e' }} />
            </div>
        </div>
    );
}

function fmtClock(s) { const m = Math.floor(s / 60); const ss = String(Math.floor(s % 60)).padStart(2, '0'); return `${m}:${ss}`; }

// ------------------------------------------------------------
// File: src/ui/Toolbar.jsx
// ------------------------------------------------------------
import React from 'react';

export default function Toolbar({ running, setRunning, simSpeed, setSimSpeed, yardLine, down, toGo, quarter, timeLeft, result, onNextPlay, onReset, cameraFollowBall, setCameraFollowBall }) {
    return (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 14px', background: '#062c06', color: '#e8ffe8', borderBottom: '1px solid #0b4a0b' }}>
            <strong>NFL Circles Simulator</strong>
            <span style={{ opacity: 0.9 }}>Q{quarter} | {timeLeft} | {ordinal(down)} &amp; {toGo} at {yardLine}</span>
            <span style={{ flex: 1 }} />
            <button onClick={() => setRunning(!running)} style={btnStyle()}>{running ? 'Pause' : 'Start'}</button>
            <button onClick={onNextPlay} style={btnStyle()}>Next Play</button>
            <button onClick={onReset} style={btnStyle('#e53935')}>Reset</button>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                Speed
                <input type="range" min={0.5} max={3} step={0.1} value={simSpeed} onChange={(e) => setSimSpeed(Number(e.target.value))} />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={cameraFollowBall} onChange={(e) => setCameraFollowBall(e.target.checked)} />
                Follow ball
            </label>
            <span style={{ opacity: 0.9 }}>{result}</span>
        </div>
    );
}

function btnStyle(bg = '#1b5e20') { return { background: bg, color: '#fff', border: 'none', padding: '8px 12px', borderRadius: 8, cursor: 'pointer' }; }
function ordinal(n) { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

// ------------------------------------------------------------
// File: src/engine/constants.js
// ------------------------------------------------------------
export const FIELD_YARDS_W = 53.3;
export const FIELD_YARDS_H = 120;
export const PLAYING_YARDS_H = 100;
export const ENDZONE_YARDS = 10;
export const PX_PER_YARD = 8;
export const FIELD_PIX_W = Math.round(FIELD_YARDS_W * PX_PER_YARD);
export const FIELD_PIX_H = Math.round(FIELD_YARDS_H * PX_PER_YARD);
export const FIELD_PIX_H_VIEW = 640;
export const OFFENSE_DIR = 1;
export const TEAM_RED = 'RED';
export const TEAM_BLK = 'BLK';
export const ROLES_OFF = ['QB', 'RB', 'WR1', 'WR2', 'WR3', 'TE', 'LT', 'LG', 'C', 'RG', 'RT'];
export const ROLES_DEF = ['LE', 'DT', 'RTk', 'RE', 'LB1', 'LB2', 'CB1', 'CB2', 'S1', 'S2', 'NB'];
export const COLORS = {
    fieldGreen: '#0a7f2e', lineWhite: '#ffffff', hash: '#dfe', red: '#e53935', black: '#222', ball: '#8B4513', text: '#f8f8f8', shadow: 'rgba(0,0,0,0.35)'
};

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

export function routesAllHitches() {
    return { WR1: [{ dx: -1, dy: 5, settle: true }], WR2: [{ dx: 2, dy: 5 }], WR3: [{ dx: -2, dy: 5 }] };
}
export function routesAllBlocks() {
    return { WR1: [{ dx: -1, dy: 3 }], WR2: [{ dx: 2, dy: 2 }], WR3: [{ dx: -2, dy: 2 }] };
}

// ------------------------------------------------------------
// File: src/engine/helpers.js
// ------------------------------------------------------------
import { PX_PER_YARD, FIELD_PIX_W, FIELD_PIX_H, ENDZONE_YARDS } from './constants';

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const rand = (a, b) => a + Math.random() * (b - a);
export const choice = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const yardsToPixY = (y) => y * PX_PER_YARD;
export const yardsToPixX = (x) => x * PX_PER_YARD;
export const pixYToYards = (py) => py / PX_PER_YARD;
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const unitVec = (v) => { const d = Math.hypot(v.x, v.y) || 1; return { x: v.x / d, y: v.y / d }; };
export const midPoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

// ------------------------------------------------------------
// File: src/engine/rosters.js
// ------------------------------------------------------------
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
    const setP = (p, x, y) => { p.pos = { x, y }; p.v = { x: 0, y: 0 }; };

    setP(off.C, startX + 2 * spacingX, olY);
    setP(off.LG, startX + spacingX, olY);
    setP(off.RG, startX + 3 * spacingX, olY);
    setP(off.LT, startX, olY);
    setP(off.RT, startX + 4 * spacingX, olY);
    setP(off.QB, off.C.pos.x, olY - yardsToPixY(3));
    setP(off.RB, off.C.pos.x, olY - yardsToPixY(5));
    setP(off.TE, off.RT.pos.x + 18, olY);
    setP(off.WR1, 40, olY);
    setP(off.WR2, FIELD_PIX_W - 40, olY);
    setP(off.WR3, midX + 130, olY - 30);

    const defFrontY = losPixY + yardsToPixY(1.5);
    setP(def.LE, off.LT.pos.x - 10, defFrontY);
    setP(def.DT, off.C.pos.x - 22, defFrontY);
    setP(def.RTk, off.C.pos.x + 22, defFrontY);
    setP(def.RE, off.RT.pos.x + 10, defFrontY);
    const lbY = defFrontY + yardsToPixY(2.5);
    setP(def.LB1, midX - 30, lbY);
    setP(def.LB2, midX + 30, lbY);
    setP(def.CB1, off.WR1.pos.x, losPixY + yardsToPixY(2));
    setP(def.CB2, off.WR2.pos.x, losPixY + yardsToPixY(2));
    const sY = losPixY + yardsToPixY(10);
    setP(def.S1, midX - 60, sY);
    setP(def.S2, midX + 60, sY);
    setP(def.NB, off.WR3.pos.x, losPixY + yardsToPixY(4));
    return { off, def };
}

// ------------------------------------------------------------
// File: src/engine/ball.js
// ------------------------------------------------------------
import { clamp, dist } from './helpers';

export function startPass(s, from, to, targetId) {
    s.play.ball.inAir = true;
    s.play.ball.carrierId = null;
    s.play.ball.from = { ...from };
    s.play.ball.to = { ...to };
    s.play.ball.t = 0;
    s.play.ball.targetId = targetId;
}

export function moveBall(s, dt) {
    const off = s.play.formation.off;
    const ball = s.play.ball;
    if (ball.inAir) {
        const speed = 420; // px/sec
        ball.t += dt * speed / Math.max(1, dist(ball.from, ball.to));
        const t = clamp(ball.t, 0, 1);
        const nx = ball.from.x + (ball.to.x - ball.from.x) * t;
        const ny = ball.from.y + (ball.to.y - ball.from.y) * t;
        ball.renderPos = { x: nx, y: ny };
        if (t >= 1) {
            if (!ball.targetId) {
                s.play.deadAt = s.play.elapsed; s.play.phase = 'DEAD'; s.play.resultWhy = 'Throw away'; return;
            }
            const r = off[ball.targetId];
            if (r) {
                const catchChance = r.attrs.catch * 0.6 + Math.random() * 0.5 - 0.15;
                if (catchChance > 0.5) { s.play.ball.inAir = false; s.play.ball.carrierId = r.id; }
                else { s.play.deadAt = s.play.elapsed; s.play.phase = 'DEAD'; s.play.resultWhy = 'Incomplete'; }
            } else { s.play.deadAt = s.play.elapsed; s.play.phase = 'DEAD'; s.play.resultWhy = 'Incomplete'; }
        }
    } else {
        const carrier = s.play.ball.carrierId ? off[s.play.ball.carrierId] : null;
        if (carrier) s.play.ball.renderPos = { ...carrier.pos };
    }
}

export function getBallPix(s) {
    if (s.play.ball.renderPos) return s.play.ball.renderPos;
    const off = s.play.formation.off; const carrier = s.play.ball.carrierId ? off[s.play.ball.carrierId] : off.QB;
    return { ...carrier.pos };
}

// ------------------------------------------------------------
// File: src/engine/ai.js
// ------------------------------------------------------------
import { clamp, dist, unitVec, rand, midPoint, yardsToPixY } from './helpers';
import { FIELD_PIX_W, ENDZONE_YARDS } from './constants';
import { startPass } from './ball';

export function initRoutesAfterSnap(s) {
    const off = s.play.formation.off;
    const call = s.play.playCall;
    s.play.routeTargets = {};
    ['WR1', 'WR2', 'WR3'].forEach(wr => {
        const path = (call.wrRoutes && call.wrRoutes[wr]) || [{ dx: 0, dy: 4 }];
        const start = off[wr].pos;
        const targets = path.map(step => ({
            x: clamp(start.x + step.dx * 8, 20, FIELD_PIX_W - 20),
            y: start.y + step.dy * 8
        }));
        s.play.routeTargets[wr] = targets;
        // Assign immediately so WRs start moving right after the snap
        off[wr].targets = targets;
        off[wr].routeIdx = 0;
    });
    const teTargets = (call.teRoute || [{ dx: 0, dy: 4 }]).map(step => ({
        x: clamp(off.TE.pos.x + step.dx * 8, 20, FIELD_PIX_W - 20),
        y: off.TE.pos.y + step.dy * 8
    }));
    s.play.teTargets = teTargets;
    off.TE.targets = teTargets;
    off.TE.routeIdx = 0;

    const rbTargets = (call.rbPath || call.rbCheckdown || [{ dx: 0, dy: 2 }]).map(step => ({
        x: clamp(off.RB.pos.x + step.dx * 8, 20, FIELD_PIX_W - 20),
        y: off.RB.pos.y + step.dy * 8
    }));
    s.play.rbTargets = rbTargets;
    // For RUN: RB will follow immediately after handoff. For PASS: give him a checkdown leak route to move.
    if (call.type === 'PASS') { off.RB.targets = rbTargets; off.RB.routeIdx = 0; }

    s.play.qbDropTarget = { x: off.QB.pos.x, y: off.QB.pos.y - (call.qbDrop || 3) * 8 };
    s.play.routesInitialized = true;
}

export function moveToward(p, target, dt, speedMul = 1) {
    const dx = target.x - p.pos.x; const dy = target.y - p.pos.y; const d = Math.hypot(dx, dy) || 1;
    const maxV = p.attrs.speed * 30 * speedMul; const step = Math.min(d, maxV * dt);
    p.pos.x += (dx / d) * step; p.pos.y += (dy / d) * step;
}

export function moveOL(off, def, dt) {
    const dls = ['LE', 'DT', 'RTk', 'RE'].map(k => def[k]);
    ['LT', 'LG', 'C', 'RG', 'RT'].forEach(k => {
        const ol = off[k];
        const close = dls.reduce((best, d) => { const dd = dist(ol.pos, d.pos); return dd < best.d ? { d: dd, t: d } : best; }, { d: 1e9, t: dls[0] });
        const away = unitVec({ x: close.t.pos.x - ol.pos.x, y: close.t.pos.y - ol.pos.y });
        ol.pos.x -= away.x * 10 * dt; ol.pos.y -= away.y * 10 * dt;
    });
}

export function moveReceivers(off, dt) {
    ['WR1', 'WR2', 'WR3'].forEach(wr => {
        const p = off[wr]; const targets = p && p.alive ? p.targets : null; if (!targets) return;
        const idx = p.routeIdx; const t = targets[idx]; if (!t) return;
        moveToward(p, t, dt, 1); if (dist(p.pos, t) < 6) p.routeIdx = Math.min(idx + 1, targets.length);
    });
}

export function moveTE(off, dt) {
    const p = off.TE; if (!p || !p.targets) return;
    const t = p.targets[p.routeIdx]; if (!t) return;
    moveToward(p, t, dt, 1); if (dist(p.pos, t) < 6) p.routeIdx = Math.min(p.routeIdx + 1, p.targets.length);
}

export function qbLogic(s, dt) {
    const off = s.play.formation.off;
    const call = s.play.playCall;
    const qb = off.QB;

    // If QB doesn't have the ball (e.g., after handoff/catch), he cannot throw again
    if (s.play.ball.carrierId !== 'QB') return;

    if (!qb.targets) { qb.targets = [s.play.qbDropTarget]; qb.routeIdx = 0; }
    const t = qb.targets[qb.routeIdx];
    if (t) moveToward(qb, t, dt, 0.9);

    if (call.type === 'RUN') {
        if (!s.play.handed && dist(qb.pos, s.play.qbDropTarget) < 6) {
            const rb = off.RB;
            s.play.ball.carrierId = 'RB';
            s.play.handed = true;
            rb.targets = s.play.rbTargets;
            rb.routeIdx = 0;
        }
        return;
    }

    // For PASS plays, routes are already assigned in initRoutesAfterSnap
    if (s.play.ball.inAir) return;

    const order = getReadOrder(call);
    const timeAfterDrop = s.play.elapsed;
    const atDrop = dist(qb.pos, s.play.qbDropTarget) < 6;

    if (atDrop && timeAfterDrop > 1.4) {
        for (const id of order) {
            const r = off[id]; if (!r) continue;
            const score = receiverOpenScore(r, s, call);
            if (isOpen(score, id === call.primary)) {
                const targetPos = leadTarget(qb.pos, r.pos);
                startPass(s, qb.pos, targetPos, r.id);
                return;
            }
        }
    }

    if (!s.play.ball.inAir && timeAfterDrop > 2.8 && off.RB) {
        const r = off.RB;
        const targetPos = leadTarget(qb.pos, r.pos);
        startPass(s, qb.pos, targetPos, r.id);
        return;
    }

    if (!s.play.scrambling && timeAfterDrop > 3.4) s.play.scrambling = true;
    if (s.play.scrambling) {
        const scr = { x: clamp(qb.pos.x + rand(-40, 40), 20, FIELD_PIX_W - 20), y: qb.pos.y + rand(10, 30) };
        moveToward(qb, scr, dt, 0.7);
        if (!s.play.ball.inAir && Math.random() < 0.012) {
            const toLeft = Math.random() < 0.5;
            const sidelineX = toLeft ? 8 : FIELD_PIX_W - 8;
            const away = { x: sidelineX, y: qb.pos.y + 18 };
            s.play.throwAway = true;
            startPass(s, qb.pos, away, null);
        }
    }
}

export function rbLogic(s, dt)(s, dt){
    const off = s.play.formation.off; const rb = off.RB; if (!rb) return;
    if (s.play.ball.carrierId === 'RB') {
        if (!rb.targets) { rb.targets = s.play.rbTargets || []; rb.routeIdx = 0; }
        const t = rb.targets[rb.routeIdx]; if (t) { moveToward(rb, t, dt, 1.05); if (dist(rb.pos, t) < 7) rb.routeIdx = Math.min(rb.routeIdx + 1, rb.targets.length); }
        else { moveToward(rb, { x: clamp(rb.pos.x + rand(-30, 30), 20, FIELD_PIX_W - 20), y: rb.pos.y + 18 }, dt, 1.1); }
    }
}

export function defenseLogic(s, dt) {
    const off = s.play.formation.off; const def = s.play.formation.def; const ball = s.play.ball;
    const coverMap = { CB1: 'WR1', CB2: 'WR2', NB: 'WR3', S1: 'TE', S2: 'WR1' };
    ['LE', 'DT', 'RTk', 'RE'].forEach(k => { const dl = def[k]; const target = ball.carrierId === 'RB' ? off.RB.pos : off.QB.pos; moveToward(dl, target, dt, 1.0); });
    ['LB1', 'LB2'].forEach(k => { const lb = def[k]; const target = ball.inAir ? midPoint(off.QB.pos, ball.to) : (ball.carrierId ? off[ball.carrierId].pos : off.QB.pos); moveToward(lb, { x: target.x, y: Math.max(lb.pos.y, target.y - 12) }, dt, 0.95); });
    Object.entries(coverMap).forEach(([dk, ok]) => { const d = def[dk]; const o = off[ok]; if (!d || !o) return; const mark = { x: o.pos.x + (ok === 'WR1' ? 6 : -6), y: o.pos.y - 10 }; moveToward(d, mark, dt, 0.97); });
    const carrier = ball.carrierId ? off[ball.carrierId] : null;
    if (carrier) { Object.values(def).forEach(d => { if (dist(d.pos, carrier.pos) < 10) { const tProb = d.attrs.tackle * 0.6 + Math.random() * 0.4 - carrier.attrs.strength * 0.25; if (tProb > 0.5) { s.play.deadAt = s.play.elapsed; s.play.phase = 'DEAD'; s.play.resultWhy = 'Tackled'; } } }); }
}

export function receiverOpenScore(rcv, s, call) {
    const defAll = Object.values(s.play.formation.def);
    const nearest = defAll.reduce((best, d) => { const dd = dist(d.pos, rcv.pos); return dd < best.d ? { d: dd, t: d } : best; }, { d: 1e9, t: defAll[0] });
    const sep = nearest.d; const depth = rcv.pos.y - s.play.formation.off.C.pos.y;
    const roleBias = rcv.role.startsWith('WR') ? 0.08 : (rcv.role === 'TE' ? -0.04 : 0);
    const primaryBias = call && call.primary === rcv.id ? 0.08 : 0;
    return sep * 0.004 + depth * 0.001 + roleBias + primaryBias + Math.random() * 0.04;
}

export function leadTarget(from, to) { const d = unitVec({ x: to.x - from.x, y: to.y - from.y }); return { x: to.x + d.x * 16, y: to.y + d.y * 12 }; }
export function getReadOrder(call) { const wrs = ['WR1', 'WR2', 'WR3']; const ordered = []; if (call && call.primary) ordered.push(call.primary); wrs.forEach(w => { if (!ordered.includes(w)) ordered.push(w); }); if (!ordered.includes('TE')) ordered.push('TE'); return ordered; }
export function isOpen(score, isPrimary) { const base = 0.18; return score > (isPrimary ? base * 0.8 : base); }

// ------------------------------------------------------------
// File: src/engine/state.js
// ------------------------------------------------------------
import { FIELD_PIX_H, FIELD_PIX_H_VIEW, FIELD_PIX_W, ENDZONE_YARDS, PLAYING_YARDS_H, PX_PER_YARD, COLORS, PLAYBOOK } from './constants';
import { clamp, yardsToPixY, pixYToYards } from './helpers';
import { createRosters, lineUpFormation } from './rosters';
import { initRoutesAfterSnap, moveOL, moveReceivers, moveTE, qbLogic, rbLogic, defenseLogic } from './ai';
import { moveBall, getBallPix } from './ball';

export function createInitialGameState() {
    const roster = createRosters();
    const drive = { losYards: 25, down: 1, toGo: 10 };
    const clock = { quarter: 1, time: 15 * 60 };
    const play = createPlayState(roster, drive);
    return { roster, drive, clock, play, cameraY: 0 };
}

export function createPlayState(roster, drive) {
    const losPixY = yardsToPixY(ENDZONE_YARDS + drive.losYards);
    const formation = lineUpFormation(roster, losPixY);
    const playCall = PLAYBOOK[(Math.random() * PLAYBOOK.length) | 0];
    const ball = { inAir: false, carrierId: 'QB', from: { x: 0, y: 0 }, to: { x: 0, y: 0 }, t: 0 };
    return { phase: 'PRESNAP', resultText: '', ball, formation, playCall, elapsed: 0 };
}

export function stepGame(state, dt) {
    let s = { ...state };
    s.play.elapsed += dt;
    const { playCall } = s.play;
    if (s.play.phase === 'PRESNAP') { if (s.play.elapsed > 1.0) { s.play.phase = 'POSTSNAP'; s.play.ball.carrierId = 'QB'; s.play.ball.inAir = false; s.play.resultText = `${playCall.name}`; } return s; }
    if (s.play.phase === 'POSTSNAP') { if (s.play.elapsed > 1.2) s.play.phase = 'LIVE'; }
    if (s.play.phase === 'LIVE') s = simulateLive(s, dt);
    if (s.play.phase === 'DEAD') { if (s.play.elapsed > s.play.deadAt + 1.2) s = betweenPlays(s); }
    const ballPix = getBallPix(s); const targetCamY = clamp(ballPix.y - FIELD_PIX_H_VIEW * 0.35, 0, FIELD_PIX_H - FIELD_PIX_H_VIEW); s.cameraY = s.cameraY + (targetCamY - s.cameraY) * 0.08;
    return s;
}

function simulateLive(s, dt) {
    if (!s.play.routesInitialized) initRoutesAfterSnap(s);
    const off = s.play.formation.off; const def = s.play.formation.def; const ball = s.play.ball; const call = s.play.playCall;
    moveOL(off, def, dt); moveReceivers(off, dt); moveTE(off, dt); qbLogic(s, dt); rbLogic(s, dt); defenseLogic(s, dt); moveBall(s, dt); checkDeadBall(s); return { ...s };
}

export function betweenPlays(s) {
    const ballY = getBallPix(s).y; const ballYards = pixYToYards(ballY) - ENDZONE_YARDS; const start = s.drive.losYards; const gained = clamp(ballYards - start, -100, 100);
    let nextDown = s.drive.down + 1; let toGo = s.drive.toGo - gained; let los = s.drive.losYards + Math.max(0, gained); let result = `${s.play.playCall.name}: ${Math.round(gained)} yards (${s.play.resultWhy || 'Tackle'})`;
    if (s.play.resultWhy === 'Touchdown') { result = `${s.play.playCall.name}: TOUCHDOWN!`; nextDown = 1; toGo = 10; los = 25; }
    else { if (toGo <= 0) { nextDown = 1; toGo = 10; } if (nextDown > 4) { result += ' — Turnover on downs'; nextDown = 1; toGo = 10; los = 25; } }
    s.drive = { losYards: clamp(los, 1, 99), down: nextDown, toGo: Math.max(1, Math.round(toGo)) };
    s.play = createPlayState(s.roster, s.drive); s.play.resultText = result; return s;
}

function checkDeadBall(s) {
    const ballPix = getBallPix(s);
    if (ballPix.x < 10 || ballPix.x > FIELD_PIX_W - 10) { s.play.deadAt = s.play.elapsed; s.play.phase = 'DEAD'; s.play.resultWhy = 'Out of bounds'; }
    const ballYards = pixYToYards(ballPix.y);
    if (ballYards >= ENDZONE_YARDS + PLAYING_YARDS_H) { s.play.deadAt = s.play.elapsed; s.play.phase = 'DEAD'; s.play.resultWhy = 'Touchdown'; }
}

// ------------------------------------------------------------
// File: src/render/draw.js
// ------------------------------------------------------------
import { COLORS, FIELD_PIX_W, FIELD_PIX_H, ENDZONE_YARDS, PLAYING_YARDS_H } from '../engine/constants';
import { yardsToPixY } from '../engine/helpers';
import { getBallPix } from '../engine/ball';

export function draw(canvas, state) {
    if (!canvas) return; const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height);
    const camY = state.cameraY || 0; ctx.save(); ctx.translate(0, -camY);
    drawField(ctx);
    const losY = yardsToPixY(ENDZONE_YARDS + state.drive.losYards);
    const ltgY = yardsToPixY(ENDZONE_YARDS + state.drive.losYards + state.drive.toGo);
    ctx.strokeStyle = '#ffec99'; ctx.lineWidth = 2; dashLine(ctx, 0, losY, FIELD_PIX_W, losY, [10, 8]);
    ctx.strokeStyle = '#99c9ff'; dashLine(ctx, 0, ltgY, FIELD_PIX_W, ltgY, [10, 8]);
    const { off, def } = state.play.formation; Object.values(def).forEach(p => drawPlayer(ctx, p, COLORS.black)); Object.values(off).forEach(p => drawPlayer(ctx, p, COLORS.red));
    const bp = getBallPix(state); drawBall(ctx, bp);
    ctx.fillStyle = COLORS.text; ctx.font = '14px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto'; ctx.fillText(`${state.play.resultText}`, 12, state.cameraY + 24);
    ctx.restore();
}

function drawField(ctx) {
    ctx.fillStyle = COLORS.fieldGreen; ctx.fillRect(0, 0, FIELD_PIX_W, FIELD_PIX_H);
    ctx.strokeStyle = COLORS.lineWhite; ctx.lineWidth = 1.2;
    for (let y = yardsToPixY(ENDZONE_YARDS); y <= yardsToPixY(ENDZONE_YARDS + PLAYING_YARDS_H); y += yardsToPixY(5)) { ctx.globalAlpha = (y % yardsToPixY(10) === 0) ? 0.9 : 0.35; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(FIELD_PIX_W, y); ctx.stroke(); }
    ctx.globalAlpha = 1; ctx.fillStyle = '#075e22'; ctx.fillRect(0, 0, FIELD_PIX_W, yardsToPixY(ENDZONE_YARDS)); ctx.fillRect(0, yardsToPixY(ENDZONE_YARDS + PLAYING_YARDS_H), FIELD_PIX_W, yardsToPixY(ENDZONE_YARDS));
}

function drawPlayer(ctx, p, color) {
    ctx.save(); ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.arc(p.pos.x + 1.5, p.pos.y + 2.5, 9, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = color; ctx.beginPath(); ctx.arc(p.pos.x, p.pos.y, 8, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = '9px ui-sans-serif, system-ui'; const label = shortRole(p.role); ctx.fillText(label, p.pos.x - ctx.measureText(label).width / 2, p.pos.y + 3); ctx.restore();
}

function shortRole(r) { const map = { QB: 'QB', RB: 'RB', WR1: 'W1', WR2: 'W2', WR3: 'W3', TE: 'TE', LT: 'LT', LG: 'LG', C: 'C', RG: 'RG', RT: 'RT', LE: 'LE', DT: 'DT', RTk: 'NT', RE: 'RE', LB1: 'LB', LB2: 'LB', CB1: 'C1', CB2: 'C2', S1: 'S1', S2: 'S2', NB: 'NB' }; return map[r] || r; }

function drawBall(ctx, pos) { ctx.save(); ctx.fillStyle = COLORS.ball; ctx.beginPath(); ctx.arc(pos.x, pos.y, 5, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#f5e6d3'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(pos.x - 3, pos.y); ctx.lineTo(pos.x + 3, pos.y); ctx.stroke(); ctx.restore(); }

function dashLine(ctx, x1, y1, x2, y2, dash = [6, 4]) { ctx.save(); ctx.setLineDash(dash); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.restore(); }
