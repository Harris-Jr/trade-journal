import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { useApp } from '../state/app.js';
import { useQuery, useMutation } from '../hooks/useQuery.js';
import { Query } from '../components/states.js';
import { dateTime } from '../format.js';
import type { Note } from '../api/types.js';

export function Notebook(): JSX.Element {
  const { api, selectedAccountId } = useApp();
  const id = selectedAccountId!;
  const [params] = useSearchParams();
  const linkedTrade = params.get('trade') ?? undefined;

  const q = useQuery(() => api.listNotes(id), [id]);
  const save = useMutation((note: { id?: string; title: string; body?: string; tags?: string[]; tradeId?: string }) => api.saveNote(id, note));
  const del = useMutation((noteId: string) => api.deleteNote(noteId));

  const [editing, setEditing] = useState<Note | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tags, setTags] = useState('');

  const startNew = (): void => { setEditing(null); setTitle(''); setBody(''); setTags(''); };
  const startEdit = (n: Note): void => { setEditing(n); setTitle(n.title); setBody(n.body ?? ''); setTags((n.tags ?? []).join(', ')); };

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!title.trim()) return;
    const payload = {
      id: editing?.id,
      title: title.trim(),
      body: body || undefined,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      tradeId: editing?.tradeId ?? linkedTrade,
    };
    const res = await save.run(payload);
    if (res !== undefined) { startNew(); q.refetch(); }
  };

  const remove = async (noteId: string): Promise<void> => {
    if (!confirm('Delete this note?')) return;
    const res = await del.run(noteId);
    if (res !== undefined) { if (editing?.id === noteId) startNew(); q.refetch(); }
  };

  return (
    <div className="stack">
      <h1>Notebook</h1>
      {linkedTrade && !editing && (
        <div className="card" style={{ padding: '10px 14px' }}>
          New note will be linked to trade <Link to={`/trades/${encodeURIComponent(linkedTrade)}`}>{linkedTrade}</Link>.
        </div>
      )}
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr)' }}>
        <form className="card" onSubmit={submit}>
          <div className="row between"><h3>{editing ? 'Edit note' : 'New note'}</h3>{editing && <button type="button" className="btn sm" onClick={startNew}>New</button>}</div>
          <div className="field"><label htmlFor="nt">Title</label>
            <input id="nt" value={title} onChange={(e) => setTitle(e.target.value)} required /></div>
          <div className="field"><label htmlFor="nb">Body</label>
            <textarea id="nb" rows={8} value={body} onChange={(e) => setBody(e.target.value)} /></div>
          <div className="field"><label htmlFor="ng">Tags (comma-separated)</label>
            <input id="ng" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="plan, review" /></div>
          {save.error && <div className="error-box" role="alert" style={{ marginBottom: 10 }}>{save.error}</div>}
          <button className="btn primary" type="submit" disabled={save.pending}>{save.pending ? 'Saving...' : editing ? 'Update note' : 'Create note'}</button>
        </form>

        <Query result={q} isEmpty={(n) => n.items.length === 0} emptyTitle="No notes yet" emptyHint="Create your first note.">
          {(notes) => (
            <div className="stack">
              {notes.items.map((n) => (
                <div key={n.id} className="card">
                  <div className="row between">
                    <strong>{n.title}</strong>
                    <span className="dim" style={{ fontSize: '0.8em' }}>{dateTime(n.updatedAt)}</span>
                  </div>
                  {n.body && <p style={{ whiteSpace: 'pre-wrap', margin: '6px 0' }}>{n.body}</p>}
                  <div className="row between">
                    <div>{(n.tags ?? []).map((t) => <span key={t} className="tag">{t}</span>)}
                      {n.tradeId && <Link className="badge" to={`/trades/${encodeURIComponent(n.tradeId)}`} style={{ marginLeft: 6, display: 'inline-flex', alignItems: 'center', gap: 3 }}><ExternalLink size={12} /> trade</Link>}</div>
                    <div className="row" style={{ gap: 6 }}>
                      <button className="btn sm" onClick={() => startEdit(n)}>Edit</button>
                      <button className="btn sm danger" onClick={() => remove(n.id)} disabled={del.pending}>Delete</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Query>
      </div>
    </div>
  );
}
