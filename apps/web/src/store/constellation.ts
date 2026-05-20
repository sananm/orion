import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { api, type Movie } from '@/api/client';

export type NodeKind = 'seed' | 'neighbor';

export type GraphNode = {
  id: number;
  movie: Movie;
  x: number;
  y: number;
  colorIndex: number;
  kind: NodeKind;
  parentId?: number | null;
  spawnedAt: number; // ms — for "just spawned" animation
};

export type GraphEdge = { from: number; to: number };

export type ConstellationFilters = {
  languages: string[];
  minRating: number | null;
  yearFrom: number | null;
  yearTo: number | null;
};

export type ConstellationSnapshot = Pick<
  State,
  'nodes' | 'edges' | 'liked' | 'disliked' | 'expanded' | 'expansionKeys' | 'initialized' | 'filters' | 'nextColorIndex'
>;

type LayoutNode = Pick<GraphNode, 'kind' | 'parentId'>;

type State = {
  nodes: Record<number, GraphNode>;
  edges: GraphEdge[];
  liked: number[];
  disliked: number[];
  expanded: number[]; // ids whose neighbors have already been fetched
  expansionKeys: Record<number, string>;
  loading: number[];
  initialized: boolean;
  filters: ConstellationFilters;
  highlightedId: number | null;
  focusNonce: number;
  sessionNonce: number;
  nextColorIndex: number;
};

type Actions = {
  reset: () => void;
  rebalanceLayout: () => void;
  generateConstellation: (seeds: Movie[]) => Promise<void>;
  addMovieToConstellation: (movie: Movie) => Promise<void>;
  expand: (parentId: number) => Promise<void>;
  toggleLike: (id: number) => Promise<void>;
  toggleDislike: (id: number) => void;
  focusNode: (id: number) => void;
  clearHighlight: () => void;
  setLanguageFilter: (languages: string[]) => void;
  toggleLanguageFilter: (language: string) => void;
  setMinRatingFilter: (minRating: number | null) => void;
  setYearFromFilter: (yearFrom: number | null) => void;
  setYearToFilter: (yearTo: number | null) => void;
  clearFilters: () => void;
  exportSnapshot: () => ConstellationSnapshot;
  importSnapshot: (snapshot: unknown) => void;
};

export type Store = State & Actions;

const NEIGHBOR_RADIUS = 3.15; // world units
const SEED_RADIUS = 4.8;
const DEFAULT_FILTERS: ConstellationFilters = { languages: [], minRating: null, yearFrom: null, yearTo: null };
const LAYOUT_ITERATIONS = 120;
const MAX_LAYOUT_STEP = 0.28;

function mobilityFor(node: GraphNode): number {
  return node.kind === 'seed' ? 0.18 : 1;
}

function nodeFieldRadius(node: LayoutNode): number {
  return node.kind === 'seed' ? 2.15 : 1.5;
}

function fieldSeparationFor(a: LayoutNode, b: LayoutNode): number {
  const base = nodeFieldRadius(a) + nodeFieldRadius(b);
  const hasSeed = a.kind === 'seed' || b.kind === 'seed';
  const sameParent = a.parentId !== null && a.parentId !== undefined && a.parentId === b.parentId;
  return base + (hasSeed ? 0.8 : sameParent ? 0.65 : 0.45);
}

function separationFor(a: LayoutNode, b: LayoutNode): number {
  return Math.max(fieldSeparationFor(a, b), a.kind === 'seed' || b.kind === 'seed' ? 4.35 : 3.35);
}

function desiredEdgeLength(from: GraphNode, to: GraphNode): number {
  return from.kind === 'seed' || to.kind === 'seed' ? 3.7 : 3.1;
}

function spawnSeparationFor(a: LayoutNode, b: LayoutNode): number {
  return separationFor(a, b) + 0.95;
}

function clampStep(value: number): number {
  return Math.max(-MAX_LAYOUT_STEP, Math.min(MAX_LAYOUT_STEP, value));
}

