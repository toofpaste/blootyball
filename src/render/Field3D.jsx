import React, { useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import {
  COLORS,
  ENDZONE_YARDS,
  FIELD_PIX_H,
  FIELD_PIX_W,
  PX_PER_YARD,
  TEAM_BLK,
  TEAM_RED,
} from '../engine/constants';
import { yardsToPixY } from '../engine/helpers';
import { getBallPix } from '../engine/ball';
import { resolveSlotColors, resolveTeamColor } from '../engine/colors';

const PLAYER_RADIUS = 7;
const PLAYER_HEIGHT = 16;
const BALL_RADIUS = 3.4;
const MARKER_MARGIN = PX_PER_YARD * 1.2;
const SIDELINE_BLEED = PX_PER_YARD * 0.9;
const QB_VISION_COLORS = {
  PRIMARY: '#ffd54f',
  THROW: '#ffb74d',
  THROW_AWAY: '#b0bec5',
  CHECKDOWN: '#4fc3f7',
  PROGRESS: '#80cbc4',
  SCRAMBLE: '#ff8a80',
  HOLD: '#d7ccc8',
  SCAN: '#f5f5f5',
};

const STADIUM_COLORS = {
  concrete: '#1f242b',
  seats: '#373e49',
  riser: '#2a3038',
  walkway: '#2d333c',
  adBand: '#eb6a1f',
  adText: '#f4f2eb',
  pressBox: '#4f5662',
  pressBoxFrame: '#5b626f',
  glass: '#a6b1bf',
  roof: '#262b33',
  rail: '#d8dce3',
  lightingStructure: '#3a404a',
  lighting: '#f0f2f6',
};

const shortRole = (role) => {
  const map = {
    QB: 'QB',
    RB: 'RB',
    WR1: 'W1',
    WR2: 'W2',
    WR3: 'W3',
    TE: 'TE',
    LT: 'LT',
    LG: 'LG',
    C: 'C',
    RG: 'RG',
    RT: 'RT',
    LE: 'LE',
    DT: 'DT',
    RTk: 'NT',
    RE: 'RE',
    LB1: 'LB',
    LB2: 'LB',
    CB1: 'C1',
    CB2: 'C2',
    S1: 'S1',
    S2: 'S2',
    NB: 'NB',
    K: 'K',
  };
  return map[role] || role || '?';
};

function isWebGLAvailable() {
  if (typeof window === 'undefined') return false;
  if (!window.WebGLRenderingContext) return false;
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
  } catch (err) {
    return false;
  }
}

function useSidelineCamera(center) {
  const { camera, size } = useThree();
  React.useLayoutEffect(() => {
    const aspect = size.width > 0 && size.height > 0 ? size.width / size.height : 16 / 9;
    const verticalFov = 26;
    const verticalFovRad = THREE.MathUtils.degToRad(verticalFov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFovRad / 2) * aspect);

    const halfFieldLength = FIELD_PIX_H / 2;
    const distance = (halfFieldLength / Math.tan(horizontalFov / 2)) * 1.02;
    const height = FIELD_PIX_W * 1.28;

    camera.position.set(distance, height, 0);
    camera.fov = verticalFov;
    camera.near = 0.1;
    camera.far = Math.max(distance, height) * 6;
    camera.up.set(0, 1, 0);
    camera.lookAt(center[0], center[1], center[2]);
    camera.updateProjectionMatrix();
  }, [camera, center, size]);
  return null;
}

function toWorldPosition(point) {
  const halfW = FIELD_PIX_W / 2;
  const halfH = FIELD_PIX_H / 2;
  return [
    point.x - halfW,
    0,
    halfH - point.y,
  ];
}

function FieldBase() {
  const thickness = 24;
  const sidelineApron = SIDELINE_BLEED;
  const endzoneApron = PX_PER_YARD * 3.2;
  const width = FIELD_PIX_W + sidelineApron * 2;
  const length = FIELD_PIX_H + endzoneApron * 2;
  const padHeight = 6;
  return (
    <group>
      <mesh position={[0, -thickness / 2, 0]} receiveShadow>
        <boxGeometry args={[width, thickness, length]} />
        <meshStandardMaterial color="#c5a46a" roughness={0.92} />
      </mesh>
      <mesh position={[0, -thickness + padHeight / 2, 0]} receiveShadow>
        <boxGeometry args={[width * 0.88, padHeight, length * 0.88]} />
        <meshStandardMaterial color="#9a6b3c" roughness={0.95} />
      </mesh>
    </group>
  );
}

