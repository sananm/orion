export type Movie = {
  id: number;
  title: string;
  year?: number | null;
  language?: string | null;
  imdb_id?: string | null;
  overview?: string | null;
  genres: string[];
  cast: string[];
  director?: string | null;
  keywords?: string[];
  poster_url?: string | null;
  imdb_rating?: number | null;
  imdb_vote_count?: number | null;
  vote_average?: number | null;
  vote_count?: number | null;
  popularity?: number | null;
  score?: number;
};

export type AccountUser = {
  id: number;
  email: string;
  displayName: string;
  hasPassword?: boolean;
  createdAt: string;
  updatedAt: string;
};

const BASE = (import.meta.env.VITE_API_BASE as string) || '';
let authToken: string | null = null;

function authHeaders(extra?: HeadersInit): HeadersInit {
  const headers = new Headers(extra);
  if (authToken) headers.set('authorization', `Bearer ${authToken}`);
  return headers;
}

async function jrequest<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: authHeaders(init?.headers),
  });
  const text = await r.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (!r.ok) {
    const detail =
      payload && typeof payload === 'object' && 'detail' in payload && typeof payload.detail === 'string'
        ? payload.detail
        : `${path} -> ${r.status}`;
    throw new Error(detail);
  }
  return payload as T;
}

async function jget<T>(path: string): Promise<T> {
  return jrequest<T>(path);
}

async function jpost<T>(path: string, body: unknown): Promise<T> {
  return jrequest<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function jput<T>(path: string, body: unknown): Promise<T> {
  return jrequest<T>(path, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function setAuthToken(token: string | null) {
  authToken = token;
}

export const api = {
  search: (q: string, limit = 8) =>
    jget<{ results: Movie[]; source?: string }>(`/api/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  movie: (id: number) => jget<Movie>(`/api/movie/${id}`),
  seed: (movieId: number) => jpost<Movie>('/api/seed', { movieId }),
  similar: (opts: {
    movieId: number;
    k?: number;
    likedIds?: number[];
    dislikedIds?: number[];
    excludeIds?: number[];
    languages?: string[] | null;
    minRating?: number | null;
    yearFrom?: number | null;
    yearTo?: number | null;
  }) =>
    jpost<{ results: Movie[] }>('/api/similar', {
      movieId: opts.movieId,
      k: opts.k ?? 5,
      likedIds: opts.likedIds ?? [],
      dislikedIds: opts.dislikedIds ?? [],
      excludeIds: opts.excludeIds ?? [],
      languages: opts.languages ?? [],
      minRating: opts.minRating ?? null,
      yearFrom: opts.yearFrom ?? null,
      yearTo: opts.yearTo ?? null,
    }),
  health: () => jget<{ ok: boolean; index_ready: boolean }>('/api/health'),
  auth: {
    register: (body: { email: string; password: string; displayName: string }) =>
      jpost<{ token: string; user: AccountUser; state: Record<string, unknown> | null }>('/api/auth/register', body),
    login: (body: { email: string; password: string }) =>
      jpost<{ token: string; user: AccountUser; state: Record<string, unknown> | null }>('/api/auth/login', body),
    me: () => jget<{ user: AccountUser }>('/api/auth/me'),
    logout: () => jpost<{ ok: boolean }>('/api/auth/logout', {}),
    updateProfile: (body: { displayName: string }) =>
      jput<{ user: AccountUser }>('/api/auth/profile', body),
    changePassword: (body: { currentPassword: string; newPassword: string }) =>
      jput<{ ok: boolean }>('/api/auth/password', body),
  },
  account: {
    loadState: () => jget<{ state: Record<string, unknown> | null }>('/api/account/state'),
    saveState: (state: Record<string, unknown>) =>
      jput<{ ok: boolean; updatedAt: string }>('/api/account/state', { state }),
  },
};
