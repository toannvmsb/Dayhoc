import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { apiCall, login as apiLogin, register as apiRegister, type Viewer, type Workspace } from './api';

const KEY = 'dz.session.v1';

interface Session {
  bearer: string;
  viewer: Viewer;
}

interface AuthValue {
  ready: boolean;
  session: Session | null;
  workspace: Workspace;
  setWorkspace: (w: Workspace) => void;
  signIn: (email: string) => Promise<void>;
  signUp: (i: { email: string; password: string; displayName?: string; role?: 'PARENT' | 'TEACHER' }) => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [workspace, setWorkspaceState] = useState<Workspace>('PARENT');

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY);
        if (raw) {
          const s = JSON.parse(raw) as Session;
          // validate the token still resolves
          try {
            await apiCall('/me', { bearer: s.bearer });
            setSession(s);
            setWorkspaceState(defaultWorkspace(s.viewer));
          } catch {
            await AsyncStorage.removeItem(KEY);
          }
        }
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const persist = useCallback(async (s: Session | null) => {
    setSession(s);
    if (s) {
      await AsyncStorage.setItem(KEY, JSON.stringify(s));
      setWorkspaceState(defaultWorkspace(s.viewer));
    } else {
      await AsyncStorage.removeItem(KEY);
    }
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      ready,
      session,
      workspace,
      setWorkspace: setWorkspaceState,
      signIn: async (email) => {
        const r = await apiLogin(email);
        await persist(r);
      },
      signUp: async (i) => {
        const r = await apiRegister(i);
        await persist(r);
      },
      signOut: () => persist(null),
    }),
    [ready, session, workspace, persist],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function defaultWorkspace(v: Viewer): Workspace {
  if (v.roles.includes('PARENT')) return 'PARENT';
  if (v.roles.includes('STUDENT')) return 'STUDENT';
  if (v.roles.includes('TEACHER')) return 'TEACHER';
  return 'PARENT';
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
