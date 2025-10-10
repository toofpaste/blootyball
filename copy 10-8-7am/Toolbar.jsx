// src/ui/Toolbar.jsx
import React from 'react';

export default function Toolbar({ running, setRunning, simSpeed, setSimSpeed, yardLine, down, toGo, quarter, timeLeft, result, onNextPlay, onReset }) {
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
            <span style={{ opacity: 0.9 }}>{result}</span>
        </div>
    );
}

function btnStyle(bg = '#1b5e20') { return { background: bg, color: '#fff', border: 'none', padding: '8px 12px', borderRadius: 8, cursor: 'pointer' }; }
function ordinal(n) { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