function FieldTopVolume({ colors }) {
  const topSurfaceY = 0.14;
  const thickness = 9;
  const endzonePix = ENDZONE_YARDS * PX_PER_YARD;
  const fieldHalf = FIELD_PIX_H / 2;
  const width = FIELD_PIX_W + SIDELINE_BLEED * 2;
  const centerLength = FIELD_PIX_H - endzonePix * 2;
  const centerY = topSurfaceY - thickness / 2;
  const northColor = colors?.north?.color || COLORS.fieldGreen;
  const southColor = colors?.south?.color || COLORS.fieldGreen;

  return (
    <group>
      <mesh position={[0, centerY, 0]} receiveShadow>
        <boxGeometry args={[width, thickness, centerLength]} />
        <meshStandardMaterial color={COLORS.fieldGreen} />
      </mesh>
      <mesh position={[0, centerY, fieldHalf - endzonePix / 2]} receiveShadow>
        <boxGeometry args={[width, thickness, endzonePix]} />
        <meshStandardMaterial color={northColor} />
      </mesh>
      <mesh position={[0, centerY, -fieldHalf + endzonePix / 2]} receiveShadow>
        <boxGeometry args={[width, thickness, endzonePix]} />
        <meshStandardMaterial color={southColor} />
      </mesh>
    </group>
  );
}

function FieldTexture({ colors }) {
  const texture = useMemo(() => {
    const fieldWidth = FIELD_PIX_W;
    const fieldHeight = FIELD_PIX_H;
    const sidelineBleed = SIDELINE_BLEED;
    const canvasWidth = fieldWidth + sidelineBleed * 2;
    const canvasHeight = fieldHeight;
    const fieldOffsetX = sidelineBleed;
    const canvas = document.createElement('canvas');
    const scale = 2;
    canvas.width = canvasWidth * scale;
    canvas.height = canvasHeight * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.scale(scale, scale);

    ctx.fillStyle = '#18a854';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    const endzonePix = ENDZONE_YARDS * PX_PER_YARD;
    if (colors?.north) {
      ctx.fillStyle = colors.north.color;
      ctx.fillRect(fieldOffsetX, 0, fieldWidth, endzonePix);
      const northLabel = String(colors.north.label || '').trim().toUpperCase();
      if (northLabel) {
        ctx.save();
        ctx.translate(fieldOffsetX + fieldWidth / 2, endzonePix * 0.6);
        ctx.fillStyle = '#f6f6f6';
        ctx.font = 'bold 32px "Oswald", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(northLabel, 0, 0);
        ctx.restore();
      }
    }
    if (colors?.south) {
      ctx.fillStyle = colors.south.color;
      ctx.fillRect(fieldOffsetX, fieldHeight - endzonePix, fieldWidth, endzonePix);
      const southLabel = String(colors.south.label || '').trim().toUpperCase();
      if (southLabel) {
        ctx.save();
        ctx.translate(fieldOffsetX + fieldWidth / 2, fieldHeight - endzonePix * 0.6);
        ctx.fillStyle = '#f6f6f6';
        ctx.font = 'bold 32px "Oswald", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(southLabel, 0, 0);
        ctx.restore();
      }
    }

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    const playingStart = endzonePix;
    const playingEnd = fieldHeight - endzonePix;
    const fiveYards = PX_PER_YARD * 5;
    for (let y = playingStart; y <= playingEnd; y += fiveYards) {
      ctx.globalAlpha = (y - playingStart) % (PX_PER_YARD * 10) === 0 ? 1 : 0.45;
      ctx.beginPath();
      ctx.moveTo(fieldOffsetX, y);
      ctx.lineTo(fieldOffsetX + fieldWidth, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = '#e9fbe5';
    const hashSpacing = PX_PER_YARD;
    for (let y = playingStart; y <= playingEnd; y += hashSpacing) {
      ctx.fillRect(fieldOffsetX + fieldWidth * 0.25 - 1, y - 1, 2, 4);
      ctx.fillRect(fieldOffsetX + fieldWidth * 0.75 - 1, y - 1, 2, 4);
    }

    const numberSequence = [10, 20, 30, 40, 50, 40, 30, 20, 10];
    const leftNumberX = fieldOffsetX + fieldWidth * 0.18;
    const rightNumberX = fieldOffsetX + fieldWidth - fieldWidth * 0.18;
    const numberOffset = PX_PER_YARD * 4.2;

    ctx.font = 'bold 34px "Oswald", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f4fff4';
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 3;

    numberSequence.forEach((num, index) => {
      const yardLineY = playingStart + (index + 1) * 10 * PX_PER_YARD;
      const bottomY = yardLineY + numberOffset;
      const text = String(num);

      ctx.save();
      ctx.translate(leftNumberX, bottomY);
      ctx.strokeText(text, 0, 0);
      ctx.fillText(text, 0, 0);
      ctx.restore();

      ctx.save();
      ctx.translate(rightNumberX, bottomY);
      ctx.strokeText(text, 0, 0);
      ctx.fillText(text, 0, 0);
      ctx.restore();
    });

    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = 8;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }, [
    colors?.north?.color,
    colors?.north?.label,
    colors?.south?.color,
    colors?.south?.label,
  ]);

  if (!texture) return null;
  const planeWidth = FIELD_PIX_W + SIDELINE_BLEED * 2;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.18, 0]} receiveShadow>
      <planeGeometry args={[planeWidth, FIELD_PIX_H]} />
      <meshStandardMaterial
        map={texture}
        toneMapped={false}
        polygonOffset
        polygonOffsetFactor={-1}
        polygonOffsetUnits={-1}
      />
    </mesh>
  );
}