export function movieMatchesFilters(movie: Movie, filters: ConstellationFilters): boolean {
  if (filters.languages.length > 0) {
    const movieLanguage = (movie.language || '').toLowerCase();
    const selected = new Set(filters.languages.map((language) => language.toLowerCase()));
    if (!selected.has(movieLanguage)) {
      return false;
    }
  }
  if (filters.minRating !== null) {
    if (typeof movie.imdb_rating !== 'number' || movie.imdb_rating < filters.minRating) {
      return false;
    }
  }
  if (filters.yearFrom !== null) {
    if (typeof movie.year !== 'number' || movie.year < filters.yearFrom) {
      return false;
    }
  }
  if (filters.yearTo !== null) {
    if (typeof movie.year !== 'number' || movie.year > filters.yearTo) {
      return false;
    }
  }
  return true;
}

function filterKey(filters: ConstellationFilters): string {
  return `${[...filters.languages].sort().join(',') || 'any'}|${filters.minRating ?? 'any'}|${filters.yearFrom ?? 'any'}|${filters.yearTo ?? 'any'}`;
}

function normalizeFilters(raw: unknown): ConstellationFilters {
  if (!raw || typeof raw !== 'object') {
    return DEFAULT_FILTERS;
  }
  const candidate = raw as Partial<Record<keyof ConstellationFilters | 'language', unknown>>;
  const rawLanguages = Array.isArray(candidate.languages)
    ? candidate.languages
    : typeof candidate.language === 'string' && candidate.language.trim()
      ? [candidate.language]
      : [];

  return {
    languages: Array.from(
      new Set(
        rawLanguages
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ),
    minRating: typeof candidate.minRating === 'number' ? candidate.minRating : null,
    yearFrom: typeof candidate.yearFrom === 'number' ? candidate.yearFrom : null,
    yearTo: typeof candidate.yearTo === 'number' ? candidate.yearTo : null,
  };
}

function normalizeSnapshot(raw: unknown): ConstellationSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<ConstellationSnapshot> & { filters?: unknown };
  const normalizedNodes: Record<number, GraphNode> = {};
  let fallbackColorIndex = 0;

  if (candidate.nodes && typeof candidate.nodes === 'object') {
    for (const [idText, rawNode] of Object.entries(candidate.nodes as Record<string, GraphNode>)) {
      if (!rawNode || typeof rawNode !== 'object') continue;
      const node = rawNode as GraphNode & { colorIndex?: number };
      const colorIndex = typeof node.colorIndex === 'number' ? node.colorIndex : fallbackColorIndex;
      fallbackColorIndex = Math.max(fallbackColorIndex, colorIndex + 1);
      normalizedNodes[Number(idText)] = {
        ...node,
        colorIndex,
      };
    }
  }

  const derivedNextColorIndex = Object.values(normalizedNodes).reduce(
    (max, node) => Math.max(max, node.colorIndex + 1),
    0,
  );

  return {
    nodes: normalizedNodes,
    edges: Array.isArray(candidate.edges) ? candidate.edges as GraphEdge[] : [],
    liked: Array.isArray(candidate.liked) ? candidate.liked.filter((value): value is number => typeof value === 'number') : [],
    disliked: Array.isArray(candidate.disliked) ? candidate.disliked.filter((value): value is number => typeof value === 'number') : [],
    expanded: Array.isArray(candidate.expanded) ? candidate.expanded.filter((value): value is number => typeof value === 'number') : [],
    expansionKeys: typeof candidate.expansionKeys === 'object' && candidate.expansionKeys ? candidate.expansionKeys as Record<number, string> : {},
    initialized: Boolean(candidate.initialized),
    filters: normalizeFilters(candidate.filters),
    nextColorIndex: typeof candidate.nextColorIndex === 'number' ? candidate.nextColorIndex : derivedNextColorIndex,
  };
}

function evaluateCandidate(
  x: number,
  y: number,
  parent: GraphNode,
  candidate: LayoutNode,
  taken: GraphNode[],
): number {
  let nearestPenalty = 0;
  let closestGap = Number.POSITIVE_INFINITY;
  for (const n of taken) {
    const dx = x - n.x;
    const dy = y - n.y;
    const dist = Math.hypot(dx, dy);
    const required = spawnSeparationFor(candidate, n);
    closestGap = Math.min(closestGap, dist - required);
    if (dist < required) {
      nearestPenalty += (required - dist) * 22;
    }
  }
  const outwardX = parent.x;
  const outwardY = parent.y;
  const outwardLen = Math.hypot(outwardX, outwardY) || 1;
  const parentDistance = Math.max(0.001, Math.hypot(x - parent.x, y - parent.y));
  const px = (x - parent.x) / parentDistance;
  const py = (y - parent.y) / parentDistance;
  const outwardBias = ((px * (outwardX / outwardLen) + py * (outwardY / outwardLen)) + 1) * 0.4;
  const targetRadius = Math.max(NEIGHBOR_RADIUS, spawnSeparationFor(candidate, parent) + 0.45);
  const orbitPenalty = Math.abs(parentDistance - targetRadius) * 0.7;
  const breathingRoomBonus = Math.max(0, Math.min(closestGap, 2.2)) * 0.35;
  return nearestPenalty + orbitPenalty - outwardBias - breathingRoomBonus;
}

