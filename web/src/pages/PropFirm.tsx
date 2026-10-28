import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Landmark, Plus } from 'lucide-react';
import { useApp } from '../state/app.js';
import { useQuery } from '../hooks/useQuery.js';
import { Query } from '../components/states.js';
import { StatTile } from '../components/StatTile.js';
import { PropAccountForm } from '../components/PropAccountForm.js';
import { money, signedMoney, pnlClass } from '../format.js';
import type { PropAccountWithTotals, PropAccountStatus } from '../api/types.js';

const statusChip: Record<PropAccountStatus, string> = { funded: 'ok', passed: 'ok', failed: 'bad', breached: 'bad', evaluation: 'warn' };

export function PropFirm(): JSX.Element {
  const { api, selectedAccount } = useApp();
  const ccy = selectedAccount?.currency ?? 'USD';
  const [creating, setCreating] = useState(false);

  const summaryQ = useQuery(() => api.getPropSummary(), []);
  const listQ = useQuery(() => api.listPropAccounts(), []);
  const refetch = (): void => { summaryQ.refetch(); listQ.refetch(); };

  return (
    <div className="stack">
      <div className="row between">
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Landmark size={22} /> Prop Firms</h1>
        <button className="btn primary" onClick={() => setCreating(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Plus size={16} /> New account
        </button>
      </div>
      <p className="hintbar" style={{ maxWidth: 760 }}>
        Track prop-firm evaluations and funded accounts and their cash flow (fees paid and payouts received).
        This ledger is entered manually and is separate from trade P&L. Automatic bank or firm sync is not included.
      </p>

      <Query result={summaryQ}>
        {(s) => (
          <div className="tiles">
            <StatTile label="Accounts" value={String(s.accounts)} sub={s.byStatus.map((b) => `${b.count} ${b.status}`).join(', ') || undefined} />
            <StatTile label="Fees paid" value={money(s.cost, ccy)} tone="neg" />
            <StatTile label="Payouts" value={money(s.payout, ccy)} tone="pos" />
            <StatTile label="Net" value={signedMoney(s.net, ccy)} tone={pnlClass(s.net) as 'pos' | 'neg' | 'flat'} />
          </div>
        )}
      </Query>

      <Query result={listQ} isEmpty={(ps) => ps.length === 0}
        emptyTitle="No prop accounts yet"
        emptyHint="Add an evaluation or funded account to track its fees and payouts."
        emptyAction={<button className="btn primary" onClick={() => setCreating(true)}>Add your first account</button>}>
        {(accounts) => (
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
            {accounts.map((a) => <PropCard key={a.id} account={a} ccy={ccy} />)}
          </div>
        )}
      </Query>

      {creating && <PropAccountForm initial={null} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); refetch(); }} />}
    </div>
  );
}

function PropCard({ account: a, ccy }: { account: PropAccountWithTotals; ccy: string }): JSX.Element {
  return (
    <Link to={`/propfirm/${encodeURIComponent(a.id)}`} className="card" style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
      <div className="row between">
        <strong>{a.firm}</strong>
        <span className={`chip ${statusChip[a.status]}`}>{a.status}</span>
      </div>
      <div className="dim" style={{ fontSize: '0.85em', margin: '4px 0' }}>{[a.program, a.phase, a.accountSize ? money(a.accountSize, ccy) : undefined].filter(Boolean).join(' - ')}</div>
      <div className="row between" style={{ marginTop: 6 }}>
        <span className="dim" style={{ fontSize: '0.8em' }}>Net</span>
        <span className={`mono ${pnlClass(a.totals.net)}`}>{signedMoney(a.totals.net, ccy)}</span>
      </div>
    </Link>
  );
}
