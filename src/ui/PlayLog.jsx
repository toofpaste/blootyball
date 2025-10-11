// src/ui/PlayLog.jsx
import React from 'react';
import PlayerStatsTable from './PlayerStatsTable';

export default function PlayLog({ items = [], playerStats = {}, playerDirectory = {} }) {
    const hasPlays = Array.isArray(items) && items.length > 0;
    const hasStats = playerStats && Object.keys(playerStats).length > 0;
    if (!hasPlays && !hasStats) return null;

    const last10 = hasPlays ? items.slice(-10) : [];

    return (
        <div style={{
            width: 'min(1100px, 95%)',
            marginTop: 12,
            background: '#062c06',
            color: '#e8ffe8',
            border: '1px solid #0b4a0b',
            borderRadius: 10,
            overflow: 'hidden',
            boxShadow: '0 6px 18px rgba(0,0,0,0.3)'
        }}>
            <div style={{ padding: '8px 10px', borderBottom: '1px solid #0b4a0b', fontWeight: 700, fontSize: 15 }}>
                Last 10 Plays
            </div>
            {hasPlays ? (
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead style={{ background: '#083b08' }}>
                            <tr>
                                <Th>#</Th>
                                <Th>Call</Th>
                                <Th>Start (Dn &amp; Dist)</Th>
                                <Th>Start LOS</Th>
                                <Th>Result</Th>
                                <Th>Yds</Th>
                                <Th>End LOS</Th>
                            </tr>
                        </thead>
                        <tbody>
                            {last10.map((it, idx) => {
                                const n = safeInt(it.num, items.length - last10.length + idx + 1);
                                const startDown = safeInt(it.startDown, null);
                                const startToGo = safeInt(it.startToGo, null);
                                const startLos = safeInt(it.startLos, null);
                                const endLos = safeInt(it.endLos, startLos != null && it.gained != null ? startLos + it.gained : null);
                                const gained = safeInt(it.gained, endLos != null && startLos != null ? (endLos - startLos) : null);
                                const result = it.result || it.why || '—';
                                const callName = it.name || it.playName || '—';

                                return (
                                    <tr key={idx} style={{ borderTop: '1px solid #0b4a0b' }}>
                                        <Td mono>{n}</Td>
                                        <Td>{callName}</Td>
                                        <Td>
                                            {startDown != null ? ordinal(startDown) : '—'}
                                            {' '} &amp; {' '}
                                            {startToGo != null ? startToGo : '—'}
                                        </Td>
                                        <Td mono>{startLos != null ? startLos : '—'}</Td>
                                        <Td>{result}</Td>
                                        <Td mono style={{ color: gained == null ? '#e8ffe8' : (gained >= 0 ? '#8ef78e' : '#ffb3b3') }}>
                                            {gained != null ? (gained >= 0 ? `+${gained}` : `${gained}`) : '—'}
                                        </Td>
                                        <Td mono>{endLos != null ? endLos : '—'}</Td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            ) : (
                <div style={{ padding: '12px 10px', fontStyle: 'italic', color: '#cfe9cf' }}>
                    No plays have been logged yet.
                </div>
            )}
            <PlayerStatsTable stats={playerStats} directory={playerDirectory} />
        </div>
    );
}

function Th({ children }) {
    return <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 600 }}>{children}</th>;
}
function Td({ children, mono, style, colSpan }) {
    return (
        <td
            colSpan={colSpan}
            style={{
                padding: '8px 10px',
                fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' : 'inherit',
                ...(style || {}),
            }}
        >
            {children}
        </td>
    );
}
function ordinal(n) { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
function safeInt(v, defVal = null) { const n = Number(v); return Number.isFinite(n) ? n : defVal; }
