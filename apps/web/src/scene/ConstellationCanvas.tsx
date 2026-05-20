import { useCallback, useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrthographicCamera } from '@react-three/drei';

import { Starfield } from './Starfield';
import { MovieNode } from './MovieNode';
import { Edges } from './Edges';
import { useDragPanControls } from './DragPanControls';
import { HoverLabel } from './HoverLabel';
import { movieMatchesFilters, useConstellation } from '@/store/constellation';

function Controls() {
  useDragPanControls();
  return null;
}

function FocusController() {
  const nodes = useConstellation((s) => s.nodes);
  const highlightedId = useConstellation((s) => s.highlightedId);
  const focusNonce = useConstellation((s) => s.focusNonce);
  const { camera } = useThree();
  const targetRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (highlightedId === null || !nodes[highlightedId]) {
      targetRef.current = null;
      return;
    }
    targetRef.current = { x: nodes[highlightedId].x, y: nodes[highlightedId].y };
  }, [focusNonce, highlightedId, nodes]);

  useFrame(() => {
    const target = targetRef.current;
    if (!target) return;
    camera.position.x += (target.x - camera.position.x) * 0.14;
    camera.position.y += (target.y - camera.position.y) * 0.14;
    if (Math.hypot(target.x - camera.position.x, target.y - camera.position.y) < 0.03) {
      camera.position.x = target.x;
      camera.position.y = target.y;
      targetRef.current = null;
    }
  });

  return null;
}

type SceneProps = { onOpenDetails: (id: number) => void };

function Scene({ onOpenDetails }: SceneProps) {
  const nodes = useConstellation((s) => s.nodes);
  const edges = useConstellation((s) => s.edges);
  const liked = useConstellation((s) => s.liked);
  const disliked = useConstellation((s) => s.disliked);
  const expand = useConstellation((s) => s.expand);
  const rebalanceLayout = useConstellation((s) => s.rebalanceLayout);
  const filters = useConstellation((s) => s.filters);
  const highlightedId = useConstellation((s) => s.highlightedId);

  const [hoverId, setHoverId] = useState<number | null>(null);
  const rebalancedOnLoad = useRef(false);

  // Click vs double-click debounce
  const clickTimer = useRef<number | null>(null);
  const handleClick = useCallback(
    (id: number) => {
      if (clickTimer.current) {
        // already pending -> ignore single, the dblclick path will fire
        return;
      }
      clickTimer.current = window.setTimeout(() => {
        clickTimer.current = null;
        onOpenDetails(id);
      }, 240);
    },
    [onOpenDetails],
  );
  const handleDoubleClick = useCallback(
    (id: number) => {
      if (clickTimer.current) {
        window.clearTimeout(clickTimer.current);
        clickTimer.current = null;
      }
      expand(id);
    },
    [expand],
  );

  const visibleNodes = Object.fromEntries(
    Object.values(nodes)
      .filter(
        (node) =>
          node.id === highlightedId || node.kind === 'seed' || movieMatchesFilters(node.movie, filters),
      )
      .map((node) => [node.id, node]),
  );
  const visibleEdges = edges.filter((edge) => visibleNodes[edge.from] && visibleNodes[edge.to]);
  const nodeList = Object.values(visibleNodes);
  const likedSet = new Set(liked);
  const dislikedSet = new Set(disliked);
  const activeEdgeNodeId = hoverId ?? highlightedId;

  useEffect(() => {
    if (rebalancedOnLoad.current || Object.keys(nodes).length < 2) return;
    rebalancedOnLoad.current = true;
    rebalanceLayout();
  }, [nodes, rebalanceLayout]);

  return (
    <>
      <Controls />
      <FocusController />
      <Starfield />
      <Edges edges={visibleEdges} nodes={visibleNodes} activeNodeId={activeEdgeNodeId} />
      {nodeList.map((n) => (
        <MovieNode
          key={n.id}
          node={n}
          nodes={visibleNodes}
          liked={likedSet.has(n.id)}
          disliked={dislikedSet.has(n.id)}
          hovered={hoverId === n.id}
          highlighted={highlightedId === n.id}
          onPointerOver={() => {
            (window as any).__nodePointerActive = true;
            setHoverId(n.id);
          }}
          onPointerOut={() => {
            (window as any).__nodePointerActive = false;
            setHoverId((cur) => (cur === n.id ? null : cur));
          }}
          onClick={() => handleClick(n.id)}
          onDoubleClick={() => handleDoubleClick(n.id)}
        />
      ))}
      {hoverId !== null && visibleNodes[hoverId] && (
        <HoverLabel node={visibleNodes[hoverId]} nodes={visibleNodes} alwaysVisible />
      )}
      {highlightedId !== null && visibleNodes[highlightedId] && hoverId !== highlightedId && (
        <HoverLabel node={visibleNodes[highlightedId]} nodes={visibleNodes} alwaysVisible highlighted />
      )}
      {nodeList
        .filter((n) => n.kind === 'seed' && n.id !== highlightedId)
        .map((n) => (
          <HoverLabel key={`seed-label-${n.id}`} node={n} nodes={visibleNodes} alwaysVisible />
        ))}
    </>
  );
}

type Props = { onOpenDetails: (id: number) => void };

export function ConstellationCanvas({ onOpenDetails }: Props) {
  return (
    <Canvas
      gl={{ antialias: true, alpha: false }}
      style={{ position: 'fixed', inset: 0, background: '#000', cursor: 'grab' }}
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).style.cursor = 'grabbing';
      }}
      onPointerUp={(e) => {
        (e.currentTarget as HTMLElement).style.cursor = 'grab';
      }}
    >
      <color attach="background" args={['#000000']} />
      <OrthographicCamera
        makeDefault
        position={[0, 0, 50]}
        zoom={80}
        near={0.1}
        far={1000}
      />
      <Scene onOpenDetails={onOpenDetails} />
    </Canvas>
  );
}
