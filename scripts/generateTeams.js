const fs = require('fs');
const path = require('path');

const TEAMS = [
  { id: 'SFB', city: 'San Francisco', name: 'Bay Guardians', abbr: 'SFB', colors: { primary: '#f44336', secondary: '#0f3554' } },
  { id: 'LAX', city: 'Los Angeles', name: 'Solar Kings', abbr: 'LAX', colors: { primary: '#ff9800', secondary: '#1b1b1b' } },
  { id: 'NYC', city: 'New York', name: 'Empire Hawks', abbr: 'NYC', colors: { primary: '#1565c0', secondary: '#e0e0e0' } },
  { id: 'MIA', city: 'Miami', name: 'Coastal Wave', abbr: 'MIA', colors: { primary: '#00bcd4', secondary: '#ff6f61' } },
  { id: 'TOR', city: 'Toronto', name: 'Northern Lights', abbr: 'TOR', colors: { primary: '#6a1b9a', secondary: '#d1c4e9' } },
  { id: 'CHI', city: 'Chicago', name: 'Wind Guardians', abbr: 'CHI', colors: { primary: '#1a237e', secondary: '#ffa000' } },
  { id: 'RNO', city: 'Reno', name: 'High Desert Rush', abbr: 'RNO', colors: { primary: '#4e342e', secondary: '#c5e1a5' } },
  { id: 'NJY', city: 'New Jersey', name: 'Garden State Charge', abbr: 'NJY', colors: { primary: '#2e7d32', secondary: '#c8e6c9' } },
];

const ROLES_OFF = ['QB', 'RB', 'WR1', 'WR2', 'WR3', 'TE', 'LT', 'LG', 'C', 'RG', 'RT'];
const ROLES_DEF = ['LE', 'DT', 'RTk', 'RE', 'LB1', 'LB2', 'CB1', 'CB2', 'S1', 'S2', 'NB'];

const FIRST_NAMES = [
  'Aiden','Mateo','Liam','Noah','Ethan','Kai','Micah','Logan','Jasper','Elijah','Hudson','Miles','Roman','Silas','Everett','Declan','Ryder','Archer','Sawyer','Caleb','Julian','Elias','Grayson','Luca','Owen','Leo','Ezra','Wyatt','Theo','Isaac','Nathaniel','Jonah','August','Asher','Finn','Rowan','Henry','Elliot','Atlas','Dominic','Xavier','Andre','Dorian','Maddox','Zayden','Zion','Carter','Camden','Emmett','Felix','Gideon','Harvey','Jayden','Kameron','Landen','Miller','Nolan','Porter','Quentin','Rafael','Soren','Tobias','Victor','Wesley','Zeke','Avery','Beckett','Callum','Dallas','Easton','Forrest','Griffin','Hendrix','Jalen','Kellan','Landen','Makai','Nico','Orion','Parker','Quincy','Ronan','Sterling','Tanner','Uriel','Vaughn','Wilder','Zander','Cohen','Devin','Edison','Fletcher','Gannon','Harlen','Iker','Jensen','Kendrick','Lawson','Malik','Nehemiah','Osiris','Princeton','Reese','Salem','Titan','Ulises','Van','Wells','Yahir','Zion']
;

const LAST_NAMES = [
  'Anderson','Bennett','Carter','Dawson','Ellison','Foster','Gallagher','Henderson','Iverson','Jennings','King','Lawson','Monroe','Nixon','Owens','Porter','Quinn','Ramirez','Santiago','Thompson','Underwood','Vargas','Walker','Young','Zimmerman','Alvarez','Brooks','Cooper','Douglas','Edwards','Franklin','Gibson','Harris','Ingram','Jefferson','Knight','Lopez','Marshall','Nelson','Ochoa','Patterson','Reed','Stevenson','Turner','Vaughn','Whitaker','Xu','Yates','Zimmer','Barnes','Chambers','Dalton','Emerson','Fleming','Gonzalez','Hampton','Irving','Jordan','Kendall','Langston','Matthews','Navarro','Owens','Parker','Reynolds','Sharpe','Tucker','Vasquez','Wilkins','York','Zamora','Bishop','Collins','Durant','Eaton','Floyd','Greene','Howard','Irvin','Jacobs','Kerr','Lambert','Manning','Neal','Ortega','Price','Ross','Simmons','Tyson','Vaughns','Wiley','Yoder','Zhang','Bolton','Chavez','Drake','Espinoza','Figueroa','Grayson','Holt','Isaacs','Jensen','Keegan','Livingston','Mayes','Nash','Oliver','Powers','Rivers','Summers','Thorpe','Valdez','Westbrook','Yarbrough','Zeller'
];

