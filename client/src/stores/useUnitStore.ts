import { useEffect, useState } from 'react';
import { unitApi, Unit } from '../api/unit';

interface UnitState {
  units: Unit[];
  loading: boolean;
  reload: () => Promise<void>;
}

// 轻量全局 store（与 useCommToolStore 一致写法）：缓存单位列表，供线索表单单位下拉使用。
let cached: Unit[] = [];
let loading = false;
const listeners = new Set<(units: Unit[]) => void>();

async function ensureLoaded(force = false): Promise<Unit[]> {
  if (cached.length && !force) return cached;
  loading = true;
  try {
    cached = await unitApi.getActive();
  } finally {
    loading = false;
  }
  listeners.forEach((l) => l(cached));
  return cached;
}

export function useUnitOptions() {
  const [units, setUnits] = useState<Unit[]>(cached);
  const [isLoading, setIsLoading] = useState<boolean>(loading);

  const reload = async () => {
    await ensureLoaded(true);
    setUnits([...cached]);
  };

  useEffect(() => {
    const listener = (u: Unit[]) => setUnits([...u]);
    listeners.add(listener);
    setUnits([...cached]);
    ensureLoaded().then((list) => setUnits([...list]));
    setIsLoading(loading);
    return () => {
      listeners.delete(listener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    units,
    options: units.map((u) => ({ label: u.name, value: u.name })),
    loading: isLoading,
    reload,
  };
}

export const unitStore: UnitState = {
  get units() {
    return cached;
  },
  get loading() {
    return loading;
  },
  reload: () => ensureLoaded(true).then(() => undefined),
};
