import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import PlayerCardModal from './PlayerCardModal';
import { buildPlayerLookup } from './teamDirectoryData';

const PlayerCardContext = createContext({ openPlayerCard: () => {} });

export function PlayerCardProvider({ season, league, children }) {
  const [focus, setFocus] = useState(null);

  const lookup = useMemo(() => buildPlayerLookup(season, league), [season, league]);
  const teamById = useMemo(() => {
    const map = {};
    lookup.teams.forEach((team) => {
      if (team?.id) map[team.id] = team;
    });
    return map;
  }, [lookup.teams]);

  const openPlayerCard = useCallback(
    ({ playerId, entry, teamId }) => {
      if (entry) {
        const team = teamId ? teamById[teamId] || entry.team || null : entry.team || null;
        setFocus({ entry, team });
        return;
      }
      if (!playerId) return;
      const found = lookup.directory[playerId];
      if (found) {
        setFocus({ entry: found.player, team: found.team });
      }
    },
    [lookup.directory, teamById],
  );

  const close = useCallback(() => setFocus(null), []);

  const value = useMemo(() => ({ openPlayerCard }), [openPlayerCard]);

  return (
    <PlayerCardContext.Provider value={value}>
      {children}
      <PlayerCardModal open={!!focus} onClose={close} entry={focus?.entry || null} team={focus?.team || null} />
    </PlayerCardContext.Provider>
  );
}

export function usePlayerCard() {
  return useContext(PlayerCardContext);
}

