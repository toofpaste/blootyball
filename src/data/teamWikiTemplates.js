import { TEAM_IDS, getTeamIdentity } from '../engine/data/teamLibrary';

const SECTION_TITLES = {
  overview: 'Overview',
  history: 'Origin & History',
  identity: 'Identity & Culture',
  lore: 'Fun Facts & Lore',
};

const TEAM_TEMPLATES = {
  SFB: {
    displayName: 'San Francisco Bay Guardians',
    sections: {
      overview:
        'The San Francisco Bay Guardians were formed by a coalition of waterfront entrepreneurs who wanted a franchise that mirrored the city\'s inventive spirit. The club plays in a reimagined pier district stadium that uses the tide cycle to power sections of the venue, leaning fully into sustainability. Supporters see the Guardians as the blueprint for blending tech optimism with hard-nosed football.',
      history:
        'The franchise entered the league during an era of West Coast expansion, quickly establishing itself through freewheeling passing attacks and opportunistic defense. Early struggles to balance flashy offense with consistent results led to a sweeping analytics overhaul, cementing the team as a pioneer in motion-heavy schemes and player performance tracking.',
      identity:
        'Team culture centers around the mantra “Protect The Bay,” a reference to both environmental stewardship and protecting the home field. Players take part in shoreline cleanups every offseason, and the locker room embraces collaborative leadership where veteran captains serve as rotating “Harbor Wardens.”',
      lore:
        'Home games are preceded by the Guardian\'s Gate Ceremony, a light-and-sound display that traces the Golden Gate Bridge across the stadium roof. The fan base is infamous for coding predictive models that chant play suggestions in real time, a trend that started as a joke on a startup message board.',
    },
  },
  LAX: {
    displayName: 'Los Angeles Solar Kings',
    sections: {
      overview:
        'The Los Angeles Solar Kings embody LA\'s flair for spectacle, playing under a retractable solar canopy that stores energy during day games and powers a choreographed light show at night. The franchise leans into cinematic presentation—halftime features drone cinematography and player introductions directed by local filmmakers.',
      history:
        'Founded by a consortium of entertainment moguls, the Solar Kings debuted with a high-budget roster but learned painful lessons about chemistry in their first campaigns. A reset centered on developing local talent and investing in elite coaching transformed the club into a disciplined contender known for tempo control.',
      identity:
        'Locker room culture promotes creative expression; position groups design their own weekly walkout wardrobes, and leadership workshops involve improv coaches. The team slogan “Crown the Moment” reflects a focus on making every drive feel marquee-worthy while still valuing detail-oriented practice.',
      lore:
        'Fans call themselves the Radiant Court and perform a synchronized “Solar Flare” arm wave after every scoring drive. The franchise also hosts an annual midnight scrimmage during the Perseid meteor shower, drawing thousands for a late-night football-and-astronomy festival.',
    },
  },
  NYC: {
    displayName: 'New York Empire Hawks',
    sections: {
      overview:
        'The New York Empire Hawks operate out of a high-rise stadium perched on the Hudson rail yards, offering skyline views that mirror the franchise\'s skyscraper ambition. The team prides itself on gritty defense and crowd noise that echoes through the urban canyons.',
      history:
        'Born from a merger between two rival borough leagues, the Hawks inherited passionate fan factions that forced early leadership to master coalition-building. Breakthrough seasons came when the organization hired data-minded coordinators who blended physical play with surgical two-minute drills, capturing the city\'s appetite for clutch heroics.',
      identity:
        'Culture revolves around “Flight Paths,” weekly planning sessions where players map out personal goals alongside team adjustments. The Hawks embrace New York hustle: practices end with subway-inspired interval drills, and community outreach includes late-night youth clinics under elevated train lines.',
      lore:
        'Every home win triggers the release of mechanized hawks that glide over the field, a nod to the city\'s falconry program. Rival supporters claim the stadium lights never fully dim, feeding the legend that Empire Hawks fans simply never sleep.',
    },
  },
  MIA: {
    displayName: 'Miami Coastal Wave',
    sections: {
      overview:
        'The Miami Coastal Wave bring tropical swagger to the league with a translucent roof stadium that mimics ocean currents through LED panels. The franchise markets a fast, fluid offense that mirrors the rhythms of South Beach nightlife.',
      history:
        'Miami\'s entry into the league followed a grassroots campaign led by former beach football tournaments. Early seasons featured dazzling highlights but inconsistent finishes until the team invested in year-round conditioning labs that combined surf training and sports science. The result was a roster built to withstand late-season humidity.',
      identity:
        'Players adhere to the “Ride The Tide” creed—stay loose, stay fearless, and overwhelm opponents with relentless pace. The locker room hosts weekly cafecito circles where coaches and players share stories before sunrise walkthroughs, reinforcing family bonds across the roster.',
      lore:
        'Before kickoff, a drum corps performs the “Storm Surge,” a percussion routine timed with programmable fountains. Fans toss biodegradable foam waves after big plays, while a mascot named Riptide rides a jetski through the stadium moat during playoff clinchers.',
    },
  },
  TOR: {
    displayName: 'Toronto Northern Lights',
    sections: {
      overview:
        'The Toronto Northern Lights turn winter into a competitive advantage, playing in a climate-controlled dome that projects aurora patterns across the ceiling. The franchise emphasizes balanced, fundamentally crisp football that reflects the city\'s reputation for measured excellence.',
      history:
        'Toronto joined the league after renovating an abandoned hockey arena into a multi-sport research hub. The Lights earned respect through meticulous scouting in Canadian university programs, cultivating a roster noted for versatility. Their breakthrough season coincided with an analytics partnership that optimized special teams efficiency.',
      identity:
        'Team ethos highlights patience and precision. Weekly “Icebreaker” meetings pair veterans with rookies to tackle strategic puzzles, while strength sessions include curling-inspired balance drills. The organization prizes community engagement with northern communities, staging outreach camps across Ontario and Nunavut.',
      lore:
        'Game days feature the “Polar March,” a parade of supporters in illuminated parkas circling the stadium. A tradition called the Aurora Oath has fans hold up LED bracelets in silence before kickoff, bathing the field in shifting colors to remind players of the franchise\'s northern roots.',
    },
  },
  CHI: {
    displayName: 'Chicago Wind Guardians',
    sections: {
      overview:
        'The Chicago Wind Guardians draw inspiration from the city\'s architectural resilience, suiting up in a lakeshore stadium designed to channel gusts into crowd-boosting whirlwinds. Their brand is smash-mouth football tempered by methodical game planning.',
      history:
        'An ownership group of engineers and former linemen launched the Guardians with a promise to dominate the trenches. Early iterations leaned too heavily on defense until a breakthrough offensive coordinator introduced wind-adjusted passing schemes, finally balancing the attack and igniting deep playoff runs.',
      identity:
        'Locker room culture embraces stoic preparation. Players study film in converted L train cars parked under the stadium, and captains host “Blueprint Sessions” where teammates diagram their favorite plays on drafting tables. The motto “Hold The Line” doubles as both a strategic and civic mantra.',
      lore:
        'The famous “Gale Warning” siren blares whenever the defense forces a turnover, sending fans into synchronized scarf twirls. A bronze statue of the franchise\'s first nose tackle anchors the plaza, with supporters leaving rivets for luck before every postseason game.',
    },
  },
  RNO: {
    displayName: 'Reno High Desert Rush',
    sections: {
      overview:
        'The Reno High Desert Rush play amid sagebrush foothills in an open-air coliseum carved into volcanic rock. The team leans into uptempo offense and opportunistic defense, mirroring the region\'s frontier hustle.',
      history:
        'Reno secured its franchise by pitching the league on altitude training benefits and casino-backed fan amenities. The Rush initially embraced a gambler\'s mentality with aggressive fourth-down calls, later pairing that edge with disciplined player development camps in the Sierra Nevada.',
      identity:
        'Culture thrives on the credo “No Dust, No Glory.” Practices often start at dawn to beat desert heat, and players participate in off-road endurance courses. Leadership councils include local small-business owners, reinforcing the connection between team and community resilience.',
      lore:
        'A pregame thunder drumming circle—borrowed from regional tribal celebrations—signals the Rush charging onto the field. Fans keep a running tally of “Jackpot Plays,” explosive gains that light up slot-machine scoreboards embedded in the concourse.',
    },
  },
  NJY: {
    displayName: 'New Jersey Garden State Charge',
    sections: {
      overview:
        'The New Jersey Garden State Charge operate from a revitalized Meadowlands complex where solar farms meet commuter rail lines. The franchise prides itself on blue-collar execution and special-teams excellence that flips field position.',
      history:
        'Created after a regional referendum, the Charge inherited generations of high school rivalries. Early seasons focused on cultivating in-state talent pipelines, and the turning point arrived when the organization hired a disciplinarian head coach who instilled relentless practice tempos and aggressive blitz packages.',
      identity:
        'Team culture is anchored by “Turnpike Tuesdays,” full-squad meetings that highlight community service stories from across the state. The roster embraces adaptability—players frequently cross-train on multiple units, and film sessions are accompanied by legendary deli spreads donated by fans.',
      lore:
        'Supporters pack the “Garden Growl” supporters section, complete with brass bands and choreographed tifo boards featuring highway exit signs. Before every game, a ceremonial toll booth raises to let the team storm the field, symbolizing statewide unity.',
    },
  },
};

