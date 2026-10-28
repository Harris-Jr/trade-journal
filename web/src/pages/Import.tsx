import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useApp } from '../state/app.js';
import { useMutation } from '../hooks/useQuery.js';
import type { ImportResult, InstrumentType } from '../api/types.js';

const SAMPLE = `Account,Symbol,Type,Side,Qty,Price,Time,Commission,Multiplier
A1,AAPL,stock,buy,100,180.00,2024-03-01T14:30:00Z,1,
A1,AAPL,stock,sell,100,183.50,2024-03-01T15:10:00Z,1,
A1,ES,future,buy,2,5100.00,2024-03-05T14:35:00Z,4,50
A1,ES,future,sell,2,5088.00,2024-03-05T15:05:00Z,4,50`;

const INSTRUMENTS: InstrumentType[] = ['stock', 'option', 'future', 'forex', 'crypto'];

export function Import(): JSX.Element {
  const { api, selectedAccountId, selectedAccount } = useApp();
  const id = selectedAccountId!;
  const run = useMutation((args: { csv: string; defaults?: { instrumentType?: InstrumentType; multiplier?: number } }) =>
    api.importCsv(id, args.csv, args.defaults));

  const [csv, setCsv] = useState('');
  const [defType, setDefType] = useState<string>('');
  const [defMult, setDefMult] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [fileName, setFileName] = useState('');

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    setCsv(await f.text());
  };

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setResult(null);
    const defaults: { instrumentType?: InstrumentType; multiplier?: number } = {};
    if (defType) defaults.instrumentType = defType as InstrumentType;
    if (defMult) defaults.multiplier = Number(defMult);
    const res = await run.run({ csv, defaults: Object.keys(defaults).length ? defaults : undefined });
    if (res !== undefined) setResult(res);
  };

  return (
    <div className="stack" style={{ maxWidth: 900 }}>
      <h1>Import Trades (CSV)</h1>
      <div className="card">
        <h3>Generic CSV format</h3>
        <p className="dim" style={{ marginTop: 0 }}>
          Columns (case-insensitive, aliases accepted): <code>symbol, instrument_type, side, quantity, price,
          timestamp</code>, optional <code>account, multiplier, commission, fees, swap</code>. Executions-level
          (one row per fill); the engine aggregates them into trades. Importing into <strong>{selectedAccount?.name}</strong>.
        </p>
        <button className="btn sm" type="button" onClick={() => setCsv(SAMPLE)}>Load sample</button>
      </div>

      <form className="card" onSubmit={submit}>
        <div className="field">
          <label htmlFor="file">Upload a file</label>
          <input id="file" type="file" accept=".csv,text/csv,text/plain" onChange={onFile} />
          {fileName && <span className="hintbar"> {fileName}</span>}
        </div>
        <div className="field">
          <label htmlFor="csv">...or paste CSV</label>
          <textarea id="csv" rows={10} value={csv} onChange={(e) => setCsv(e.target.value)} spellCheck={false} style={{ fontFamily: 'ui-monospace, monospace' }} />
        </div>
        <div className="row" style={{ gap: 12 }}>
          <div className="field"><label htmlFor="dt">Default instrument type (if column missing)</label>
            <select id="dt" value={defType} onChange={(e) => setDefType(e.target.value)}>
              <option value="">(none)</option>
              {INSTRUMENTS.map((i) => <option key={i} value={i}>{i}</option>)}
            </select></div>
          <div className="field"><label htmlFor="dm">Default multiplier</label>
            <input id="dm" type="number" step="any" value={defMult} onChange={(e) => setDefMult(e.target.value)} placeholder="1" /></div>
        </div>
        {run.error && <div className="error-box" role="alert" style={{ marginBottom: 10 }}>{run.error}</div>}
        <button className="btn primary" type="submit" disabled={run.pending || !csv.trim()}>
          {run.pending ? 'Importing...' : 'Import'}
        </button>
      </form>

      {result && (
        <div className="card">
          <h3>Import summary</h3>
          <div className="row" style={{ gap: 24 }}>
            <div><div className="k dim">Imported fills</div><div className="v mono pos" style={{ fontSize: '1.4rem' }}>{result.imported}</div></div>
            <div><div className="k dim">Rows with errors</div><div className={`v mono ${result.errors.length ? 'neg' : ''}`} style={{ fontSize: '1.4rem' }}>{result.errors.length}</div></div>
          </div>
          {result.errors.length > 0 && (
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table>
                <thead><tr><th>Row</th><th>Problem</th></tr></thead>
                <tbody>
                  {result.errors.map((err) => (
                    <tr key={err.row}><td className="num">{err.row}</td><td className="neg">{err.message}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {result.imported > 0 && (
            <p style={{ marginTop: 12 }}><Link className="btn primary" to="/trades" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>View imported trades <ArrowRight size={14} /></Link></p>
          )}
        </div>
      )}
    </div>
  );
}
