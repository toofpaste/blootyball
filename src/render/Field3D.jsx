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
  concrete: '#8e949d',
  seats: '#5a616d',
  riser: '#7c838f',
  walkway: '#b8bdc7',
  seatHighlight: '#d6dbe3',
  adBand: '#eb6a1f',
  adText: '#f4f2eb',
  pressBox: '#989ea9',
  pressBoxFrame: '#777e89',
  glass: '#dce2eb',
  roof: '#5b616b',
  rail: '#f0f3f6',
  lightingStructure: '#7a808c',
  lighting: '#f8fbff',
  scoreboardFrame: '#50565f',
  scoreboardAccent: '#626771',
  truss: '#6e747f',
  beam: '#7a808b',
  stair: '#c7ccd4',
  bannerHighlight: '#fbd165',
  fasciaAccent: '#6a717c',
  suiteGlass: '#dfe4ec',
  suiteFrame: '#7b828d',
  seatDivider: '#6d737f',
  lightBacker: '#323741',
  lightGuard: '#9096a2',
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

function createDiagonalSlabGeometry({ width, depth, height, cutDepth }) {
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  const safeCut = Math.max(0, Math.min(cutDepth, halfWidth - 0.01));
  const shape = new THREE.Shape();
  shape.moveTo(-halfWidth + safeCut, -halfDepth);
  shape.lineTo(halfWidth - safeCut, -halfDepth);
  shape.lineTo(halfWidth, 0);
  shape.lineTo(halfWidth - safeCut, halfDepth);
  shape.lineTo(-halfWidth + safeCut, halfDepth);
  shape.lineTo(-halfWidth, 0);
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
  });
  geometry.rotateX(Math.PI / 2);
  geometry.rotateY(Math.PI / 2);
  geometry.translate(0, height / 2, 0);
  geometry.computeVertexNormals();
  return geometry;
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
  const baseHeight = 12;
  const legHeight = 92;
  const legSpread = 8;
  const legThickness = 2.6;
  const midPlatformHeight = 3.8;
  const topPlatformThickness = 2.8;
  const headWidth = 42;
  const headHeight = 6.8;
  const headDepth = 11;
  const lightRows = 3;
  const lightColumns = 5;
  const lightSpacingX = headWidth / (lightColumns + 1);
  const lightSpacingY = headHeight / (lightRows + 1);
  const lightElevation = baseHeight + legHeight + midPlatformHeight + headHeight + topPlatformThickness + 2.4;

  const legs = [];
  const braces = [];
  const braceSegments = 5;
  for (const xDir of [-1, 1]) {
    for (const zDir of [-1, 1]) {
      const legX = xDir * legSpread;
      const legZ = zDir * legSpread * 0.6;
      legs.push(
        <mesh
          key={`leg-${xDir}-${zDir}`}
          position={[legX, baseHeight + legHeight / 2, legZ]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[legThickness, legHeight, legThickness]} />
          <meshStandardMaterial color={STADIUM_COLORS.lightingStructure} roughness={0.46} metalness={0.28} />
        </mesh>,
      );

      for (let segment = 0; segment < braceSegments; segment += 1) {
        const braceY = baseHeight + (legHeight / braceSegments) * segment + legThickness * 1.1;
        const tilt = (segment % 2 === 0 ? 1 : -1) * Math.PI / 6;
        braces.push(
          <mesh
            key={`brace-${xDir}-${zDir}-${segment}`}
            position={[legX * 0.65, braceY, legZ * 0.65]}
            rotation={[0, tilt, 0]}
          >
            <boxGeometry args={[legThickness * 0.8, legThickness * 4.6, legThickness * 0.8]} />
            <meshStandardMaterial color={STADIUM_COLORS.truss} roughness={0.55} metalness={0.18} />
          </mesh>,
        );
      }
    }
  }

  const lightFixtures = [];
  for (let row = 0; row < lightRows; row += 1) {
    for (let column = 0; column < lightColumns; column += 1) {
      const x = -headWidth / 2 + lightSpacingX * (column + 1);
      const y = baseHeight + legHeight + midPlatformHeight + headHeight - lightSpacingY * (row + 1);
      lightFixtures.push(
        <mesh key={`light-${row}-${column}`} position={[x, y, headDepth / 2 + 1.2]}>
          <boxGeometry args={[lightSpacingX * 0.72, lightSpacingY * 0.62, 2.4]} />
          <meshStandardMaterial
            color={STADIUM_COLORS.lighting}
            emissive={STADIUM_COLORS.lighting}
            emissiveIntensity={0.85}
            roughness={0.12}
          />
        </mesh>,
      );
    }
  }

  return (
    <group position={position}>
      <mesh position={[0, baseHeight / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[18, baseHeight, 18]} />
        <meshStandardMaterial color={STADIUM_COLORS.concrete} roughness={0.82} />
      </mesh>
      {legs}
      {braces}
      <mesh position={[0, baseHeight + legHeight * 0.58, 0]} castShadow>
        <boxGeometry args={[legSpread * 1.7, legThickness * 2.3, legSpread * 1.12]} />
        <meshStandardMaterial color={STADIUM_COLORS.truss} roughness={0.46} metalness={0.26} />
      </mesh>
      <mesh position={[0, baseHeight + legHeight + midPlatformHeight / 2, 0]} castShadow>
        <boxGeometry args={[headWidth * 0.74, midPlatformHeight, headDepth * 0.72]} />
        <meshStandardMaterial color={STADIUM_COLORS.lightingStructure} roughness={0.36} metalness={0.24} />
      </mesh>
      <mesh position={[0, baseHeight + legHeight + midPlatformHeight + headHeight / 2, headDepth / 2]}>
        <boxGeometry args={[headWidth, headHeight, headDepth]} />
        <meshStandardMaterial color={STADIUM_COLORS.lightBacker} roughness={0.32} />
      </mesh>
      {lightFixtures}
      {[-1, 1].map((xDir) => (
        <mesh
          key={`guard-${xDir}`}
          position={[xDir * (headWidth / 2 + 0.8), baseHeight + legHeight + midPlatformHeight + headHeight / 2, headDepth / 2]}
        >
          <boxGeometry args={[1.2, headHeight + 1.6, headDepth * 1.1]} />
          <meshStandardMaterial color={STADIUM_COLORS.lightGuard} roughness={0.5} />
        </mesh>
      ))}
      <mesh position={[0, baseHeight + legHeight + midPlatformHeight + headHeight + topPlatformThickness / 2, headDepth / 2]}
        castShadow
      >
        <boxGeometry args={[headWidth * 0.86, topPlatformThickness, headDepth * 1.08]} />
        <meshStandardMaterial color={STADIUM_COLORS.truss} roughness={0.44} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh
          key={`top-rail-${side}`}
          position={[0, baseHeight + legHeight + midPlatformHeight + headHeight + topPlatformThickness + 0.8, side * headDepth * 0.42]}
        >
          <boxGeometry args={[headWidth * 0.9, 1, 1.1]} />
          <meshStandardMaterial color={STADIUM_COLORS.rail} roughness={0.28} />
        </mesh>
      ))}
      <spotLight
        position={[0, lightElevation, 0]}
        angle={0.52}
        penumbra={0.35}
        intensity={1.8}
        distance={2200}
        decay={1.4}
        color={STADIUM_COLORS.lighting}
        castShadow
        target-position={[-position[0], 0, -position[2]]}
      />
    </group>
  );
}

