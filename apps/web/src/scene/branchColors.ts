import type { GraphNode } from '@/store/constellation';

export function branchColorHex(node: GraphNode, nodes: Record<number, GraphNode>): string {
  void nodes;
  const index = typeof node.colorIndex === 'number' ? node.colorIndex : Math.abs(node.id);
  const goldenAngle = 137.508;
  const hue = (index * goldenAngle + 208) % 360;
  const sat = 78 + (index % 8);
  const light = 65 + ((index * 19) % 7);
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}
