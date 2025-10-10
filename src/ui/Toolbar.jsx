// src/ui/Toolbar.jsx
import React, { useState } from 'react';
import { PLAYBOOK } from '../engine/constants';

// Backward compatible props with your current App.jsx,
// plus new handlers for forced play and outcome.
export default function Toolbar(props) {
    const {
        // existing props from your App.jsx
        running, setRunning, simSpeed, setSimSpeed,
        yardLine, down, toGo, quarter, timeLeft, result,
        onNextPlay, onReset,

        // new optional props for debugging tools
        onForcePlayName,
        onForceOutcome,
        forceOutcome = null,
        forcedPlayName = null,
    } = props;

    const [localSpeed, setLocalSpeed] = useState(simSpeed ?? 1);

    const setSpeed = (v) => {
        setLocalSpeed(v);
        setSimSpeed && setSimSpeed(v);
    };

    const outcomes = [
        { k: 'FUMBLE', label: 'Fumble' },
        { k: 'INT', label: 'Interception' },
        { k: 'SCRAMBLE', label: 'Scramble' },
    ];

    return (
        <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr',
            gap: 8,
            background: '#0b2a0b',
            color: '#e8ffe8',
            padding: 10,
            borderRadius: 10,
            border: '1px solid #145214',
            width: 'min(1100px, 95%)',
            margin: '8px auto'
        }}>
            {/* Top row: sim controls and info */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                {running ? (
                    <button onClick={() => setRunning(false)} style={btn()}>Pause</button>
                ) : (
                    <button onClick={() => setRunning(true)} style={btn()}>Start</button>
                )}
                <button onClick={onNextPlay} style={btn()}>Next Play</button>
                <button onClick={onReset} style={btn('danger')}>Reset</button>

                <div style={{ marginLeft: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <label style={{ opacity: 0.85 }}>Speed</label>
                    <input
                        type="range" min="0.2" max="3" step="0.1"
                        value={localSpeed}
                        onChange={(e) => setSpeed(parseFloat(e.target.value))}
                    />
                    <span style={{ width: 34, textAlign: 'right' }}>{(localSpeed ?? 1).toFixed(1)}x</span>
                </div>

                <div style={{ marginLeft: 'auto', opacity: 0.9, display: 'flex', gap: 12 }}>
                    <span>Q{quarter} {timeLeft}</span>
                    <span>Down: {down} &amp; {toGo}</span>
                    <span>LOS: {yardLine}</span>
                </div>
            </div>

            {/* Middle row: forced next play */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ opacity: 0.85 }}>Next Play:</span>
                <select
                    value={forcedPlayName || ''}
                    onChange={(e) => onForcePlayName?.(e.target.value || null)}
                    style={sel()}
                >
                    <option value="">(random)</option>
                    {PLAYBOOK.map(p => (
                        <option value={p.name} key={p.name}>{p.name}</option>
                    ))}
                </select>
                <button style={btn('ghost')} onClick={() => onForcePlayName?.(null)}>Clear</button>
                <span style={{ opacity: 0.7, marginLeft: 8 }}>Current: {result}</span>
            </div>

            {/* Bottom row: forced outcome */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ opacity: 0.85 }}>Force Outcome:</span>
                {outcomes.map(o => (
                    <button
                        key={o.k}
                        onClick={() => onForceOutcome?.(forceOutcome === o.k ? null : o.k)}
                        style={btn(forceOutcome === o.k ? 'active' : 'ghost')}
                        title={`Force next play to ${o.label}`}
                    >
                        {o.label}
                    </button>
                ))}
                <button style={btn('ghost')} onClick={() => onForceOutcome?.(null)}>Clear</button>
            </div>
        </div>
    );
}

function btn(variant) {
    const base = {
        padding: '6px 10px',
        borderRadius: 8,
        border: '1px solid #145214',
        cursor: 'pointer',
        background: '#124012',
        color: '#e8ffe8'
    };
    if (variant === 'ghost') return { ...base, background: 'transparent' };
    if (variant === 'active') return { ...base, background: '#176d17', borderColor: '#1c8a1c' };
    if (variant === 'danger') return { ...base, background: '#641414', borderColor: '#8c1c1c' };
    return base;
}
function sel() {
    return {
        padding: '6px 8px',
        borderRadius: 8,
        background: '#124012',
        color: '#e8ffe8',
        border: '1px solid #145214'
    };
}
