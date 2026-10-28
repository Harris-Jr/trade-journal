import { useState } from 'react';
import { useApp } from '../state/app.js';
import { useQuery, useMutation } from '../hooks/useQuery.js';
import { Query } from '../components/states.js';
import { money, dateOnly } from '../format.js';
import type { AccountKind, Tag } from '../api/types.js';

export function Settings(): JSX.Element {
  return (
    <div className="stack">
      <h1>Settings</h1>
      <AccountsSection />
      <BalanceSection />
      <StrategiesSection />
      <TagsSection />
    </div>
  );
}

function AccountsSection(): JSX.Element {
  const { api, accounts, reloadAccounts, demoMode } = useApp();
  const create = useMutation((input: { name: string; currency: string; startingBalance?: number; kind?: AccountKind }) => api.createAccount(input));
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [startingBalance, setStarting] = useState('0');
  const [kind, setKind] = useState<AccountKind>('live');

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const res = await create.run({ name: name.trim(), currency: currency.trim().toUpperCase(), startingBalance: Number(startingBalance) || 0, kind });
    if (res !== undefined) { setName(''); setStarting('0'); reloadAccounts(); }
  };

  return (
    <div className="card">
      <h3>Accounts</h3>
      <div className="table-wrap" style={{ marginBottom: 14 }}>
        <table>
          <thead><tr><th>Name</th><th>Currency</th><th className="num">Starting balance</th><th>Kind</th></tr></thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id}><td>{a.name}</td><td>{a.currency}</td><td className="num">{money(a.startingBalance, a.currency)}</td><td>{a.kind}</td></tr>
            ))}
            {accounts.length === 0 && <tr><td colSpan={4} className="dim">No accounts yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <form className="row" onSubmit={submit} style={{ alignItems: 'flex-end' }}>
        <div className="field" style={{ margin: 0 }}><label htmlFor="an">Name</label><input id="an" value={name} onChange={(e) => setName(e.target.value)} required /></div>
        <div className="field" style={{ margin: 0 }}><label htmlFor="ac">Currency</label><input id="ac" value={currency} onChange={(e) => setCurrency(e.target.value)} style={{ width: 90 }} /></div>
        <div className="field" style={{ margin: 0 }}><label htmlFor="ab">Starting balance</label><input id="ab" type="number" step="any" value={startingBalance} onChange={(e) => setStarting(e.target.value)} style={{ width: 130 }} /></div>
        <div className="field" style={{ margin: 0 }}><label htmlFor="ak">Kind</label>
          <select id="ak" value={kind} onChange={(e) => setKind(e.target.value as AccountKind)}>
            <option value="live">live</option><option value="backtest">backtest</option><option value="prop">prop</option>
          </select></div>
        <button className="btn primary" type="submit" disabled={create.pending}>Add account</button>
      </form>
      {create.error && <div className="error-box" role="alert" style={{ marginTop: 10 }}>{create.error}</div>}
      {demoMode && <p className="hintbar" style={{ marginTop: 8 }}>Demo mode: new accounts are in-memory and reset on reload.</p>}
    </div>
  );
}

