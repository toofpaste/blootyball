import React, { useMemo, useState } from 'react';
import { TEAM_RED, TEAM_BLK } from '../engine/constants';
import PlayerStatsTable from './PlayerStatsTable';
import Modal from './Modal';

const TEAM_LABELS = {
    [TEAM_RED]: 'Red Team',
    [TEAM_BLK]: 'Black Team',
};

const TEAMS = [TEAM_RED, TEAM_BLK];

function buildScore(stat = {}) {
    const passing = stat.passing || {};
    const rushing = stat.rushing || {};
    const receiving = stat.receiving || {};
    const defense = stat.defense || {};

    const yards = Math.abs(passing.yards || 0) + Math.abs(rushing.yards || 0) + Math.abs(receiving.yards || 0);
    const touchdowns = (passing.touchdowns || 0) + (rushing.touchdowns || 0) + (receiving.touchdowns || 0);
    const touches = (passing.attempts || 0) + (passing.completions || 0) + (rushing.attempts || 0) + (receiving.targets || 0);
    const defenseEvents = (defense.tackles || 0) + (defense.sacks || 0) + (defense.interceptions || 0);

    return yards + touchdowns * 15 + touches * 2 + defenseEvents * 6;
}

function buildRow(playerId, meta = {}, stat = {}) {
    const passing = stat.passing || {};
    const rushing = stat.rushing || {};
    const receiving = stat.receiving || {};
    const defense = stat.defense || {};

    return {
        id: playerId,
        name: meta.fullName || playerId,
        number: meta.number,
        role: meta.role || '—',
        pass: passing.attempts || passing.completions || passing.yards
            ? `${passing.completions ?? 0}/${passing.attempts ?? 0}, ${Math.round(passing.yards || 0)} yds, ${passing.touchdowns ?? 0} TD / ${passing.interceptions ?? 0} INT`
            : '—',
        rush: rushing.attempts
            ? `${rushing.attempts} att, ${Math.round(rushing.yards || 0)} yds, ${rushing.touchdowns ?? 0} TD`
            : '—',
        receive: receiving.targets
            ? `${receiving.targets} tgt, ${receiving.receptions ?? 0} rec, ${Math.round(receiving.yards || 0)} yds, ${receiving.touchdowns ?? 0} TD`
            : '—',
        defense: defense.tackles || defense.sacks || defense.interceptions
            ? `${defense.tackles ?? 0} Tk, ${defense.sacks ?? 0} Sk, ${defense.interceptions ?? 0} INT`
            : '—',
        score: buildScore(stat),
    };
}

function gatherTopPlayers(stats = {}, directory = {}, teamId) {
    const rows = Object.entries(directory)
        .filter(([, meta]) => meta.team === teamId)
        .map(([id, meta]) => ({
            ...buildRow(id, meta, stats[id] || {}),
        }))
        .filter(row => row.pass !== '—' || row.rush !== '—' || row.receive !== '—' || row.defense !== '—');

    rows.sort((a, b) => b.score - a.score);

    return rows.slice(0, 3);
}

export default function StatsSummary({ stats = {}, directory = {} }) {
    const [openTeam, setOpenTeam] = useState(null);

    const teamSections = useMemo(
        () => TEAMS.map(team => ({ team, rows: gatherTopPlayers(stats, directory, team) })),
        [stats, directory]
    );

    const hasAnyRows = teamSections.some(section => section.rows.length > 0);

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
                        padding: '10px 12px',
                        borderBottom: '1px solid #0b4a0b',
                        fontWeight: 700,
                        fontSize: 15,
                        background: '#083b08',
                    }}
                >
                    Team Leaders
                </div>
                {hasAnyRows ? (
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        {teamSections.map(({ team, rows }) => (
                            <div key={team} style={{ borderTop: '1px solid rgba(11,74,11,0.7)' }}>
                                <div
                                    style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        padding: '8px 12px',
                                        background: 'rgba(8,59,8,0.9)',
                                        fontWeight: 600,
                                        fontSize: 13,
                                    }}
                                >
                                    <span>{TEAM_LABELS[team] || team}</span>
                                    <button
                                        onClick={() => setOpenTeam(team)}
                                        style={{
                                            background: '#145c14',
                                            color: '#e8ffe8',
                                            border: '1px solid rgba(232,255,232,0.35)',
                                            borderRadius: 6,
                                            padding: '4px 8px',
                                            fontSize: 11,
                                            cursor: 'pointer',
                                        }}
                                    >
                                        View Full Stats
                                    </button>
                                </div>
                                {rows.length ? (
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                                        <tbody>
                                            {rows.map(row => (
                                                <tr key={row.id} style={{ borderTop: '1px solid rgba(11,74,11,0.5)' }}>
                                                    <Td style={{ fontWeight: 600 }}>
                                                        {row.number ? `#${row.number} ${row.name}` : row.name}
                                                        <span style={{ display: 'block', fontWeight: 400, color: '#9bd79b' }}>
                                                            {row.role}
                                                        </span>
                                                    </Td>
                                                    <Td mono>{row.pass}</Td>
                                                    <Td mono>{row.rush}</Td>
                                                    <Td mono>{row.receive}</Td>
                                                    <Td mono>{row.defense}</Td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                ) : (
                                    <div style={{ padding: '10px 12px', fontStyle: 'italic', color: '#cfe9cf' }}>
                                        No standout performances yet.
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                ) : (
                    <div style={{ padding: '12px', fontStyle: 'italic', color: '#cfe9cf' }}>
                        No player stats recorded yet.
                    </div>
                )}
            </div>
            <Modal
                open={Boolean(openTeam)}
                onClose={() => setOpenTeam(null)}
                title={`${TEAM_LABELS[openTeam] || 'Team'} - Full Stats`}
                width="min(92vw, 960px)"
            >
                {openTeam ? (
                    <PlayerStatsTable stats={stats} directory={directory} teams={[openTeam]} />
                ) : null}
            </Modal>
        </>
    );
}

function Td({ children, mono, style }) {
    return (
        <td
            style={{
                padding: '8px 10px',
                fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' : 'inherit',
                verticalAlign: 'top',
                ...(style || {}),
            }}
        >
            {children}
        </td>
    );
}
