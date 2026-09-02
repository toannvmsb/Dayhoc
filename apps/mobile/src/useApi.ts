import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, client, type Workspace } from './api';
import { useAuth } from './auth';

/** Human message for any thrown value — prefers ApiError.friendly. */
export function errText(e: unknown): string {
  if (e instanceof ApiError) return e.friendly;
  return e instanceof Error ? e.message : String(e);
}

/** A client bound to the current session + an explicit workspace. */
export function useClient(workspace?: Workspace) {
  const { session, workspace: current } = useAuth();
  return useMemo(
    () => client(session?.bearer ?? null, workspace ?? current),
    [session?.bearer, workspace, current],
  );
}

interface QueryState<T> {
  data: T | undefined;
  error: string | undefined;
  loading: boolean;
  reload: () => void;
}

/** Minimal fetch-on-mount + manual reload. Keeps the app dependency-light. */
export function useQuery<T>(fn: () => Promise<T>, deps: unknown[]): QueryState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(undefined);
    fnRef
      .current()
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((e: unknown) => {
        if (alive) setError(errText(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}
