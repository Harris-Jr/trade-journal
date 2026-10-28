import { useApp } from '../state/app.js';

export function AccountSelector(): JSX.Element {
  const { accounts, selectedAccountId, setSelectedAccountId, accountsLoading } = useApp();
  if (accountsLoading && accounts.length === 0) return <span className="dim">Loading accounts...</span>;
  if (accounts.length === 0) return <span className="dim">No accounts</span>;
  return (
    <label style={{ margin: 0 }}>
      <span className="sr-only" style={{ position: 'absolute', left: -9999 }}>Account</span>
      <select
        aria-label="Account"
        value={selectedAccountId ?? ''}
        onChange={(e) => setSelectedAccountId(e.target.value)}
      >
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>
        ))}
      </select>
    </label>
  );
}
