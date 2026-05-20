import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { branchColorHex } from './branchColors';
import { getGlowTexture } from './glowTexture';
import { stellarColor } from './starColors';
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
  const haloRef = useRef<THREE.Sprite>(null);
  const coreRef = useRef<THREE.Sprite>(null);
  const map = useMemo(() => getGlowTexture(), []);
  const tintColor = useMemo(() => new THREE.Color(branchColorHex(node, nodes)), [node, nodes]);
  const white = useMemo(() => new THREE.Color('#ffffff'), []);
  const starBase = useMemo(
    () => stellarColor(node.id * 97 + (node.movie.year ?? 0) * 13),
    [node, nodes],
  );
  const haloColor = useMemo(
    () => tintColor.clone().lerp(starBase, node.kind === 'seed' ? 0.16 : 0.22).lerp(white, node.kind === 'seed' ? 0.16 : 0.22),
    [node.kind, starBase, tintColor],
  );
  const coreColor = useMemo(
    () => tintColor.clone().lerp(starBase, 0.22).lerp(white, node.kind === 'seed' ? 0.38 : 0.46),
    [node.kind, starBase, tintColor, white],
  );
  const highlightHaloColor = useMemo(
    () => haloColor.clone().lerp(new THREE.Color('#fff0bc'), 0.42),
    [haloColor],
  );
  const highlightCoreColor = useMemo(
    () => coreColor.clone().lerp(new THREE.Color('#fff8e5'), 0.35),
    [coreColor],
  );

  const baseSize = node.kind === 'seed' ? SIZE.seed : SIZE.neighbor + (liked ? LIKED_BONUS : 0);
  const haloTargetOpacity = highlighted ? 0.92 : disliked ? 0.08 : liked ? 0.76 : node.kind === 'seed' ? 0.68 : 0.62;
  const coreTargetOpacity = highlighted ? 0.96 : disliked ? 0.18 : node.kind === 'seed' ? 0.7 : 0.62;

  useFrame(({ clock }) => {
    if (!haloRef.current || !coreRef.current) return;
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
    const haloSize = baseSize * 1.56 * pulse * hoverScale * spawnEase;
    const coreSize = baseSize * 0.58 * (0.98 + pulse * 0.04) * hoverScale * spawnEase;

    haloRef.current.scale.set(haloSize, haloSize, 1);
    coreRef.current.scale.set(coreSize, coreSize, 1);

    const haloMat = haloRef.current.material as THREE.SpriteMaterial;
    haloMat.opacity += (haloTargetOpacity - haloMat.opacity) * 0.15;
    haloMat.color.lerp(highlighted ? highlightHaloColor : haloColor, highlighted ? 0.18 : 0.14);

    const coreMat = coreRef.current.material as THREE.SpriteMaterial;
    coreMat.opacity += (coreTargetOpacity - coreMat.opacity) * 0.15;
    coreMat.color.lerp(highlighted ? highlightCoreColor : coreColor, highlighted ? 0.2 : 0.16);
  });

  return (
    <group position={[node.x, node.y, 0]}>
      <sprite
        ref={haloRef}
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
          opacity={haloTargetOpacity}
        />
      </sprite>
      <sprite ref={coreRef} position={[0, 0, 0.02]}>
        <spriteMaterial
          map={map}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          opacity={coreTargetOpacity}
        />
      </sprite>
    </group>
  );
}
