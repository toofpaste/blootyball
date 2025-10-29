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
    const verticalFov = 30;
    const verticalFovRad = THREE.MathUtils.degToRad(verticalFov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFovRad / 2) * aspect);

    const halfFieldLength = FIELD_PIX_H / 2;
    const distance = (halfFieldLength / Math.tan(horizontalFov / 2)) * 1.03;
    const height = FIELD_PIX_W * 0.9;

    camera.position.set(distance, height, 0);
    camera.fov = verticalFov;
    camera.near = 0.1;
    camera.far = distance * 4;
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

function FieldTexture({ colors }) {
  const texture = useMemo(() => {
    const width = FIELD_PIX_W;
    const height = FIELD_PIX_H;
    const canvas = document.createElement('canvas');
    const scale = 2;
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.scale(scale, scale);

    ctx.fillStyle = '#0a6b24';
    ctx.fillRect(0, 0, width, height);

    const stripeHeight = PX_PER_YARD * 2;
    for (let y = 0; y < height; y += stripeHeight) {
      ctx.fillStyle = y % (stripeHeight * 2) === 0 ? '#0c7428' : '#0a6b24';
      ctx.fillRect(0, y, width, stripeHeight);
    }

    const endzonePix = ENDZONE_YARDS * PX_PER_YARD;
    if (colors?.north) {
      ctx.fillStyle = colors.north.color;
      ctx.fillRect(0, 0, width, endzonePix);
      const northLabel = String(colors.north.label || '').trim().toUpperCase();
      if (northLabel) {
        ctx.save();
        ctx.translate(width / 2, endzonePix * 0.6);
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
      ctx.fillRect(0, height - endzonePix, width, endzonePix);
      const southLabel = String(colors.south.label || '').trim().toUpperCase();
      if (southLabel) {
        ctx.save();
        ctx.translate(width / 2, height - endzonePix * 0.6);
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
    const playingEnd = height - endzonePix;
    const fiveYards = PX_PER_YARD * 5;
    for (let y = playingStart; y <= playingEnd; y += fiveYards) {
      ctx.globalAlpha = (y - playingStart) % (PX_PER_YARD * 10) === 0 ? 1 : 0.45;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = '#dff2d8';
    const hashSpacing = PX_PER_YARD;
    for (let y = playingStart; y <= playingEnd; y += hashSpacing) {
      ctx.fillRect(width * 0.25 - 1, y - 1, 2, 4);
      ctx.fillRect(width * 0.75 - 1, y - 1, 2, 4);
    }

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
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[FIELD_PIX_W, FIELD_PIX_H]} />
      <meshStandardMaterial map={texture} toneMapped={false} />
    </mesh>
  );
}

function PlayerMarker({ player, color, qbVision, playElapsed }) {
  const position = useMemo(() => toWorldPosition(player.pos), [player.pos]);
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

function BallMarker({ pos, height, shadow }) {
  const ballHeight = Math.max(0, height || 0);
  const [x, , z] = pos;
  const baseY = PLAYER_RADIUS * 0.9;
  const y = baseY + ballHeight * 0.18;
  return (
    <group>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[shadow[0], 0.05, shadow[2]]}
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
  return (
    <group>
      <MarkerLine positionZ={losWorld[2]} color="#3da5ff" />
      <MarkerLine positionZ={ltgWorld[2]} color="#ffd400" dashed />
    </group>
  );
}

function MarkerLine({ positionZ, color, dashed = false }) {
  const y = PLAYER_HEIGHT * 0.5 + 0.2;
  if (!dashed) {
    return (
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, y, positionZ]}>
        <planeGeometry args={[FIELD_PIX_W, 1.2]} />
        <meshBasicMaterial color={color} transparent opacity={0.85} />
      </mesh>
    );
  }

  const segmentCount = 28;
  const segmentWidth = FIELD_PIX_W / (segmentCount * 1.35);
  const spacing = segmentWidth * 0.6;
  const startX = -FIELD_PIX_W / 2 + segmentWidth / 2;

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
    const height = state?.play?.ball?.flight?.height || 0;
    return { pos: worldPos, shadow, height };
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
      <FieldTexture colors={endzones} />
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
      {ball ? <BallMarker pos={ball.pos} height={ball.height} shadow={ball.shadow} /> : null}
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
      camera={{ fov: 30, position: [FIELD_PIX_H, FIELD_PIX_W * 0.9, 0], near: 0.1, far: 4000 }}
      gl={{ antialias: true }}
    >
      <color attach="background" args={["#021403"]} />
      <fog attach="fog" args={["#021403", 900, 2500]} />
      <SceneContent state={state} />
    </Canvas>
  );
}

export default React.memo(Field3D);
