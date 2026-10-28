import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Plus, ArchiveRestore } from 'lucide-react';
import { useApp } from '../state/app.js';
import { useQuery } from '../hooks/useQuery.js';
import { Query } from '../components/states.js';
import { PlaybookForm } from '../components/PlaybookForm.js';
import type { Playbook, PlaybookStatus } from '../api/types.js';

export function Playbooks(): JSX.Element {
  const { api } = useApp();
  const [status, setStatus] = useState<PlaybookStatus>('active');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);

  const q = useQuery(() => api.listPlaybooks({ status, search: search.trim() || undefined, sort: 'name' }), [status, search]);

  return (
    <div className="stack">
      <div className="row between">
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><BookOpen size={22} /> Playbooks</h1>
        <button className="btn primary" onClick={() => setCreating(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Plus size={16} /> New playbook
        </button>
      </div>
      <p className="hintbar" style={{ maxWidth: 760 }}>
        A playbook documents a trading setup and its rules. Assign trades to a playbook from the trade detail view,
        then review performance per playbook. Playbooks are the detailed successor to the lightweight Strategy field; tags and setup labels still work alongside them.
      </p>

      <div className="row">
        <input type="search" placeholder="Search playbooks..." value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search playbooks" style={{ minWidth: 220 }} />
        <div className="segmented" role="group" aria-label="Status">
          <button aria-pressed={status === 'active'} onClick={() => setStatus('active')}>Active</button>
          <button aria-pressed={status === 'archived'} onClick={() => setStatus('archived')}>Archived</button>
        </div>
      </div>

      <Query result={q} isEmpty={(ps) => ps.length === 0}
        emptyTitle={status === 'active' ? 'No playbooks yet' : 'No archived playbooks'}
        emptyHint={status === 'active' ? 'Create a playbook to document a setup and track how it performs.' : 'Archived playbooks will appear here.'}
        emptyAction={status === 'active' ? <button className="btn primary" onClick={() => setCreating(true)}>Create your first playbook</button> : undefined}>
        {(playbooks) => (
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
            {playbooks.map((p) => <PlaybookCard key={p.id} playbook={p} />)}
          </div>
        )}
      </Query>

      {creating && <PlaybookForm initial={null} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); q.refetch(); }} />}
    </div>
  );
}

function PlaybookCard({ playbook: p }: { playbook: Playbook }): JSX.Element {
  const meta = [p.direction, p.timeframe, p.category].filter(Boolean);
  return (
    <Link to={`/playbooks/${encodeURIComponent(p.id)}`} className="card" style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
      <div className="row between">
        <strong>{p.name}</strong>
        {p.status === 'archived' && <span className="chip"><ArchiveRestore size={12} /> Archived</span>}
      </div>
      {p.description && <p className="dim" style={{ margin: '6px 0', fontSize: '0.88em' }}>{p.description}</p>}
      <div className="row" style={{ gap: 4, marginTop: 6 }}>
        {meta.map((m) => <span key={m} className="badge">{m}</span>)}
        {(p.symbols ?? []).slice(0, 4).map((s) => <span key={s} className="tag">{s}</span>)}
      </div>
    </Link>
  );
}
