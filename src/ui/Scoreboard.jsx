// src/ui/Scoreboard.jsx
import React from 'react';
import { COLORS } from '../engine/constants';

export default function Scoreboard({
    redScore = 0,
    blkScore = 0,
    quarter = 1,
    timeLeftText = '15:00',
    down = 1,
    toGo = 10,
}) {
    return (
        <div style={{
            width: 'min(1100px, 95%)',
            margin: '8px auto 4px',
            background: '#0b2a0b',
            border: '1px solid #145214',
            borderRadius: 12,
            color: '#e8ffe8',
            display: 'grid',
            gridTemplateColumns: '1fr auto 1fr',
            alignItems: 'center',
            padding: '10px 12px',
            boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
            gap: 8
        }}>
            {/* Left team: RED */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{
                    display: 'inline-block',
                    width: 10, height: 10, borderRadius: 9999,
                    background: COLORS.red
                }} />
                <span style={{ fontWeight: 700, letterSpacing: 0.2 }}>Red</span>
                <span style={{ marginLeft: 'auto', fontSize: 22, fontWeight: 800 }}>{redScore}</span>
            </div>

            {/* Center: down & distance and clock */}
            <div style={{ textAlign: 'center', fontWeight: 700 }}>
                <div style={{ fontSize: 14, opacity: 0.9 }}>
                    {ordinal(down)} & {Math.max(1, Math.round(toGo))} • Q{quarter}
                </div>
                <div style={{ fontSize: 18 }}>{timeLeftText}</div>
            </div>

            {/* Right team: BLACK */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, justifyContent: 'flex-end' }}>
                <span style={{ fontSize: 22, fontWeight: 800 }}>{blkScore}</span>
                <span style={{ fontWeight: 700, letterSpacing: 0.2 }}>Black</span>
                <span style={{
                    display: 'inline-block',
                    width: 10, height: 10, borderRadius: 9999,
                    background: COLORS.black
                }} />
            </div>
        </div>
    );
}

function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
