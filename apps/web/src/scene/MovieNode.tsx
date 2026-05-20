import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { branchColorHex } from './branchColors';
import { getGlowTexture } from './glowTexture';
import type { GraphNode } from '@/store/constellation';

type Props = {
  node: GraphNode;
  nodes: Record<number, GraphNode>;
  liked: boolean;
  disliked: boolean;
  hovered: boolean;
  highlighted: boolean;
  onPointerOver: () => void;
  onPointerOut: () => void;
  onClick: () => void;
  onDoubleClick: () => void;
};

const SIZE = {
  seed: 1.4,
  neighbor: 0.9,
};
const LIKED_BONUS = 0.25;

export function MovieNode({
  node,
  nodes,
  liked,
  disliked,
  hovered,
  highlighted,
  onPointerOver,
  onPointerOut,
  onClick,
  onDoubleClick,
}: Props) {
  const ref = useRef<THREE.Sprite>(null);
  const map = useMemo(() => getGlowTexture(), []);
  const tintColor = useMemo(() => new THREE.Color(branchColorHex(node, nodes)), [node, nodes]);
  const white = useMemo(() => new THREE.Color('#ffffff'), []);
  const baseColor = useMemo(
    () =>
      tintColor.clone().lerp(white, node.kind === 'seed' ? 0.18 : 0.5),
    [node.kind, tintColor, white],
  );
  const highlightColor = useMemo(() => new THREE.Color('#ffe28a'), []);

  const baseSize = node.kind === 'seed' ? SIZE.seed : SIZE.neighbor + (liked ? LIKED_BONUS : 0);
  const targetOpacity = highlighted ? 1.0 : disliked ? 0.12 : 1.0;

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    // gentle pulse, phase-shifted per node so they don't sync up
    const phase = (node.id % 100) * 0.073;
    const pulse = highlighted
      ? 1 + Math.sin(t * 2.1 + phase) * 0.12
      : 1 + Math.sin(t * 1.1 + phase) * 0.05;
    const hoverScale = highlighted ? 1.75 : hovered ? 1.35 : 1;
    // spawn pop-in (first ~0.9s after spawnedAt)
    const age = (Date.now() - node.spawnedAt) / 900;
    const spawnEase = age >= 1 ? 1 : 0.2 + 0.8 * (1 - Math.pow(1 - Math.min(1, age), 3));
    const s = baseSize * pulse * hoverScale * spawnEase;
    ref.current.scale.set(s, s, 1);
    const mat = ref.current.material as THREE.SpriteMaterial;
    mat.opacity += (targetOpacity - mat.opacity) * 0.15;
    mat.color.lerp(highlighted ? highlightColor : baseColor, highlighted ? 0.18 : 0.12);
  });

  return (
    <sprite
      ref={ref}
      position={[node.x, node.y, 0]}
      onPointerOver={(e) => {
        e.stopPropagation();
        onPointerOver();
      }}
      onPointerOut={(e) => {
        e.stopPropagation();
        onPointerOut();
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onDoubleClick();
      }}
    >
      <spriteMaterial
        map={map}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        opacity={1}
      />
    </sprite>
  );
}
