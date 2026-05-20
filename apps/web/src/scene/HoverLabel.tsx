import { Html } from '@react-three/drei';

import { branchColorHex } from './branchColors';
import type { GraphNode } from '@/store/constellation';

type Props = { node: GraphNode; nodes: Record<number, GraphNode>; alwaysVisible?: boolean; offset?: { x: number; y: number } };

export function HoverLabel({ node, nodes, alwaysVisible, highlighted, offset }: Props & { highlighted?: boolean }) {
  const tint = branchColorHex(node, nodes);
  return (
    <Html
      position={[node.x + (offset?.x ?? 0), node.y + (offset?.y ?? -1.08), 0]}
      center
      style={{
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
        opacity: alwaysVisible ? 0.92 : 1,
      }}
    >
      <div
        style={{
          padding: highlighted ? '4px 11px' : '3px 9px',
          borderRadius: '999px',
          background: highlighted ? 'rgba(6, 6, 10, 0.42)' : 'rgba(4, 4, 7, 0.28)',
          border: highlighted ? '1px solid rgba(255, 231, 166, 0.2)' : `1px solid color-mix(in srgb, ${tint} 26%, transparent)`,
          backdropFilter: 'blur(6px)',
          fontSize: highlighted ? 14 : 13,
          letterSpacing: highlighted ? '0.7px' : '0.55px',
          fontWeight: highlighted ? 500 : 450,
          color: highlighted ? '#fff0c8' : 'rgba(248, 249, 252, 0.96)',
          textShadow: highlighted ? '0 0 14px rgba(255,226,138,0.28), 0 0 8px rgba(0,0,0,0.95)' : '0 0 10px rgba(0,0,0,0.98)',
          boxShadow: highlighted ? '0 0 22px rgba(255, 231, 166, 0.08)' : '0 8px 20px rgba(0,0,0,0.16)',
        }}
      >
        {node.movie.title}
        {node.movie.year ? ` · ${node.movie.year}` : ''}
      </div>
    </Html>
  );
}
