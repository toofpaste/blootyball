// src/ui/Scoreboard.jsx
import React from 'react';

function TeamPanel({ team = {}, align = 'left' }) {
    const {
        displayName = 'Team',
        abbr = '',
        recordText = '0-0-0',
        score = 0,
        color = '#e8ffe8',
    } = team;

    const isRight = align === 'right';
    const flexDirection = isRight ? 'row-reverse' : 'row';

    return (
        <div style={{ display: 'flex', flexDirection, alignItems: 'center', gap: 10 }}>
            <div style={{
                width: 12,
                height: 12,
                borderRadius: 9999,
                background: color || '#e8ffe8',
                boxShadow: '0 0 6px rgba(0,0,0,0.35)'
            }} />
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: isRight ? 'flex-end' : 'flex-start', gap: 2 }}>
                <span style={{ fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase' }}>{abbr || displayName}</span>
                <span style={{ fontWeight: 500, fontSize: 14, opacity: 0.85 }}>{displayName}</span>
                <span style={{ fontSize: 12, color: '#b0e8b0' }}>{recordText}</span>
            </div>
            <span style={{ fontSize: 28, fontWeight: 800, minWidth: 32, textAlign: 'center' }}>{score}</span>
        </div>
    );
}

export default function Scoreboard({
    home = {},
    away = {},
    quarter = 1,
    timeLeftText = '15:00',
    down = 1,
    toGo = 10,
    gameLabel = '',
    onShowSeasonStats = null,
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
            alignItems: 'stretch',
            padding: '12px 14px',
            boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
            gap: 8,
            position: 'relative'
        }}>
            <TeamPanel team={home} align="left" />

            <div style={{ textAlign: 'center', fontWeight: 700, display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'center' }}>
                <div style={{ fontSize: 13, opacity: 0.8 }}>{gameLabel}</div>
                <div style={{ fontSize: 14, opacity: 0.9 }}>
                    {ordinal(down)} & {Math.max(1, Math.round(toGo))} • Q{quarter}
                </div>
                <div style={{ fontSize: 18 }}>{timeLeftText}</div>
            </div>

            <TeamPanel team={away} align="right" />

            {typeof onShowSeasonStats === 'function' ? (
                <button
                    type="button"
                    onClick={onShowSeasonStats}
                    style={{
                        position: 'absolute',
                        top: 8,
                        right: 8,
                        background: 'rgba(255,255,255,0.1)',
                        color: '#e8ffe8',
                        border: '1px solid rgba(200,255,200,0.25)',
                        borderRadius: 9999,
                        padding: '6px 14px',
                        fontSize: 12,
                        letterSpacing: 0.3,
                        textTransform: 'uppercase',
                        cursor: 'pointer',
                        transition: 'all 160ms ease',
                    }}
                    onMouseOver={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.2)'; }}
                    onFocus={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.2)'; }}
                    onMouseOut={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
                    onBlur={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
                >
                    Season Stats
                </button>
            ) : null}
        </div>
    );
}

function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