function PlayerMarker({ player, color, qbVision, playElapsed }) {
  const position = useMemo(
    () => toWorldPosition({ x: player.pos.x, y: player.pos.y }),
    [player.pos.x, player.pos.y],
  );
  const vision = player.role === 'QB' ? qbVision : null;
  const height = PLAYER_HEIGHT;
  return (
    <group position={[position[0], height / 2, position[2]]}>
      <mesh castShadow>
        <cylinderGeometry args={[PLAYER_RADIUS, PLAYER_RADIUS * 0.82, height, 32]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -height / 2 + 0.2, 0]}>
        <circleGeometry args={[PLAYER_RADIUS * 1.2, 32]} />
        <meshBasicMaterial color="black" transparent opacity={0.35} />
      </mesh>
      {vision ? <QbVisionRing vision={vision} playElapsed={playElapsed} /> : null}
      <Html
        position={[0, height * 0.65, 0]}
        style={{
          color: '#f8f8f8',
          fontSize: '11px',
          fontWeight: 600,
          textTransform: 'uppercase',
          textShadow: '0 0 6px rgba(0,0,0,0.65)',
        }}
        center
      >
        {shortRole(player.role)}
      </Html>
    </group>
  );
}

function QbVisionRing({ vision, playElapsed }) {
  const color = QB_VISION_COLORS[vision.intent] || QB_VISION_COLORS.SCAN;
  let alpha = vision.intent === 'THROW' ? 0.95 : 0.82;
  if (typeof playElapsed === 'number' && typeof vision.updatedAt === 'number') {
    const age = Math.max(0, playElapsed - vision.updatedAt);
    if (age > 4.5) return null;
    const fade = Math.max(0.25, 1 - age / 4.5);
    alpha *= fade;
  }
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.2, 0]}>
      <ringGeometry args={[PLAYER_RADIUS * 1.6, PLAYER_RADIUS * 2.2, 64]} />
      <meshBasicMaterial color={color} transparent opacity={alpha * 0.65} />
    </mesh>
  );
}

function BallMarker({ pos, height, shadow, carried }) {
  const ballHeight = Math.max(0, height || 0);
  const carriedOffsetX = carried ? PLAYER_RADIUS * 1.45 : 0;
  const [baseX, , baseZ] = pos;
  const shadowX = shadow[0] + carriedOffsetX;
  const shadowZ = shadow[2];
  const baseY = carried ? PLAYER_HEIGHT * 0.58 : PLAYER_RADIUS * 0.9;
  const y = carried ? baseY : baseY + ballHeight * 0.18;
  const x = baseX + carriedOffsetX;
  const z = baseZ;
  return (
    <group>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[shadowX, 0.05, shadowZ]}
        scale={[1.4, 1, 1]}
      >
        <circleGeometry args={[5.2, 40]} />
        <meshBasicMaterial color="black" transparent opacity={0.45} />
      </mesh>
      <mesh position={[x, y, z]} castShadow>
        <sphereGeometry args={[BALL_RADIUS + Math.min(1.6, ballHeight / 28), 16, 16]} />
        <meshStandardMaterial color={COLORS.ball} />
      </mesh>
    </group>
  );
}

function FirstDownMarkers({ losY, ltgY }) {
  const losWorld = useMemo(() => toWorldPosition({ x: FIELD_PIX_W / 2, y: losY }), [losY]);
  const ltgWorld = useMemo(() => toWorldPosition({ x: FIELD_PIX_W / 2, y: ltgY }), [ltgY]);
  const width = FIELD_PIX_W - MARKER_MARGIN * 2;
  return (
    <group>
      <MarkerLine positionZ={losWorld[2]} color="#3da5ff" width={width} />
      <MarkerLine positionZ={ltgWorld[2]} color="#ffd400" width={width} dashed />
    </group>
  );
}

function MarkerLine({ positionZ, color, width, dashed = false }) {
  const y = PLAYER_HEIGHT * 0.5 + 0.2;
  const safeWidth = Math.max(10, width || FIELD_PIX_W);
  if (!dashed) {
    return (
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, y, positionZ]}>
        <planeGeometry args={[safeWidth, 1.2]} />
        <meshBasicMaterial color={color} transparent opacity={0.85} />
      </mesh>
    );
  }

  const segmentCount = 26;
  const segmentWidth = safeWidth / (segmentCount * 1.18);
  const spacing = segmentWidth * 0.7;
  const startX = -safeWidth / 2 + segmentWidth / 2;

  return (
    <group position={[0, y, positionZ]}>
      {Array.from({ length: segmentCount }).map((_, index) => {
        const x = startX + index * (segmentWidth + spacing);
        return (
          <mesh
            key={index}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[x, 0, 0]}
          >
            <planeGeometry args={[segmentWidth, 1.2]} />
            <meshBasicMaterial color={color} transparent opacity={0.75} />
          </mesh>
        );
      })}
    </group>
  );
}