function BalanceSection(): JSX.Element {
  const { api, selectedAccountId, selectedAccount } = useApp();
  const id = selectedAccountId!; // pages render only when an account is selected (see Shell)
  const ccy = selectedAccount?.currency ?? 'USD';
  const bal = useQuery(() => api.getBalance(id), [id]);
  const txs = useQuery(() => api.listBalanceTransactions(id), [id]);
  const add = useMutation((tx: { amount: number; kind: 'deposit' | 'withdrawal' | 'fee' | 'payout' | 'adjustment'; note?: string }) => api.addBalanceTransaction(id, tx));
  const [amount, setAmount] = useState('');
  const [kind, setKind] = useState<'deposit' | 'withdrawal' | 'fee' | 'payout' | 'adjustment'>('deposit');
  const [note, setNote] = useState('');

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const res = await add.run({ amount: Number(amount), kind, note: note || undefined });
    if (res !== undefined) { setAmount(''); setNote(''); bal.refetch(); txs.refetch(); }
  };

  return (
    <div className="card">
      <div className="row between"><h3>Balance - {selectedAccount?.name}</h3>
        <Query result={bal}>{(b) => <div className="mono" style={{ fontSize: '1.2rem', fontWeight: 650 }}>{money(b.balance, ccy)}</div>}</Query>
      </div>
      <p className="hintbar" style={{ marginTop: 0 }}>Balance = starting balance + realized net P&L + balance transactions (computed by the backend).</p>
      <form className="row" onSubmit={submit} style={{ alignItems: 'flex-end' }}>
        <div className="field" style={{ margin: 0 }}><label htmlFor="bamt">Amount (+/-)</label><input id="bamt" type="number" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} required style={{ width: 130 }} /></div>
        <div className="field" style={{ margin: 0 }}><label htmlFor="bk">Kind</label>
          <select id="bk" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="deposit">deposit</option><option value="withdrawal">withdrawal</option><option value="fee">fee</option><option value="payout">payout</option><option value="adjustment">adjustment</option>
          </select></div>
        <div className="field" style={{ margin: 0, flex: 1 }}><label htmlFor="bn">Note</label><input id="bn" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <button className="btn" type="submit" disabled={add.pending}>Add</button>
      </form>
      {add.error && <div className="error-box" role="alert" style={{ marginTop: 10 }}>{add.error}</div>}
      <Query result={txs} isEmpty={(t) => t.items.length === 0} emptyTitle="No balance transactions">
        {(list) => (
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table>
              <thead><tr><th>Date</th><th>Kind</th><th className="num">Amount</th><th>Note</th></tr></thead>
              <tbody>{list.items.map((t) => (
                <tr key={t.id}><td>{dateOnly(t.timestamp)}</td><td>{t.kind}</td><td className={`num ${t.amount >= 0 ? 'pos' : 'neg'}`}>{money(t.amount, ccy)}</td><td>{t.note ?? ''}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Query>
    </div>
  );
}

function StrategiesSection(): JSX.Element {
  const { api } = useApp();
  const q = useQuery(() => api.listStrategies(), []);
  const create = useMutation((input: { name: string; rules?: string[] }) => api.createStrategy(input));
  const [name, setName] = useState('');
  const [rules, setRules] = useState('');
  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const res = await create.run({ name: name.trim(), rules: rules.split('\n').map((r) => r.trim()).filter(Boolean) });
    if (res !== undefined) { setName(''); setRules(''); q.refetch(); }
  };
  return (
    <div className="card">
      <h3>Strategies / Playbooks</h3>
      <Query result={q} isEmpty={(s) => s.length === 0} emptyTitle="No strategies yet">
        {(list) => <ul>{list.map((s) => <li key={s.id}><strong>{s.name}</strong>{s.rules?.length ? <span className="dim"> - {s.rules.join('; ')}</span> : null}</li>)}</ul>}
      </Query>
      <form className="row" onSubmit={submit} style={{ alignItems: 'flex-end', marginTop: 10 }}>
        <div className="field" style={{ margin: 0 }}><label htmlFor="sn">Name</label><input id="sn" value={name} onChange={(e) => setName(e.target.value)} required /></div>
        <div className="field" style={{ margin: 0, flex: 1 }}><label htmlFor="sr">Rules (one per line)</label><input id="sr" value={rules} onChange={(e) => setRules(e.target.value)} /></div>
        <button className="btn primary" type="submit" disabled={create.pending}>Add</button>
      </form>
      {create.error && <div className="error-box" role="alert" style={{ marginTop: 10 }}>{create.error}</div>}
    </div>
  );
}

function TagsSection(): JSX.Element {
  const { api } = useApp();
  const q = useQuery(() => api.listTags(), []);
  const create = useMutation((input: { label: string; category: Tag['category'] }) => api.createTag(input));
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState<Tag['category']>('setup');
  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const res = await create.run({ label: label.trim(), category });
    if (res !== undefined) { setLabel(''); q.refetch(); }
  };
  return (
    <div className="card">
      <h3>Tags</h3>
      <Query result={q} isEmpty={(t) => t.length === 0} emptyTitle="No tags yet">
        {(list) => <div>{list.map((t) => <span key={t.id} className="tag">{t.label} <span className="dim">- {t.category}</span></span>)}</div>}
      </Query>
      <form className="row" onSubmit={submit} style={{ alignItems: 'flex-end', marginTop: 10 }}>
        <div className="field" style={{ margin: 0 }}><label htmlFor="tl">Label</label><input id="tl" value={label} onChange={(e) => setLabel(e.target.value)} required /></div>
        <div className="field" style={{ margin: 0 }}><label htmlFor="tc">Category</label>
          <select id="tc" value={category} onChange={(e) => setCategory(e.target.value as Tag['category'])}>
            <option value="setup">setup</option><option value="mistake">mistake</option><option value="emotion">emotion</option><option value="custom">custom</option>
          </select></div>
        <button className="btn primary" type="submit" disabled={create.pending}>Add</button>
      </form>
      {create.error && <div className="error-box" role="alert" style={{ marginTop: 10 }}>{create.error}</div>}
    </div>
  );
}
