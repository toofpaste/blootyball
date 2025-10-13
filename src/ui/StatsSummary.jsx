import React, { useState } from 'react';
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

    const teamSections = TEAMS.map(team => ({
        team,
        rows: gatherTopPlayers(stats, directory, team),
    }));

    const hasAnyRows = teamSections.some(section => section.rows.length > 0);

    return (
        <>
            <div
                style={{
                    background: 'linear-gradient(180deg, rgba(6,44,6,0.96) 0%, rgba(4,28,4,0.98) 100%)',
                    color: '#f2fff2',
                    border: '1px solid #165e16',
                    borderRadius: 16,
                    boxShadow: '0 14px 30px rgba(0,0,0,0.35)',
                    overflow: 'hidden',
                    width: '100%',
                }}
            >
                <div
                    style={{
                        padding: '12px 18px',
                        borderBottom: '1px solid rgba(9,72,9,0.85)',
                        fontWeight: 700,
                        fontSize: 16,
                        letterSpacing: 0.4,
                        textTransform: 'uppercase',
                        background: 'rgba(12,64,12,0.85)',
                    }}
                >
                    Team Leaders
                </div>
                {hasAnyRows ? (
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        {teamSections.map(({ team, rows }) => (
                            <div key={team} style={{ borderTop: '1px solid rgba(14,74,14,0.7)' }}>
                                <div
                                    style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        padding: '10px 18px',
                                        background: 'rgba(8,59,8,0.85)',
                                        fontWeight: 600,
                                        fontSize: 14,
                                    }}
                                >
                                    <span>{TEAM_LABELS[team] || team}</span>
                                    <button
                                        onClick={() => setOpenTeam(team)}
                                        style={{
                                            background: 'rgba(20,92,20,0.75)',
                                            color: '#f2fff2',
                                            border: '1px solid rgba(232,255,232,0.25)',
                                            borderRadius: 999,
                                            padding: '6px 12px',
                                            fontSize: 11,
                                            cursor: 'pointer',
                                            transition: 'all 140ms ease',
                                            boxShadow: '0 6px 12px rgba(0,0,0,0.25)',
                                        }}
                                    >
                                        View Full Stats
                                    </button>
                                </div>
                                {rows.length ? (
                                    <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 12 }}>
                                        <thead>
                                            <tr style={{ background: 'rgba(10,70,10,0.85)' }}>
                                                <Th>Player</Th>
                                                <Th align="right">Passing</Th>
                                                <Th align="right">Rushing</Th>
                                                <Th align="right">Receiving</Th>
                                                <Th align="right">Defense</Th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {rows.map((row, idx) => {
                                                const isStriped = idx % 2 === 0;
                                                return (
                                                    <tr
                                                        key={row.id}
                                                        style={{
                                                            borderTop: '1px solid rgba(14,74,14,0.35)',
                                                            background: isStriped ? 'rgba(7,45,7,0.75)' : 'rgba(5,32,5,0.9)'
                                                        }}
                                                    >
                                                        <Td style={{ fontWeight: 600 }}>
                                                            <span style={{ display: 'block' }}>{row.name}</span>
                                                            <span style={{ display: 'block', fontWeight: 400, color: '#9bd79b', fontSize: 11 }}>
                                                                {row.role} {row.number ? `• #${row.number}` : ''}
                                                            </span>
                                                        </Td>
                                                        <Td mono align="right">{row.pass}</Td>
                                                        <Td mono align="right">{row.rush}</Td>
                                                        <Td mono align="right">{row.receive}</Td>
                                                        <Td mono align="right">{row.defense}</Td>
                                                    </tr>
                                                );
                                            })}
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

function Th({ children, align = 'left' }) {
    return (
        <th
            style={{
                textAlign: align,
                padding: '10px 14px',
                fontWeight: 600,
                fontSize: 11,
                letterSpacing: 0.4,
                textTransform: 'uppercase',
                color: '#c1f0c1'
            }}
        >
            {children}
        </th>
    );
}

function Td({ children, mono, style, align = 'left' }) {
    return (
        <td
            style={{
                padding: '10px 14px',
                fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' : 'inherit',
                verticalAlign: 'top',
                textAlign: align,
                ...(style || {}),
            }}
        >
            {children}
        </td>
    );
}
