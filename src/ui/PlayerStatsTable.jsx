import React, { useMemo } from 'react';
import { TEAM_RED, TEAM_BLK, ROLES_OFF, ROLES_DEF } from '../engine/constants';

const TEAM_LABELS = {
    [TEAM_RED]: 'Red Team',
    [TEAM_BLK]: 'Black Team',
};

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

export default function PlayerStatsTable({ stats = {}, directory = {}, teams = [TEAM_RED, TEAM_BLK] }) {
    const teamRows = useMemo(() => teams.map(team => ({ team, rows: gatherTeamRows(stats, directory, team) })), [stats, directory, teams]);
    const hasAnyRows = teamRows.some(section => section.rows.length > 0);
    if (!hasAnyRows) return null;

    return (
        <div style={{
            width: 'min(1100px, 95%)',
            marginTop: 16,
            background: '#062c06',
            color: '#e8ffe8',
            border: '1px solid #0b4a0b',
            borderRadius: 10,
            overflow: 'hidden',
            boxShadow: '0 6px 18px rgba(0,0,0,0.3)'
        }}>
            <div style={{ padding: '8px 10px', borderBottom: '1px solid #0b4a0b', fontWeight: 700, fontSize: 15 }}>
                Player Stats
            </div>
            {teamRows.map(({ team, rows }) => (
                <div key={team} style={{ borderTop: '1px solid #0b4a0b' }}>
                    <div style={{ padding: '8px 10px', background: '#083b08', fontWeight: 600 }}>
                        {TEAM_LABELS[team] || team}
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead>
                                <tr>
                                    <Th>Player</Th>
                                    <Th>Pos</Th>
                                    <Th>Pass C/A</Th>
                                    <Th>Pass Yds</Th>
                                    <Th>TD/INT/S</Th>
                                    <Th>Rush A-Y-TD</Th>
                                    <Th>Rec T-R-Y-TD</Th>
                                    <Th>Drops</Th>
                                    <Th>Def Tk-Sk-INT</Th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.length ? rows.map(row => (
                                    <tr key={row.id} style={{ borderTop: '1px solid #0b4a0b' }}>
                                        <Td>{row.number ? `#${row.number} ${row.name}` : row.name}</Td>
                                        <Td>{row.role}</Td>
                                        <Td mono>{row.passCA}</Td>
                                        <Td mono>{row.passYds}</Td>
                                        <Td mono>{row.passLine}</Td>
                                        <Td mono>{row.rushLine}</Td>
                                        <Td mono>{row.recLine}</Td>
                                        <Td mono>{row.drops}</Td>
                                        <Td mono>{row.defLine}</Td>
                                    </tr>
                                )) : (
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

function Th({ children }) {
    return <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 600 }}>{children}</th>;
}

function Td({ children, mono, colSpan, style }) {
    return (
        <td
            colSpan={colSpan}
            style={{
                padding: '8px 10px',
                fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' : 'inherit',
                ...(style || {})
            }}
        >
            {children}
        </td>
    );
}
