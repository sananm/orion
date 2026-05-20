import { useMemo } from 'react';
import * as THREE from 'three';

import { branchColorHex } from './branchColors';
import type { GraphEdge, GraphNode } from '@/store/constellation';

type Props = {
  edges: GraphEdge[];
  nodes: Record<number, GraphNode>;
  activeNodeId?: number | null;
};

function branchColor(edge: GraphEdge, nodes: Record<number, GraphNode>): THREE.Color {
  const from = nodes[edge.from];
  if (!from) return new THREE.Color('#8a8a8a');
  return new THREE.Color(branchColorHex(from, nodes)).lerp(new THREE.Color('#ffffff'), 0.2);
}

function edgeToColor(edge: GraphEdge, nodes: Record<number, GraphNode>): THREE.Color {
  const to = nodes[edge.to];
  if (!to) return new THREE.Color('#8a8a8a');
  return new THREE.Color(branchColorHex(to, nodes)).lerp(new THREE.Color('#ffffff'), 0.2);
}

export function Edges({ edges, nodes, activeNodeId }: Props) {
  const base = useMemo(() => {
    const positions: number[] = [];
    const colors: number[] = [];
    for (const e of edges) {
      const a = nodes[e.from];
      const b = nodes[e.to];
      if (!a || !b) continue;
      const fromColor = branchColor(e, nodes);
      const toColor = edgeToColor(e, nodes);
      positions.push(a.x, a.y, -0.1, b.x, b.y, -0.1);
      colors.push(fromColor.r, fromColor.g, fromColor.b, toColor.r, toColor.g, toColor.b);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: activeNodeId !== null && activeNodeId !== undefined ? 0.16 : 0.26,
      depthWrite: false,
    });
    return { geometry, material };
  }, [activeNodeId, edges, nodes]);

  const accent = useMemo(() => {
    if (activeNodeId === null || activeNodeId === undefined) return null;
    const positions: number[] = [];
    const colors: number[] = [];
    for (const e of edges) {
      if (e.from !== activeNodeId && e.to !== activeNodeId) continue;
      const a = nodes[e.from];
      const b = nodes[e.to];
      if (!a || !b) continue;
      const fromColor = branchColor(e, nodes).clone().lerp(new THREE.Color('#ffffff'), 0.12);
      const toColor = edgeToColor(e, nodes).clone().lerp(new THREE.Color('#ffffff'), 0.12);
      positions.push(a.x, a.y, -0.08, b.x, b.y, -0.08);
      colors.push(fromColor.r, fromColor.g, fromColor.b, toColor.r, toColor.g, toColor.b);
    }
    if (!positions.length) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.56,
      depthWrite: false,
    });
    return { geometry, material };
  }, [activeNodeId, edges, nodes]);

  return (
    <>
      <lineSegments geometry={base.geometry} material={base.material} />
      {accent && <lineSegments geometry={accent.geometry} material={accent.material} />}
    </>
  );
}
