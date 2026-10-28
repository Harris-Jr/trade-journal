import type { ReactNode } from 'react';
import type { QueryResult } from '../hooks/useQuery.js';

export function Loading({ label = 'Loading...' }: { label?: string }): JSX.Element {
  return (
    <div className="state" role="status" aria-live="polite">
      <div className="spinner" aria-hidden="true" />
      <div style={{ marginTop: 8 }}>{label}</div>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }): JSX.Element {
  return (
    <div className="state">
      <div className="error-box" role="alert">
        <div className="big">Something went wrong</div>
        <div className="dim" style={{ marginBottom: onRetry ? 10 : 0 }}>{message}</div>
        {onRetry && <button className="btn" onClick={onRetry}>Retry</button>}
      </div>
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }): JSX.Element {
  return (
    <div className="state">
      <div className="big">{title}</div>
      {hint && <div className="dim" style={{ marginBottom: action ? 12 : 0 }}>{hint}</div>}
      {action}
    </div>
  );
}

/** Renders loading/error/empty uniformly, then hands data to children. */
export function Query<T>({
  result, children, isEmpty, emptyTitle = 'Nothing here yet', emptyHint, emptyAction,
}: {
  result: QueryResult<T>;
  children: (data: T) => ReactNode;
  isEmpty?: (data: T) => boolean;
  emptyTitle?: string;
  emptyHint?: string;
  emptyAction?: ReactNode;
}): JSX.Element {
  if (result.loading && result.data === undefined) return <Loading />;
  if (result.error) return <ErrorState message={result.error} onRetry={result.refetch} />;
  if (result.data === undefined) return <Loading />;
  if (isEmpty && isEmpty(result.data)) return <EmptyState title={emptyTitle} hint={emptyHint} action={emptyAction} />;
  return <>{children(result.data)}</>;
}