function placeAround(parent: GraphNode, count: number, taken: GraphNode[]): { x: number; y: number }[] {
  const positions: { x: number; y: number }[] = [];
  const facing = Math.atan2(parent.y, parent.x);
  const workingTaken = [...taken];
  const candidate: LayoutNode = { kind: 'neighbor', parentId: parent.id };

  for (let i = 0; i < count; i++) {
    let best: { x: number; y: number } | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    const ring = Math.floor(i / 4);
    const radius = Math.max(NEIGHBOR_RADIUS, spawnSeparationFor(candidate, parent) + 0.45) + ring * 1.35;
    const baseAngle = facing + ((i % 4) - 1.5) * 0.95;

    for (let attempt = 0; attempt < 28; attempt++) {
      const sweep = ((attempt / 28) * Math.PI * 2.35) - Math.PI * 1.175;
      const jitter = (Math.random() - 0.5) * 0.16;
      const angle = baseAngle + sweep + jitter;
      const x = parent.x + Math.cos(angle) * radius;
      const y = parent.y + Math.sin(angle) * radius;
      const score = evaluateCandidate(x, y, parent, candidate, workingTaken);
      if (score < bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }

    const chosen = best ?? {
      x: parent.x + Math.cos(baseAngle) * radius,
      y: parent.y + Math.sin(baseAngle) * radius,
    };
    positions.push(chosen);
    workingTaken.push({
      id: -1 - i,
      movie: parent.movie,
      x: chosen.x,
      y: chosen.y,
      colorIndex: parent.colorIndex,
      ...candidate,
      spawnedAt: parent.spawnedAt,
    });
  }

  return positions;
}

function placeSeeds(seeds: Movie[]): { x: number; y: number }[] {
  if (seeds.length === 1) return [{ x: 0, y: 0 }];
  const positions: { x: number; y: number }[] = [];
  for (let i = 0; i < seeds.length; i++) {
    const a = (i / seeds.length) * Math.PI * 2 - Math.PI / 2;
    positions.push({ x: Math.cos(a) * SEED_RADIUS, y: Math.sin(a) * SEED_RADIUS });
  }
  return positions;
}

function placeAdditionalSeed(taken: GraphNode[]): { x: number; y: number } {
  if (!taken.length) return { x: 0, y: 0 };

  const candidate: LayoutNode = { kind: 'seed', parentId: null };
  const center = taken.reduce(
    (acc, node) => ({ x: acc.x + node.x / taken.length, y: acc.y + node.y / taken.length }),
    { x: 0, y: 0 },
  );
  const maxRadius = taken.reduce(
    (max, node) => Math.max(max, Math.hypot(node.x - center.x, node.y - center.y)),
    0,
  );
  const outerClearance = taken.reduce(
    (max, node) => Math.max(max, Math.hypot(node.x - center.x, node.y - center.y) + spawnSeparationFor(candidate, node)),
    0,
  );
  const baseRadius = Math.max(outerClearance + 1.35, maxRadius + SEED_RADIUS * 1.9, SEED_RADIUS * 3.15);

  let best = { x: center.x + baseRadius, y: center.y };
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const ringOffset of [0, 1.1, 2.25]) {
    const radius = baseRadius + ringOffset;
    for (let step = 0; step < 48; step++) {
      const angle = (step / 48) * Math.PI * 2 - Math.PI / 2;
      const x = center.x + Math.cos(angle) * radius;
      const y = center.y + Math.sin(angle) * radius;

      let minDistance = Number.POSITIVE_INFINITY;
      let penalty = 0;
      for (const node of taken) {
        const distance = Math.hypot(x - node.x, y - node.y);
        minDistance = Math.min(minDistance, distance);
        const required = spawnSeparationFor(candidate, node);
        if (distance < required) {
          penalty += (required - distance) * 18;
        }
      }

      const score = minDistance - penalty - ringOffset * 0.4;
      if (score > bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }

  return best;
}

function relaxLayout(nodes: Record<number, GraphNode>, edges: GraphEdge[]): Record<number, GraphNode> {
  const ids = Object.keys(nodes).map(Number);
  if (ids.length < 2) return nodes;

  const nextNodes: Record<number, GraphNode> = Object.fromEntries(
    ids.map((id) => [id, { ...nodes[id] }]),
  );
  const anchors: Record<number, { x: number; y: number }> = Object.fromEntries(
    ids.map((id) => [id, { x: nodes[id].x, y: nodes[id].y }]),
  );

  for (let iteration = 0; iteration < LAYOUT_ITERATIONS; iteration++) {
    const delta = new Map<number, { x: number; y: number }>();
    ids.forEach((id) => delta.set(id, { x: 0, y: 0 }));

    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = nextNodes[ids[i]];
        const b = nextNodes[ids[j]];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.max(0.001, Math.hypot(dx, dy));
        const minDist = separationFor(a, b);
        if (dist >= minDist) continue;
        const push = ((minDist - dist) / minDist) * 0.5;
        const ux = dx / dist;
        const uy = dy / dist;
        const aMove = delta.get(a.id)!;
        const bMove = delta.get(b.id)!;
        aMove.x -= ux * push;
        aMove.y -= uy * push;
        bMove.x += ux * push;
        bMove.y += uy * push;
      }
    }

    for (const edge of edges) {
      const from = nextNodes[edge.from];
      const to = nextNodes[edge.to];
      if (!from || !to) continue;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const dist = Math.max(0.001, Math.hypot(dx, dy));
      const target = desiredEdgeLength(from, to);
      const stretch = (dist - target) * 0.08;
      const ux = dx / dist;
      const uy = dy / dist;
      const fromMove = delta.get(from.id)!;
      const toMove = delta.get(to.id)!;
      fromMove.x += ux * stretch;
      fromMove.y += uy * stretch;
      toMove.x -= ux * stretch;
      toMove.y -= uy * stretch;
    }

    for (const id of ids) {
      const node = nextNodes[id];
      const anchor = anchors[id];
      const move = delta.get(id)!;
      move.x += (anchor.x - node.x) * (node.kind === 'seed' ? 0.18 : 0.06);
      move.y += (anchor.y - node.y) * (node.kind === 'seed' ? 0.18 : 0.06);
    }

    for (const id of ids) {
      const node = nextNodes[id];
      const move = delta.get(id)!;
      const mobility = mobilityFor(node);
      node.x += clampStep(move.x * mobility);
      node.y += clampStep(move.y * mobility);
    }
  }

  return nextNodes;
}

