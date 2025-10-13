// src/ui/PlayLog.jsx
import React, { useMemo, useState } from 'react';
import Modal from './Modal';

export default function PlayLog({ items = [] }) {
    const [showAll, setShowAll] = useState(false);
    const hasPlays = Array.isArray(items) && items.length > 0;

    const summary = useMemo(() => (hasPlays ? items.slice(-4).reverse() : []), [hasPlays, items]);
    const extended = useMemo(() => (hasPlays ? items.slice(-25).reverse() : []), [hasPlays, items]);

    return (
        <>
            <div
                style={{
                    background: '#062c06',
                    color: '#e8ffe8',
                    border: '1px solid #0b4a0b',
                    borderRadius: 12,
                    boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
                    overflow: 'hidden',
                    width: '100%',
                }}
            >
                <div
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '10px 12px',
                        borderBottom: '1px solid #0b4a0b',
                        fontWeight: 700,
                        fontSize: 15,
                        background: '#083b08',
                    }}
                >
                    <span>Recent Plays</span>
                    <button
                        onClick={() => setShowAll(true)}
                        disabled={!hasPlays}
                        style={{
                            background: hasPlays ? '#145c14' : 'rgba(255,255,255,0.08)',
                            color: hasPlays ? '#e8ffe8' : '#9bbf9b',
                            border: '1px solid rgba(232,255,232,0.35)',
                            borderRadius: 6,
                            padding: '4px 10px',
                            fontSize: 12,
                            cursor: hasPlays ? 'pointer' : 'default',
                            transition: 'background 0.2s ease',
                        }}
                    >
                        View All
                    </button>
                </div>
                {hasPlays ? (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <tbody>
                            {summary.map((it, idx) => (
                                <SummaryRow
                                    key={`${it.num}-${idx}`}
                                    item={it}
                                />
                            ))}
                        </tbody>
                    </table>
                ) : (
                    <div style={{ padding: '12px', fontStyle: 'italic', color: '#cfe9cf' }}>
                        No plays have been logged yet.
                    </div>
                )}
            </div>
            <Modal open={showAll} onClose={() => setShowAll(false)} title="Play History" width="min(92vw, 860px)">
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
                                {extended.map((it, idx) => {
                                    const n = safeInt(it.num, extended.length - idx);
                                    const startDown = safeInt(it.startDown, null);
                                    const startToGo = safeInt(it.startToGo, null);
                                    const startLos = safeInt(it.startLos, null);
                                    const endLos = safeInt(
                                        it.endLos,
                                        startLos != null && it.gained != null ? startLos + it.gained : null
                                    );
                                    const gained = safeInt(
                                        it.gained,
                                        endLos != null && startLos != null ? endLos - startLos : null
                                    );
                                    const result = it.result || it.why || '—';
                                    const callName = it.name || it.playName || '—';

                                    return (
                                        <tr key={`${it.num}-${idx}`} style={{ borderTop: '1px solid #0b4a0b' }}>
                                            <Td mono>{n}</Td>
                                            <Td>{callName}</Td>
                                            <Td>
                                                {startDown != null ? ordinal(startDown) : '—'}
                                                {' '}&amp;{' '}
                                                {startToGo != null ? startToGo : '—'}
                                            </Td>
                                            <Td mono>{startLos != null ? startLos : '—'}</Td>
                                            <Td>{result}</Td>
                                            <Td
                                                mono
                                                style={{ color: gained == null ? '#e8ffe8' : gained >= 0 ? '#8ef78e' : '#ffb3b3' }}
                                            >
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
            </Modal>
        </>
    );
}

function SummaryRow({ item }) {
    const n = safeInt(item.num);
    const startLos = safeInt(item.startLos, null);
    const endLos = safeInt(
        item.endLos,
        startLos != null && item.gained != null ? startLos + item.gained : null
    );
    const gained = safeInt(
        item.gained,
        endLos != null && startLos != null ? endLos - startLos : null
    );

    return (
        <tr style={{ borderTop: '1px solid rgba(11,74,11,0.7)' }}>
            <Td mono style={{ width: 40 }}>{n != null ? n : '—'}</Td>
            <Td style={{ fontWeight: 600 }}>{item.name || item.playName || '—'}</Td>
            <Td mono style={{ color: '#9bd79b' }}>{item.result || item.why || '—'}</Td>
            <Td
                mono
                style={{
                    color: gained == null ? '#e8ffe8' : gained >= 0 ? '#8ef78e' : '#ffb3b3',
                    textAlign: 'right',
                    width: 60,
                }}
            >
                {gained != null ? (gained >= 0 ? `+${gained}` : `${gained}`) : '—'}
            </Td>
        </tr>
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
