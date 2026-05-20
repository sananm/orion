import type { GraphNode } from '@/store/constellation';

const BRANCH_PALETTE = [
  '#a8c7ff',
  '#ffd6a0',
  '#bfe8db',
  '#d8c8ff',
  '#ffc8d9',
] as const;

export function branchRootId(node: GraphNode, nodes: Record<number, GraphNode>): number {
  let current: GraphNode | undefined = node;
  let hops = 0;

  while (current?.parentId !== null && current?.parentId !== undefined && nodes[current.parentId] && hops < 24) {
    current = nodes[current.parentId];
    hops += 1;
  }

  return current?.id ?? node.id;
}

export function branchColorHex(node: GraphNode, nodes: Record<number, GraphNode>): string {
  const rootId = branchRootId(node, nodes);
  return BRANCH_PALETTE[Math.abs(rootId) % BRANCH_PALETTE.length];
}
