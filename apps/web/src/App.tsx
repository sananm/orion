import { useEffect, useState } from 'react';

import { ConstellationCanvas } from '@/scene/ConstellationCanvas';
import { useAccount } from '@/store/account';
import { SeedSearch } from '@/ui/SeedSearch';
import { MovieDetailCard } from '@/ui/MovieDetailCard';
import { Hud } from '@/ui/Hud';
import { AccountPanel } from '@/ui/AccountPanel';
import { useConstellation } from '@/store/constellation';

export default function App() {
  const initialized = useConstellation((s) => s.initialized);
  const bootstrapAccount = useAccount((s) => s.bootstrap);
  const [detailId, setDetailId] = useState<number | null>(null);

  useEffect(() => {
    void bootstrapAccount();
  }, [bootstrapAccount]);

  useEffect(() => {
    if (!initialized) {
      setDetailId(null);
    }
  }, [initialized]);

  return (
    <div className="constellation-shell">
      <ConstellationCanvas key={initialized ? 'constellation-live' : 'constellation-seed'} onOpenDetails={(id) => setDetailId(id)} />
      <div className="app-ambient">
        <div className="app-nebula app-nebula-violet" />
        <div className="app-nebula app-nebula-amber" />
        <div className="app-grain" />
      </div>
      {!initialized && (
        <div className="fixed top-5 right-6 z-30">
          <AccountPanel />
        </div>
      )}
      {!initialized && <SeedSearch />}
      {initialized && <Hud />}
      <MovieDetailCard movieId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
