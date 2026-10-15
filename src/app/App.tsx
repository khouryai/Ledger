import { lazy, Suspense } from 'react';
import { AppProvider, useApp } from './state';
import { useHashRoute } from './router';
import { Layout } from './components/Layout';
import { Setup } from './screens/Setup';
import { Today } from './screens/Today';
import { Items } from './screens/Items';

/*
 * Today and the lists load with the app; everything else when first opened. The
 * single-file build inlines all of it, so it is the same either way there.
 */
const People = lazy(() => import('./screens/People').then((m) => ({ default: m.People })));
const Meetings = lazy(() => import('./screens/Meetings').then((m) => ({ default: m.Meetings })));
const Capture = lazy(() => import('./screens/Capture').then((m) => ({ default: m.Capture })));
const Review = lazy(() => import('./screens/Review').then((m) => ({ default: m.Review })));
const Outlook = lazy(() => import('./screens/Outlook').then((m) => ({ default: m.Outlook })));
const Settings = lazy(() => import('./screens/Settings').then((m) => ({ default: m.Settings })));

function Loading() {
  return <div className="p-8 text-[13px] text-[var(--text-subtle)]">Loading…</div>;
}

function Shell() {
  const { state } = useApp();
  const route = useHashRoute();
  if (state.status !== 'ready') return <Setup />;
  let screen: React.ReactNode;
  switch (route.screen) {
    case 'owe':
    case 'wait':
    case 'all':
      screen = <Items route={route} />;
      break;
    case 'people':
      screen = <People route={route} />;
      break;
    case 'meetings':
      screen = <Meetings route={route} />;
      break;
    case 'capture':
      screen = <Capture />;
      break;
    case 'review':
      screen = <Review />;
      break;
    case 'outlook':
      screen = <Outlook />;
      break;
    case 'settings':
      screen = <Settings />;
      break;
    default:
      screen = <Today />;
  }
  return (
    <Layout screen={route.screen === 'dashboard' ? 'today' : route.screen}>
      <Suspense fallback={<Loading />}>{screen}</Suspense>
    </Layout>
  );
}

export function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
