import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { useApp } from '../state/app.js';

export function Login(): JSX.Element {
  const { login, register, setDemoMode } = useApp();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      if (mode === 'login') await login(email, password);
      else await register(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setPending(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div className="card" style={{ width: '100%', maxWidth: 380 }}>
        <div className="brand" style={{ padding: '0 0 14px' }}><span className="dot" aria-hidden="true" /> Trade Journal</div>
        <div className="segmented" role="group" aria-label="Auth mode" style={{ marginBottom: 14 }}>
          <button aria-pressed={mode === 'login'} onClick={() => setMode('login')}>Sign in</button>
          <button aria-pressed={mode === 'register'} onClick={() => setMode('register')}>Create account</button>
        </div>
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required style={{ width: '100%' }} />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} style={{ width: '100%' }} />
            {mode === 'register' && <span className="hintbar">At least 8 characters.</span>}
          </div>
          {error && <div className="error-box" role="alert" style={{ marginBottom: 10 }}>{error}</div>}
          <button className="btn primary" type="submit" disabled={pending} style={{ width: '100%' }}>
            {pending ? 'Please wait...' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>
        <div className="row between" style={{ marginTop: 14 }}>
          <span className="hintbar">Self-hosted - local account</span>
          <button className="btn sm" onClick={() => setDemoMode(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Explore demo <ArrowRight size={14} /></button>
        </div>
      </div>
    </div>
  );
}