export const useConstellation = create<Store>()(
  persist(
    (set, get) => ({
      nodes: {},
      edges: [],
      liked: [],
      disliked: [],
      expanded: [],
      expansionKeys: {},
      loading: [],
      initialized: false,
      filters: DEFAULT_FILTERS,
      highlightedId: null,
      focusNonce: 0,
      sessionNonce: 0,
      nextColorIndex: 0,

      reset: () =>
        set((s) => ({
          nodes: {},
          edges: [],
          liked: [],
          disliked: [],
          expanded: [],
          expansionKeys: {},
          loading: [],
          initialized: false,
          filters: DEFAULT_FILTERS,
          highlightedId: null,
          focusNonce: 0,
          sessionNonce: s.sessionNonce + 1,
          nextColorIndex: 0,
        })),

      rebalanceLayout: () =>
        set((s) => ({
          nodes: relaxLayout(s.nodes, s.edges),
        })),

      generateConstellation: async (seeds) => {
        const sessionNonce = get().sessionNonce;
        // Ensure every seed has been embedded into our local FAISS index.
        // For movies that came from TMDB live search but aren't in our corpus,
        // the backend will fetch + embed them just-in-time.
        const enriched: Movie[] = [];
        for (const m of seeds) {
          if (get().sessionNonce !== sessionNonce) return;
          try {
            // eslint-disable-next-line no-await-in-loop
            const full = await api.seed(m.id);
            if (get().sessionNonce !== sessionNonce) return;
            enriched.push(full);
          } catch (e) {
            console.error('seed failed for', m.id, e);
          }
        }
        if (get().sessionNonce !== sessionNonce) return;
        if (!enriched.length) {
          throw new Error('none of the seeds could be embedded — check the API logs');
        }

        const now = Date.now();
        const positions = placeSeeds(enriched);
        const nodes: Record<number, GraphNode> = {};
        enriched.forEach((m, i) => {
          nodes[m.id] = {
            id: m.id,
            movie: m,
            x: positions[i].x,
            y: positions[i].y,
            colorIndex: i,
            kind: 'seed',
            parentId: null,
            spawnedAt: now,
          };
        });
        set({
          nodes: relaxLayout(nodes, []),
          edges: [],
          expanded: [],
          expansionKeys: {},
          loading: [],
          initialized: true,
          highlightedId: null,
          focusNonce: 0,
          nextColorIndex: enriched.length,
        });
        for (const m of enriched) {
          if (get().sessionNonce !== sessionNonce) return;
          // eslint-disable-next-line no-await-in-loop
          await get().expand(m.id);
        }
      },

      addMovieToConstellation: async (movie) => {
        const sessionNonce = get().sessionNonce;
        const { initialized, nodes } = get();
        if (!initialized || !Object.keys(nodes).length) {
          await get().generateConstellation([movie]);
          return;
        }

        const full = await api.seed(movie.id);
        if (get().sessionNonce !== sessionNonce) return;
        const latest = get();
        const now = Date.now();
        const existing = latest.nodes[full.id];
        const position = existing ? { x: existing.x, y: existing.y } : placeAdditionalSeed(Object.values(latest.nodes));
        const colorIndex = existing ? existing.colorIndex : latest.nextColorIndex;
        const nextNodes = {
          ...latest.nodes,
          [full.id]: {
            id: full.id,
            movie: full,
            x: position.x,
            y: position.y,
            colorIndex,
            kind: 'seed' as const,
            parentId: null,
            spawnedAt: now,
          },
        };

        set({
          nodes: relaxLayout(nextNodes, latest.edges),
          initialized: true,
          highlightedId: full.id,
          focusNonce: latest.focusNonce + 1,
          nextColorIndex: existing ? latest.nextColorIndex : latest.nextColorIndex + 1,
        });

        if (get().sessionNonce !== sessionNonce) return;
        await get().expand(full.id);
      },

      expand: async (parentId) => {
        const { nodes, expansionKeys, loading, liked, disliked, filters, sessionNonce, nextColorIndex } = get();
        const currentFilterKey = filterKey(filters);
        if (loading.includes(parentId)) return;
        const parent = nodes[parentId];
        if (!parent) return;
        set({ loading: [...loading, parentId] });
        try {
          const excludeIds = Object.keys(nodes).map(Number);
          const { results } = await api.similar({
            movieId: parentId,
            k: 5,
            likedIds: liked,
            dislikedIds: disliked,
            excludeIds,
            languages: filters.languages.length ? filters.languages : null,
            minRating: filters.minRating,
            yearFrom: filters.yearFrom,
            yearTo: filters.yearTo,
          });
          if (get().sessionNonce !== sessionNonce) return;
          const takenArr = Object.values(get().nodes);
          const positions = placeAround(parent, results.length, takenArr);
          const now = Date.now();
          const newNodes: Record<number, GraphNode> = {};
          const newEdges: GraphEdge[] = [];
          results.forEach((m, i) => {
            newNodes[m.id] = {
              id: m.id,
              movie: m,
              x: positions[i].x,
              y: positions[i].y,
              colorIndex: nextColorIndex + i,
              kind: 'neighbor',
              parentId,
              spawnedAt: now,
            };
            newEdges.push({ from: parentId, to: m.id });
          });
          const mergedNodes = { ...get().nodes, ...newNodes };
          const mergedEdges = [...get().edges, ...newEdges];
          set((s) => ({
            ...(s.sessionNonce !== sessionNonce
              ? {}
              : {
            nodes: relaxLayout(mergedNodes, mergedEdges),
            edges: mergedEdges,
            expanded: s.expanded.includes(parentId) ? s.expanded : [...s.expanded, parentId],
            expansionKeys: { ...s.expansionKeys, [parentId]: currentFilterKey },
            loading: s.loading.filter((id) => id !== parentId),
            nextColorIndex: Math.max(s.nextColorIndex, nextColorIndex + results.length),
              }),
          }));
        } catch (e) {
          console.error('expand failed', e);
          set((s) =>
            s.sessionNonce !== sessionNonce
              ? s
              : { loading: s.loading.filter((id) => id !== parentId) },
          );
        }
      },

      toggleLike: async (id) => {
        const { liked, disliked } = get();
        const wasLiked = liked.includes(id);
        set({
          liked: wasLiked ? liked.filter((x) => x !== id) : [...liked, id],
          disliked: disliked.filter((x) => x !== id),
        });
        if (!wasLiked) {
          // auto-expand on like, mirroring single-click behavior
          await get().expand(id);
        }
      },

      toggleDislike: (id) => {
        const { liked, disliked } = get();
        const wasDis = disliked.includes(id);
        set({
          disliked: wasDis ? disliked.filter((x) => x !== id) : [...disliked, id],
          liked: liked.filter((x) => x !== id),
        });
      },

      focusNode: (id) =>
        set((s) => ({
          highlightedId: id,
          focusNonce: s.focusNonce + 1,
        })),

      clearHighlight: () =>
        set({
          highlightedId: null,
        }),

      setLanguageFilter: (languages) =>
        set((s) => ({
          filters: { ...s.filters, languages: Array.from(new Set(languages.map((value) => value.trim()).filter(Boolean))) },
          expansionKeys: {},
        })),

      toggleLanguageFilter: (language) =>
        set((s) => {
          const normalized = language.trim();
          if (!normalized) return s;
          const exists = s.filters.languages.includes(normalized);
          return {
            filters: {
              ...s.filters,
              languages: exists
                ? s.filters.languages.filter((value) => value !== normalized)
                : [...s.filters.languages, normalized],
            },
          expansionKeys: {},
          };
        }),

      setMinRatingFilter: (minRating) =>
        set((s) => ({
          filters: { ...s.filters, minRating },
          expansionKeys: {},
        })),

      setYearFromFilter: (yearFrom) =>
        set((s) => ({
          filters: { ...s.filters, yearFrom },
          expansionKeys: {},
        })),

      setYearToFilter: (yearTo) =>
        set((s) => ({
          filters: { ...s.filters, yearTo },
          expansionKeys: {},
        })),

      clearFilters: () =>
        set({
          filters: DEFAULT_FILTERS,
          expansionKeys: {},
        }),

      exportSnapshot: () => {
        const s = get();
        return {
          nodes: s.nodes,
          edges: s.edges,
          liked: s.liked,
          disliked: s.disliked,
          expanded: s.expanded,
          expansionKeys: s.expansionKeys,
          initialized: s.initialized,
          filters: s.filters,
          nextColorIndex: s.nextColorIndex,
        };
      },

      importSnapshot: (snapshot) =>
        set((s) => {
          const normalized = normalizeSnapshot(snapshot);
          if (!normalized) return s;
          return {
            ...normalized,
            loading: [],
            highlightedId: null,
            focusNonce: 0,
            sessionNonce: s.sessionNonce + 1,
          };
        }),
    }),
    {
      name: 'constellation-store',
      version: 2,
      migrate: (persistedState) => {
        if (!persistedState || typeof persistedState !== 'object') {
          return persistedState;
        }
        const candidate = persistedState as Partial<State> & { filters?: unknown };
        return {
          ...candidate,
          filters: normalizeFilters(candidate.filters),
        };
      },
      merge: (persistedState, currentState) => {
        if (!persistedState || typeof persistedState !== 'object') {
          return currentState;
        }
        const candidate = persistedState as Partial<State> & { filters?: unknown };
        return {
          ...currentState,
          ...candidate,
          filters: normalizeFilters(candidate.filters),
        };
      },
      partialize: (s) => ({
        nodes: s.nodes,
        edges: s.edges,
        liked: s.liked,
        disliked: s.disliked,
        expanded: s.expanded,
        expansionKeys: s.expansionKeys,
        initialized: s.initialized,
        filters: s.filters,
      }),
    },
  ),
);
