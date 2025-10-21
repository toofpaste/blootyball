import React, { useState } from 'react';
import PlayerStatsTable from './PlayerStatsTable';
import Modal from './Modal';
import { usePlayerCard } from './PlayerCardProvider';

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

function formatStatGroup(label, fragments = []) {
    const content = fragments.filter(Boolean).join(', ');
    if (!content) return null;
    return `${label} ${content}`;
}

function buildSummary(stat = {}) {
    const passing = stat.passing || {};
    const rushing = stat.rushing || {};
    const receiving = stat.receiving || {};
    const defense = stat.defense || {};

    const sections = [];

    if ((passing.attempts || 0) > 0 || (passing.completions || 0) > 0 || (passing.yards || 0) !== 0) {
        sections.push(
            formatStatGroup('Pass', [
                (passing.attempts || 0) > 0 ? `${passing.completions ?? 0}/${passing.attempts ?? 0}` : null,
                (passing.yards || 0) !== 0 ? `${Math.round(passing.yards || 0)}y` : null,
                (passing.touchdowns || 0) > 0 ? `${passing.touchdowns}TD` : null,
                (passing.interceptions || 0) > 0 ? `${passing.interceptions}INT` : null,
            ])
        );
    }

    if ((rushing.attempts || 0) > 0 || (rushing.yards || 0) !== 0) {
        sections.push(
            formatStatGroup('Rush', [
                (rushing.attempts || 0) > 0 ? `${rushing.attempts}att` : null,
                (rushing.yards || 0) !== 0 ? `${Math.round(rushing.yards || 0)}y` : null,
                (rushing.touchdowns || 0) > 0 ? `${rushing.touchdowns}TD` : null,
            ])
        );
    }

    if ((receiving.targets || 0) > 0 || (receiving.yards || 0) !== 0) {
        sections.push(
            formatStatGroup('Rec', [
                (receiving.targets || 0) > 0 ? `${receiving.receptions ?? 0}/${receiving.targets}ct` : null,
                (receiving.yards || 0) !== 0 ? `${Math.round(receiving.yards || 0)}y` : null,
                (receiving.touchdowns || 0) > 0 ? `${receiving.touchdowns}TD` : null,
            ])
        );
    }

    if ((defense.tackles || 0) > 0 || (defense.sacks || 0) > 0 || (defense.interceptions || 0) > 0) {
        sections.push(
            formatStatGroup('Def', [
                (defense.tackles || 0) > 0 ? `${defense.tackles}Tk` : null,
                (defense.sacks || 0) > 0 ? `${defense.sacks}Sk` : null,
                (defense.interceptions || 0) > 0 ? `${defense.interceptions}INT` : null,
            ])
        );
    }

    return sections.filter(Boolean).join('  |  ');
}

function buildRow(playerId, meta = {}, stat = {}, injuredReserve = {}) {
    const passing = stat.passing || {};
    const rushing = stat.rushing || {};
    const receiving = stat.receiving || {};
    const defense = stat.defense || {};
    const irEntry = injuredReserve[playerId] || null;
    const irPlayer = irEntry?.player || null;
    const fallbackName = irPlayer
        ? `${irPlayer.firstName || ''}${irPlayer.lastName ? ` ${irPlayer.lastName}` : ''}`.trim() || irPlayer.fullName || playerId
        : playerId;
    const resolvedName = meta.fullName || meta.name || fallbackName;

    return {
        id: playerId,
        name: resolvedName,
        number: meta.number,
        role: meta.role || '—',
        onInjuredReserve: Boolean(irEntry),
        injury: irEntry
            ? {
                description: irEntry.description || '',
                gamesRemaining: irEntry.gamesRemaining ?? null,
            }
            : null,
        pass:
            passing.attempts || passing.completions || passing.yards
                ? `${passing.completions ?? 0}/${passing.attempts ?? 0}, ${Math.round(passing.yards || 0)} yds, ${passing.touchdowns ?? 0} TD / ${passing.interceptions ?? 0} INT`
                : '—',
        rush: rushing.attempts
            ? `${rushing.attempts} att, ${Math.round(rushing.yards || 0)} yds, ${rushing.touchdowns ?? 0} TD`
            : '—',
        receive: receiving.targets
            ? `${receiving.targets} tgt, ${receiving.receptions ?? 0} rec, ${Math.round(receiving.yards || 0)} yds, ${receiving.touchdowns ?? 0} TD`
            : '—',
        defense:
            defense.tackles || defense.sacks || defense.interceptions
                ? `${defense.tackles ?? 0} Tk, ${defense.sacks ?? 0} Sk, ${defense.interceptions ?? 0} INT`
                : '—',
        score: buildScore(stat),
        summary: buildSummary(stat),
    };
}

function gatherTopPlayers(stats = {}, directory = {}, teamId, injuredReserve = {}) {
    const rows = Object.entries(directory)
        .filter(([, meta]) => meta.team === teamId)
        .map(([id, meta]) => ({
            ...buildRow(id, meta, stats[id] || {}, injuredReserve),
            teamId,
        }))
        .filter(row => row.pass !== '—' || row.rush !== '—' || row.receive !== '—' || row.defense !== '—');

    rows.sort((a, b) => b.score - a.score);

    return rows.slice(0, 3);
}

