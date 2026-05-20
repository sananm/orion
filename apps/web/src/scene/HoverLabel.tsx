import { Html } from '@react-three/drei';

import { branchColorHex } from './branchColors';
import type { GraphNode } from '@/store/constellation';

type Props = { node: GraphNode; nodes: Record<number, GraphNode>; alwaysVisible?: boolean };

export function HoverLabel({ node, nodes, alwaysVisible, highlighted }: Props & { highlighted?: boolean }) {
  const tint = branchColorHex(node, nodes);
  return (
    <Html
      position={[node.x, node.y - 0.95, 0]}
      center
      style={{
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
        fontSize: highlighted ? 12 : 11,
        letterSpacing: highlighted ? '0.8px' : '0.5px',
        fontWeight: highlighted ? 400 : 300,
        color: highlighted ? '#ffe7a6' : tint,
        textShadow: highlighted ? '0 0 14px rgba(255,226,138,0.35), 0 0 8px rgba(0,0,0,0.95)' : '0 0 10px rgba(0,0,0,0.95)',
        opacity: alwaysVisible ? 0.85 : 1,
      }}
    >
      {node.movie.title}
      {node.movie.year ? ` · ${node.movie.year}` : ''}
    </Html>
  );
}
