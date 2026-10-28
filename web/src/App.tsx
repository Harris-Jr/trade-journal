import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppProvider, useApp } from './state/app.js';
import { Shell } from './components/Shell.js';
import { Login } from './pages/Login.js';
import { Loading } from './components/states.js';
import { Dashboard } from './pages/Dashboard.js';
import { TradeLog } from './pages/TradeLog.js';
import { TradeDetail } from './pages/TradeDetail.js';
import { AddTrade } from './pages/AddTrade.js';
import { Journal } from './pages/Journal.js';
import { Notebook } from './pages/Notebook.js';
import { Reports } from './pages/Reports.js';
import { ProgressTracker } from './pages/ProgressTracker.js';
import { Playbooks } from './pages/Playbooks.js';
import { PlaybookDetail } from './pages/PlaybookDetail.js';
import { Insights } from './pages/Insights.js';
import { Import } from './pages/Import.js';
import { Settings } from './pages/Settings.js';

function Gate(): JSX.Element {
  const { authReady, authenticated } = useApp();
  if (!authReady) return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><Loading label="Starting..." /></div>;
  if (!authenticated) return <Login />;
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Dashboard />} />
          <Route path="trades" element={<TradeLog />} />
          <Route path="trades/:tradeId" element={<TradeDetail />} />
          <Route path="add" element={<AddTrade />} />
          <Route path="journal" element={<Journal />} />
          <Route path="notebook" element={<Notebook />} />
          <Route path="reports" element={<Reports />} />
          <Route path="playbooks" element={<Playbooks />} />
          <Route path="playbooks/:id" element={<PlaybookDetail />} />
          <Route path="insights" element={<Insights />} />
          <Route path="progress" element={<ProgressTracker />} />
          <Route path="import" element={<Import />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export function App(): JSX.Element {
  return (
    <AppProvider>
      <Gate />
    </AppProvider>
  );
}