function StadiumEnvironment() {
  const fieldHalfW = FIELD_PIX_W / 2;
  const fieldHalfH = FIELD_PIX_H / 2;
  const sidelineOffset = SIDELINE_BLEED + PX_PER_YARD * 1.4;
  const standFrontX = -fieldHalfW - sidelineOffset;
  const adTexture = useMemo(() => createAdTexture(), []);
  const mainWidth = FIELD_PIX_H + PX_PER_YARD * 6;
  const baseHeight = 9.4;
  const foundationDepth = 48;
  const adBandDepth = 3.6;
  const adBandHeight = 4.6;
  const tierGap = 7.4;
  const railHeight = 2.6;
  const endzoneStandWidth = FIELD_PIX_W + SIDELINE_BLEED * 2 + PX_PER_YARD * 6;
  const wingFoundationDepth = 34;
  const wingBaseHeight = baseHeight * 0.92;

  const mainWalkwayWidth = mainWidth * 1.02;
  const mainFoundationWidth = mainWidth * 1.08;

  const mainFoundationGeometry = useMemo(
    () =>
      createDiagonalSlabGeometry({
        width: mainFoundationWidth,
        depth: foundationDepth,
        height: baseHeight,
        cutDepth: mainFoundationWidth * 0.18,
      }),
    [baseHeight, foundationDepth, mainFoundationWidth],
  );

  const mainApronGeometry = useMemo(
    () =>
      createDiagonalSlabGeometry({
        width: mainWalkwayWidth,
        depth: foundationDepth * 0.9,
        height: baseHeight * 0.4,
        cutDepth: mainWalkwayWidth * 0.2,
      }),
    [baseHeight, foundationDepth, mainWalkwayWidth],
  );

  const mainDeckGeometry = useMemo(
    () =>
      createDiagonalSlabGeometry({
        width: mainWalkwayWidth,
        depth: foundationDepth * 0.62,
        height: 2.2,
        cutDepth: mainWalkwayWidth * 0.18,
      }),
    [foundationDepth, mainWalkwayWidth],
  );

  const wingWalkwayWidth = endzoneStandWidth * 1.02;
  const wingFoundationWidth = wingWalkwayWidth * 1.08;

  const wingFoundationGeometry = useMemo(
    () =>
      createDiagonalSlabGeometry({
        width: wingFoundationWidth,
        depth: wingFoundationDepth,
        height: wingBaseHeight,
        cutDepth: wingFoundationWidth * 0.2,
      }),
    [wingBaseHeight, wingFoundationDepth, wingFoundationWidth],
  );

  const wingApronGeometry = useMemo(
    () =>
      createDiagonalSlabGeometry({
        width: wingWalkwayWidth,
        depth: wingFoundationDepth * 0.78,
        height: wingBaseHeight * 0.42,
        cutDepth: wingWalkwayWidth * 0.2,
      }),
    [wingBaseHeight, wingFoundationDepth, wingWalkwayWidth],
  );

  const wingDeckGeometry = useMemo(
    () =>
      createDiagonalSlabGeometry({
        width: wingWalkwayWidth,
        depth: wingFoundationDepth * 0.64,
        height: 1.8,
        cutDepth: wingWalkwayWidth * 0.18,
      }),
    [wingFoundationDepth, wingWalkwayWidth],
  );

  const mainAisleCount = 9;
  const mainAisleWidth = 5.4;
  const mainAisleSpacing = mainWidth / (mainAisleCount + 1);
  const mainAisleOffsets = Array.from({ length: mainAisleCount }, (_, index) => (
    -mainWidth / 2 + mainAisleSpacing * (index + 1)
  ));
  const underSeatSupportCount = 12;
  const underSeatSupportSpacing = mainWidth / (underSeatSupportCount + 1);
  const underSeatSupportOffsets = Array.from({ length: underSeatSupportCount }, (_, index) => (
    -mainWidth / 2 + underSeatSupportSpacing * (index + 1)
  ));

  const tierConfigs = [
    { width: mainWidth * 1.02, depth: 32, height: 14.6, offset: 0, walkwayDepth: 6, walkwayHeight: 3.2, rows: 18 },
    { width: mainWidth * 0.94, depth: 26, height: 13.2, offset: 22, walkwayDepth: 5.2, walkwayHeight: 2.8, rows: 16 },
    { width: mainWidth * 0.82, depth: 24, height: 12.2, offset: 42, walkwayDepth: 4.6, walkwayHeight: 2.6, rows: 14 },
    { width: mainWidth * 0.7, depth: 20, height: 11, offset: 60, walkwayDepth: 4, walkwayHeight: 2.4, rows: 12 },
  ];

  const furthestOffset = tierConfigs.reduce(
    (max, tier) => Math.max(max, tier.offset + tier.depth),
    0,
  );

  let elevation = baseHeight;
  const mainTiers = [];
  const tierWalkways = [];
  tierConfigs.forEach((tier, index) => {
    const seatCenterY = elevation + tier.height / 2;
    const seatX = -tier.offset - tier.depth / 2;
    const frontEdgeX = seatX + tier.depth / 2;
    const backEdgeX = seatX - tier.depth / 2;
    const walkwayGap = 0.8;
    const walkwayDeckX = backEdgeX - tier.walkwayDepth / 2 - 0.4;
    const walkwayDeckHeight = tier.walkwayHeight;
    const walkwayY = seatCenterY + tier.height / 2 + walkwayGap + walkwayDeckHeight / 2;
    const adCenterY = walkwayY + walkwayDeckHeight / 2 + adBandHeight / 2 + 0.4;
    const adX = walkwayDeckX + tier.walkwayDepth / 2 - adBandDepth / 2 - 0.2;

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

    const seatRowCount = tier.rows || 12;
    const seatRowThickness = Math.min(0.4, tier.height / (seatRowCount * 3));
    for (let rowIndex = 0; rowIndex < seatRowCount; rowIndex += 1) {
      const rowY = seatCenterY - tier.height / 2 + (tier.height / seatRowCount) * (rowIndex + 0.35);
      mainTiers.push(
        <mesh
          key={`main-tier-row-${index}-${rowIndex}`}
          position={[seatX + tier.depth * 0.16, rowY, 0]}
        >
          <boxGeometry args={[tier.depth * 0.68, seatRowThickness, tier.width * 0.9]} />
          <meshStandardMaterial color={STADIUM_COLORS.seatHighlight} roughness={0.58} />
        </mesh>,
      );
    }

    const seatStripeCount = 9;
    const seatStripeHeight = Math.min(0.6, tier.height * 0.12);
    for (let stripeIndex = 1; stripeIndex < seatStripeCount; stripeIndex += 1) {
      const stripeY = seatCenterY - tier.height / 2 + (tier.height / seatStripeCount) * stripeIndex;
      mainTiers.push(
        <mesh
          key={`main-tier-stripe-${index}-${stripeIndex}`}
          position={[seatX, stripeY, 0]}
        >
          <boxGeometry args={[tier.depth * 0.94, seatStripeHeight, tier.width * 0.92]} />
          <meshStandardMaterial color={STADIUM_COLORS.seatHighlight} roughness={0.64} />
        </mesh>,
      );
    }

    const stairBandCount = 3;
    const stairBandWidth = Math.min(6, tier.width * 0.06);
    for (let bandIndex = 0; bandIndex < stairBandCount; bandIndex += 1) {
      const bandZ = -tier.width / 2 + (tier.width / (stairBandCount + 1)) * (bandIndex + 1);
      mainTiers.push(
        <mesh
          key={`main-tier-stairband-${index}-${bandIndex}`}
          position={[seatX + tier.depth * 0.18, seatCenterY - tier.height * 0.08, bandZ]}
        >
          <boxGeometry args={[tier.depth * 0.78, tier.height * 0.22, stairBandWidth]} />
          <meshStandardMaterial color={STADIUM_COLORS.walkway} roughness={0.5} />
        </mesh>,
      );
      mainTiers.push(
        <mesh
          key={`main-tier-stairband-lip-${index}-${bandIndex}`}
          position={[seatX + tier.depth * 0.18, seatCenterY + tier.height / 2 - 0.5, bandZ]}
        >
          <boxGeometry args={[tier.depth * 0.74, 0.7, stairBandWidth * 0.7]} />
          <meshStandardMaterial color={STADIUM_COLORS.seatHighlight} roughness={0.42} />
        </mesh>,
      );
    }

    const seatModuleCount = Math.max(14, Math.round(tier.width / (PX_PER_YARD * 3.4)));
    for (let moduleIndex = 1; moduleIndex < seatModuleCount; moduleIndex += 1) {
      const moduleZ = -tier.width / 2 + (tier.width / seatModuleCount) * moduleIndex;
      mainTiers.push(
        <mesh
          key={`main-tier-divider-${index}-${moduleIndex}`}
          position={[seatX + tier.depth * 0.22, seatCenterY + tier.height * 0.08, moduleZ]}
        >
          <boxGeometry args={[tier.depth * 0.12, tier.height * 0.6, 0.8]} />
          <meshStandardMaterial color={STADIUM_COLORS.seatDivider} roughness={0.56} />
        </mesh>,
      );
    }

    const fasciaHeight = Math.min(3.8, tier.height * 0.4);
    const fasciaCenterY = seatCenterY - tier.height / 2 + fasciaHeight / 2;
    mainTiers.push(
      <mesh
        key={`main-fascia-${index}`}
        position={[frontEdgeX - 1.4, fasciaCenterY, 0]}
      >
        <boxGeometry args={[3.2, fasciaHeight, tier.width]} />
        <meshStandardMaterial color={STADIUM_COLORS.fasciaAccent} roughness={0.58} />
      </mesh>,
    );

    const fasciaLipHeight = Math.min(1.2, fasciaHeight * 0.4);
    mainTiers.push(
      <mesh
        key={`main-fascia-lip-${index}`}
        position={[frontEdgeX - 2.4, fasciaCenterY + fasciaHeight / 2 + fasciaLipHeight / 2, 0]}
      >
        <boxGeometry args={[2.2, fasciaLipHeight, tier.width * 0.98]} />
        <meshStandardMaterial color={STADIUM_COLORS.riser} roughness={0.54} />
      </mesh>,
    );

    mainTiers.push(
      <mesh
        key={`main-tier-edge-${index}`}
        position={[frontEdgeX - 0.8, seatCenterY + tier.height / 2 - 0.6, 0]}
      >
        <boxGeometry args={[1.6, 1.2, tier.width * 0.96]} />
        <meshStandardMaterial color={STADIUM_COLORS.seatHighlight} roughness={0.42} />
      </mesh>,
    );

    const railCenterY = seatCenterY + tier.height / 2 - railHeight / 2;
    mainTiers.push(
      <mesh
        key={`main-rail-${index}`}
        position={[-tier.offset + 0.5, railCenterY, 0]}
      >
        <boxGeometry args={[1.2, railHeight, tier.width * 0.9]} />
        <meshStandardMaterial color={STADIUM_COLORS.rail} roughness={0.2} />
      </mesh>,
    );

    const stringerCount = 4;
    for (let s = 0; s < stringerCount; s += 1) {
      const stringerZ = -tier.width / 2 + (tier.width / (stringerCount - 1 || 1)) * s;
      mainTiers.push(
        <mesh
          key={`main-stringer-${index}-${s}`}
          position={[frontEdgeX - 3.6, seatCenterY - tier.height / 2 + 1.4, stringerZ]}
        >
          <boxGeometry args={[2.4, tier.height + walkwayDeckHeight * 0.4, 1.4]} />
          <meshStandardMaterial color={STADIUM_COLORS.beam} roughness={0.55} />
        </mesh>,
      );
    }

    mainAisleOffsets.forEach((offset, aisleIndex) => {
      if (Math.abs(offset) + mainAisleWidth / 2 >= tier.width / 2) return;
      mainTiers.push(
        <mesh
          key={`main-tier-aisle-${index}-${aisleIndex}`}
          position={[seatX, seatCenterY, offset]}
          receiveShadow
        >
          <boxGeometry args={[tier.depth * 0.92, tier.height * 1.08, mainAisleWidth]} />
          <meshStandardMaterial color={STADIUM_COLORS.walkway} roughness={0.48} />
        </mesh>,
      );
      mainTiers.push(
        <mesh
          key={`main-tier-aisle-rail-${index}-${aisleIndex}`}
          position={[-tier.offset + 0.6, railCenterY + railHeight / 2, offset]}
        >
          <boxGeometry args={[1.4, railHeight * 0.5, mainAisleWidth * 0.3]} />
          <meshStandardMaterial color={STADIUM_COLORS.rail} roughness={0.25} />
        </mesh>,
      );
      mainTiers.push(
        <mesh
          key={`main-tier-aisle-stair-${index}-${aisleIndex}`}
          position={[seatX + 0.2, seatCenterY - tier.height / 2 + 1.4, offset]}
        >
          <boxGeometry args={[tier.depth * 0.86, 2.2, mainAisleWidth * 0.74]} />
          <meshStandardMaterial color={STADIUM_COLORS.stair} roughness={0.58} />
        </mesh>,
      );
    });

    mainTiers.push(
      <mesh
        key={`main-adband-${index}`}
        position={[adX, adCenterY, 0]}
        castShadow
      >
        <boxGeometry args={[adBandDepth, adBandHeight, tier.width * 0.98]} />
        <meshStandardMaterial
          color={STADIUM_COLORS.adBand}
          emissive={STADIUM_COLORS.adBand}
          emissiveIntensity={0.16}
        />
      </mesh>,
    );

    mainTiers.push(
      <mesh
        key={`main-walkway-${index}`}
        position={[walkwayDeckX, walkwayY, 0]}
        receiveShadow
      >
        <boxGeometry args={[tier.walkwayDepth, walkwayDeckHeight, tier.width]} />
        <meshStandardMaterial color={STADIUM_COLORS.walkway} roughness={0.52} />
      </mesh>,
    );

    tierWalkways.push({
      index,
      walkwayDeckX,
      walkwayY,
      walkwayDeckHeight,
      width: tier.width,
      seatCenterY,
      seatX,
      tier,
    });

    mainTiers.push(
      <mesh
        key={`main-walkway-rail-${index}`}
        position={[walkwayDeckX - tier.walkwayDepth / 2 + 0.8, walkwayY + walkwayDeckHeight / 2 + railHeight / 2 - 0.3, 0]}
      >
        <boxGeometry args={[1.2, railHeight, tier.width * 0.96]} />
        <meshStandardMaterial color={STADIUM_COLORS.rail} roughness={0.24} />
      </mesh>,
    );

    const bannerHeight = Math.min(1.4, adBandHeight * 0.32);
    mainTiers.push(
      <mesh
        key={`main-adband-highlight-${index}`}
        position={[adX + adBandDepth / 2 - 0.6, adCenterY + adBandHeight / 2 - bannerHeight / 2 - 0.1, 0]}
      >
        <boxGeometry args={[1.4, bannerHeight, tier.width * 0.96]} />
        <meshStandardMaterial color={STADIUM_COLORS.bannerHighlight} emissive={STADIUM_COLORS.bannerHighlight} emissiveIntensity={0.2} />
      </mesh>,
    );

    const walkwayBeamCount = 5;
    for (let b = 0; b < walkwayBeamCount; b += 1) {
      const beamOffset = -tier.width / 2 + (tier.width / (walkwayBeamCount - 1 || 1)) * b;
      mainTiers.push(
        <mesh
          key={`main-walkway-beam-${index}-${b}`}
          position={[walkwayDeckX - tier.walkwayDepth / 2 + 0.6, seatCenterY + tier.height / 2 + 0.6, beamOffset]}
        >
          <boxGeometry args={[2.6, walkwayDeckHeight + 2.8, 1.2]} />
          <meshStandardMaterial color={STADIUM_COLORS.truss} roughness={0.6} />
        </mesh>,
      );
    }

    if (adTexture) {
      mainTiers.push(
        <mesh
          key={`main-adpanel-${index}`}
          position={[adX + adBandDepth / 2 + 0.05, adCenterY, 0]}
          rotation={[0, Math.PI / 2, 0]}
        >
          <planeGeometry args={[tier.width * 0.98, adBandHeight * 0.9]} />
          <meshStandardMaterial
            map={adTexture}
            toneMapped={false}
            transparent
            opacity={0.97}
          />
        </mesh>,
      );
    }

    mainTiers.push(
      <mesh
        key={`main-walkway-truss-${index}`}
        position={[walkwayDeckX - tier.walkwayDepth / 2 - 1.4, seatCenterY + tier.height / 2 - 1.2, 0]}
      >
        <boxGeometry args={[2.2, walkwayDeckHeight + tierGap * 1.1, tier.width]} />
        <meshStandardMaterial color={STADIUM_COLORS.truss} roughness={0.62} />
      </mesh>,
    );

    elevation = adCenterY + adBandHeight / 2 + tierGap;
  });

  const clubTier = tierWalkways.find((entry) => entry.index === 1);
  if (clubTier) {
    const suiteDepth = 12;
    const suiteHeight = 6.8;
    const suiteBaseX = clubTier.walkwayDeckX - clubTier.tier.walkwayDepth / 2 - suiteDepth / 2 - 2.2;
    const suiteBaseY = clubTier.walkwayY + clubTier.walkwayDeckHeight / 2 + suiteHeight / 2 + 1.4;
    const suiteCount = 10;
    const suiteSpacing = clubTier.width / suiteCount;
    for (let suiteIndex = 0; suiteIndex < suiteCount; suiteIndex += 1) {
      const centerZ = -clubTier.width / 2 + suiteSpacing / 2 + suiteSpacing * suiteIndex;
      const suiteKey = `club-suite-${suiteIndex}`;
      mainTiers.push(
        <mesh key={`${suiteKey}-body`} position={[suiteBaseX, suiteBaseY, centerZ]} castShadow receiveShadow>
          <boxGeometry args={[suiteDepth, suiteHeight, suiteSpacing * 0.82]} />
          <meshStandardMaterial color={STADIUM_COLORS.suiteFrame} roughness={0.5} metalness={0.16} />
        </mesh>,
      );
      mainTiers.push(
        <mesh key={`${suiteKey}-glass`} position={[suiteBaseX + suiteDepth / 2 - 1.8, suiteBaseY, centerZ]}>
          <boxGeometry args={[3.2, suiteHeight * 0.86, suiteSpacing * 0.74]} />
          <meshStandardMaterial
            color={STADIUM_COLORS.suiteGlass}
            transparent
            opacity={0.48}
            roughness={0.12}
            metalness={0.1}
          />
        </mesh>,
      );
      mainTiers.push(
        <mesh key={`${suiteKey}-soffit`} position={[suiteBaseX + suiteDepth / 2 - 0.6, suiteBaseY + suiteHeight / 2 - 0.8, centerZ]}>
          <boxGeometry args={[1.2, 1.6, suiteSpacing * 0.78]} />
          <meshStandardMaterial color={STADIUM_COLORS.fasciaAccent} roughness={0.48} />
        </mesh>,
      );
      mainTiers.push(
        <mesh key={`${suiteKey}-mullion`} position={[suiteBaseX + suiteDepth / 2 - 1.8, suiteBaseY, centerZ]}>
          <boxGeometry args={[3.4, suiteHeight * 0.88, suiteSpacing * 0.08]} />
          <meshStandardMaterial color={STADIUM_COLORS.pressBoxFrame} roughness={0.44} />
        </mesh>,
      );
    }
  }

  const logeTier = tierWalkways.find((entry) => entry.index === 2);
  if (logeTier) {
    const logeDepth = 8;
    const logeHeight = 4.2;
    const logeBaseX = logeTier.walkwayDeckX - logeTier.tier.walkwayDepth / 2 - logeDepth / 2 - 1.5;
    const logeBaseY = logeTier.walkwayY + logeTier.walkwayDeckHeight / 2 + logeHeight / 2 + 0.9;
    const logeCount = 18;
    const logeSpacing = logeTier.width / logeCount;
    for (let logeIndex = 0; logeIndex < logeCount; logeIndex += 1) {
      const centerZ = -logeTier.width / 2 + logeSpacing / 2 + logeSpacing * logeIndex;
      const key = `loge-${logeIndex}`;
      mainTiers.push(
        <mesh key={`${key}-bar`} position={[logeBaseX, logeBaseY, centerZ]}>
          <boxGeometry args={[logeDepth, logeHeight, logeSpacing * 0.74]} />
          <meshStandardMaterial color={STADIUM_COLORS.pressBoxFrame} roughness={0.5} />
        </mesh>,
      );
      mainTiers.push(
        <mesh key={`${key}-glass`} position={[logeBaseX + logeDepth / 2 - 1.4, logeBaseY + logeHeight * 0.05, centerZ]}>
          <boxGeometry args={[2.2, logeHeight * 0.7, logeSpacing * 0.64]} />
          <meshStandardMaterial color={STADIUM_COLORS.suiteGlass} transparent opacity={0.38} roughness={0.14} />
        </mesh>,
      );
    }
  }

  const topTier = tierConfigs[tierConfigs.length - 1];
  const pressPlatformHeight = 5.2;
  const pressPlatformDepth = 36;
  const pressPlatformWidth = topTier.width * 0.82;
  const pressPlatformY = elevation + pressPlatformHeight / 2 + 0.8;
  const pressPlatformX = -topTier.offset - pressPlatformDepth / 2 - 8;

  const pressRailHeight = 2.4;
  const pressRailOffset = -topTier.offset - 0.4;

  const pressBoxHeight = 18;
  const pressBoxDepth = 34;
  const pressBoxWidth = topTier.width * 0.6;
  const pressBoxY = pressPlatformY + pressPlatformHeight / 2 + pressBoxHeight / 2 + 1.8;
  const pressBoxX = pressPlatformX - pressBoxDepth / 2 + 0.4;

  const pressBoxLowerTrimHeight = 2.2;

  const roofHeight = 6.2;
  const roofDepth = pressBoxDepth + 18;
  const roofWidth = pressBoxWidth + 28;
  const roofY = pressBoxY + pressBoxHeight / 2 + roofHeight / 2 + 1.6;
  const roofX = pressBoxX - 1.2;

  const scoreboardDepth = pressBoxDepth * 0.64;
  const scoreboardHeight = 14.8;
  const scoreboardWidth = pressBoxWidth * 0.86;
  const scoreboardOffsetAboveRoof = 3.6;
  const scoreboardY = roofY + roofHeight / 2 + scoreboardOffsetAboveRoof + scoreboardHeight / 2;
  const scoreboardX = roofX - roofDepth / 2 - scoreboardDepth / 2 - 2.8;
  const scoreboardSupportHeight = scoreboardY - (roofY + roofHeight / 2);
  const scoreboardSupportSpacing = scoreboardWidth * 0.3;
  const scoreboardFaceInset = scoreboardDepth / 2 - 0.8;
  const scoreboardDeckHeight = 2.1;
  const scoreboardDeckDepth = scoreboardDepth + 8;
  const scoreboardDeckWidth = scoreboardWidth + 16;
  const scoreboardDeckY = roofY + roofHeight / 2 + scoreboardDeckHeight / 2 + 0.7;
  const scoreboardDeckX = scoreboardX - scoreboardDepth / 2 + scoreboardDeckDepth / 2 - 0.6;
  const scoreboardColumnHeight = Math.max(
    1.2,
    scoreboardY - scoreboardHeight / 2 - (scoreboardDeckY + scoreboardDeckHeight / 2),
  );
  const scoreboardColumnCount = 3;
  const scoreboardColumnSpacing = scoreboardWidth / (scoreboardColumnCount + 1);
  const scoreboardRailHeight = 1.8;
  const scoreboardLightCount = 4;
  const scoreboardLightSpacing = scoreboardWidth / (scoreboardLightCount + 1);

  const sidelineWallX = fieldHalfW + SIDELINE_BLEED + PX_PER_YARD * 0.9;
  const sidelineWallWidth = mainWidth + PX_PER_YARD * 12;
  const endzoneWallZ = fieldHalfH + PX_PER_YARD * 2.6;
  const endzoneWallWidth = FIELD_PIX_W + SIDELINE_BLEED * 2 + PX_PER_YARD * 6;
  const wallHeight = 4.4;
  const wallThickness = 4.4;

  const renderWing = (direction) => {
    const wingConfigs = [
      { width: endzoneStandWidth * 1.02, depth: 18, height: 9.6, offset: 0, walkwayDepth: 3.6, walkwayHeight: 1.9, rows: 12 },
      { width: endzoneStandWidth * 0.94, depth: 16, height: 8.6, offset: 14, walkwayDepth: 3.2, walkwayHeight: 1.7, rows: 11 },
      { width: endzoneStandWidth * 0.84, depth: 14, height: 7.8, offset: 26, walkwayDepth: 2.8, walkwayHeight: 1.5, rows: 10 },
    ];
    const wingAdHeight = 3.6;
    const wingAdDepth = 2.8;
    const wingGap = 3.8;
    const wingRailHeight = 2.2;
    const wingAisleCount = 5;
    const wingAisleWidth = 5;
    const wingAisleSpacing = wingConfigs[0].width / (wingAisleCount + 1);
    const wingAisleOffsets = Array.from({ length: wingAisleCount }, (_, index) => (
      -wingConfigs[0].width / 2 + wingAisleSpacing * (index + 1)
    ));
    let wingElevation = wingBaseHeight;
    const wingElements = [];

    wingConfigs.forEach((tier, index) => {
      const seatCenterY = wingElevation + tier.height / 2;
      const seatX = -tier.offset - tier.depth / 2;
      const frontEdgeX = seatX + tier.depth / 2;
      const walkwayDeckHeight = tier.walkwayHeight;
      const walkwayGap = 0.8;
      const walkwayDeckX = seatX - tier.depth / 2 - tier.walkwayDepth / 2 - 0.4;
      const walkwayY = seatCenterY + tier.height / 2 + walkwayGap + walkwayDeckHeight / 2;
      const adCenterY = walkwayY + walkwayDeckHeight / 2 + wingAdHeight / 2 + 0.35;
      const adX = walkwayDeckX + tier.walkwayDepth / 2 - wingAdDepth / 2 - 0.2;

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

      const rowCount = tier.rows || 10;
      const rowThickness = Math.min(0.32, tier.height / (rowCount * 2.6));
      for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
        const rowY = seatCenterY - tier.height / 2 + (tier.height / rowCount) * (rowIndex + 0.35);
        wingElements.push(
          <mesh
            key={`wing-${direction}-row-${index}-${rowIndex}`}
            position={[seatX + tier.depth * 0.14, rowY, 0]}
          >
            <boxGeometry args={[tier.depth * 0.64, rowThickness, tier.width * 0.9]} />
            <meshStandardMaterial color={STADIUM_COLORS.seatHighlight} roughness={0.6} />
          </mesh>,
        );
      }

      const wingStripeCount = 7;
      const wingStripeHeight = Math.min(0.52, tier.height * 0.12);
      for (let stripeIndex = 1; stripeIndex < wingStripeCount; stripeIndex += 1) {
        const stripeY = seatCenterY - tier.height / 2 + (tier.height / wingStripeCount) * stripeIndex;
        wingElements.push(
          <mesh
            key={`wing-${direction}-tier-stripe-${index}-${stripeIndex}`}
            position={[seatX, stripeY, 0]}
          >
            <boxGeometry args={[tier.depth * 0.94, wingStripeHeight, tier.width * 0.9]} />
            <meshStandardMaterial color={STADIUM_COLORS.seatHighlight} roughness={0.64} />
          </mesh>,
        );
      }

      const wingStairBands = 3;
      const wingStairWidth = Math.min(5.4, tier.width * 0.055);
      for (let stairIndex = 0; stairIndex < wingStairBands; stairIndex += 1) {
        const stairZ = -tier.width / 2 + (tier.width / (wingStairBands + 1)) * (stairIndex + 1);
        wingElements.push(
          <mesh
            key={`wing-${direction}-stairband-${index}-${stairIndex}`}
            position={[seatX + tier.depth * 0.16, seatCenterY - tier.height * 0.08, stairZ]}
          >
            <boxGeometry args={[tier.depth * 0.74, tier.height * 0.2, wingStairWidth]} />
            <meshStandardMaterial color={STADIUM_COLORS.walkway} roughness={0.5} />
          </mesh>,
        );
        wingElements.push(
          <mesh
            key={`wing-${direction}-stairband-lip-${index}-${stairIndex}`}
            position={[seatX + tier.depth * 0.16, seatCenterY + tier.height / 2 - 0.45, stairZ]}
          >
            <boxGeometry args={[tier.depth * 0.72, 0.6, wingStairWidth * 0.7]} />
            <meshStandardMaterial color={STADIUM_COLORS.seatHighlight} roughness={0.4} />
          </mesh>,
        );
      }

      const sectionCount = Math.max(16, Math.round(tier.width / (PX_PER_YARD * 3.2)));
      for (let sectionIndex = 1; sectionIndex < sectionCount; sectionIndex += 1) {
        const sectionZ = -tier.width / 2 + (tier.width / sectionCount) * sectionIndex;
        wingElements.push(
          <mesh
            key={`wing-${direction}-divider-${index}-${sectionIndex}`}
            position={[seatX + tier.depth * 0.18, seatCenterY + tier.height * 0.06, sectionZ]}
          >
            <boxGeometry args={[tier.depth * 0.12, tier.height * 0.52, 0.8]} />
            <meshStandardMaterial color={STADIUM_COLORS.seatDivider} roughness={0.56} />
          </mesh>,
        );
      }

      const fasciaHeight = Math.min(2.6, tier.height * 0.34);
      wingElements.push(
        <mesh
          key={`wing-${direction}-fascia-${index}`}
          position={[frontEdgeX - 1.2, seatCenterY - tier.height / 2 + fasciaHeight / 2, 0]}
        >
          <boxGeometry args={[2.2, fasciaHeight, tier.width * 1.02]} />
          <meshStandardMaterial color={STADIUM_COLORS.fasciaAccent} roughness={0.6} />
        </mesh>,
      );

      wingElements.push(
        <mesh
          key={`wing-${direction}-edge-${index}`}
          position={[frontEdgeX - 0.7, seatCenterY + tier.height / 2 - 0.5, 0]}
        >
          <boxGeometry args={[1.4, 1, tier.width * 0.94]} />
          <meshStandardMaterial color={STADIUM_COLORS.seatHighlight} roughness={0.4} />
        </mesh>,
      );

      const railCenterY = seatCenterY + tier.height / 2 - wingRailHeight / 2;
      wingElements.push(
        <mesh
          key={`wing-${direction}-rail-${index}`}
          position={[-tier.offset + 0.5, railCenterY, 0]}
        >
          <boxGeometry args={[1.1, wingRailHeight, tier.width * 0.9]} />
          <meshStandardMaterial color={STADIUM_COLORS.rail} roughness={0.24} />
        </mesh>,
      );

      wingAisleOffsets.forEach((offset, aisleIndex) => {
        if (Math.abs(offset) + wingAisleWidth / 2 >= tier.width / 2) return;
        wingElements.push(
          <mesh
            key={`wing-${direction}-tier-aisle-${index}-${aisleIndex}`}
            position={[seatX, seatCenterY, offset]}
            receiveShadow
          >
            <boxGeometry args={[tier.depth * 0.9, tier.height * 1.06, wingAisleWidth]} />
            <meshStandardMaterial color={STADIUM_COLORS.walkway} roughness={0.48} />
          </mesh>,
        );
        wingElements.push(
          <mesh
            key={`wing-${direction}-tier-aisle-stair-${index}-${aisleIndex}`}
            position={[seatX + 0.1, seatCenterY - tier.height / 2 + 1.2, offset]}
          >
            <boxGeometry args={[tier.depth * 0.84, 2.2, wingAisleWidth * 0.72]} />
            <meshStandardMaterial color={STADIUM_COLORS.stair} roughness={0.58} />
          </mesh>,
        );
      });

      wingElements.push(
        <mesh
          key={`wing-${direction}-walkway-${index}`}
          position={[walkwayDeckX, walkwayY, 0]}
          receiveShadow
        >
          <boxGeometry args={[tier.walkwayDepth, walkwayDeckHeight, tier.width]} />
          <meshStandardMaterial color={STADIUM_COLORS.walkway} roughness={0.68} />
        </mesh>,
      );

      wingElements.push(
        <mesh
          key={`wing-${direction}-walkway-rail-${index}`}
          position={[walkwayDeckX - tier.walkwayDepth / 2 + 0.7, walkwayY + walkwayDeckHeight / 2 + wingRailHeight / 2 - 0.2, 0]}
        >
          <boxGeometry args={[1, wingRailHeight, tier.width * 0.98]} />
          <meshStandardMaterial color={STADIUM_COLORS.rail} roughness={0.25} />
        </mesh>,
      );

      wingElements.push(
        <mesh
          key={`wing-${direction}-ad-${index}`}
          position={[adX, adCenterY, 0]}
          castShadow
        >
          <boxGeometry args={[wingAdDepth, wingAdHeight, tier.width * 0.98]} />
          <meshStandardMaterial
            color={STADIUM_COLORS.adBand}
            emissive={STADIUM_COLORS.adBand}
            emissiveIntensity={0.15}
          />
        </mesh>,
      );

      wingElements.push(
        <mesh
          key={`wing-${direction}-ad-highlight-${index}`}
          position={[adX + wingAdDepth / 2 - 0.5, adCenterY + wingAdHeight / 2 - 0.5, 0]}
        >
          <boxGeometry args={[1, 1.2, tier.width * 0.96]} />
          <meshStandardMaterial color={STADIUM_COLORS.bannerHighlight} emissive={STADIUM_COLORS.bannerHighlight} emissiveIntensity={0.18} />
        </mesh>,
      );

      if (adTexture) {
        wingElements.push(
          <mesh
            key={`wing-${direction}-adpanel-${index}`}
            position={[adX + wingAdDepth / 2 + 0.05, adCenterY, 0]}
            rotation={[0, Math.PI / 2, 0]}
          >
            <planeGeometry args={[tier.width * 0.98, wingAdHeight * 0.9]} />
            <meshStandardMaterial
              map={adTexture}
              toneMapped={false}
              transparent
              opacity={0.97}
            />
          </mesh>,
        );
      }

      const walkwayColumnCount = 4;
      for (let columnIndex = 0; columnIndex < walkwayColumnCount; columnIndex += 1) {
        const columnZ = -tier.width / 2 + (tier.width / (walkwayColumnCount - 1 || 1)) * columnIndex;
        wingElements.push(
          <mesh
            key={`wing-${direction}-walkway-column-${index}-${columnIndex}`}
            position={[walkwayDeckX - tier.walkwayDepth / 2 + 0.5, seatCenterY + tier.height / 2 - 0.6, columnZ]}
          >
            <boxGeometry args={[2.2, walkwayDeckHeight + 2.6, 1.2]} />
            <meshStandardMaterial color={STADIUM_COLORS.truss} roughness={0.6} />
          </mesh>,
        );
      }

      wingElements.push(
        <mesh
          key={`wing-${direction}-walkway-truss-${index}`}
          position={[walkwayDeckX - tier.walkwayDepth / 2 - 1.2, seatCenterY + tier.height / 2 - 1, 0]}
        >
          <boxGeometry args={[2, walkwayDeckHeight + tierGap * 0.9, tier.width]} />
          <meshStandardMaterial color={STADIUM_COLORS.truss} roughness={0.6} />
        </mesh>,
      );

      wingElevation = adCenterY + wingAdHeight / 2 + wingGap;
    });

    const wingFurthestOffset = wingConfigs.reduce(
      (max, tier) => Math.max(max, tier.offset + tier.depth),
      0,
    );
    const wingBackX = -wingFurthestOffset - 6;
    const wingBackHeight = wingElevation + 5.4;
    const wingWidth = wingConfigs[0].width;
    const wingFrontZ = direction * (FIELD_PIX_H / 2 + PX_PER_YARD * 3.4);
    const wingGroupX = 0;

    return (
      <group
        key={`wing-${direction}`}
        position={[wingGroupX, 0, wingFrontZ]}
        rotation={[0, direction * Math.PI / 2, 0]}
      >
        <mesh position={[-wingFoundationDepth / 2, wingBaseHeight / 2, 0]} castShadow receiveShadow>
          <primitive object={wingFoundationGeometry} attach="geometry" />
          <meshStandardMaterial color={STADIUM_COLORS.concrete} roughness={0.82} />
        </mesh>
        <mesh position={[-wingFoundationDepth * 0.6, wingBaseHeight * 0.32, 0]} receiveShadow>
          <primitive object={wingApronGeometry} attach="geometry" />
          <meshStandardMaterial color={STADIUM_COLORS.walkway} roughness={0.5} />
        </mesh>
        <mesh position={[-wingFoundationDepth * 0.45, wingBaseHeight * 0.62, 0]} receiveShadow>
          <primitive object={wingDeckGeometry} attach="geometry" />
          <meshStandardMaterial color={STADIUM_COLORS.walkway} roughness={0.6} />
        </mesh>
        {wingElements}
        <mesh position={[wingBackX, wingBackHeight / 2, 0]} receiveShadow>
          <boxGeometry args={[8.6, wingBackHeight, wingWidth * 1.2]} />
          <meshStandardMaterial color={STADIUM_COLORS.truss} roughness={0.6} />
        </mesh>
      </group>
    );
  };

  const lightingPositions = [
    [standFrontX - 58, 0, mainWidth / 2 + 64],
    [standFrontX - 58, 0, -mainWidth / 2 - 64],
    [standFrontX - 118, 0, mainWidth / 2 + 42],
    [standFrontX - 118, 0, -mainWidth / 2 - 42],
  ];

  return (
    <group>
      <group position={[standFrontX, 0, 0]}>
        <mesh position={[-foundationDepth / 2, baseHeight / 2, 0]} castShadow receiveShadow>
          <primitive object={mainFoundationGeometry} attach="geometry" />
          <meshStandardMaterial color={STADIUM_COLORS.concrete} roughness={0.82} />
        </mesh>
        <mesh position={[-foundationDepth * 0.6, baseHeight * 0.35, 0]} receiveShadow>
          <primitive object={mainApronGeometry} attach="geometry" />
          <meshStandardMaterial color={STADIUM_COLORS.walkway} roughness={0.72} />
        </mesh>
        <mesh position={[-foundationDepth * 0.4, baseHeight + 0.9, 0]} receiveShadow>
          <primitive object={mainDeckGeometry} attach="geometry" />
          <meshStandardMaterial color={STADIUM_COLORS.walkway} roughness={0.68} />
        </mesh>
        <mesh position={[-foundationDepth * 0.7, baseHeight + 2.2, 0]}>
          <boxGeometry args={[2, 3, mainWidth * 1.02]} />
          <meshStandardMaterial color={STADIUM_COLORS.rail} roughness={0.24} />
        </mesh>
        {[-1, 1].map((side) => (
          <mesh
            key={`main-front-stair-${side}`}
            position={[-foundationDepth * 0.28, baseHeight / 2, side * (mainWidth / 2 + 8)]}
            rotation={[0, 0, Math.PI / 16]}
          >
            <boxGeometry args={[foundationDepth * 0.24, baseHeight + 3.6, 12]} />
            <meshStandardMaterial color={STADIUM_COLORS.stair} roughness={0.6} />
          </mesh>
        ))}
        {Array.from({ length: underSeatSupportCount + 2 }).map((_, pierIndex) => {
          const spacing = mainWidth / (underSeatSupportCount + 1);
          const offset = -mainWidth / 2 + spacing * pierIndex - spacing / 2;
          return (
            <mesh
              key={`main-front-pier-${pierIndex}`}
              position={[-foundationDepth * 0.05, baseHeight, offset]}
              castShadow
              receiveShadow
            >
              <boxGeometry args={[foundationDepth * 0.1, baseHeight + 4.4, 2.2]} />
              <meshStandardMaterial color={STADIUM_COLORS.truss} roughness={0.62} />
            </mesh>
          );
        })}
        {Array.from({ length: underSeatSupportCount - 1 }).map((_, braceIndex) => {
          const spacing = mainWidth / underSeatSupportCount;
          const offset = -mainWidth / 2 + spacing * (braceIndex + 1);
          return (
            <mesh
              key={`main-front-brace-${braceIndex}`}
              position={[-foundationDepth * 0.12, baseHeight * 0.45, offset]}
              rotation={[0, 0, Math.PI / 5]}
            >
              <boxGeometry args={[foundationDepth * 0.14, baseHeight * 0.9, 1.4]} />
              <meshStandardMaterial color={STADIUM_COLORS.beam} roughness={0.58} />
            </mesh>
          );
        })}
        {mainTiers}
        {underSeatSupportOffsets.map((offset, index) => (
          <mesh
            key={`main-support-${index}`}
            position={[-foundationDepth * 0.3, baseHeight / 2, offset]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[foundationDepth * 0.28, baseHeight + 2.4, 2.8]} />
            <meshStandardMaterial color={STADIUM_COLORS.riser} roughness={0.66} />
          </mesh>
        ))}
        <mesh position={[-furthestOffset - 8, (elevation + 10) / 2, 0]} receiveShadow>
          <boxGeometry args={[10, elevation + 10, mainWidth * 1.2]} />
          <meshStandardMaterial color={STADIUM_COLORS.riser} roughness={0.6} />
        </mesh>
        <mesh position={[pressPlatformX, pressPlatformY, 0]} castShadow receiveShadow>
          <boxGeometry args={[pressPlatformDepth, pressPlatformHeight, pressPlatformWidth]} />
          <meshStandardMaterial color={STADIUM_COLORS.walkway} roughness={0.52} />
        </mesh>
        <mesh position={[pressRailOffset, pressPlatformY + pressPlatformHeight / 2 - pressRailHeight / 2, 0]}>
          <boxGeometry args={[1.2, pressRailHeight, pressPlatformWidth * 0.92]} />
          <meshStandardMaterial color={STADIUM_COLORS.rail} roughness={0.25} />
        </mesh>
        {[-1, 1].map((side) => (
          <mesh
            key={`press-platform-stair-${side}`}
            position={[pressPlatformX + pressPlatformDepth / 2 - 3.6, pressPlatformY - pressPlatformHeight / 2 + 1.8, side * (pressPlatformWidth / 2 + 6)]}
          >
            <boxGeometry args={[6.2, 3.6, 10]} />
            <meshStandardMaterial color={STADIUM_COLORS.stair} roughness={0.6} />
          </mesh>
        ))}
        <mesh position={[pressBoxX, pressBoxY - pressBoxHeight / 2 + pressBoxLowerTrimHeight / 2, 0]}>
          <boxGeometry args={[pressBoxDepth * 1.02, pressBoxLowerTrimHeight, pressBoxWidth * 1.04]} />
          <meshStandardMaterial color={STADIUM_COLORS.fasciaAccent} roughness={0.5} />
        </mesh>
        <mesh position={[pressBoxX, pressBoxY, 0]} castShadow receiveShadow>
          <boxGeometry args={[pressBoxDepth, pressBoxHeight, pressBoxWidth]} />
          <meshStandardMaterial color={STADIUM_COLORS.pressBoxFrame} roughness={0.6} metalness={0.18} />
        </mesh>
        {Array.from({ length: 4 }).map((_, columnIndex) => {
          const spacing = pressBoxWidth / 3;
          const offset = -pressBoxWidth / 2 + spacing * columnIndex + spacing / 2;
          return (
            <mesh
              key={`press-support-${columnIndex}`}
              position={[pressBoxX + pressBoxDepth / 2 - 1.4, pressPlatformY + pressPlatformHeight / 2, offset]}
            >
              <boxGeometry args={[2.4, pressBoxY - pressPlatformY, 1.8]} />
              <meshStandardMaterial color={STADIUM_COLORS.truss} roughness={0.58} />
            </mesh>
          );
        })}
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
        <mesh position={[pressBoxX - pressBoxDepth / 2 + 1.6, pressBoxY + pressBoxHeight / 2 - 2, 0]}>
          <boxGeometry args={[3.2, 4, pressBoxWidth * 1.02]} />
          <meshStandardMaterial color={STADIUM_COLORS.pressBoxFrame} roughness={0.46} />
        </mesh>
        <mesh position={[roofX, roofY, 0]} castShadow receiveShadow>
          <boxGeometry args={[roofDepth, roofHeight, roofWidth]} />
          <meshStandardMaterial color={STADIUM_COLORS.roof} roughness={0.4} />
        </mesh>
        <mesh position={[roofX + roofDepth / 2 - 2.4, roofY - roofHeight / 2 + 1.2, 0]}>
          <boxGeometry args={[4.8, 2.4, roofWidth * 0.96]} />
          <meshStandardMaterial color={STADIUM_COLORS.rail} roughness={0.28} />
        </mesh>
        {Array.from({ length: 4 }).map((_, ribIndex) => {
          const offset = -roofWidth / 2 + (roofWidth / 3) * ribIndex;
          return (
            <mesh
              key={`roof-rib-${ribIndex}`}
              position={[roofX, roofY, offset]}
            >
              <boxGeometry args={[roofDepth * 0.92, 1.4, 1.2]} />
              <meshStandardMaterial color={STADIUM_COLORS.truss} roughness={0.5} />
            </mesh>
          );
        })}
        <mesh position={[roofX - roofDepth / 2 + 1.6, roofY + roofHeight / 2 + 0.8, 0]}>
          <boxGeometry args={[3.2, 1.6, roofWidth * 1.04]} />
          <meshStandardMaterial color={STADIUM_COLORS.rail} roughness={0.32} />
        </mesh>
        <mesh position={[scoreboardDeckX, scoreboardDeckY, 0]} castShadow receiveShadow>
          <boxGeometry args={[scoreboardDeckDepth, scoreboardDeckHeight, scoreboardDeckWidth]} />
          <meshStandardMaterial color={STADIUM_COLORS.walkway} roughness={0.52} />
        </mesh>
        <mesh position={[scoreboardDeckX - scoreboardDeckDepth / 2 + 2.2, scoreboardDeckY + scoreboardDeckHeight / 2 + 0.6, 0]}>
          <boxGeometry args={[4.4, 1.2, scoreboardDeckWidth * 0.92]} />
          <meshStandardMaterial color={STADIUM_COLORS.truss} roughness={0.55} />
        </mesh>
        {Array.from({ length: scoreboardColumnCount }, (_, columnIndex) => {
          const columnZ = -scoreboardWidth / 2 + scoreboardColumnSpacing * (columnIndex + 1);
          const columnDepth = Math.min(scoreboardDepth * 0.55, 8);
          const columnX = scoreboardDeckX - scoreboardDeckDepth / 2 + columnDepth / 2 + 0.3;
          return (
            <mesh
              key={`scoreboard-column-${columnIndex}`}
              position={[columnX, scoreboardDeckY + scoreboardDeckHeight / 2 + scoreboardColumnHeight / 2, columnZ]}
              castShadow
              receiveShadow
            >
              <boxGeometry args={[columnDepth, scoreboardColumnHeight, 2.6]} />
              <meshStandardMaterial color={STADIUM_COLORS.scoreboardAccent} roughness={0.58} />
            </mesh>
          );
        })}
        {[-1, 1].map((direction) => (
          <mesh
            key={`scoreboard-support-${direction}`}
            position={[roofX - roofDepth / 2 + scoreboardDepth * 0.1, roofY + roofHeight / 2 + scoreboardSupportHeight / 2, direction * scoreboardSupportSpacing]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[3.2, scoreboardSupportHeight, 3.2]} />
            <meshStandardMaterial color={STADIUM_COLORS.lightingStructure} roughness={0.45} metalness={0.2} />
          </mesh>
        ))}
        {[-1, 1].map((direction) => (
          <mesh
            key={`scoreboard-deck-rail-z-${direction}`}
            position={[scoreboardDeckX, scoreboardDeckY + scoreboardDeckHeight / 2 + scoreboardRailHeight / 2, direction * (scoreboardDeckWidth / 2 - 0.7)]}
          >
            <boxGeometry args={[scoreboardDeckDepth * 0.92, scoreboardRailHeight, 1.2]} />
            <meshStandardMaterial color={STADIUM_COLORS.rail} roughness={0.25} />
          </mesh>
        ))}
        {[-1, 1].map((direction) => (
          <mesh
            key={`scoreboard-deck-rail-x-${direction}`}
            position={[scoreboardDeckX + direction * (scoreboardDeckDepth / 2 - 0.6), scoreboardDeckY + scoreboardDeckHeight / 2 + scoreboardRailHeight / 2, 0]}
          >
            <boxGeometry args={[1.1, scoreboardRailHeight, scoreboardDeckWidth * 0.94]} />
            <meshStandardMaterial color={STADIUM_COLORS.rail} roughness={0.25} />
          </mesh>
        ))}
        <mesh position={[scoreboardX, scoreboardY, 0]} castShadow receiveShadow>
          <boxGeometry args={[scoreboardDepth, scoreboardHeight, scoreboardWidth]} />
          <meshStandardMaterial color={STADIUM_COLORS.scoreboardFrame} roughness={0.45} />
        </mesh>
        <mesh position={[scoreboardX, scoreboardY, 0]}>
          <boxGeometry args={[scoreboardDepth * 0.92, scoreboardHeight * 0.94, scoreboardWidth * 0.94]} />
          <meshStandardMaterial color={STADIUM_COLORS.scoreboardAccent} roughness={0.52} />
        </mesh>
        <mesh position={[scoreboardX + scoreboardFaceInset, scoreboardY, 0]} rotation={[0, Math.PI / 2, 0]}>
          <planeGeometry args={[scoreboardWidth * 0.92, scoreboardHeight * 0.84]} />
          <meshStandardMaterial color="#12141a" emissive="#1c202a" emissiveIntensity={0.24} roughness={0.2} />
        </mesh>
        {Array.from({ length: 3 }).map((_, bandIndex) => {
          const bandHeight = scoreboardHeight * 0.18;
          const offset = -scoreboardHeight / 2 + bandHeight * (bandIndex + 0.5);
          return (
            <mesh
              key={`scoreboard-band-${bandIndex}`}
              position={[scoreboardX + scoreboardFaceInset - 0.1, scoreboardY + offset, 0]}
              rotation={[0, Math.PI / 2, 0]}
            >
              <planeGeometry args={[scoreboardWidth * 0.9, bandHeight * 0.82]} />
              <meshStandardMaterial color={bandIndex === 1 ? STADIUM_COLORS.bannerHighlight : '#1b1f27'} emissive={bandIndex === 1 ? STADIUM_COLORS.bannerHighlight : '#1b1f27'} emissiveIntensity={bandIndex === 1 ? 0.18 : 0.12} roughness={0.18} />
            </mesh>
          );
        })}
        <mesh position={[scoreboardX - scoreboardDepth / 2 + 1.2, scoreboardY + scoreboardHeight / 2 - 1.4, 0]}>
          <boxGeometry args={[2.4, 2.8, scoreboardWidth * 0.96]} />
          <meshStandardMaterial color={STADIUM_COLORS.rail} roughness={0.3} />
        </mesh>
        {[-1, 1].map((direction) => (
          <mesh
            key={`scoreboard-side-trim-${direction}`}
            position={[scoreboardX, scoreboardY, direction * (scoreboardWidth / 2 + 0.6)]}
          >
            <boxGeometry args={[scoreboardDepth * 0.94, scoreboardHeight * 0.92, 1.1]} />
            <meshStandardMaterial color={STADIUM_COLORS.scoreboardAccent} roughness={0.5} />
          </mesh>
        ))}
        <mesh position={[scoreboardX - scoreboardDepth / 2 + 0.8, scoreboardY - scoreboardHeight / 2 - 0.9, 0]}>
          <boxGeometry args={[2.2, 1.8, scoreboardWidth * 0.9]} />
          <meshStandardMaterial color={STADIUM_COLORS.scoreboardAccent} roughness={0.52} />
        </mesh>
        <mesh position={[scoreboardX - scoreboardDepth / 2 + 0.6, scoreboardY + scoreboardHeight / 2 + 0.6, 0]}>
          <boxGeometry args={[1.6, 1.2, scoreboardWidth * 0.9]} />
          <meshStandardMaterial color={STADIUM_COLORS.scoreboardAccent} roughness={0.52} />
        </mesh>
        <mesh position={[scoreboardX - scoreboardDepth / 2 + 0.3, scoreboardY + scoreboardHeight / 2 + 1.6, 0]}>
          <boxGeometry args={[1, 0.8, scoreboardWidth * 0.78]} />
          <meshStandardMaterial color={STADIUM_COLORS.rail} roughness={0.3} />
        </mesh>
        {Array.from({ length: 4 }).map((_, backIndex) => (
          <mesh
            key={`scoreboard-back-${backIndex}`}
            position={[scoreboardX - scoreboardDepth / 2 + 2.6, scoreboardY - scoreboardHeight / 2 + 3.2 + backIndex * 3.6, 0]}
          >
            <boxGeometry args={[3.8, 1.6, scoreboardWidth * 0.88]} />
            <meshStandardMaterial color={STADIUM_COLORS.truss} roughness={0.55} />
          </mesh>
        ))}
        {Array.from({ length: scoreboardLightCount }, (_, lightIndex) => {
          const lightZ = -scoreboardWidth / 2 + scoreboardLightSpacing * (lightIndex + 1);
          return (
            <mesh
              key={`scoreboard-light-${lightIndex}`}
              position={[scoreboardX - scoreboardDepth / 2, scoreboardY + scoreboardHeight / 2 + 2.2, lightZ]}
            >
              <boxGeometry args={[2.4, 1.2, 2.6]} />
              <meshStandardMaterial
                color={STADIUM_COLORS.lighting}
                emissive={STADIUM_COLORS.lighting}
                emissiveIntensity={0.42}
                roughness={0.22}
              />
            </mesh>
          );
        })}
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