function FieldGoalPosts() {
  const crossbarHeight = 28;
  const uprightHeight = 62;
  const uprightGap = PX_PER_YARD * 6.2;
  const supportDepth = PX_PER_YARD * 2.6;
  const postColor = '#f6f0c4';
  const padColor = '#d9c88a';
  const crossbarZ = FIELD_PIX_H / 2 - PX_PER_YARD * 0.4;
  const basePadRadius = 8;
  const postThickness = 2.1;

  const renderPost = (flip) => (
    <group key={flip} position={[0, 0, flip * crossbarZ]}>
      <mesh
        position={[0, crossbarHeight / 2, flip * supportDepth]}
        castShadow
      >
        <cylinderGeometry args={[postThickness * 1.2, postThickness * 1.5, crossbarHeight, 20]} />
        <meshStandardMaterial color={padColor} metalness={0.05} roughness={0.6} />
      </mesh>
      <mesh
        rotation={[0, 0, 0]}
        position={[0, 3, flip * supportDepth]}
        castShadow
      >
        <cylinderGeometry args={[basePadRadius, basePadRadius, 6, 24]} />
        <meshStandardMaterial color="#3d2a1a" roughness={0.8} />
      </mesh>
      <mesh
        rotation={[0, 0, 0]}
        position={[0, crossbarHeight, 0]}
        castShadow
      >
        <boxGeometry args={[uprightGap + 6, 2.6, 2.6]} />
        <meshStandardMaterial color={postColor} metalness={0.22} roughness={0.38} />
      </mesh>
      {[-1, 1].map((dir) => (
        <mesh
          key={dir}
          position={[dir * uprightGap / 2, crossbarHeight + uprightHeight / 2, 0]}
          castShadow
        >
          <cylinderGeometry args={[postThickness, postThickness, uprightHeight, 20]} />
          <meshStandardMaterial color={postColor} metalness={0.2} roughness={0.45} />
        </mesh>
      ))}
      <mesh
        position={[0, crossbarHeight / 2, flip * supportDepth * 0.6]}
        rotation={[flip * THREE.MathUtils.degToRad(18), 0, 0]}
        castShadow
      >
        <cylinderGeometry args={[postThickness * 0.9, postThickness * 0.9, supportDepth * 1.15, 16]} />
        <meshStandardMaterial color={postColor} metalness={0.18} roughness={0.52} />
      </mesh>
    </group>
  );

  return (
    <group>
      {renderPost(1)}
      {renderPost(-1)}
    </group>
  );
}

