import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { prefStore } from './store';

export const CHILD_KEY = 'dz.child.v1';
const KEY = CHILD_KEY;

interface ChildValue {
  childId: string | null;
  setChildId: (id: string) => void;
  /**
   * Reconcile the persisted selection against the children the signed-in
   * account may actually see. If the stored id is stale (left over from a
   * previous account, or a since-deleted child) it is replaced with the
   * first available child — this prevents "not a guardian of this child"
   * from a leftover selection.
   */
  reconcile: (availableIds: string[]) => void;
}

const Ctx = createContext<ChildValue | null>(null);

export function ChildProvider({ children }: { children: ReactNode }) {
  const [childId, setId] = useState<string | null>(null);

  useEffect(() => {
    prefStore.get(KEY).then((v) => {
      if (v) setId(v);
    });
  }, []);

  // stable across renders — they only use the functional setState form, so
  // nothing that consumes them (effects, useFocusEffect deps) churns.
  const setChildId = useCallback((id: string) => {
    setId(id);
    void prefStore.set(KEY, id);
  }, []);

  const reconcile = useCallback((availableIds: string[]) => {
    if (availableIds.length === 0) return;
    setId((current) => {
      if (current && availableIds.includes(current)) return current;
      const next = availableIds[0]!;
      void prefStore.set(KEY, next);
      return next;
    });
  }, []);

  const value = useMemo<ChildValue>(
    () => ({ childId, setChildId, reconcile }),
    [childId, setChildId, reconcile],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useChild(): ChildValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useChild outside ChildProvider');
  return v;
}
