import { useState } from 'react';
import { Star } from 'lucide-react';
import { useApp } from '../state/app.js';
import { useQuery, useMutation } from '../hooks/useQuery.js';
import { Query } from '../components/states.js';
import { dateOnly } from '../format.js';

const todayIso = (): string => new Date().toISOString().slice(0, 10);

function StarRating({ value }: { value: number }): JSX.Element {
  return (
    <span className="row" style={{ gap: 1 }} aria-label={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={15} fill={n <= value ? 'var(--warn)' : 'none'} color="var(--warn)" />
      ))}
    </span>
  );
}

export function Journal(): JSX.Element {
  const { api, selectedAccountId } = useApp();
  const id = selectedAccountId!;
  const q = useQuery(() => api.listJournal(id), [id]);
  const save = useMutation((entry: { date: string; body?: string; rating?: number }) => api.saveJournal(id, entry));

  const [date, setDate] = useState(todayIso());
  const [body, setBody] = useState('');
  const [rating, setRating] = useState(3);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const res = await save.run({ date, body: body || undefined, rating });
    if (res !== undefined) { setBody(''); q.refetch(); }
  };

  return (
    <div className="stack" style={{ maxWidth: 820 }}>
      <h1>Daily Journal</h1>
      <form className="card" onSubmit={submit}>
        <div className="row" style={{ gap: 12 }}>
          <div className="field"><label htmlFor="jd">Date</label>
            <input id="jd" type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></div>
          <div className="field"><label htmlFor="jr">Day rating</label>
            <select id="jr" value={rating} onChange={(e) => setRating(Number(e.target.value))}>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} / 5</option>)}
            </select></div>
        </div>
        <div className="field"><label htmlFor="jb">Entry</label>
          <textarea id="jb" rows={5} value={body} onChange={(e) => setBody(e.target.value)} placeholder="How did the session go? What went well, what to improve..." /></div>
        {save.error && <div className="error-box" role="alert" style={{ marginBottom: 10 }}>{save.error}</div>}
        <button className="btn primary" type="submit" disabled={save.pending}>{save.pending ? 'Saving...' : 'Save entry'}</button>
        <span className="hintbar" style={{ marginLeft: 10 }}>Saving an existing date updates that day's entry.</span>
      </form>

      <Query result={q} isEmpty={(e) => e.items.length === 0} emptyTitle="No journal entries yet" emptyHint="Write your first daily entry above.">
        {(entries) => (
          <div className="stack">
            {entries.items.map((e) => (
              <div key={e.id} className="card">
                <div className="row between">
                  <strong>{dateOnly(Date.parse(`${e.date}T00:00:00Z`))}</strong>
                  {e.rating !== undefined && <StarRating value={e.rating} />}
                </div>
                {e.body && <p style={{ whiteSpace: 'pre-wrap', margin: '8px 0 0' }}>{e.body}</p>}
              </div>
            ))}
          </div>
        )}
      </Query>
    </div>
  );
}
