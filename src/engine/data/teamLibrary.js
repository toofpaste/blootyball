import sfb from './teams/sfb.json';
import lax from './teams/lax.json';
import nyc from './teams/nyc.json';
import mia from './teams/mia.json';
import tor from './teams/tor.json';
import chi from './teams/chi.json';
import rno from './teams/rno.json';
import njy from './teams/njy.json';

export const TEAM_LIBRARY = {
  [sfb.id]: sfb,
  [lax.id]: lax,
  [nyc.id]: nyc,
  [mia.id]: mia,
  [tor.id]: tor,
  [chi.id]: chi,
  [rno.id]: rno,
  [njy.id]: njy,
};

export const TEAM_IDS = Object.keys(TEAM_LIBRARY);

export function getTeamData(teamId) {
  return TEAM_LIBRARY[teamId] || null;
}

export function getTeamIdentity(teamId) {
  const data = getTeamData(teamId);
  if (!data) return null;
  return {
    id: data.id,
    city: data.city,
    name: data.name,
    displayName: `${data.city} ${data.name}`,
    abbr: data.abbr,
    colors: data.colors || {},
  };
}

export function listTeamIdentities() {
  return TEAM_IDS.map(id => getTeamIdentity(id)).filter(Boolean);
}
