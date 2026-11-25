import { useSearchParams } from 'react-router-dom';

/** Reads/writes list filters in the URL query string so views can be bookmarked or refreshed. */
export function useUrlFilters() {
  const [sp, setSp] = useSearchParams();
  const get = (key: string) => sp.get(key) ?? '';
  const statuses = get('status') ? get('status').split(',') : [];

  /** Merge changes into the URL. Changing any filter (not `page`) resets to page 1. */
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    if (!('page' in patch)) next.delete('page');
    setSp(next, { replace: true });
  };

  return { sp, get, set, statuses, page: Number(get('page')) || 1 };
}
