import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { prefStore } from './store';

const KEY = 'dz.child.v1';

interface ChildValue {
  childId: string | null;
  setChildId: (id: string) => void;
}

const Ctx = createContext<ChildValue | null>(null);

export function ChildProvider({ children }: { children: ReactNode }) {
  const [childId, setId] = useState<string | null>(null);

  useEffect(() => {
    prefStore.get(KEY).then((v) => {
      if (v) setId(v);
    });
  }, []);

  const value = useMemo<ChildValue>(
    () => ({
      childId,
      setChildId: (id: string) => {
        setId(id);
        void prefStore.set(KEY, id);
      },
    }),
    [childId],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useChild(): ChildValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useChild outside ChildProvider');
  return v;
}
