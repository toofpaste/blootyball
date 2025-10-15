import React, { useMemo } from 'react';
import { ROLES_OFF, ROLES_DEF } from '../engine/constants';
import { usePlayerCard } from './PlayerCardProvider';

const POSITION_ORDER = [...ROLES_OFF, ...ROLES_DEF];
const ALWAYS_SHOW = new Set(['QB', 'RB', 'WR1', 'WR2', 'WR3', 'TE']);

function sortValue(role) {
    const idx = POSITION_ORDER.indexOf(role);
    return idx >= 0 ? idx : 100 + (role ? role.charCodeAt(0) : 0);
}

function hasActivity(stat) {
    if (!stat) return false;
    const { passing, rushing, receiving, defense } = stat;
    const passTotal = (passing?.attempts ?? 0) + (passing?.completions ?? 0) + Math.abs(passing?.yards ?? 0) + (passing?.touchdowns ?? 0) + (passing?.interceptions ?? 0) + (passing?.sacks ?? 0);
    const rushTotal = (rushing?.attempts ?? 0) + Math.abs(rushing?.yards ?? 0) + (rushing?.touchdowns ?? 0);
    const recTotal = (receiving?.targets ?? 0) + (receiving?.receptions ?? 0) + Math.abs(receiving?.yards ?? 0) + (receiving?.touchdowns ?? 0) + (receiving?.drops ?? 0);
    const defTotal = (defense?.tackles ?? 0) + (defense?.sacks ?? 0) + (defense?.interceptions ?? 0);
    return passTotal + rushTotal + recTotal + defTotal > 0;
}

function formatYards(y) {
    if (y == null || Number.isNaN(y)) return '0';
    const val = Math.round(y);
    return `${val}`;
}

function buildRow(playerId, meta, stat) {
    const passing = stat?.passing || {};
    const rushing = stat?.rushing || {};
    const receiving = stat?.receiving || {};
    const defense = stat?.defense || {};

    const passCA = (passing.attempts || passing.completions || passing.sacks)
        ? `${passing.completions ?? 0}/${passing.attempts ?? 0}`
        : '—';
    const passYds = (passing.attempts || passing.completions || passing.sacks)
        ? formatYards(passing.yards || 0)
        : '—';
    const passLine = (passing.attempts || passing.completions || passing.interceptions || passing.sacks || passing.touchdowns)
        ? `${passing.touchdowns ?? 0}/${passing.interceptions ?? 0}/${passing.sacks ?? 0}`
        : '—';

    const rushLine = rushing.attempts
        ? `${rushing.attempts}-${formatYards(rushing.yards || 0)}-${rushing.touchdowns ?? 0}`
        : '—';
    const recLine = receiving.targets
        ? `${receiving.targets}-${receiving.receptions ?? 0}-${formatYards(receiving.yards || 0)}-${receiving.touchdowns ?? 0}`
        : '—';
    const drops = receiving.targets ? `${receiving.drops ?? 0}` : '—';
    const defLine = (defense.tackles || defense.sacks || defense.interceptions)
        ? `${defense.tackles ?? 0}-${defense.sacks ?? 0}-${defense.interceptions ?? 0}`
        : '—';

    return {
        id: playerId,
        name: meta.fullName || playerId,
        number: meta.number,
        role: meta.role || '—',
        passCA,
        passYds,
        passLine,
        rushLine,
        recLine,
        drops,
        defLine,
    };
}

function gatherTeamRows(stats, directory, teamId) {
    const rows = Object.entries(directory || {})
        .filter(([, meta]) => meta.team === teamId)
        .map(([id, meta]) => ({ id, meta, stat: stats?.[id] || null }))
        .filter(({ meta, stat }) => ALWAYS_SHOW.has(meta.role) || hasActivity(stat));

    rows.sort((a, b) => {
        const svA = sortValue(a.meta.role);
        const svB = sortValue(b.meta.role);
        if (svA !== svB) return svA - svB;
        const nameA = (a.meta.fullName || a.meta.role || '').toLowerCase();
        const nameB = (b.meta.fullName || b.meta.role || '').toLowerCase();
        return nameA.localeCompare(nameB);
    });

    return rows.map(({ id, meta, stat }) => buildRow(id, meta, stat));
}

