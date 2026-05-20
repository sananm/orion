import { useEffect, useMemo, useRef, useState } from 'react';

import { api, type Movie } from '@/api/client';
import { useConstellation } from '@/store/constellation';
import { formatLanguage, LanguageMultiSelect } from '@/ui/LanguageMultiSelect';

const MIN_SEEDS = 1;
const MAX_SEEDS = 5;
const FILTER_INPUT_CLASS =
  'appearance-none rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[12px] text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-white/30';
const INITIAL_LANGUAGE_OPTIONS = [
  'en',
  'fr',
  'es',
  'de',
  'it',
  'pt',
  'ja',
  'ko',
  'zh',
  'hi',
  'ta',
  'te',
  'ml',
  'ru',
  'ar',
  'tr',
  'pl',
  'sv',
  'da',
  'no',
  'nl',
  'th',
] as const;

export function SeedSearch() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Movie[]>([]);
  const [searchSource, setSearchSource] = useState<'tmdb' | 'local' | null>(null);
  const [seeds, setSeeds] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debRef = useRef<number | null>(null);
  const searchReqRef = useRef(0);

  const generate = useConstellation((s) => s.generateConstellation);
  const languages = useConstellation((s) => s.filters.languages);
  const minRating = useConstellation((s) => s.filters.minRating);
  const yearFrom = useConstellation((s) => s.filters.yearFrom);
  const yearTo = useConstellation((s) => s.filters.yearTo);
  const setLanguageFilter = useConstellation((s) => s.setLanguageFilter);
  const toggleLanguageFilter = useConstellation((s) => s.toggleLanguageFilter);
  const setMinRatingFilter = useConstellation((s) => s.setMinRatingFilter);
  const setYearFromFilter = useConstellation((s) => s.setYearFromFilter);
  const setYearToFilter = useConstellation((s) => s.setYearToFilter);
  const queryActive = q.trim().length > 0;
  const activeFilterCount = Number(languages.length > 0) + Number(minRating !== null) + Number(yearFrom !== null) + Number(yearTo !== null);
  const headerCaption = useMemo(() => {
    if (seeds.length === 0) return `pick ${MIN_SEEDS}-${MAX_SEEDS} movies to seed your sky`;
    if (seeds.length < MIN_SEEDS) return 'choose at least one movie to unlock the constellation';
    return `${seeds.length} seed${seeds.length === 1 ? '' : 's'} locked${seeds.length < MAX_SEEDS ? ` · ${MAX_SEEDS - seeds.length} slot${MAX_SEEDS - seeds.length === 1 ? '' : 's'} left` : ''}`;
  }, [seeds.length]);
  const readyToGenerate = seeds.length >= MIN_SEEDS;

  useEffect(() => {
    if (debRef.current) window.clearTimeout(debRef.current);
    const query = q.trim();
    if (!query) {
      searchReqRef.current += 1;
      setResults([]);
      setSearchSource(null);
      setLoading(false);
      return;
    }
    const requestId = ++searchReqRef.current;
    debRef.current = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await api.search(query, 12);
        if (searchReqRef.current !== requestId) return;
        setResults(r.results);
        setSearchSource(r.source === 'tmdb' || r.source === 'local' ? r.source : null);
      } catch (e: any) {
        if (searchReqRef.current !== requestId) return;
        setError(e.message || 'search failed');
        setSearchSource(null);
      } finally {
        if (searchReqRef.current !== requestId) return;
        setLoading(false);
      }
    }, 200);
    return () => {
      if (debRef.current) window.clearTimeout(debRef.current);
    };
  }, [q]);

  const addSeed = (m: Movie) => {
    if (seeds.find((s) => s.id === m.id)) return;
    if (seeds.length >= MAX_SEEDS) return;
    setSeeds([...seeds, m]);
    searchReqRef.current += 1;
    if (debRef.current) window.clearTimeout(debRef.current);
    setQ('');
    setResults([]);
    setSearchSource(null);
    setLoading(false);
  };

  const removeSeed = (id: number) => setSeeds(seeds.filter((s) => s.id !== id));

  const onGenerate = async () => {
    if (seeds.length < MIN_SEEDS) return;
    setGenerating(true);
    try {
      await generate(seeds);
    } catch (e: any) {
      setError(e.message || 'generate failed');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center">
      <div className="pointer-events-auto w-[min(560px,92vw)] flex flex-col items-center gap-5">
        <div className="text-center">
          <div className="text-[11px] tracking-[3px] text-zinc-500 font-light">CONSTELLATION</div>
          <div className="mt-2 text-xs text-zinc-600 font-light tracking-wide">
            {headerCaption}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <span className="ui-chip">{seeds.length}/{MAX_SEEDS} seeds</span>
            <span className="ui-chip">{activeFilterCount > 0 ? `${activeFilterCount} live filters` : 'all languages and years'}</span>
            <span className={`ui-chip ${readyToGenerate ? 'text-zinc-100' : 'text-zinc-500'}`}>
              {readyToGenerate ? 'ready to generate' : 'awaiting first seed'}
            </span>
          </div>
        </div>

        <div className="glass-panel glass-panel-strong glass-panel-highlight w-full rounded-[28px] p-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Add a movie…"
            className="w-full rounded-full border border-white/12 bg-white/[0.02] px-5 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition focus:border-white/35"
            autoFocus
          />
          {queryActive && (
            <div className="mt-3 overflow-hidden rounded-2xl border border-white/10 bg-black/65 backdrop-blur-md">
              {loading && <div className="px-4 py-3 text-xs text-zinc-500">searching…</div>}
              {!loading && results.length === 0 && (
                <div className="px-4 py-3 text-xs text-zinc-500">No matching movie found.</div>
              )}
              {results.length > 0 && (
                <div className="max-h-[320px] overflow-y-auto">
                  {results.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => addSeed(m)}
                      className="group flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition hover:bg-white/[0.06]"
                    >
                      {m.poster_url ? (
                        <img src={m.poster_url} alt="" className="h-14 w-9 rounded-md object-cover shadow-[0_10px_28px_rgba(0,0,0,0.35)] transition duration-200 group-hover:scale-[1.03]" />
                      ) : (
                        <div className="h-14 w-9 rounded-md bg-white/5" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-zinc-100">{m.title}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                          <span>{m.year ?? '—'}</span>
                          {m.language && <span>{formatLanguage(m.language)}</span>}
                          {typeof m.imdb_rating === 'number' && <span>IMDb {m.imdb_rating.toFixed(1)}</span>}
                        </div>
                      </div>
                      <div className="text-[10px] uppercase tracking-[2px] text-zinc-600 transition group-hover:text-zinc-300">lock</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {queryActive && searchSource === 'local' && !loading && (
            <div className="mt-2 px-4 text-[11px] text-amber-300/80">
              Search is using the local fallback catalog, not live TMDB results.
            </div>
          )}
        </div>

        {seeds.length > 0 && (
          <div className="grid w-full gap-3 sm:grid-cols-2">
            {seeds.map((m) => (
              <div
                key={m.id}
                className="glass-panel rounded-2xl p-3"
              >
                <div className="flex items-start gap-3">
                  {m.poster_url ? (
                    <img src={m.poster_url} alt="" className="h-20 w-14 rounded-lg object-cover shadow-[0_12px_32px_rgba(0,0,0,0.35)]" />
                  ) : (
                    <div className="h-20 w-14 rounded-lg bg-white/5" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="line-clamp-2 text-sm text-zinc-100">{m.title}</div>
                        <div className="mt-1 text-[11px] text-zinc-500">
                          {[m.year ?? '—', m.language ? formatLanguage(m.language) : null].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                      <button
                        className="rounded-full border border-white/12 px-2 py-1 text-[10px] uppercase tracking-[2px] text-zinc-500 transition hover:border-white/30 hover:text-zinc-200"
                        onClick={() => removeSeed(m.id)}
                        aria-label={`remove ${m.title}`}
                      >
                        remove
                      </button>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {typeof m.imdb_rating === 'number' && <span className="ui-chip">IMDb {m.imdb_rating.toFixed(1)}</span>}
                      {m.genres?.slice(0, 2).map((genre) => (
                        <span key={genre} className="ui-chip">{genre}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="glass-panel w-full rounded-[26px] px-4 py-4 backdrop-blur-md">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-[2px] text-zinc-500">Initial Filters</div>
              <div className="mt-1 text-[11px] text-zinc-600">Your first wave of recommendations reacts to these immediately.</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="ui-chip">{languages.length > 0 ? `${languages.length} language${languages.length === 1 ? '' : 's'}` : 'any language'}</span>
              <span className="ui-chip">{minRating !== null ? `IMDb ${minRating}+` : 'any rating'}</span>
              <span className="ui-chip">{yearFrom !== null || yearTo !== null ? `${yearFrom ?? '...'}-${yearTo ?? '...'}` : 'any year'}</span>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-6">
            <LanguageMultiSelect
              options={[...INITIAL_LANGUAGE_OPTIONS]}
              selected={languages}
              onToggle={toggleLanguageFilter}
              onClear={() => setLanguageFilter([])}
              className="sm:col-span-6"
              columns={3}
              maxHeightClassName="max-h-28"
            />
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="text-[10px] uppercase tracking-[2px] text-zinc-600">IMDb Rating Above</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                max="10"
                step="0.5"
                value={minRating ?? ''}
                onChange={(e) => {
                  const value = e.target.value.trim();
                  const nextValue = value ? Number(value) : null;
                  setMinRatingFilter(nextValue !== null && Number.isFinite(nextValue) ? nextValue : null);
                }}
                placeholder="Any"
                className={FILTER_INPUT_CLASS}
              />
            </label>
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="text-[10px] uppercase tracking-[2px] text-zinc-600">Year From</span>
              <input
                type="number"
                inputMode="numeric"
                min="1888"
                max="2100"
                step="1"
                value={yearFrom ?? ''}
                onChange={(e) => {
                  const value = e.target.value.trim();
                  const nextValue = value ? Number(value) : null;
                  setYearFromFilter(nextValue !== null && Number.isFinite(nextValue) ? nextValue : null);
                }}
                placeholder="Any"
                className={FILTER_INPUT_CLASS}
              />
            </label>
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="text-[10px] uppercase tracking-[2px] text-zinc-600">Year To</span>
              <input
                type="number"
                inputMode="numeric"
                min="1888"
                max="2100"
                step="1"
                value={yearTo ?? ''}
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
          <div className="mt-2 text-[11px] text-zinc-600">
            Initial recommendations will respect these filters.
          </div>
        </div>

        <div className="flex flex-col items-center gap-2">
          <button
            disabled={seeds.length < MIN_SEEDS || generating}
            onClick={onGenerate}
            className="ui-action ui-action-primary px-6 py-3 text-sm tracking-[2px] font-light text-zinc-100 disabled:cursor-not-allowed disabled:opacity-30"
          >
            {generating ? 'GENERATING…' : 'GENERATE CONSTELLATION'}
          </button>
          <div className="text-[11px] text-zinc-600">
            {readyToGenerate ? 'Single-click stars for details once the map opens. Double-click to grow branches.' : 'Pick at least one movie to continue.'}
          </div>
        </div>

        {error && <div className="text-xs text-red-400">{error}</div>}
      </div>
    </div>
  );
}
