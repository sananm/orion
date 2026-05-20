import { useEffect } from 'react';

import { useConstellation } from '@/store/constellation';
import type { Movie } from '@/api/client';

type Props = { movieId: number | null; onClose: () => void };

export function MovieDetailCard({ movieId, onClose }: Props) {
  const nodes = useConstellation((s) => s.nodes);
  const liked = useConstellation((s) => s.liked);
  const disliked = useConstellation((s) => s.disliked);
  const toggleLike = useConstellation((s) => s.toggleLike);
  const toggleDislike = useConstellation((s) => s.toggleDislike);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const open = movieId !== null;
  const node = movieId !== null ? nodes[movieId] : null;
  const m: Movie | null = node?.movie ?? null;
  const isLiked = movieId !== null && liked.includes(movieId);
  const isDisliked = movieId !== null && disliked.includes(movieId);

  return (
    <>
      <button
        type="button"
        aria-label="close details"
        onClick={onClose}
        className={`fixed inset-0 z-30 bg-black/35 backdrop-blur-[2px] transition-opacity duration-300 ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />
      <aside
        aria-hidden={!open}
        className={`fixed top-0 right-0 z-40 h-screen w-[min(400px,92vw)]
          border-l border-white/10 bg-black/82 backdrop-blur-xl
          transition-transform duration-300 ease-out
          ${open ? 'translate-x-0' : 'translate-x-full pointer-events-none'}`}
      >
        {m && (
          <div className="h-full flex flex-col overflow-hidden">
            <header className="flex items-start justify-between px-5 pt-5 pb-2">
              <div className="min-w-0">
                <div className="text-[10px] tracking-[2px] uppercase text-zinc-600 font-light">Details</div>
                <h2 className="mt-1 text-lg font-light text-zinc-100 truncate">{m.title}</h2>
                {m.year && <div className="text-xs text-zinc-500 font-light">{m.year}</div>}
              </div>
              <button
                onClick={onClose}
                aria-label="close"
                className="text-zinc-500 hover:text-zinc-200 text-2xl leading-none -mt-1 -mr-1 px-2"
              >
                ×
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-4 text-sm font-light text-zinc-300">
              {m.poster_url && (
                <div className="glass-panel rounded-[24px] p-2">
                  <img
                    src={m.poster_url}
                    alt={m.title}
                    className="w-full rounded-[18px] object-cover bg-zinc-900 max-h-[440px]"
                  />
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                {typeof m.imdb_rating === 'number' && m.imdb_rating > 0 && (
                  <span className="ui-chip ui-chip-warm">IMDb ★ {m.imdb_rating.toFixed(1)}{typeof m.imdb_vote_count === 'number' && m.imdb_vote_count > 0 ? ` · ${m.imdb_vote_count.toLocaleString()} votes` : ''}</span>
                )}
                {typeof m.vote_average === 'number' && m.vote_average > 0 && (
                  <span className="ui-chip ui-chip-cool">TMDB ★ {m.vote_average.toFixed(1)}</span>
                )}
                {m.director && <span className="ui-chip">dir. {m.director}</span>}
              </div>

              {m.genres && m.genres.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {m.genres.map((g) => (
                    <span
                      key={g}
                      className="px-2 py-0.5 text-[10px] tracking-wider uppercase rounded-full border border-white/15 text-zinc-300"
                    >
                      {g}
                    </span>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="ui-stat ui-stat-cool">
                  <div className="text-[10px] uppercase tracking-[2px] text-zinc-600">Language</div>
                  <div className="mt-2 text-sm text-zinc-100">{m.language ? m.language.toUpperCase() : 'Unknown'}</div>
                </div>
                <div className="ui-stat ui-stat-warm">
                  <div className="text-[10px] uppercase tracking-[2px] text-zinc-600">Cast</div>
                  <div className="mt-2 text-sm text-zinc-100">{m.cast?.length ?? 0} listed</div>
                </div>
              </div>

              {m.overview && (
                <p className="text-sm leading-relaxed text-zinc-300">{m.overview}</p>
              )}

              {m.cast && m.cast.length > 0 && (
                <div className="text-xs text-zinc-500">
                  <div className="uppercase tracking-wider text-[10px] text-zinc-600 mb-1">Cast</div>
                  <div className="leading-relaxed">{m.cast.slice(0, 8).join(' · ')}</div>
                </div>
              )}
            </div>

            <footer className="px-5 py-4 border-t border-white/10 flex items-center gap-2">
              <button
                onClick={() => movieId !== null && toggleLike(movieId)}
                className={`flex-1 px-3 py-2 text-[11px] tracking-[2px] font-light rounded-full border transition ${
                  isLiked
                    ? 'border-white/60 bg-white/[0.08] text-white'
                    : 'border-white/20 text-zinc-300 hover:border-white/40 hover:bg-white/[0.04]'
                }`}
              >
                ✦ {isLiked ? 'LIKED' : 'LIKE'}
              </button>
              <button
                onClick={() => movieId !== null && toggleDislike(movieId)}
                className={`flex-1 px-3 py-2 text-[11px] tracking-[2px] font-light rounded-full border transition ${
                  isDisliked
                    ? 'border-white/40 bg-white/[0.03] text-zinc-400'
                    : 'border-white/15 text-zinc-500 hover:border-white/30 hover:text-zinc-300'
                }`}
              >
                {isDisliked ? 'HIDDEN' : 'HIDE'}
              </button>
            </footer>
          </div>
        )}
      </aside>
    </>
  );
}
