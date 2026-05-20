import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { api, setAuthToken, type AccountUser } from '@/api/client';
import { useConstellation } from '@/store/constellation';

type SyncStatus = 'idle' | 'saving' | 'saved' | 'error';

type AccountState = {
  token: string | null;
  user: AccountUser | null;
  ready: boolean;
  syncStatus: SyncStatus;
  syncError: string | null;
  lastSyncedAt: string | null;
};

type AccountActions = {
  bootstrap: () => Promise<void>;
  register: (body: { email: string; password: string; displayName: string }) => Promise<void>;
  login: (body: { email: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (displayName: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  saveSnapshot: () => Promise<void>;
  clearSyncStatus: () => void;
};

type AccountStore = AccountState & AccountActions;

function applyRemoteState(state: Record<string, unknown> | null) {
  if (!state) return;
  useConstellation.getState().importSnapshot(state);
}

export const useAccount = create<AccountStore>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      ready: false,
      syncStatus: 'idle',
      syncError: null,
      lastSyncedAt: null,

      bootstrap: async () => {
        const token = get().token;
        if (!token) {
          set({ ready: true, user: null });
          setAuthToken(null);
          return;
        }

        setAuthToken(token);
        try {
          const [{ user }, { state }] = await Promise.all([api.auth.me(), api.account.loadState()]);
          set({ user, ready: true, syncStatus: 'idle', syncError: null });
          applyRemoteState(state);
        } catch {
          setAuthToken(null);
          set({
            token: null,
            user: null,
            ready: true,
            syncStatus: 'idle',
            syncError: null,
            lastSyncedAt: null,
          });
        }
      },

      register: async ({ email, password, displayName }) => {
        const { token, user, state } = await api.auth.register({ email, password, displayName });
        setAuthToken(token);
        set({ token, user, ready: true, syncStatus: 'idle', syncError: null });
        if (state) {
          applyRemoteState(state);
        } else {
          await get().saveSnapshot();
        }
      },

      login: async ({ email, password }) => {
        const { token, user, state } = await api.auth.login({ email, password });
        setAuthToken(token);
        set({ token, user, ready: true, syncStatus: 'idle', syncError: null });
        if (state) {
          applyRemoteState(state);
        } else {
          await get().saveSnapshot();
        }
      },

      logout: async () => {
        const token = get().token;
        try {
          if (token) {
            setAuthToken(token);
            await api.auth.logout();
          }
        } catch {
          // ignore logout failure when clearing local session
        } finally {
          setAuthToken(null);
          set({
            token: null,
            user: null,
            syncStatus: 'idle',
            syncError: null,
            lastSyncedAt: null,
          });
        }
      },

      updateProfile: async (displayName) => {
        const { user } = await api.auth.updateProfile({ displayName });
        set({ user });
      },

      changePassword: async (currentPassword, newPassword) => {
        await api.auth.changePassword({ currentPassword, newPassword });
      },

      saveSnapshot: async () => {
        if (!get().token) return;
        set({ syncStatus: 'saving', syncError: null });
        try {
          const snapshot = useConstellation.getState().exportSnapshot();
          const { updatedAt } = await api.account.saveState(snapshot as Record<string, unknown>);
          set({ syncStatus: 'saved', lastSyncedAt: updatedAt, syncError: null });
        } catch (error: any) {
          set({ syncStatus: 'error', syncError: error?.message || 'sync failed' });
        }
      },

      clearSyncStatus: () => set({ syncStatus: 'idle', syncError: null }),
    }),
    {
      name: 'account-store',
      partialize: (state) => ({
        token: state.token,
        user: state.user,
      }),
      onRehydrateStorage: () => (state) => {
        setAuthToken(state?.token ?? null);
      },
    },
  ),
);
