import { useCallback, useEffect, useRef, useState } from 'react';

export interface QueryResult<T> {
  data: T | undefined;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Minimal data-fetching hook with loading/error/data and a stable refetch.
 * `deps` controls when the query re-runs. Errors are surfaced, never swallowed
 * or replaced with placeholder data.
 */
export function useQuery<T>(fn: () => Promise<T>, deps: unknown[]): QueryResult<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fnRef.current()
      .then((res) => { if (!cancelled) setData(res); })
      .catch((e: unknown) => {
        if (!cancelled) { setError(e instanceof Error ? e.message : 'Request failed'); setData(undefined); }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const refetch = useCallback(() => setTick((t) => t + 1), []);
  return { data, loading, error, refetch };
}

/** For imperative mutations (POST/PUT/DELETE) with pending/error state. */
export function useMutation<Args extends unknown[], R>(fn: (...args: Args) => Promise<R>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Always call the latest callback so mutations that read current component state
  // (rather than taking arguments) never run against a stale closure.
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const run = useCallback(async (...args: Args): Promise<R | undefined> => {
    setPending(true); setError(null);
    try { return await fnRef.current(...args); }
    catch (e) { setError(e instanceof Error ? e.message : 'Request failed'); return undefined; }
    finally { setPending(false); }
  }, []);
  return { run, pending, error };
}
