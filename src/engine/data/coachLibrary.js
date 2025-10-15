export const COACH_LIBRARY = {
  SFB: {
    id: 'SFB-HC',
    name: 'Avery Morgan',
    philosophy: 'offense',
    tacticalIQ: 1.36,
    playcallingIQ: 1.42,
    clock: { hurry: 150, defensive: 122, must: 28, margin: 5 },
    playerBoosts: {
      offense: {
        team: { awareness: 0.07, catch: 0.05, speed: 0.03 },
        positions: {
          QB: { throwAcc: 0.12, awareness: 0.07 },
          WR1: { catch: 0.1, speed: 0.06 },
          WR2: { catch: 0.07, awareness: 0.05 },
          WR3: { catch: 0.06, agility: 0.05 },
          TE: { awareness: 0.05, strength: 0.04 },
        },
      },
      defense: {
        team: { awareness: 0.03 },
        positions: {
          CB1: { speed: 0.04, awareness: 0.04 },
          S1: { awareness: 0.05 },
        },
      },
    },
    development: { offense: 0.38, defense: 0.14, qb: 0.42, skill: 0.34, run: 0.22 },
    tendencies: { passBias: 0.32, aggression: 0.24 },
  },
  LAX: {
    id: 'LAX-HC',
    name: 'Keon Whitfield',
    philosophy: 'balanced',
    tacticalIQ: 1.02,
    playcallingIQ: 1.0,
    clock: { hurry: 132, defensive: 112, must: 40, margin: 11 },
    playerBoosts: {
      offense: {
        team: { awareness: 0.02 },
        positions: {
          RB: { speed: 0.03, strength: 0.02 },
          TE: { catch: 0.02, strength: 0.02 },
        },
      },
      defense: {
        team: { strength: 0.02 },
        positions: {
          LB1: { awareness: 0.03, strength: 0.02 },
          LB2: { awareness: 0.02 },
        },
      },
    },
    development: { offense: 0.2, defense: 0.22, qb: 0.16, skill: 0.18, run: 0.24 },
    tendencies: { runBias: 0.18, aggression: -0.02 },
  },
  NYC: {
    id: 'NYC-HC',
    name: 'Jada Ellison',
    philosophy: 'defense',
    tacticalIQ: 1.32,
    playcallingIQ: 1.04,
    clock: { hurry: 122, defensive: 100, must: 38, margin: 10 },
    playerBoosts: {
      offense: {
        team: { awareness: 0.01 },
        positions: {
          QB: { awareness: 0.03 },
          WR1: { catch: 0.02 },
        },
      },
      defense: {
        team: { awareness: 0.08, strength: 0.06 },
        positions: {
          DT: { strength: 0.07 },
          LB1: { speed: 0.05, awareness: 0.04 },
          S2: { awareness: 0.05 },
        },
      },
    },
    development: { offense: 0.14, defense: 0.38, qb: 0.14, skill: 0.18, run: 0.16 },
    tendencies: { passBias: -0.12, aggression: 0.04 },
  },
  MIA: {
    id: 'MIA-HC',
    name: 'Solomon Drake',
    philosophy: 'offense',
    tacticalIQ: 1.1,
    playcallingIQ: 1.3,
    clock: { hurry: 142, defensive: 112, must: 36, margin: 10 },
    playerBoosts: {
      offense: {
        team: { speed: 0.04, agility: 0.03 },
        positions: {
          QB: { throwPow: 0.06, throwAcc: 0.08 },
          WR2: { speed: 0.06 },
          RB: { agility: 0.06 },
        },
      },
      defense: {
        team: { speed: 0.02 },
        positions: {
          CB2: { speed: 0.05 },
          NB: { agility: 0.05 },
        },
      },
    },
    development: { offense: 0.34, defense: 0.16, qb: 0.36, skill: 0.3, run: 0.18 },
    tendencies: { passBias: 0.26, aggression: 0.18 },
  },
  TOR: {
    id: 'TOR-HC',
    name: 'Ibrahim Kole',
    philosophy: 'balanced',
    tacticalIQ: 1.08,
    playcallingIQ: 1.05,
    clock: { hurry: 140, defensive: 126, must: 38, margin: 9 },
    playerBoosts: {
      offense: {
        team: { awareness: 0.02, strength: 0.02 },
        positions: {
          TE: { catch: 0.03, awareness: 0.03 },
          WR3: { agility: 0.05 },
        },
      },
      defense: {
        team: { awareness: 0.03 },
        positions: {
          S1: { awareness: 0.05 },
          CB1: { agility: 0.04 },
        },
      },
    },
    development: { offense: 0.22, defense: 0.26, qb: 0.18, skill: 0.2, run: 0.28 },
    tendencies: { runBias: 0.16, aggression: 0.02 },
  },
  CHI: {
    id: 'CHI-HC',
    name: 'Marta Kline',
    philosophy: 'defense',
    tacticalIQ: 1.24,
    playcallingIQ: 0.98,
    clock: { hurry: 128, defensive: 108, must: 40, margin: 8 },
    playerBoosts: {
      offense: {
        team: { strength: 0.01 },
        positions: {
          RB: { strength: 0.05 },
          LT: { strength: 0.05 },
        },
      },
      defense: {
        team: { strength: 0.05, awareness: 0.04 },
        positions: {
          DT: { strength: 0.06 },
          LB2: { awareness: 0.05 },
          RE: { strength: 0.05 },
        },
      },
    },
    development: { offense: 0.16, defense: 0.36, qb: 0.14, skill: 0.18, run: 0.32 },
    tendencies: { runBias: 0.12, aggression: 0.02 },
  },
  RNO: {
    id: 'RNO-HC',
    name: 'Nate Cooley',
    philosophy: 'offense',
    tacticalIQ: 1.04,
    playcallingIQ: 1.18,
    clock: { hurry: 136, defensive: 120, must: 34, margin: 9 },
    playerBoosts: {
      offense: {
        team: { speed: 0.05 },
        positions: {
          WR1: { speed: 0.06, catch: 0.06 },
          WR2: { catch: 0.05 },
          RB: { agility: 0.05 },
        },
      },
      defense: {
        team: { agility: 0.01 },
        positions: {
          CB1: { speed: 0.05 },
          S2: { awareness: 0.03 },
        },
      },
    },
    development: { offense: 0.3, defense: 0.18, qb: 0.28, skill: 0.3, run: 0.2 },
    tendencies: { passBias: 0.2, aggression: 0.14 },
  },
  NJY: {
    id: 'NJY-HC',
    name: 'Clarissa Holt',
    philosophy: 'balanced',
    tacticalIQ: 1.16,
    playcallingIQ: 1.12,
    clock: { hurry: 134, defensive: 118, must: 32, margin: 8 },
    playerBoosts: {
      offense: {
        team: { awareness: 0.04 },
        positions: {
          QB: { throwAcc: 0.06 },
          WR2: { awareness: 0.05 },
          RB: { strength: 0.04 },
        },
      },
      defense: {
        team: { awareness: 0.03 },
        positions: {
          LB1: { agility: 0.04 },
          CB2: { awareness: 0.05 },
        },
      },
    },
    development: { offense: 0.24, defense: 0.22, qb: 0.26, skill: 0.24, run: 0.22 },
    tendencies: { passBias: 0.08, runBias: 0.02, aggression: 0.1 },
  },
};

export function getCoachDefinition(teamId) {
  return COACH_LIBRARY[teamId] || null;
}
