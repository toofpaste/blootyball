// src/ui/PlayLog.jsx
import React, { useMemo, useState } from 'react';
import Modal from './Modal';

export default function PlayLog({ items = [] }) {
    const [showAll, setShowAll] = useState(false);
    const hasPlays = Array.isArray(items) && items.length > 0;

    const lastPlay = hasPlays ? items[items.length - 1] : null;
    const lastDescription = useMemo(() => formatLastPlay(lastPlay), [lastPlay]);
    const extended = useMemo(() => (hasPlays ? items.slice(-25).reverse() : []), [hasPlays, items]);

    return (
        <>
            <div className="last-play-banner">
                <div className="last-play-banner__label">Last Play</div>
                <div className="last-play-banner__text">
                    {hasPlays ? lastDescription : 'Waiting for the first snap...'}
                </div>
                <button
                    onClick={() => setShowAll(true)}
                    className="last-play-banner__history"
                    disabled={!hasPlays}
                >
                    View History
                </button>
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
function formatLastPlay(item) {
    if (!item) return '';
    const parts = [];
    if (item.name) parts.push(item.name);
    const result = item.result || item.why;
    if (result) {
        const trimmed = String(result).trim();
        const capitalized = trimmed ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : '';
        if (capitalized) parts.push(capitalized);
    }
    if (parts.length === 0) return 'Play recorded';
    return parts.join(' — ');
}
