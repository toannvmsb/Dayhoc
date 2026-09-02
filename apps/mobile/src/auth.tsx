import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  login as apiLogin,
  register as apiRegister,
  setUnauthorizedHandler,
  whoami,
  type Viewer,
  type Workspace,
} from './api';
import { CHILD_KEY } from './child';
import { prefStore, secureStore } from './store';

const TOKEN_KEY = 'dz.bearer';
const VIEWER_KEY = 'dz.viewer.v1';
const WS_KEY = 'dz.workspace.v1';

interface Session {
  bearer: string;
  viewer: Viewer;
}

interface AuthValue {
  ready: boolean;
  session: Session | null;
  workspace: Workspace;
  availableWorkspaces: Workspace[];
  setWorkspace: (w: Workspace) => void;
  signIn: (email: string) => Promise<void>;
  signUp: (i: { email: string; password: string; displayName?: string; role?: 'PARENT' | 'TEACHER' }) => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthValue | null>(null);

const ROLE_TO_WS: Record<string, Workspace | undefined> = {
  PARENT: 'PARENT',
  STUDENT: 'STUDENT',
  TEACHER: 'TEACHER',
};

function workspacesOf(v: Viewer): Workspace[] {
  const ws = v.roles.map((r) => ROLE_TO_WS[r]).filter((x): x is Workspace => !!x);
  return ws.length > 0 ? [...new Set(ws)] : ['PARENT'];
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [workspace, setWorkspaceState] = useState<Workspace>('PARENT');

  useEffect(() => {
    (async () => {
      try {
        const bearer = await secureStore.get(TOKEN_KEY);
        if (bearer) {
          try {
            const viewer = await whoami(bearer); // re-validate on launch
            const s = { bearer, viewer };
            setSession(s);
            await prefStore.set(VIEWER_KEY, JSON.stringify(viewer));
            const savedWs = (await prefStore.get(WS_KEY)) as Workspace | null;
            const opts = workspacesOf(viewer);
            setWorkspaceState(savedWs && opts.includes(savedWs) ? savedWs : opts[0]!);
          } catch {
            await secureStore.remove(TOKEN_KEY);
            await prefStore.remove(VIEWER_KEY);
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
      await secureStore.set(TOKEN_KEY, s.bearer);
      await prefStore.set(VIEWER_KEY, JSON.stringify(s.viewer));
      setWorkspaceState(workspacesOf(s.viewer)[0]!);
    } else {
      await secureStore.remove(TOKEN_KEY);
      await prefStore.remove(VIEWER_KEY);
      await prefStore.remove(WS_KEY);
      await prefStore.remove(CHILD_KEY); // don't carry a child selection across accounts
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      void persist(null);
    });
    return () => setUnauthorizedHandler(null);
  }, [persist]);

  const setWorkspace = useCallback((w: Workspace) => {
    setWorkspaceState(w);
    void prefStore.set(WS_KEY, w);
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      ready,
      session,
      workspace,
      availableWorkspaces: session ? workspacesOf(session.viewer) : ['PARENT'],
      setWorkspace,
      signIn: async (email) => {
        await persist(await apiLogin(email));
      },
      signUp: async (i) => {
        await persist(await apiRegister(i));
      },
      signOut: () => persist(null),
    }),
    [ready, session, workspace, persist, setWorkspace],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
