export const COACH_LIBRARY = {
  SFB: {
    id: 'SFB-HC',
    name: 'Avery Morgan',
    philosophy: 'offense',
    tacticalIQ: 1.22,
    playcallingIQ: 1.28,
    clock: { hurry: 135, defensive: 118, must: 32, margin: 7 },
    playerBoosts: {
      offense: {
        team: { awareness: 0.05, catch: 0.03 },
        positions: {
          QB: { throwAcc: 0.08, awareness: 0.05 },
          WR1: { catch: 0.08, speed: 0.05 },
          WR2: { catch: 0.05, awareness: 0.03 },
          WR3: { catch: 0.04, agility: 0.03 },
          TE: { awareness: 0.04, strength: 0.03 },
        },
      },
      defense: {
        team: { awareness: 0.02 },
        positions: {
          CB1: { speed: 0.03, awareness: 0.03 },
          S1: { awareness: 0.04 },
        },
      },
    },
    development: { offense: 0.32, defense: 0.16, qb: 0.34, skill: 0.28, run: 0.22 },
    tendencies: { passBias: 0.22, aggression: 0.18 },
  },
  LAX: {
    id: 'LAX-HC',
    name: 'Keon Whitfield',
    philosophy: 'balanced',
    tacticalIQ: 1.18,
    playcallingIQ: 1.15,
    clock: { hurry: 140, defensive: 120, must: 35, margin: 8 },
    playerBoosts: {
      offense: {
        team: { awareness: 0.03 },
        positions: {
          RB: { speed: 0.04, strength: 0.03 },
          TE: { catch: 0.04, strength: 0.02 },
        },
      },
      defense: {
        team: { strength: 0.03 },
        positions: {
          LB1: { awareness: 0.04, strength: 0.03 },
          LB2: { awareness: 0.03 },
        },
      },
    },
    development: { offense: 0.26, defense: 0.26, qb: 0.2, skill: 0.24, run: 0.28 },
    tendencies: { runBias: 0.12, aggression: 0.05 },
  },
  NYC: {
    id: 'NYC-HC',
    name: 'Jada Ellison',
    philosophy: 'defense',
    tacticalIQ: 1.3,
    playcallingIQ: 1.12,
    clock: { hurry: 128, defensive: 108, must: 30, margin: 6 },
    playerBoosts: {
      offense: {
        team: { awareness: 0.02 },
        positions: {
          QB: { awareness: 0.04 },
          WR1: { catch: 0.03 },
        },
      },
      defense: {
        team: { awareness: 0.05, strength: 0.03 },
        positions: {
          DT: { strength: 0.05 },
          LB1: { speed: 0.03, awareness: 0.03 },
          S2: { awareness: 0.04 },
        },
      },
    },
    development: { offense: 0.18, defense: 0.34, qb: 0.18, skill: 0.22, run: 0.2 },
    tendencies: { passBias: -0.05, aggression: 0.08 },
  },
  MIA: {
    id: 'MIA-HC',
    name: 'Solomon Drake',
    philosophy: 'offense',
    tacticalIQ: 1.16,
    playcallingIQ: 1.24,
    clock: { hurry: 138, defensive: 118, must: 34, margin: 8 },
    playerBoosts: {
      offense: {
        team: { speed: 0.03, agility: 0.02 },
        positions: {
          QB: { throwPow: 0.05, throwAcc: 0.06 },
          WR2: { speed: 0.05 },
          RB: { agility: 0.05 },
        },
      },
      defense: {
        team: { speed: 0.02 },
        positions: {
          CB2: { speed: 0.04 },
          NB: { agility: 0.04 },
        },
      },
    },
    development: { offense: 0.3, defense: 0.18, qb: 0.3, skill: 0.26, run: 0.2 },
    tendencies: { passBias: 0.18, aggression: 0.16 },
  },
  TOR: {
    id: 'TOR-HC',
    name: 'Ibrahim Kole',
    philosophy: 'balanced',
    tacticalIQ: 1.14,
    playcallingIQ: 1.1,
    clock: { hurry: 142, defensive: 124, must: 36, margin: 9 },
    playerBoosts: {
      offense: {
        team: { awareness: 0.03 },
        positions: {
          TE: { catch: 0.04, awareness: 0.04 },
          WR3: { agility: 0.04 },
        },
      },
      defense: {
        team: { awareness: 0.03 },
        positions: {
          S1: { awareness: 0.04 },
          CB1: { agility: 0.03 },
        },
      },
    },
    development: { offense: 0.24, defense: 0.24, qb: 0.2, skill: 0.22, run: 0.24 },
    tendencies: { runBias: 0.08, aggression: 0.04 },
  },
  CHI: {
    id: 'CHI-HC',
    name: 'Marta Kline',
    philosophy: 'defense',
    tacticalIQ: 1.26,
    playcallingIQ: 1.08,
    clock: { hurry: 130, defensive: 110, must: 32, margin: 6 },
    playerBoosts: {
      offense: {
        team: { strength: 0.02 },
        positions: {
          RB: { strength: 0.05 },
          LT: { strength: 0.04 },
        },
      },
      defense: {
        team: { strength: 0.04, awareness: 0.03 },
        positions: {
          DT: { strength: 0.05 },
          LB2: { awareness: 0.04 },
          RE: { strength: 0.04 },
        },
      },
    },
    development: { offense: 0.18, defense: 0.32, qb: 0.16, skill: 0.2, run: 0.28 },
    tendencies: { runBias: 0.1, aggression: 0.06 },
  },
  RNO: {
    id: 'RNO-HC',
    name: 'Nate Cooley',
    philosophy: 'offense',
    tacticalIQ: 1.12,
    playcallingIQ: 1.2,
    clock: { hurry: 136, defensive: 122, must: 34, margin: 8 },
    playerBoosts: {
      offense: {
        team: { speed: 0.04 },
        positions: {
          WR1: { speed: 0.05, catch: 0.05 },
          WR2: { catch: 0.04 },
          RB: { agility: 0.04 },
        },
      },
      defense: {
        team: { agility: 0.02 },
        positions: {
          CB1: { speed: 0.04 },
          S2: { awareness: 0.03 },
        },
      },
    },
    development: { offense: 0.28, defense: 0.2, qb: 0.26, skill: 0.28, run: 0.22 },
    tendencies: { passBias: 0.14, aggression: 0.12 },
  },
  NJY: {
    id: 'NJY-HC',
    name: 'Clarissa Holt',
    philosophy: 'balanced',
    tacticalIQ: 1.2,
    playcallingIQ: 1.16,
    clock: { hurry: 134, defensive: 116, must: 33, margin: 7 },
    playerBoosts: {
      offense: {
        team: { awareness: 0.03 },
        positions: {
          QB: { throwAcc: 0.05 },
          WR2: { awareness: 0.04 },
          RB: { strength: 0.03 },
        },
      },
      defense: {
        team: { awareness: 0.03 },
        positions: {
          LB1: { agility: 0.03 },
          CB2: { awareness: 0.04 },
        },
      },
    },
    development: { offense: 0.26, defense: 0.24, qb: 0.24, skill: 0.26, run: 0.24 },
    tendencies: { passBias: 0.06, runBias: 0.04, aggression: 0.07 },
  },
};

export function getCoachDefinition(teamId) {
  return COACH_LIBRARY[teamId] || null;
}
