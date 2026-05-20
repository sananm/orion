import { useEffect, useMemo, useRef, useState } from 'react';

import { useAccount } from '@/store/account';
import { useConstellation } from '@/store/constellation';

type Props = {
  className?: string;
  triggerClassName?: string;
};

export function AccountPanel({ className = '', triggerClassName = '' }: Props) {
  const token = useAccount((s) => s.token);
  const user = useAccount((s) => s.user);
  const ready = useAccount((s) => s.ready);
  const syncStatus = useAccount((s) => s.syncStatus);
  const syncError = useAccount((s) => s.syncError);
  const lastSyncedAt = useAccount((s) => s.lastSyncedAt);
  const register = useAccount((s) => s.register);
  const login = useAccount((s) => s.login);
  const logout = useAccount((s) => s.logout);
  const updateProfile = useAccount((s) => s.updateProfile);
  const changePassword = useAccount((s) => s.changePassword);
  const saveSnapshot = useAccount((s) => s.saveSnapshot);
  const clearSyncStatus = useAccount((s) => s.clearSyncStatus);
  const snapshot = useConstellation((s) => s.exportSnapshot());

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'login' | 'register' | 'manage'>('login');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const syncTimerRef = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!token || !ready) return;
    if (syncTimerRef.current) window.clearTimeout(syncTimerRef.current);
    syncTimerRef.current = window.setTimeout(() => {
      void saveSnapshot();
    }, 900);
    return () => {
      if (syncTimerRef.current) window.clearTimeout(syncTimerRef.current);
    };
  }, [ready, saveSnapshot, snapshot, token]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!user) return;
    setDisplayName(user.displayName);
    setMode('manage');
  }, [user]);

  const syncLabel = useMemo(() => {
    if (!token) return 'guest mode';
    if (syncStatus === 'saving') return 'saving constellation…';
    if (syncStatus === 'saved') return lastSyncedAt ? `saved ${new Date(lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'saved';
    if (syncStatus === 'error') return 'sync error';
    return 'account connected';
  }, [lastSyncedAt, syncStatus, token]);

  const onLogin = async () => {
    setBusy(true);
    setFormError(null);
    try {
      await login({ email, password });
      setPassword('');
      setOpen(false);
    } catch (error: any) {
      setFormError(error?.message || 'login failed');
    } finally {
      setBusy(false);
    }
  };

  const onRegister = async () => {
    setBusy(true);
    setFormError(null);
    try {
      await register({ email, password, displayName });
      setPassword('');
      setCurrentPassword('');
      setNewPassword('');
      setOpen(false);
    } catch (error: any) {
      setFormError(error?.message || 'registration failed');
    } finally {
      setBusy(false);
    }
  };

  const onUpdateProfile = async () => {
    setBusy(true);
    setFormError(null);
    try {
      await updateProfile(displayName);
    } catch (error: any) {
      setFormError(error?.message || 'profile update failed');
    } finally {
      setBusy(false);
    }
  };

  const onChangePassword = async () => {
    setBusy(true);
    setFormError(null);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
    } catch (error: any) {
      setFormError(error?.message || 'password change failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={rootRef} className={`relative pointer-events-auto ${className}`}>
      <button
        type="button"
        onClick={() => {
          clearSyncStatus();
          setOpen((value) => !value);
          setFormError(null);
        }}
        className={`ui-action ${triggerClassName}`}
      >
        {user ? user.displayName : 'account'}
      </button>
      {open && (
        <div className="glass-panel glass-panel-strong absolute right-0 top-[calc(100%+12px)] z-50 w-[min(360px,86vw)] rounded-[24px] p-4 backdrop-blur-md">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-[2px] text-zinc-500">Account</div>
              <div className="mt-1 text-sm text-zinc-100">{user ? user.email : 'Sign in to sync your constellation'}</div>
            </div>
            <span className={`ui-chip ${user ? 'ui-chip-cool' : ''}`}>{syncLabel}</span>
          </div>

          {!ready && <div className="mt-4 text-[11px] text-zinc-500">loading account…</div>}

          {ready && !user && (
            <div className="mt-4 space-y-3">
              <div className="flex gap-2">
                <button className={`ui-action ${mode === 'login' ? 'ui-action-primary' : ''}`} onClick={() => setMode('login')}>sign in</button>
                <button className={`ui-action ${mode === 'register' ? 'ui-action-primary' : ''}`} onClick={() => setMode('register')}>create account</button>
              </div>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[12px] text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-white/30"
              />
              {mode === 'register' && (
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Display name"
                  className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[12px] text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-white/30"
                />
              )}
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[12px] text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-white/30"
              />
              <div className="text-[11px] text-zinc-600">Accounts sync your constellation, likes, dislikes, filters, and layout across devices.</div>
              <button
                type="button"
                disabled={busy}
                onClick={mode === 'register' ? onRegister : onLogin}
                className="ui-action ui-action-primary w-full justify-center disabled:opacity-40"
              >
                {busy ? 'working…' : mode === 'register' ? 'create account' : 'sign in'}
              </button>
            </div>
          )}

          {ready && user && (
            <div className="mt-4 space-y-4">
              <div>
                <div className="mb-2 text-[10px] uppercase tracking-[2px] text-zinc-500">Profile</div>
                <div className="flex gap-2">
                  <input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Display name"
                    className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[12px] text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-white/30"
                  />
                  <button type="button" onClick={onUpdateProfile} disabled={busy} className="ui-action ui-action-primary shrink-0 disabled:opacity-40">
                    save
                  </button>
                </div>
              </div>

              {user.hasPassword !== false ? (
                <div>
                  <div className="mb-2 text-[10px] uppercase tracking-[2px] text-zinc-500">Password</div>
                  <div className="space-y-2">
                    <input
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="Current password"
                      className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[12px] text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-white/30"
                    />
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="New password"
                      className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[12px] text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-white/30"
                    />
                    <button type="button" onClick={onChangePassword} disabled={busy} className="ui-action w-full justify-center disabled:opacity-40">
                      update password
                    </button>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-3 py-3 text-[11px] text-zinc-500">
                  Password login is unavailable for this account.
                </div>
              )}

              <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.02] px-3 py-3 text-[11px] text-zinc-500">
                <span>{syncStatus === 'error' ? syncError ?? 'sync failed' : 'Your constellation auto-saves while you explore.'}</span>
                <button type="button" onClick={() => void saveSnapshot()} className="ui-action shrink-0">
                  sync now
                </button>
              </div>

              <button type="button" onClick={() => void logout()} className="ui-action w-full justify-center">
                sign out
              </button>
            </div>
          )}

          {formError && <div className="mt-3 text-[11px] text-red-400">{formError}</div>}
        </div>
      )}
    </div>
  );
}
