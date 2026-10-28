import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App.js';

beforeEach(() => {
  localStorage.clear();
  window.history.pushState({}, '', '/');
});
afterEach(() => vi.unstubAllGlobals());

describe('Demo-mode happy path', () => {
  beforeEach(() => localStorage.setItem('tj.demo', '1'));

  it('loads the dashboard with backend-consistent stats and navigates to the trade log', async () => {
    const user = userEvent.setup();
    render(<App />);

    // Account selector resolves to the demo account.
    expect(await screen.findByRole('combobox', { name: 'Account' })).toHaveValue('demo-account');

    // Dashboard tiles render (computed by the shared engine, not mocked numbers).
    // These labels also appear in the Health Score panel, so allow multiple matches.
    expect((await screen.findAllByText('Net P&L')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('Win rate')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('Profit factor')).length).toBeGreaterThan(0);
    expect(await screen.findByText('Expectancy')).toBeInTheDocument();

    // Navigate to Trade Log.
    await user.click(screen.getByRole('link', { name: /Trade Log/i }));
    const heading = await screen.findByRole('heading', { name: 'Trade Log' });
    expect(heading).toBeInTheDocument();

    // Table has trades.
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    const bodyRows = within(screen.getByRole('table')).getAllByRole('row');
    expect(bodyRows.length).toBeGreaterThan(1);
  });

  it('search filters the trade log', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', '/trades');
    render(<App />);

    await screen.findByRole('heading', { name: 'Trade Log' });
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());

    const search = screen.getByRole('searchbox', { name: /search trades/i });
    await user.type(search, 'AAPL');

    await waitFor(() => {
      const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1); // drop header
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) expect(r.textContent).toContain('AAPL');
    });
  });

  it('value-unit selector reprojects the P&L column (Stage 4)', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', '/trades');
    render(<App />);
    await screen.findByRole('heading', { name: 'Trade Log' });
    await user.selectOptions(screen.getByRole('combobox', { name: /value unit/i }), 'R');
    expect(await screen.findByText('P&L (R)')).toBeInTheDocument();
  });

  it('saves and lists a trade filter (Stage 3)', async () => {
    const user = userEvent.setup();
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('My winners');
    window.history.pushState({}, '', '/trades');
    render(<App />);
    await screen.findByRole('heading', { name: 'Trade Log' });
    await user.click(screen.getByRole('button', { name: /save filter/i }));
    expect(await screen.findByRole('button', { name: 'My winners' })).toBeInTheDocument();
    promptSpy.mockRestore();
  });

  it('shows the Progress Tracker with seeded goals (M6.1)', async () => {
    window.history.pushState({}, '', '/progress');
    render(<App />);
    expect(await screen.findByRole('heading', { name: /Progress Tracker/i })).toBeInTheDocument();
    expect(await screen.findByText('Performance')).toBeInTheDocument();
    expect(await screen.findByText('Net P&L')).toBeInTheDocument();
    // progress indicators render
    expect((await screen.findAllByRole('progressbar')).length).toBeGreaterThan(0);
  });

  it('creates a new goal through the sheet (M6.1)', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', '/progress');
    render(<App />);
    await screen.findByRole('heading', { name: /Progress Tracker/i });
    await user.click(screen.getByRole('button', { name: /New goal/i }));
    const dialog = await screen.findByRole('dialog', { name: /New goal/i });
    await user.selectOptions(within(dialog).getByLabelText('Metric'), 'win_rate');
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: /Target/i }), { target: { value: '55' } });
    await user.click(within(dialog).getByRole('button', { name: /Create goal/i }));
    // the new Win rate goal card appears
    await waitFor(() => expect(screen.getByText('Win rate')).toBeInTheDocument());
  });

  it('rejects an invalid goal target with a message (M6.1)', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', '/progress');
    render(<App />);
    await screen.findByRole('heading', { name: /Progress Tracker/i });
    await user.click(screen.getByRole('button', { name: /New goal/i }));
    const dialog = await screen.findByRole('dialog', { name: /New goal/i });
    await user.selectOptions(within(dialog).getByLabelText('Metric'), 'win_rate');
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: /Target/i }), { target: { value: '150' } });
    await user.click(within(dialog).getByRole('button', { name: /Create goal/i }));
    expect(await screen.findByText(/at most 100/i)).toBeInTheDocument();
    // the sheet stays open because creation was rejected
    expect(screen.getByRole('dialog', { name: /New goal/i })).toBeInTheDocument();
  });

  it('lists the seeded playbook and opens its detail (M6.2)', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', '/playbooks');
    render(<App />);
    expect(await screen.findByRole('heading', { name: /Playbooks/i })).toBeInTheDocument();
    await user.click(await screen.findByText('Opening Range Breakout'));
    expect(await screen.findByText(/Performance/i)).toBeInTheDocument();
    expect(await screen.findByText('Linked trades')).toBeInTheDocument();
  });

  it('creates a playbook through the form (M6.2)', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', '/playbooks');
    render(<App />);
    await screen.findByRole('heading', { name: /Playbooks/i });
    await user.click(screen.getByRole('button', { name: /New playbook/i }));
    const dialog = await screen.findByRole('dialog', { name: /New playbook/i });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Mean Reversion' } });
    await user.click(within(dialog).getByRole('button', { name: /Create playbook/i }));
    await waitFor(() => expect(screen.getByText('Mean Reversion')).toBeInTheDocument());
  });

  it('rejects a nameless playbook with a message (M6.2)', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', '/playbooks');
    render(<App />);
    await screen.findByRole('heading', { name: /Playbooks/i });
    await user.click(screen.getByRole('button', { name: /New playbook/i }));
    const dialog = await screen.findByRole('dialog', { name: /New playbook/i });
    await user.click(within(dialog).getByRole('button', { name: /Create playbook/i }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/name is required/i);
  });

  it('renders the Insights page from real computed data (M6.3)', async () => {
    window.history.pushState({}, '', '/insights');
    render(<App />);
    expect(await screen.findByRole('heading', { name: /Insights/i })).toBeInTheDocument();
    // The seeded demo trades produce at least one behavioral flag or an honest empty state.
    await waitFor(() => {
      const hasFlags = screen.queryByText(/flag\(s\) across/i);
      const emptyFlags = screen.queryByText(/No behavioral flags in this range/i);
      const emptyTrades = screen.queryByText(/No closed trades in this range/i);
      expect(hasFlags || emptyFlags || emptyTrades).toBeTruthy();
    });
    // Never silently shows fabricated data: no error alert in the happy path.
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  });

  it('shows prop-firm accounts, summary, and a ledger (M6.4)', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', '/propfirm');
    render(<App />);
    expect(await screen.findByRole('heading', { name: /Prop Firms/i })).toBeInTheDocument();
    expect(await screen.findByText('Fees paid')).toBeInTheDocument(); // summary tile
    await user.click(await screen.findByText('FTMO')); // seeded account
    expect(await screen.findByText('Cash-flow ledger')).toBeInTheDocument();
    // the seeded payout appears as a signed amount in the ledger (unique to the row)
    expect(await screen.findByText('+$2,300.00')).toBeInTheDocument();
  });

  it('creates a prop account and rejects a firmless one (M6.4)', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', '/propfirm');
    render(<App />);
    await screen.findByRole('heading', { name: /Prop Firms/i });
    await user.click(screen.getByRole('button', { name: /New account/i }));
    let dialog = await screen.findByRole('dialog', { name: /New prop account/i });
    await user.click(within(dialog).getByRole('button', { name: /Create account/i }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/firm is required/i);
    fireEvent.change(within(dialog).getByLabelText('Firm'), { target: { value: 'MyFundedFutures' } });
    await user.click(within(dialog).getByRole('button', { name: /Create account/i }));
    await waitFor(() => expect(screen.getByText('MyFundedFutures')).toBeInTheDocument());
  });
});

describe('API error state (authenticated session, data fetch fails)', () => {
  it('shows an error with a retry action instead of silently faking data', async () => {
    // Simulate a valid session: /auth/me succeeds, but the accounts load fails.
    localStorage.setItem('tj.demo', '0');
    localStorage.setItem('tj.token', 'valid-token');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/auth/me')) {
        return new Response(JSON.stringify({ id: 'u1', email: 'u@test.com' }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new TypeError('Failed to fetch');
    }));
    render(<App />);

    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText(/Network error/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    // No trade data is fabricated.
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

describe('Unauthenticated shows the login screen (no fake data)', () => {
  it('renders sign-in when there is no session and not in demo mode', async () => {
    localStorage.setItem('tj.demo', '0');
    render(<App />);
    expect(await screen.findByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
