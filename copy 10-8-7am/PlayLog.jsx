// src/ui/PlayLog.jsx
import React from 'react';

export default function PlayLog({ items = [] }) {
    if (!items.length) return null;
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
            <div style={{ padding: '10px 12px', fontWeight: 700, borderBottom: '1px solid #0b4a0b' }}>
                Last 10 Plays
            </div>
            <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                    <thead>
                        <tr style={{ background: '#083b08' }}>
                            <Th>#</Th>
                            <Th>Play</Th>
                            <Th>Start (Dn &amp; Dist)</Th>
                            <Th>Start LOS</Th>
                            <Th>Result</Th>
                            <Th>Yds</Th>
                            <Th>End LOS</Th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.map((p) => (
                            <tr key={p.num} style={{ borderTop: '1px solid #0b4a0b' }}>
                                <Td mono>{p.num}</Td>
                                <Td>{p.name}</Td>
                                <Td>{ordinal(p.startDown)} &amp; {p.startToGo}</Td>
                                <Td mono>{p.startLos}</Td>
                                <Td style={{ color: p.turnover ? '#ffd166' : '#e8ffe8' }}>{p.result}</Td>
                                <Td mono style={{ color: p.yards > 0 ? '#a0f0a0' : p.yards < 0 ? '#ff9e9e' : '#e8ffe8' }}>
                                    {p.yards > 0 ? `+${p.yards}` : p.yards}
                                </Td>
                                <Td mono>{p.endLos}</Td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function Th({ children }) {
    return <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 600 }}>{children}</th>;
}
function Td({ children, mono }) {
    return <td style={{ padding: '8px 10px', fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' : 'inherit' }}>{children}</td>;
}
function ordinal(n) { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