function mulberry32(a) {
  return function () {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function pickUnique(rng, pool, used) {
  let attempt = 0;
  while (attempt < pool.length * 2) {
    const value = pool[Math.floor(rng() * pool.length) % pool.length];
    if (!used.has(value)) {
      used.add(value);
      return value;
    }
    attempt += 1;
  }
  const [value] = pool.filter(item => !used.has(item));
  if (value) {
    used.add(value);
    return value;
  }
  throw new Error('Ran out of unique names');
}

function buildRatings(rng, role) {
  const base = {
    speed: 5.5 + rng() * 1.2,
    accel: 13 + rng() * 6,
    agility: 0.8 + rng() * 0.3,
    strength: 0.75 + rng() * 0.35,
    awareness: 0.85 + rng() * 0.3,
    catch: 0.6 + rng() * 0.4,
    throwPow: 0.5 + rng() * 0.5,
    throwAcc: 0.5 + rng() * 0.5,
    tackle: 0.6 + rng() * 0.5,
  };

  const boost = (stat, amount) => {
    base[stat] += amount;
  };

  switch (role) {
    case 'QB':
      boost('throwPow', 0.4);
      boost('throwAcc', 0.45);
      boost('awareness', 0.1);
      boost('speed', -0.2 + rng() * 0.3);
      boost('catch', -0.3);
      break;
    case 'RB':
      boost('speed', 0.2);
      boost('accel', 1.5);
      boost('agility', 0.15);
      boost('strength', 0.1);
      boost('catch', 0.1);
      break;
    case 'WR1':
    case 'WR2':
    case 'WR3':
      boost('speed', 0.35);
      boost('accel', 1.4);
      boost('agility', 0.2);
      boost('catch', 0.3);
      boost('throwPow', -0.2);
      boost('throwAcc', -0.2);
      boost('tackle', -0.1);
      break;
    case 'TE':
      boost('strength', 0.3);
      boost('catch', 0.2);
      boost('speed', 0.05);
      boost('accel', 0.6);
      break;
    case 'LT':
    case 'LG':
    case 'C':
    case 'RG':
    case 'RT':
      boost('strength', 0.5);
      boost('speed', -0.5);
      boost('accel', -2);
      boost('agility', -0.1);
      boost('awareness', 0.1);
      boost('catch', -0.3);
      boost('tackle', 0.2);
      break;
    case 'LE':
    case 'RE':
    case 'DT':
    case 'RTk':
      boost('strength', 0.45);
      boost('speed', 0.1);
      boost('accel', 0.6);
      boost('tackle', 0.3);
      boost('catch', -0.2);
      boost('throwPow', -0.3);
      boost('throwAcc', -0.3);
      break;
    case 'LB1':
    case 'LB2':
      boost('strength', 0.25);
      boost('speed', 0.15);
      boost('tackle', 0.35);
      break;
    case 'CB1':
    case 'CB2':
    case 'S1':
    case 'S2':
    case 'NB':
      boost('speed', 0.25);
      boost('accel', 1.1);
      boost('agility', 0.25);
      boost('catch', 0.15);
      boost('tackle', 0.1);
      break;
    default:
      break;
  }

  Object.keys(base).forEach(key => {
    if (base[key] < 0.3) base[key] = 0.3;
    if (key === 'accel') base[key] = Math.max(10, base[key]);
  });

  return Object.fromEntries(
    Object.entries(base).map(([key, value]) => [key, Math.round(value * 100) / 100])
  );
}

function buildModifiers(rng, role) {
  const base = {};
  switch (role) {
    case 'QB':
      base.passTendencies = {
        short: Math.round((0.35 + rng() * 0.3) * 100) / 100,
        intermediate: Math.round((0.3 + rng() * 0.25) * 100) / 100,
        deep: Math.round((0.2 + rng() * 0.2) * 100) / 100,
      };
      const total = base.passTendencies.short + base.passTendencies.intermediate + base.passTendencies.deep;
      base.passTendencies.deep = Math.round(base.passTendencies.deep / total * 100) / 100;
      base.passTendencies.intermediate = Math.round(base.passTendencies.intermediate / total * 100) / 100;
      base.passTendencies.short = Math.round((1 - base.passTendencies.deep - base.passTendencies.intermediate) * 100) / 100;
      base.scrambleAggression = Math.round((0.15 + rng() * 0.3) * 100) / 100;
      base.releaseQuickness = Math.round((0.55 + rng() * 0.3) * 100) / 100;
      base.pocketPoise = Math.round((0.6 + rng() * 0.25) * 100) / 100;
      base.throwVelocity = Math.round((0.6 + rng() * 0.25) * 100) / 100;
      break;
    case 'RB':
      base.vision = Math.round((0.6 + rng() * 0.25) * 100) / 100;
      base.burst = Math.round((0.6 + rng() * 0.25) * 100) / 100;
      base.breakTackle = Math.round((0.6 + rng() * 0.25) * 100) / 100;
      base.ballSecurity = Math.round((0.65 + rng() * 0.2) * 100) / 100;
      base.receiving = Math.round((0.5 + rng() * 0.3) * 100) / 100;
      base.patience = Math.round((0.5 + rng() * 0.3) * 100) / 100;
      break;
    case 'WR1':
    case 'WR2':
    case 'WR3':
      base.release = Math.round((0.6 + rng() * 0.3) * 100) / 100;
      base.routePrecision = Math.round((0.6 + rng() * 0.3) * 100) / 100;
      base.deepThreat = Math.round((0.55 + rng() * 0.3) * 100) / 100;
      base.hands = Math.round((0.6 + rng() * 0.3) * 100) / 100;
      base.runAfterCatch = Math.round((0.55 + rng() * 0.3) * 100) / 100;
      break;
    case 'TE':
      base.routePrecision = Math.round((0.55 + rng() * 0.25) * 100) / 100;
      base.hands = Math.round((0.55 + rng() * 0.25) * 100) / 100;
      base.inlineBlocking = Math.round((0.65 + rng() * 0.25) * 100) / 100;
      base.redZone = Math.round((0.55 + rng() * 0.25) * 100) / 100;
      break;
    default:
      base.impact = Math.round((0.5 + rng() * 0.4) * 100) / 100;
      base.discipline = Math.round((0.5 + rng() * 0.4) * 100) / 100;
      break;
  }
  return base;
}

function buildKicker(rng, teamId) {
  const first = pickUnique(rng, FIRST_NAMES, buildKicker.firstUsed);
  const last = pickUnique(rng, LAST_NAMES, buildKicker.lastUsed);
  return {
    id: `${teamId}-K`,
    firstName: first,
    lastName: last,
    number: Math.floor(2 + rng() * 97),
    maxDistance: Math.round(45 + rng() * 15),
    accuracy: Math.round((0.7 + rng() * 0.2) * 100) / 100,
  };
}
buildKicker.firstUsed = new Set();
buildKicker.lastUsed = new Set();

function buildTeam(team, seed) {
  const rng = mulberry32(seed);
  const usedFirst = new Set();
  const usedLast = new Set();

  const pickFirst = () => pickUnique(rng, FIRST_NAMES, usedFirst);
  const pickLast = () => pickUnique(rng, LAST_NAMES, usedLast);

  const buildSide = (roles) => roles.reduce((acc, role, idx) => {
    const first = pickFirst();
    const last = pickLast();
    const number = 1 + ((idx * 7 + Math.floor(rng() * 30)) % 99);
    acc[role] = {
      id: `${team.id}-${role}`,
      firstName: first,
      lastName: last,
      number,
      ratings: buildRatings(rng, role),
      modifiers: buildModifiers(rng, role),
    };
    return acc;
  }, {});

  return {
    id: team.id,
    name: team.name,
    city: team.city,
    abbr: team.abbr,
    colors: team.colors,
    offense: buildSide(ROLES_OFF),
    defense: buildSide(ROLES_DEF),
    specialTeams: { K: buildKicker(rng, team.id) },
  };
}

function main() {
  const outDir = path.resolve(__dirname, '../src/engine/data/teams');
  fs.mkdirSync(outDir, { recursive: true });

  const manifest = [];
  TEAMS.forEach((team, idx) => {
    const data = buildTeam(team, 12345 + idx * 97);
    manifest.push({ id: data.id, file: `${team.id.toLowerCase()}.json`, name: data.name, city: data.city, abbr: data.abbr, colors: data.colors });
    const filePath = path.join(outDir, `${team.id.toLowerCase()}.json`);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  });

  const manifestPath = path.join(outDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify({ teams: manifest }, null, 2));
}

main();