function createAdTexture() {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = STADIUM_COLORS.adBand;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = STADIUM_COLORS.adText;
  ctx.font = 'bold 160px "Oswald", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const count = 8;
  for (let i = 0; i < count; i += 1) {
    const x = (i + 0.5) * (canvas.width / count);
    ctx.fillText('AD', x, canvas.height / 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 8;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function LightTower({ position }) {
  const baseHeight = 7;
  const mastHeight = 64;
  const platformHeight = 6;
  const headHeight = 4;
  const headWidth = 28;

  return (
    <group position={position}>
      <mesh position={[0, baseHeight / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[12, baseHeight, 12]} />
        <meshStandardMaterial color={STADIUM_COLORS.concrete} roughness={0.82} />
      </mesh>
      <mesh position={[0, baseHeight + mastHeight / 2, 0]} castShadow>
        <boxGeometry args={[6, mastHeight, 6]} />
        <meshStandardMaterial color={STADIUM_COLORS.lightingStructure} roughness={0.5} metalness={0.28} />
      </mesh>
      <mesh position={[0, baseHeight + mastHeight + platformHeight / 2, 0]} castShadow>
        <boxGeometry args={[16, platformHeight, 16]} />
        <meshStandardMaterial color={STADIUM_COLORS.lightingStructure} roughness={0.45} />
      </mesh>
      <mesh position={[0, baseHeight + mastHeight + platformHeight + headHeight / 2, 0]} castShadow>
        <boxGeometry args={[headWidth, headHeight, 6]} />
        <meshStandardMaterial color={STADIUM_COLORS.lightingStructure} roughness={0.35} />
      </mesh>
      {[-1, 0, 1].map((offset) => (
        <mesh
          key={offset}
          position={[0, baseHeight + mastHeight + platformHeight + headHeight / 2, offset * 6]}
        >
          <boxGeometry args={[headWidth * 0.7, headHeight * 0.85, 4]} />
          <meshStandardMaterial
            color={STADIUM_COLORS.lighting}
            emissive={STADIUM_COLORS.lighting}
            emissiveIntensity={0.38}
            roughness={0.25}
          />
        </mesh>
      ))}
      <mesh position={[0, baseHeight + mastHeight * 0.45, 0]} rotation={[0, 0, Math.PI / 4]}>
        <boxGeometry args={[2.2, mastHeight * 0.78, 2.2]} />
        <meshStandardMaterial color={STADIUM_COLORS.lightingStructure} roughness={0.5} metalness={0.2} />
      </mesh>
      <mesh position={[0, baseHeight + mastHeight * 0.45, 0]} rotation={[0, 0, -Math.PI / 4]}>
        <boxGeometry args={[2.2, mastHeight * 0.78, 2.2]} />
        <meshStandardMaterial color={STADIUM_COLORS.lightingStructure} roughness={0.5} metalness={0.2} />
      </mesh>
    </group>
  );
}

function StadiumEnvironment() {
  const fieldHalfW = FIELD_PIX_W / 2;
  const fieldHalfH = FIELD_PIX_H / 2;
  const sidelineOffset = SIDELINE_BLEED + PX_PER_YARD * 1.4;
  const standFrontX = -fieldHalfW - sidelineOffset;
  const adTexture = useMemo(() => createAdTexture(), []);
  const mainWidth = FIELD_PIX_H * 0.68;
  const baseHeight = 8;
  const foundationDepth = 36;
  const adBandDepth = 2.8;
  const adBandHeight = 4.2;
  const tierGap = 6;
  const railHeight = 2.2;

  const tierConfigs = [
    { width: mainWidth, depth: 18, height: 12, offset: 0 },
    { width: mainWidth * 0.84, depth: 17, height: 11.5, offset: 14 },
    { width: mainWidth * 0.68, depth: 16, height: 11, offset: 28 },
  ];

  const furthestOffset = tierConfigs.reduce(
    (max, tier) => Math.max(max, tier.offset + tier.depth),
    0,
  );

  let elevation = baseHeight;
  const mainTiers = [];
  tierConfigs.forEach((tier, index) => {
    const seatCenterY = elevation + tier.height / 2;
    const seatX = -tier.offset - tier.depth / 2;

    mainTiers.push(
      <mesh
        key={`main-tier-${index}`}
        position={[seatX, seatCenterY, 0]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[tier.depth, tier.height, tier.width]} />
        <meshStandardMaterial color={STADIUM_COLORS.seats} roughness={0.68} />
      </mesh>,
    );

    const fasciaHeight = Math.min(3.6, tier.height * 0.38);
    const fasciaCenterY = seatCenterY - tier.height / 2 + fasciaHeight / 2;
    mainTiers.push(
      <mesh
        key={`main-fascia-${index}`}
        position={[seatX + tier.depth / 2 - 1.6, fasciaCenterY, 0]}
      >
        <boxGeometry args={[3.2, fasciaHeight, tier.width]} />
        <meshStandardMaterial color={STADIUM_COLORS.riser} roughness={0.62} />
      </mesh>,
    );

    const railCenterY = seatCenterY + tier.height / 2 - railHeight / 2;
    mainTiers.push(
      <mesh
        key={`main-rail-${index}`}
        position={[-tier.offset + 0.5, railCenterY, 0]}
      >
        <boxGeometry args={[1.2, railHeight, tier.width * 0.94]} />
        <meshStandardMaterial color={STADIUM_COLORS.rail} roughness={0.2} />
      </mesh>,
    );

    const adCenterY = seatCenterY + tier.height / 2 + adBandHeight / 2;
    mainTiers.push(
      <mesh
        key={`main-adband-${index}`}
        position={[-tier.offset + adBandDepth / 2, adCenterY, 0]}
        castShadow
      >
        <boxGeometry args={[adBandDepth, adBandHeight, tier.width]} />
        <meshStandardMaterial
          color={STADIUM_COLORS.adBand}
          emissive={STADIUM_COLORS.adBand}
          emissiveIntensity={0.14}
        />
      </mesh>,
    );

    if (adTexture) {
      mainTiers.push(
        <mesh
          key={`main-adpanel-${index}`}
          position={[-tier.offset + adBandDepth + 0.05, adCenterY, 0]}
          rotation={[0, Math.PI / 2, 0]}
        >
          <planeGeometry args={[tier.width, adBandHeight * 0.92]} />
          <meshStandardMaterial
            map={adTexture}
            toneMapped={false}
            transparent
            opacity={0.97}
          />
        </mesh>,
      );
    }

    elevation = adCenterY + adBandHeight / 2 + tierGap;
  });

  const topTier = tierConfigs[tierConfigs.length - 1];
  const pressPlatformHeight = 4.2;
  const pressPlatformDepth = 24;
  const pressPlatformWidth = topTier.width * 0.9;
  const pressPlatformY = elevation + pressPlatformHeight / 2;
  const pressPlatformX = -topTier.offset - pressPlatformDepth / 2 - 6;

  const pressRailHeight = 2;
  const pressRailOffset = -topTier.offset + 0.6;

  const pressBoxHeight = 15;
  const pressBoxDepth = 26;
  const pressBoxWidth = topTier.width * 0.62;
  const pressBoxY = pressPlatformY + pressPlatformHeight / 2 + pressBoxHeight / 2 + 1.6;
  const pressBoxX = pressPlatformX - pressBoxDepth / 2 + 0.6;

  const roofHeight = 5;
  const roofDepth = pressBoxDepth + 10;
  const roofWidth = pressBoxWidth + 18;
  const roofY = pressBoxY + pressBoxHeight / 2 + roofHeight / 2 + 1.1;
  const roofX = pressBoxX - 1.6;

  const sidelineWallX = fieldHalfW + SIDELINE_BLEED + PX_PER_YARD * 0.9;
  const sidelineWallWidth = FIELD_PIX_H + PX_PER_YARD * 6;
  const endzoneWallZ = fieldHalfH + PX_PER_YARD * 2.6;
  const endzoneWallWidth = FIELD_PIX_W + SIDELINE_BLEED * 2 + PX_PER_YARD * 3.4;
  const wallHeight = 4.4;
  const wallThickness = 4.4;

  const renderWing = (direction) => {
    const wingBaseHeight = baseHeight * 0.9;
    const wingFoundationDepth = 26;
    const wingConfigs = [
      { width: mainWidth * 0.46, depth: 14, height: 9.5, offset: 0 },
      { width: mainWidth * 0.38, depth: 13, height: 9, offset: 11 },
    ];
    const wingAdHeight = 3.4;
    const wingAdDepth = 2.4;
    const wingGap = 4.5;
    const wingRailHeight = 2;
    let wingElevation = wingBaseHeight;
    const wingElements = [];

    wingConfigs.forEach((tier, index) => {
      const seatCenterY = wingElevation + tier.height / 2;
      const seatX = -tier.offset - tier.depth / 2;

      wingElements.push(
        <mesh
          key={`wing-${direction}-tier-${index}`}
          position={[seatX, seatCenterY, 0]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[tier.depth, tier.height, tier.width]} />
          <meshStandardMaterial color={STADIUM_COLORS.seats} roughness={0.68} />
        </mesh>,
      );

      const fasciaHeight = Math.min(3, tier.height * 0.35);
      const fasciaCenterY = seatCenterY - tier.height / 2 + fasciaHeight / 2;
      wingElements.push(
        <mesh
          key={`wing-${direction}-fascia-${index}`}
          position={[seatX + tier.depth / 2 - 1.4, fasciaCenterY, 0]}
        >
          <boxGeometry args={[2.8, fasciaHeight, tier.width]} />
          <meshStandardMaterial color={STADIUM_COLORS.riser} roughness={0.62} />
        </mesh>,
      );

      const railCenterY = seatCenterY + tier.height / 2 - wingRailHeight / 2;
      wingElements.push(
        <mesh
          key={`wing-${direction}-rail-${index}`}
          position={[-tier.offset + 0.4, railCenterY, 0]}
        >
          <boxGeometry args={[1, wingRailHeight, tier.width * 0.92]} />
          <meshStandardMaterial color={STADIUM_COLORS.rail} roughness={0.2} />
        </mesh>,
      );

      const adCenterY = seatCenterY + tier.height / 2 + wingAdHeight / 2;
      wingElements.push(
        <mesh
          key={`wing-${direction}-ad-${index}`}
          position={[-tier.offset + wingAdDepth / 2, adCenterY, 0]}
          castShadow
        >
          <boxGeometry args={[wingAdDepth, wingAdHeight, tier.width]} />
          <meshStandardMaterial
            color={STADIUM_COLORS.adBand}
            emissive={STADIUM_COLORS.adBand}
            emissiveIntensity={0.12}
          />
        </mesh>,
      );

      if (adTexture) {
        wingElements.push(
          <mesh
            key={`wing-${direction}-adpanel-${index}`}
            position={[-tier.offset + wingAdDepth + 0.05, adCenterY, 0]}
            rotation={[0, Math.PI / 2, 0]}
          >
            <planeGeometry args={[tier.width, wingAdHeight * 0.92]} />
            <meshStandardMaterial
              map={adTexture}
              toneMapped={false}
              transparent
              opacity={0.97}
            />
          </mesh>,
        );
      }

      wingElevation = adCenterY + wingAdHeight / 2 + wingGap;
    });

    const wingFurthestOffset = wingConfigs.reduce(
      (max, tier) => Math.max(max, tier.offset + tier.depth),
      0,
    );
    const wingBackX = -wingFurthestOffset - 6;
    const wingBackHeight = wingElevation + 6;
    const wingWidth = wingConfigs[0].width;
    const wingInnerEdge = endzoneWallZ + wallThickness / 2;
    const wingCenterZ = wingInnerEdge + wingWidth / 2;

    return (
      <group
        key={`wing-${direction}`}
        position={[standFrontX - 2, 0, direction * wingCenterZ]}
        rotation={[0, direction * -Math.PI / 9, 0]}
      >
        <mesh position={[-wingFoundationDepth / 2, wingBaseHeight / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[wingFoundationDepth, wingBaseHeight, wingWidth * 1.12]} />
          <meshStandardMaterial color={STADIUM_COLORS.concrete} roughness={0.82} />
        </mesh>
        <mesh position={[-wingFoundationDepth * 0.6, wingBaseHeight * 0.35, 0]} receiveShadow>
          <boxGeometry args={[wingFoundationDepth * 0.8, wingBaseHeight * 0.4, wingWidth * 1.18]} />
          <meshStandardMaterial color={STADIUM_COLORS.walkway} roughness={0.7} />
        </mesh>
        {wingElements}
        <mesh position={[wingBackX, wingBackHeight / 2, 0]} receiveShadow>
          <boxGeometry args={[8, wingBackHeight, wingWidth * 1.18]} />
          <meshStandardMaterial color={STADIUM_COLORS.riser} roughness={0.6} />
        </mesh>
      </group>
    );
  };

  const lightingPositions = [
    [standFrontX - 46, 0, mainWidth / 2 + 78],
    [standFrontX - 46, 0, -mainWidth / 2 - 78],
    [standFrontX - 96, 0, mainWidth / 2 + 58],
    [standFrontX - 96, 0, -mainWidth / 2 - 58],
  ];

  return (
    <group>
      <group position={[standFrontX, 0, 0]}>
        <mesh position={[-foundationDepth / 2, baseHeight / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[foundationDepth, baseHeight, mainWidth * 1.12]} />
          <meshStandardMaterial color={STADIUM_COLORS.concrete} roughness={0.82} />
        </mesh>
        <mesh position={[-foundationDepth * 0.6, baseHeight * 0.35, 0]} receiveShadow>
          <boxGeometry args={[foundationDepth * 0.9, baseHeight * 0.4, mainWidth * 1.18]} />
          <meshStandardMaterial color={STADIUM_COLORS.walkway} roughness={0.72} />
        </mesh>
        {mainTiers}
        <mesh position={[-furthestOffset - 8, (elevation + 10) / 2, 0]} receiveShadow>
          <boxGeometry args={[10, elevation + 10, mainWidth * 1.2]} />
          <meshStandardMaterial color={STADIUM_COLORS.riser} roughness={0.6} />
        </mesh>
        <mesh position={[pressPlatformX, pressPlatformY, 0]} castShadow receiveShadow>
          <boxGeometry args={[pressPlatformDepth, pressPlatformHeight, pressPlatformWidth]} />
          <meshStandardMaterial color={STADIUM_COLORS.walkway} roughness={0.7} />
        </mesh>
        <mesh position={[pressRailOffset, pressPlatformY + pressPlatformHeight / 2 - pressRailHeight / 2, 0]}>
          <boxGeometry args={[1.2, pressRailHeight, pressPlatformWidth * 0.92]} />
          <meshStandardMaterial color={STADIUM_COLORS.rail} roughness={0.25} />
        </mesh>
        <mesh position={[pressBoxX, pressBoxY, 0]} castShadow receiveShadow>
          <boxGeometry args={[pressBoxDepth, pressBoxHeight, pressBoxWidth]} />
          <meshStandardMaterial color={STADIUM_COLORS.pressBoxFrame} roughness={0.6} metalness={0.18} />
        </mesh>
        <mesh position={[pressBoxX + pressBoxDepth * 0.12, pressBoxY + pressBoxHeight * 0.08, 0]}>
          <boxGeometry args={[pressBoxDepth * 0.76, pressBoxHeight * 0.54, pressBoxWidth * 0.9]} />
          <meshStandardMaterial
            color={STADIUM_COLORS.glass}
            transparent
            opacity={0.55}
            roughness={0.08}
            metalness={0.1}
          />
        </mesh>
        {Array.from({ length: 5 }).map((_, index) => {
          const spacing = pressBoxWidth * 0.18;
          const offset = -((5 - 1) / 2) * spacing + spacing * index;
          return (
            <mesh
              key={`press-mullion-${index}`}
              position={[pressBoxX + pressBoxDepth * 0.12, pressBoxY + pressBoxHeight * 0.08, offset]}
            >
              <boxGeometry args={[pressBoxDepth * 0.78, pressBoxHeight * 0.54, pressBoxWidth * 0.02]} />
              <meshStandardMaterial color={STADIUM_COLORS.pressBoxFrame} roughness={0.4} />
            </mesh>
          );
        })}
        <mesh position={[roofX, roofY, 0]} castShadow receiveShadow>
          <boxGeometry args={[roofDepth, roofHeight, roofWidth]} />
          <meshStandardMaterial color={STADIUM_COLORS.roof} roughness={0.4} />
        </mesh>
        <mesh position={[roofX + roofDepth / 2 - 2.4, roofY - roofHeight / 2 + 1.2, 0]}>
          <boxGeometry args={[4.8, 2.4, roofWidth * 0.96]} />
          <meshStandardMaterial color={STADIUM_COLORS.rail} roughness={0.28} />
        </mesh>
      </group>
      {[-1, 1].map((direction) => renderWing(direction))}
      <mesh position={[sidelineWallX, wallHeight / 2, 0]} receiveShadow>
        <boxGeometry args={[wallThickness, wallHeight, sidelineWallWidth]} />
        <meshStandardMaterial color={STADIUM_COLORS.walkway} roughness={0.68} />
      </mesh>
      {[-1, 1].map((direction) => (
        <mesh
          key={`endzone-wall-${direction}`}
          position={[0, wallHeight / 2, direction * endzoneWallZ]}
          receiveShadow
        >
          <boxGeometry args={[endzoneWallWidth, wallHeight, wallThickness]} />
          <meshStandardMaterial color={STADIUM_COLORS.walkway} roughness={0.68} />
        </mesh>
      ))}
      {lightingPositions.map((position, index) => (
        <LightTower key={`tower-${index}`} position={position} />
      ))}
    </group>
  );
}

function computeTeams(state) {
  const formation = state?.play?.formation || {};
  const safePlayers = (group) => Object.values(group || {}).filter(
    (p) => p && p.pos && Number.isFinite(p.pos.x) && Number.isFinite(p.pos.y),
  );
  const offenseSlot = state?.possession === TEAM_BLK ? TEAM_BLK : TEAM_RED;
  const defenseSlot = offenseSlot === TEAM_RED ? TEAM_BLK : TEAM_RED;
  const offenseColor = getTeamDisplayColor(state, offenseSlot, 'offense');
  const defenseColor = getTeamDisplayColor(state, defenseSlot, 'defense');

  const playElapsed = typeof state?.play?.elapsed === 'number' ? state.play.elapsed : null;
  const qbVision = state?.play?.qbVision || null;

  return {
    offense: safePlayers(formation.off).map((p) => ({ player: p, color: offenseColor })),
    defense: safePlayers(formation.def).map((p) => ({ player: p, color: defenseColor })),
    qbVision,
    playElapsed,
  };
}

function getTeamDisplayColor(state, slot, side) {
  const fallback = slot === TEAM_RED ? COLORS.red : COLORS.black;
  const source = resolveSlotColors(state, slot, side);
  return resolveTeamColor(source, fallback);
}

function computeEndzoneColors(state) {
  const resolve = (slot) => {
    const colors = resolveSlotColors(state, slot, 'offense');
    const fallback = slot === TEAM_RED ? COLORS.red : COLORS.black;
    const color = resolveTeamColor(colors, fallback);
    const matchup = state?.matchup || state?.lastCompletedGame?.matchup || null;
    const identity = matchup?.identities?.[slot] || null;
    const displayName = identity?.abbr || identity?.displayName || identity?.name || slot;
    return { color, label: displayName };
  };
  return {
    north: resolve(TEAM_RED),
    south: resolve(TEAM_BLK),
  };
}

function computeLineMarkers(state) {
  const losYards = Math.max(0, Math.min(100, state?.drive?.losYards ?? 25));
  const rawToGo = Math.max(1, state?.drive?.toGo ?? 10);
  const cappedToGo = Math.min(rawToGo, 100 - losYards);
  const losY = yardsToPixY(ENDZONE_YARDS + losYards);
  const ltgY = yardsToPixY(ENDZONE_YARDS + losYards + cappedToGo);
  return { losY, ltgY };
}

function computeBall(state) {
  try {
    const pos = getBallPix(state);
    if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return null;
    const worldPos = toWorldPosition(pos);
    const shadowSource = state?.play?.ball?.shadowPos || pos;
    const shadow = toWorldPosition(shadowSource);
    const ballState = state?.play?.ball || null;
    const height = ballState?.flight?.height || 0;
    const carried = !!(ballState && ballState.carrierId && !ballState.inAir);
    return { pos: worldPos, shadow, height, carried };
  } catch (err) {
    return null;
  }
}

function SceneContent({ state }) {
  const center = [0, 0, 0];
  useSidelineCamera(center);

  const teams = useMemo(() => computeTeams(state), [state]);
  const endzones = useMemo(() => computeEndzoneColors(state), [state]);
  const lines = useMemo(() => computeLineMarkers(state), [state]);
  const ball = useMemo(() => computeBall(state), [state]);

  return (
    <group>
      <FieldBase />
      <FieldTopVolume colors={endzones} />
      <FieldTexture colors={endzones} />
      <FieldGoalPosts />
      <StadiumEnvironment />
      <ambientLight intensity={0.55} />
      <directionalLight position={[320, 500, 420]} intensity={0.85} castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048} />
      <hemisphereLight args={[0x49753a, 0x0a1c0a, 0.35]} />
      <group>
        {teams.defense.map(({ player, color }) => (
          <PlayerMarker
            key={`def-${player.role}`}
            player={player}
            color={color}
            qbVision={teams.qbVision}
            playElapsed={teams.playElapsed}
          />
        ))}
        {teams.offense.map(({ player, color }) => (
          <PlayerMarker
            key={`off-${player.role}`}
            player={player}
            color={color}
            qbVision={teams.qbVision}
            playElapsed={teams.playElapsed}
          />
        ))}
      </group>
      {ball ? <BallMarker pos={ball.pos} height={ball.height} shadow={ball.shadow} carried={ball.carried} /> : null}
      <FirstDownMarkers losY={lines.losY} ltgY={lines.ltgY} />
    </group>
  );
}

function Field3D({ state }) {
  const [webglSupported] = React.useState(() => isWebGLAvailable());
  if (!webglSupported) {
    return (
      <div className="field-canvas field-canvas--fallback">
        <div className="field-canvas__fallback-glow" />
        <span className="field-canvas__fallback-text">3D view unavailable</span>
      </div>
    );
  }
  return (
    <Canvas
      className="field-canvas"
      shadows
      dpr={[1, 2]}
      camera={{ fov: 26, position: [FIELD_PIX_H * 0.9, FIELD_PIX_W * 1.2, 0], near: 0.1, far: 6000 }}
      gl={{ antialias: true }}
    >
      <color attach="background" args={["#021403"]} />
      <fog attach="fog" args={["#021403", 900, 2500]} />
      <SceneContent state={state} />
    </Canvas>
  );
}

export default React.memo(Field3D);