export default function StatsSummary({ stats = {}, directory = {}, teams = [], title = 'Team Leaders', injuredReserve = {} }) {
    const [openTeam, setOpenTeam] = useState(null);
    const { openPlayerCard } = usePlayerCard();

    const teamSections = teams.map(team => ({
        team,
        rows: gatherTopPlayers(stats, directory, team.id, injuredReserve),
    }));

    const hasAnyRows = teamSections.some(section => section.rows.length > 0);
    const columnCount = Math.max(1, teamSections.length);
    const useColumns = columnCount > 1;

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
                    {title}
                </div>
                {hasAnyRows ? (
                    <div
                        style={{
                            display: 'grid',
                            gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
                            borderTop: '1px solid rgba(14,74,14,0.7)',
                        }}
                    >
                        {teamSections.map(({ team, rows }, index) => (
                            <div
                                key={team.id}
                                style={{
                                    borderLeft: useColumns && index > 0 ? '1px solid rgba(14,74,14,0.6)' : 'none',
                                }}
                            >
                                <div
                                    style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        padding: '10px 16px',
                                        background: 'rgba(8,59,8,0.85)',
                                        fontWeight: 600,
                                        fontSize: 14,
                                    }}
                                >
                                    <span>{team.displayName || team.label || team.id}</span>
                                    <button
                                        onClick={() => setOpenTeam(team.id)}
                                        style={{
                                            background: 'rgba(20,92,20,0.75)',
                                            color: '#f2fff2',
                                            border: '1px solid rgba(232,255,232,0.25)',
                                            borderRadius: 999,
                                            padding: '5px 10px',
                                            fontSize: 10,
                                            cursor: 'pointer',
                                            transition: 'all 140ms ease',
                                            boxShadow: '0 6px 12px rgba(0,0,0,0.25)',
                                        }}
                                    >
                                        View Full Stats
                                    </button>
                                </div>
                                {rows.length ? (
                                    <table
                                        style={{
                                            width: '100%',
                                            borderCollapse: 'separate',
                                            borderSpacing: 0,
                                            fontSize: 12,
                                            tableLayout: 'fixed',
                                        }}
                                    >
                                        <thead>
                                            <tr style={{ background: 'rgba(10,70,10,0.85)' }}>
                                                <Th>Player</Th>
                                                <Th align="left">Highlights</Th>
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
                                                            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => openPlayerCard({ playerId: row.id, teamId: row.teamId })}
                                                                    style={{
                                                                        background: 'none',
                                                                        border: 'none',
                                                                        padding: 0,
                                                                        margin: 0,
                                                                        color: '#f2fff2',
                                                                        fontWeight: 600,
                                                                        cursor: 'pointer',
                                                                        textAlign: 'left',
                                                                    }}
                                                                >
                                                                    {row.name}
                                                                </button>
                                                                {row.onInjuredReserve ? (
                                                                    <span
                                                                        style={{
                                                                            display: 'inline-flex',
                                                                            alignItems: 'center',
                                                                            padding: '1px 6px',
                                                                            borderRadius: 999,
                                                                            background: 'rgba(124,22,22,0.25)',
                                                                            color: '#ff8282',
                                                                            fontSize: 9,
                                                                            fontWeight: 700,
                                                                            letterSpacing: 0.8,
                                                                            textTransform: 'uppercase',
                                                                        }}
                                                                    >
                                                                        IR
                                                                    </span>
                                                                ) : null}
                                                            </span>
                                                            <span style={{ display: 'block', fontWeight: 400, color: '#9bd79b', fontSize: 11 }}>
                                                                {row.role} {row.number ? `• #${row.number}` : ''}
                                                            </span>
                                                            {row.onInjuredReserve && (row.injury?.description || row.injury?.gamesRemaining != null) ? (
                                                                <span style={{ display: 'block', fontWeight: 400, color: '#ff9f9f', fontSize: 11 }}>
                                                                    {row.injury?.description || 'Injured'}
                                                                    {row.injury?.gamesRemaining != null
                                                                        ? ` • ${row.injury.gamesRemaining} game${row.injury.gamesRemaining === 1 ? '' : 's'} remaining`
                                                                        : ''}
                                                                </span>
                                                            ) : null}
                                                        </Td>
                                                        <Td
                                                            mono
                                                            align="left"
                                                            style={{
                                                                color: '#d2f4d2',
                                                                whiteSpace: 'nowrap',
                                                                overflow: 'hidden',
                                                                textOverflow: 'ellipsis',
                                                                width: '68%',
                                                            }}
                                                        >
                                                            {row.summary || '—'}
                                                        </Td>
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
                title={`${(teams.find(t => t.id === openTeam)?.displayName) || 'Team'} - Full Stats`}
                width="min(92vw, 960px)"
            >
                {openTeam ? (
                    <PlayerStatsTable
                        stats={stats}
                        directory={directory}
                        teams={teams.filter(t => t.id === openTeam)}
                    />
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
