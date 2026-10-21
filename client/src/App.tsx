import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { TokenGate } from './components/TokenGate';
import { ToastViewport } from './components/ToastViewport';
import { useLibrary } from './store/LibraryContext';
import { DashboardPage } from './pages/DashboardPage';
import { AssetsPage } from './pages/AssetsPage';
import { CollectionsPage } from './pages/CollectionsPage';
import { CollectionDetailPage } from './pages/CollectionDetailPage';
import { UploadsPage } from './pages/UploadsPage';
import { SettingsPage } from './pages/SettingsPage';

export function App() {
  const { needsToken, capsLoading } = useLibrary();

  if (capsLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <div className="flex items-center gap-2 text-sm text-muted">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          Starting GameVault…
        </div>
      </div>
    );
  }

  if (needsToken) {
    return (
      <>
        <TokenGate />
        <ToastViewport />
      </>
    );
  }

  return (
    <>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="assets" element={<AssetsPage />} />
          <Route path="collections" element={<CollectionsPage />} />
          <Route path="collections/:name" element={<CollectionDetailPage />} />
          <Route path="uploads" element={<UploadsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <ToastViewport />
    </>
  );
}
