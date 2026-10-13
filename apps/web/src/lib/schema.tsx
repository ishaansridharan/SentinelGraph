import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, type Schema, type Stats } from './api';

interface Ctx {
  schema: Schema | null;
  stats: Stats | null;
  online: boolean;
  refreshStats: () => void;
  /** bumps whenever any entity/relationship changes, so views can refetch */
  version: number;
  notifyChange: () => void;
}

const SchemaCtx = createContext<Ctx>({
  schema: null, stats: null, online: true, refreshStats: () => {}, version: 0, notifyChange: () => {},
});

export function SchemaProvider({ children }: { children: ReactNode }) {
  const [schema, setSchema] = useState<Schema | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [online, setOnline] = useState(true);
  const [version, setVersion] = useState(0);

  const refreshStats = useCallback(() => {
    api.stats().then((s) => { setStats(s); setOnline(true); }).catch(() => setOnline(false));
  }, []);

  useEffect(() => {
    api.schema().then(setSchema).catch(() => setOnline(false));
    refreshStats();
  }, [refreshStats]);

  const notifyChange = useCallback(() => {
    setVersion((v) => v + 1);
    refreshStats();
  }, [refreshStats]);

  return (
    <SchemaCtx.Provider value={{ schema, stats, online, refreshStats, version, notifyChange }}>
      {children}
    </SchemaCtx.Provider>
  );
}

export const useSchema = () => useContext(SchemaCtx);
