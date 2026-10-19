import { lazy, Suspense, useState } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { ConnectionBanner } from './components/layout/ConnectionBanner';
import { ErrorBoundary } from './components/layout/ErrorBoundary';
import { SettingsDialog } from './components/layout/SettingsDialog';
import { TopNav } from './components/layout/TopNav';
import { Skeleton } from './components/ui/Skeleton';
import { Console } from './pages/Console';
import { NotFound } from './pages/NotFound';

// The Arena pulls in the canvas engine and game logic; most visits never open it.
const Arena = lazy(() => import('./pages/Arena').then((m) => ({ default: m.Arena })));

function RouteFallback() {
  return (
    <div role="status" aria-label="Loading page" className="flex flex-col gap-6">
      <Skeleton className="h-9 w-56" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-[360px] w-full" />
    </div>
  );
}

export default function App() {
  const location = useLocation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const openSettings = () => setSettingsOpen(true);
  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-2 focus:z-60 focus:rounded-control focus:bg-accent focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-accent-ink"
      >
        Skip to content
      </a>
      <TopNav onOpenSettings={openSettings} />
      <ConnectionBanner onOpenSettings={openSettings} />
      {/* tabIndex -1 lets a closing dialog park focus here when its opener has been removed. */}
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-page px-4 py-8 outline-none sm:px-gutter sm:py-12">
        {/* Keyed by pathname so navigating away from a crashed page clears the error. */}
        <ErrorBoundary key={location.pathname}>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<Console />} />
              <Route path="/arena" element={<Arena />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </main>
      {/* Rendered outside the header: its backdrop-filter would otherwise become the containing block for the fixed overlay. */}
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}