export function createInitialTeamWiki() {
  const wiki = {};
  TEAM_IDS.forEach((teamId) => {
    const identity = getTeamIdentity(teamId);
    const template = TEAM_TEMPLATES[teamId] || {
      displayName: identity?.displayName || teamId,
      sections: {
        overview: `${identity?.displayName || teamId} joined the Blootyball Association with a mandate to bring community-first football to the league.`,
        history: 'The franchise traces its roots to local semi-pro circuits and has steadily built a reputation for resilient play.',
        identity: 'Team culture emphasizes adaptability, innovation, and a commitment to entertaining fans across the region.',
        lore: 'Supporters have already begun crafting matchday rituals that give the club one of the most distinctive atmospheres in the league.',
      },
    };

    wiki[teamId] = {
      id: teamId,
      displayName: template.displayName,
      sections: Object.entries(template.sections).map(([sectionId, body]) => ({
        id: sectionId,
        title: SECTION_TITLES[sectionId] || sectionId,
        body,
      })),
      seasonSummaries: [],
      totals: {
        playoffAppearances: 0,
        championships: 0,
        awards: 0,
        bluperbowlWins: 0,
      },
      recordsSet: [],
      notablePlayers: [],
      lastUpdatedSeason: 0,
    };
  });
  return wiki;
}

