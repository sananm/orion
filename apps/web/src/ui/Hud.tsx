import { useEffect, useMemo, useRef, useState } from 'react';

import { api, type Movie } from '@/api/client';
import { movieMatchesFilters, useConstellation } from '@/store/constellation';
import { AccountPanel } from '@/ui/AccountPanel';
import { formatLanguage, LanguageMultiSelect } from '@/ui/LanguageMultiSelect';

const FILTER_INPUT_CLASS =
  'appearance-none rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[12px] text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-white/30';

export function Hud() {
  const reset = useConstellation((s) => s.reset);
  const nodes = useConstellation((s) => s.nodes);
  const liked = useConstellation((s) => s.liked.length);
  const filters = useConstellation((s) => s.filters);
  const highlightedId = useConstellation((s) => s.highlightedId);
  const addMovieToConstellation = useConstellation((s) => s.addMovieToConstellation);
  const focusNode = useConstellation((s) => s.focusNode);
  const clearHighlight = useConstellation((s) => s.clearHighlight);
  const setLanguageFilter = useConstellation((s) => s.setLanguageFilter);
  const toggleLanguageFilter = useConstellation((s) => s.toggleLanguageFilter);
  const setMinRatingFilter = useConstellation((s) => s.setMinRatingFilter);
  const setYearFromFilter = useConstellation((s) => s.setYearFromFilter);
  const setYearToFilter = useConstellation((s) => s.setYearToFilter);
  const clearFilters = useConstellation((s) => s.clearFilters);
  const [addOpen, setAddOpen] = useState(false);
  const [q, setQ] = useState('');
  const [findQ, setFindQ] = useState('');
  const [results, setResults] = useState<Movie[]>([]);
  const [searchSource, setSearchSource] = useState<'tmdb' | 'local' | null>(null);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const debRef = useRef<number | null>(null);
  const searchReqRef = useRef(0);

  const nodeList = Object.values(nodes);
  const nodeCount = nodeList.length;
  const visibleCount = nodeList.filter((node) => node.kind === 'seed' || movieMatchesFilters(node.movie, filters)).length;
  const languages = useMemo(
    () =>
      Array.from(
        new Set(
          [...filters.languages, ...nodeList
            .map((node) => node.movie.language)
            .filter((language): language is string => Boolean(language))],
        ),
      ).sort((a, b) => formatLanguage(a).localeCompare(formatLanguage(b))),
    [filters.languages, nodeList],
  );
  const highlightedNode = highlightedId !== null ? nodes[highlightedId] ?? null : null;
  const activeFilterCount = Number(filters.languages.length > 0) + Number(filters.minRating !== null) + Number(filters.yearFrom !== null) + Number(filters.yearTo !== null);
  const activeFilterSummary = [
    filters.languages.length > 0 ? `${filters.languages.length} lang` : null,
    filters.minRating !== null ? `IMDb ${filters.minRating}+` : null,
    filters.yearFrom !== null || filters.yearTo !== null ? `${filters.yearFrom ?? '...'}-${filters.yearTo ?? '...'}` : null,
  ].filter(Boolean) as string[];
  const findResults = useMemo(() => {
    const query = findQ.trim().toLowerCase();
    if (!query) return [];
    return [...nodeList]
      .filter((node) => node.movie.title.toLowerCase().includes(query))
      .sort((a, b) => {
        const aTitle = a.movie.title.toLowerCase();
        const bTitle = b.movie.title.toLowerCase();
        const aStarts = aTitle.startsWith(query) ? 0 : 1;
        const bStarts = bTitle.startsWith(query) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
        if (a.kind !== b.kind) return a.kind === 'seed' ? -1 : 1;
        return a.movie.title.localeCompare(b.movie.title) || (b.movie.year ?? 0) - (a.movie.year ?? 0);
      })
      .slice(0, 10);
  }, [findQ, nodeList]);

  useEffect(() => {
    if (debRef.current) window.clearTimeout(debRef.current);
    const query = q.trim();
    if (!addOpen || !query) {
      searchReqRef.current += 1;
      setResults([]);
      setSearchSource(null);
      setSearching(false);
      return;
    }
    const requestId = ++searchReqRef.current;
    debRef.current = window.setTimeout(async () => {
      setSearching(true);
      setSearchError(null);
      try {
        const r = await api.search(query, 10);
        if (searchReqRef.current !== requestId) return;
        setResults(r.results);
        setSearchSource(r.source === 'tmdb' || r.source === 'local' ? r.source : null);
      } catch (e: any) {
        if (searchReqRef.current !== requestId) return;
        setSearchError(e.message || 'search failed');
        setSearchSource(null);
      } finally {
        if (searchReqRef.current !== requestId) return;
        setSearching(false);
      }
    }, 200);
    return () => {
      if (debRef.current) window.clearTimeout(debRef.current);
    };
  }, [addOpen, q]);

  const closeAddMovie = () => {
    searchReqRef.current += 1;
    if (debRef.current) window.clearTimeout(debRef.current);
    setAddOpen(false);
    setQ('');
    setResults([]);
    setSearchSource(null);
    setSearchError(null);
    setSearching(false);
  };

  const onAddMovie = async (movie: Movie) => {
    setAdding(true);
    setSearchError(null);
    try {
      await addMovieToConstellation(movie);
      closeAddMovie();
    } catch (e: any) {
      setSearchError(e.message || 'add failed');
    } finally {
      setAdding(false);
    }
  };

  const onFocusNode = (id: number) => {
    focusNode(id);
    setFindQ('');
  };

  return (
    <>
      <div className="fixed top-5 left-6 z-20 text-[11px] tracking-[2px] text-zinc-500 font-light pointer-events-none">
        CONSTELLATION
      </div>
      <div className="fixed top-14 left-6 z-20 w-[min(280px,72vw)] pointer-events-none">
        <div className="glass-panel glass-panel-highlight rounded-[24px] p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-[2px] text-zinc-500">Live Field</div>
              <div className="mt-1 text-sm text-zinc-100">
                {highlightedNode ? highlightedNode.movie.title : 'Explore the graph'}
              </div>
            </div>
            <span className={`ui-chip ${highlightedNode ? 'ui-chip-warm' : 'ui-chip-cool'}`}>{highlightedNode ? 'focused' : 'roaming'}</span>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <div className="ui-stat ui-stat-cool">
              <div className="text-[10px] uppercase tracking-[2px] text-zinc-600">Stars</div>
              <div className="mt-2 text-lg text-zinc-100">{nodeCount}</div>
            </div>
            <div className="ui-stat">
              <div className="text-[10px] uppercase tracking-[2px] text-zinc-600">Visible</div>
              <div className="mt-2 text-lg text-zinc-100">{visibleCount}</div>
            </div>
            <div className="ui-stat ui-stat-warm">
              <div className="text-[10px] uppercase tracking-[2px] text-zinc-600">Liked</div>
              <div className="mt-2 text-lg text-zinc-100">{liked}</div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className={`ui-chip ${activeFilterCount > 0 ? 'ui-chip-warm' : 'ui-chip-cool'}`}>{activeFilterCount > 0 ? `${activeFilterCount} active filter${activeFilterCount === 1 ? '' : 's'}` : 'all titles visible'}</span>
            {highlightedNode?.movie.year && <span className="ui-chip ui-chip-cool">{highlightedNode.movie.year}</span>}
          </div>
        </div>
      </div>
      <div className="fixed top-5 left-1/2 z-20 w-[min(420px,76vw)] -translate-x-1/2 pointer-events-auto">
        <div className="glass-panel glass-panel-strong rounded-[26px] p-3 backdrop-blur-md">
          <div className="flex items-center gap-2">
            <input
              value={findQ}
              onChange={(e) => setFindQ(e.target.value)}
              placeholder="Search current constellation…"
              className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[12px] text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-white/30"
            />
            {highlightedNode && (
              <button
                onClick={clearHighlight}
                className="shrink-0 text-[10px] uppercase tracking-[2px] text-zinc-500 transition hover:text-zinc-200"
              >
                clear
              </button>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="ui-chip ui-chip-cool">{nodeCount} total nodes</span>
            <span className="ui-chip">{visibleCount} visible</span>
            {highlightedNode && (
              <span className="ui-chip ui-chip-warm max-w-[200px] truncate" title={highlightedNode.movie.title}>
                focused on {highlightedNode.movie.title}
              </span>
            )}
          </div>
          {findQ.trim() && (
            <div className="mt-2 overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]">
              {findResults.length > 0 ? (
                findResults.map((node) => (
                  <button
                    key={node.id}
                    onClick={() => onFocusNode(node.id)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition hover:bg-white/5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] text-zinc-100">{node.movie.title}</div>
                      <div className="text-[10px] text-zinc-500">
                        {node.movie.year ?? '—'} · {node.kind === 'seed' ? 'seed' : 'node'}
                      </div>
                    </div>
                    <div className="text-[10px] uppercase tracking-[2px] text-zinc-600">focus</div>
                  </button>
                ))
              ) : (
                <div className="px-3 py-2 text-[11px] text-zinc-500">No matching movie in the current constellation.</div>
              )}
            </div>
          )}
          {highlightedNode && !findQ.trim() && (
            <div className="mt-2 text-[11px] text-zinc-500">
              Highlighted: <span className="text-zinc-300">{highlightedNode.movie.title}{highlightedNode.movie.year ? ` · ${highlightedNode.movie.year}` : ''}</span>
            </div>
          )}
        </div>
      </div>
      <div className="fixed top-5 right-6 z-20 flex flex-col items-end gap-3 text-[11px] tracking-wider text-zinc-600 font-light">
        <div className="pointer-events-none flex flex-wrap justify-end gap-2">
          <span className="ui-chip ui-chip-cool">{visibleCount}/{nodeCount} shown</span>
          <span className="ui-chip ui-chip-warm">{liked} liked</span>
          <span className={`ui-chip ${activeFilterCount > 0 ? 'ui-chip-warm' : ''}`}>{activeFilterCount > 0 ? `${activeFilterCount} filters` : 'open field'}</span>
        </div>
        <div className="pointer-events-auto flex items-center gap-3">
          <button
            onClick={() => {
              if (addOpen) closeAddMovie();
              else setAddOpen(true);
            }}
            className="ui-action"
          >
            {addOpen ? 'close add movie' : 'add movie'}
          </button>
          <button
            onClick={() => {
              if (confirm('Clear the constellation?')) reset();
            }}
            className="ui-action"
          >
            reset
          </button>
          <AccountPanel />
        </div>
        {addOpen && (
          <div className="glass-panel glass-panel-strong pointer-events-auto w-[min(360px,82vw)] rounded-[24px] p-4 backdrop-blur-md">
            <div className="mb-3 text-[10px] uppercase tracking-[2px] text-zinc-500">Add Movie</div>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search TMDB or local index…"
              className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[12px] text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-white/30"
              autoFocus
            />
            {(results.length > 0 || searching) && (
              <div className="mt-2 overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]">
                {searching && <div className="px-3 py-2 text-[11px] text-zinc-500">searching…</div>}
                {results.map((movie) => (
                  <button
                    key={movie.id}
                    onClick={() => onAddMovie(movie)}
                    disabled={adding}
                    className="group flex w-full items-center gap-3 px-3 py-2 text-left transition hover:bg-white/5 disabled:opacity-50"
                  >
                    {movie.poster_url ? (
                      <img src={movie.poster_url} alt="" className="h-14 w-9 rounded-md object-cover shadow-[0_10px_28px_rgba(0,0,0,0.35)] transition duration-200 group-hover:scale-[1.03]" />
                    ) : (
                      <div className="h-14 w-9 rounded-md bg-white/5" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] text-zinc-100">{movie.title}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-zinc-500">
                        <span>{movie.year ?? '—'}</span>
                        {movie.language && <span>{formatLanguage(movie.language)}</span>}
                        {typeof movie.imdb_rating === 'number' && <span>IMDb {movie.imdb_rating.toFixed(1)}</span>}
                      </div>
                    </div>
                    <div className="text-[10px] uppercase tracking-[2px] text-zinc-600 transition group-hover:text-zinc-300">add</div>
                  </button>
                ))}
              </div>
            )}
            {searchSource === 'local' && !searching && (
              <div className="mt-2 text-[11px] text-amber-300/80">
                Search is using the local fallback catalog, not live TMDB results.
              </div>
            )}
            {adding && <div className="mt-2 text-[11px] text-zinc-500">embedding movie and expanding constellation…</div>}
            {searchError && <div className="mt-2 text-[11px] text-red-400">{searchError}</div>}
          </div>
        )}
        <div className="glass-panel pointer-events-auto w-[min(320px,80vw)] rounded-[24px] p-4 backdrop-blur-md">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-[2px] text-zinc-500">Filters</div>
            <button onClick={clearFilters} className="text-[10px] text-zinc-500 transition hover:text-zinc-200">
              clear
            </button>
          </div>
          <div className="mb-3 flex flex-wrap gap-2">
            {activeFilterSummary.length > 0 ? (
              activeFilterSummary.map((summary) => (
                <span key={summary} className="ui-chip">{summary}</span>
              ))
            ) : (
              <span className="ui-chip">No filters applied</span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <LanguageMultiSelect
              options={languages}
              selected={filters.languages}
              onToggle={toggleLanguageFilter}
              onClear={() => setLanguageFilter([])}
              className="col-span-2"
              maxHeightClassName="max-h-28"
            />
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[2px] text-zinc-600">IMDb Rating Above</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                max="10"
                step="0.5"
                value={filters.minRating ?? ''}
                onChange={(e) => {
                  const value = e.target.value.trim();
                  const nextValue = value ? Number(value) : null;
                  setMinRatingFilter(nextValue !== null && Number.isFinite(nextValue) ? nextValue : null);
                }}
                placeholder="Any"
                className={FILTER_INPUT_CLASS}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[2px] text-zinc-600">Year From</span>
              <input
                type="number"
                inputMode="numeric"
                min="1888"
                max="2100"
                step="1"
                value={filters.yearFrom ?? ''}
                onChange={(e) => {
                  const value = e.target.value.trim();
                  const nextValue = value ? Number(value) : null;
                  setYearFromFilter(nextValue !== null && Number.isFinite(nextValue) ? nextValue : null);
                }}
                placeholder="Any"
                className={FILTER_INPUT_CLASS}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[2px] text-zinc-600">Year To</span>
              <input
                type="number"
                inputMode="numeric"
                min="1888"
                max="2100"
                step="1"
                value={filters.yearTo ?? ''}
                onChange={(e) => {
                  const value = e.target.value.trim();
                  const nextValue = value ? Number(value) : null;
                  setYearToFilter(nextValue !== null && Number.isFinite(nextValue) ? nextValue : null);
                }}
                placeholder="Any"
                className={FILTER_INPUT_CLASS}
              />
            </label>
          </div>
        </div>
      </div>
      <div className="glass-panel fixed bottom-5 left-1/2 z-20 -translate-x-1/2 rounded-full px-4 py-2 text-[10px] tracking-[2px] text-zinc-500 font-light pointer-events-none">
        drag to pan · scroll or trackpad to zoom · click for details · double-click for more recs · search current movies at the top
      </div>
    </>
  );
}
