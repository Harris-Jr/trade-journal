import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../state/app.js';
import { useMutation } from '../hooks/useQuery.js';
import type { ExecutionInput, InstrumentType } from '../api/types.js';

const INSTRUMENTS: InstrumentType[] = ['stock', 'option', 'future', 'forex', 'crypto'];
const toMs = (local: string): number => (local ? new Date(local).getTime() : Date.now());

export function AddTrade(): JSX.Element {
  const { api, selectedAccountId, selectedAccount } = useApp();
  const navigate = useNavigate();
  const id = selectedAccountId!;
  const add = useMutation((execs: ExecutionInput[]) => api.addExecutions(id, execs));

  const [symbol, setSymbol] = useState('');
  const [instrumentType, setInstrument] = useState<InstrumentType>('stock');
  const [multiplier, setMultiplier] = useState('1');
  const [direction, setDirection] = useState<'long' | 'short'>('long');
  const [quantity, setQuantity] = useState('');
  const [entryPrice, setEntryPrice] = useState('');
  const [entryTime, setEntryTime] = useState('');
  const [entryComm, setEntryComm] = useState('0');
  const [closed, setClosed] = useState(true);
  const [exitPrice, setExitPrice] = useState('');
  const [exitTime, setExitTime] = useState('');
  const [exitComm, setExitComm] = useState('0');
  const [formError, setFormError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setFormError(null);
    const qty = Number(quantity);
    if (!symbol.trim()) return setFormError('Symbol is required.');
    if (!(qty > 0)) return setFormError('Quantity must be greater than 0.');
    if (!(Number(entryPrice) >= 0)) return setFormError('Entry price is invalid.');
    const mult = Number(multiplier) || 1;
    const entrySide = direction === 'long' ? 'buy' : 'sell';
    const base = { symbol: symbol.trim().toUpperCase(), instrumentType, quantity: qty, multiplier: mult } as const;

    const execs: ExecutionInput[] = [
      { ...base, side: entrySide, price: Number(entryPrice), timestamp: toMs(entryTime), commission: Number(entryComm) || 0 },
    ];
    if (closed) {
      if (!(Number(exitPrice) >= 0)) return setFormError('Exit price is invalid.');
      execs.push({ ...base, side: entrySide === 'buy' ? 'sell' : 'buy', price: Number(exitPrice), timestamp: toMs(exitTime || entryTime), commission: Number(exitComm) || 0 });
    }
    const res = await add.run(execs);
    if (res !== undefined) navigate('/trades');
  };

  return (
    <div className="stack" style={{ maxWidth: 680 }}>
      <h1>Add Trade</h1>
      <p className="hintbar">
        Logs the trade as broker-style executions through the existing API. The trade engine then
        derives direction, average prices and P&L - this form never computes P&L itself. Use{' '}
        <a href="#/import" onClick={(e) => { e.preventDefault(); navigate('/import'); }}>Import</a> for bulk history.
      </p>
      <form className="card" onSubmit={submit}>
        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 2 }}><label htmlFor="sym">Symbol</label>
            <input id="sym" value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="AAPL" required /></div>
          <div className="field" style={{ flex: 1 }}><label htmlFor="inst">Instrument</label>
            <select id="inst" value={instrumentType} onChange={(e) => setInstrument(e.target.value as InstrumentType)}>
              {INSTRUMENTS.map((i) => <option key={i} value={i}>{i}</option>)}
            </select></div>
          <div className="field" style={{ flex: 1 }}><label htmlFor="mult">Multiplier</label>
            <input id="mult" type="number" step="any" value={multiplier} onChange={(e) => setMultiplier(e.target.value)} /></div>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 1 }}><label htmlFor="dir">Direction</label>
            <select id="dir" value={direction} onChange={(e) => setDirection(e.target.value as 'long' | 'short')}>
              <option value="long">Long</option><option value="short">Short</option>
            </select></div>
          <div className="field" style={{ flex: 1 }}><label htmlFor="qty">Quantity</label>
            <input id="qty" type="number" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} required /></div>
        </div>

        <h3 style={{ marginTop: 6 }}>Entry</h3>
        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 1 }}><label htmlFor="ep">Price</label>
            <input id="ep" type="number" step="any" value={entryPrice} onChange={(e) => setEntryPrice(e.target.value)} required /></div>
          <div className="field" style={{ flex: 2 }}><label htmlFor="et">Time</label>
            <input id="et" type="datetime-local" value={entryTime} onChange={(e) => setEntryTime(e.target.value)} /></div>
          <div className="field" style={{ flex: 1 }}><label htmlFor="ec">Commission</label>
            <input id="ec" type="number" step="any" value={entryComm} onChange={(e) => setEntryComm(e.target.value)} /></div>
        </div>

        <label className="row" style={{ gap: 8, marginBottom: 10 }}>
          <input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} /> Trade is closed (add exit)
        </label>

        {closed && (
          <>
            <h3>Exit</h3>
            <div className="row" style={{ gap: 12 }}>
              <div className="field" style={{ flex: 1 }}><label htmlFor="xp">Price</label>
                <input id="xp" type="number" step="any" value={exitPrice} onChange={(e) => setExitPrice(e.target.value)} /></div>
              <div className="field" style={{ flex: 2 }}><label htmlFor="xt">Time</label>
                <input id="xt" type="datetime-local" value={exitTime} onChange={(e) => setExitTime(e.target.value)} /></div>
              <div className="field" style={{ flex: 1 }}><label htmlFor="xc">Commission</label>
                <input id="xc" type="number" step="any" value={exitComm} onChange={(e) => setExitComm(e.target.value)} /></div>
            </div>
          </>
        )}

        {(formError || add.error) && <div className="error-box" role="alert" style={{ marginBottom: 10 }}>{formError ?? add.error}</div>}
        <div className="row">
          <button className="btn primary" type="submit" disabled={add.pending}>{add.pending ? 'Saving...' : 'Add trade'}</button>
          <span className="hintbar">Account: {selectedAccount?.name}</span>
        </div>
      </form>
    </div>
  );
}