export function cloneTeamWikiMap(map = {}) {
  const clone = {};
  Object.entries(map).forEach(([teamId, entry]) => {
    clone[teamId] = {
      id: entry.id,
      displayName: entry.displayName,
      sections: Array.isArray(entry.sections)
        ? entry.sections.map((section) => ({ ...section }))
        : [],
      seasonSummaries: Array.isArray(entry.seasonSummaries)
        ? entry.seasonSummaries.map((summary) => ({
            seasonNumber: summary.seasonNumber ?? null,
            recordText: summary.recordText || '0-0',
            playoffResult: summary.playoffResult || 'Regular Season',
            pointsFor: summary.pointsFor ?? 0,
            pointsAgainst: summary.pointsAgainst ?? 0,
            awards: Array.isArray(summary.awards) ? [...summary.awards] : [],
            notablePlayers: Array.isArray(summary.notablePlayers)
              ? summary.notablePlayers.map((player) => ({ ...player }))
              : [],
            notes: summary.notes || '',
          }))
        : [],
      totals: {
        playoffAppearances: entry.totals?.playoffAppearances ?? 0,
        championships: entry.totals?.championships ?? 0,
        awards: entry.totals?.awards ?? 0,
        bluperbowlWins: entry.totals?.bluperbowlWins ?? 0,
      },
      recordsSet: Array.isArray(entry.recordsSet)
        ? entry.recordsSet.map((record) => ({ ...record }))
        : [],
      notablePlayers: Array.isArray(entry.notablePlayers)
        ? entry.notablePlayers.map((player) => ({
            ...player,
            highlights: Array.isArray(player.highlights) ? [...player.highlights] : [],
            seasons: Array.isArray(player.seasons) ? [...player.seasons] : [],
          }))
        : [],
      lastUpdatedSeason: entry.lastUpdatedSeason ?? 0,
      aiSections: entry.aiSections ? { ...entry.aiSections } : undefined,
    };
  });
  return clone;
}