export default function PlayerStatsTable({ stats = {}, directory = {}, teams = [] }) {
    const teamRows = useMemo(
        () => teams.map(team => ({ team, rows: gatherTeamRows(stats, directory, team.id) })),
        [stats, directory, teams]
    );
    const { openPlayerCard } = usePlayerCard();
    const hasAnyRows = teamRows.some(section => section.rows.length > 0);
    if (!hasAnyRows) return null;

    return (
        <div style={{
            width: 'min(1100px, 95%)',
            marginTop: 16,
            background: 'linear-gradient(180deg, rgba(6,44,6,0.95) 0%, rgba(4,28,4,0.98) 100%)',
            color: '#f2fff2',
            border: '1px solid #165e16',
            borderRadius: 14,
            overflow: 'hidden',
            boxShadow: '0 14px 30px rgba(0,0,0,0.35)'
        }}>
            <div
                style={{
                    padding: '12px 18px',
                    borderBottom: '1px solid rgba(9,72,9,0.85)',
                    fontWeight: 700,
                    fontSize: 16,
                    letterSpacing: 0.4,
                    textTransform: 'uppercase',
                    background: 'rgba(12,64,12,0.85)'
                }}
            >
                Player Stats
            </div>
            {teamRows.map(({ team, rows }) => (
                <div key={team.id} style={{ borderTop: '1px solid rgba(14,74,14,0.7)' }}>
                    <div
                        style={{
                            padding: '10px 18px',
                            background: 'rgba(8,59,8,0.85)',
                            fontWeight: 600,
                            fontSize: 14,
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                        }}
                    >
                        {team.displayName || team.label || team.id}
                        <span style={{ fontSize: 12, color: '#a5e0a5' }}>Game totals</span>
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 13 }}>
                            <thead>
                                <tr style={{ background: 'rgba(10,70,10,0.85)' }}>
                                    <Th>Player</Th>
                                    <Th align="center">Pos</Th>
                                    <Th align="right">Pass C/A</Th>
                                    <Th align="right">Pass Yds</Th>
                                    <Th align="right">TD/INT/S</Th>
                                    <Th align="right">Rush A-Y-TD</Th>
                                    <Th align="right">Rec T-R-Y-TD</Th>
                                    <Th align="right">Drops</Th>
                                    <Th align="right">Def Tk-Sk-INT</Th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.length ? rows.map((row, idx) => {
                                    const isStriped = idx % 2 === 0;
                                    return (
                                        <tr
                                            key={row.id}
                                            style={{
                                                background: isStriped ? 'rgba(7,45,7,0.75)' : 'rgba(5,32,5,0.9)',
                                                borderTop: '1px solid rgba(14,74,14,0.35)'
                                            }}
                                        >
                                            <Td>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                                    <button
                                                        type="button"
                                                        onClick={() => openPlayerCard({ playerId: row.id, teamId: team.id })}
                                                        style={{
                                                            background: 'none',
                                                            border: 'none',
                                                            padding: 0,
                                                            margin: 0,
                                                            fontWeight: 600,
                                                            color: '#f2fff2',
                                                            textAlign: 'left',
                                                            cursor: 'pointer',
                                                        }}
                                                    >
                                                        {row.name}
                                                    </button>
                                                    <span style={{ fontSize: 11, color: '#9bd79b' }}>
                                                        {row.number ? `#${row.number}` : '—'}
                                                    </span>
                                                </div>
                                            </Td>
                                            <Td align="center">{row.role}</Td>
                                            <Td mono align="right">{row.passCA}</Td>
                                            <Td mono align="right">{row.passYds}</Td>
                                            <Td mono align="right">{row.passLine}</Td>
                                            <Td mono align="right">{row.rushLine}</Td>
                                            <Td mono align="right">{row.recLine}</Td>
                                            <Td mono align="right">{row.drops}</Td>
                                            <Td mono align="right">{row.defLine}</Td>
                                        </tr>
                                    );
                                }) : (
                                    <tr>
                                        <Td colSpan={9} style={{ textAlign: 'center', padding: '12px 10px' }}>No recorded stats yet.</Td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            ))}
        </div>
    );
}

function Th({ children, align = 'left' }) {
    return (
        <th
            style={{
                textAlign: align,
                padding: '10px 14px',
                fontWeight: 600,
                fontSize: 12,
                letterSpacing: 0.4,
                textTransform: 'uppercase',
                color: '#c1f0c1'
            }}
        >
            {children}
        </th>
    );
}

function Td({ children, mono, colSpan, style, align = 'left' }) {
    return (
        <td
            colSpan={colSpan}
            style={{
                padding: '10px 14px',
                textAlign: align,
                fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' : 'inherit',
                ...(style || {})
            }}
        >
            {children}
        </td>
    );
}
