import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'flowbite-react';
import { meltekTheme } from './shared/flowbite-theme';
import {
  createRootRoute, createRoute, createRouter, Outlet, RouterProvider,
} from '@tanstack/react-router';
import { Shell } from './shared/Shell';
import { Dashboard } from './design/Dashboard';
import { Button, Card, EmptyState, Skeleton } from './shared/primitives';
import { AuthGate } from './auth/AuthGate';
import './index.css';
import './app-theme.css';
import './calculator-theme.css';
import { validateAdminSearch } from './admin/adminTabs';

const NewDesign = lazy(() => import('./design/NewDesign').then(module => ({ default: module.NewDesign })));
const Register = lazy(() => import('./auth/Register').then(module => ({ default: module.Register })));
const DesignDetail = lazy(() => import('./design/DesignDetail').then(module => ({ default: module.DesignDetail })));
const Admin = lazy(() => import('./admin/Admin').then(module => ({ default: module.Admin })));

const rootRoute = createRootRoute({
  component: () => <Shell><Suspense fallback={<Card><div className="p-5 flex flex-col gap-4" role="status" aria-label="Loading page"><Skeleton className="h-8 w-48" /><Skeleton className="h-40 w-full" /></div></Card>}><Outlet /></Suspense></Shell>,
  errorComponent: () => <div className="route-state" role="alert"><span className="eyebrow">WORKSPACE INTERRUPTED</span><h1>This page could not be displayed</h1><p>Reload the workspace to try again. Your saved designs remain in the register.</p><Button variant="primary" onClick={() => window.location.reload()}>Reload workspace</Button></div>,
  notFoundComponent: () => (
    <Card><EmptyState title="That page does not exist">
      Use the navigation menu to open the dashboard, calculator or design register.
    </EmptyState></Card>
  ),
});

const routes = [
  createRoute({ getParentRoute: () => rootRoute, path: '/', component: Dashboard }),
  createRoute({ getParentRoute: () => rootRoute, path: '/calculator', component: NewDesign }),
  createRoute({ getParentRoute: () => rootRoute, path: '/design/new', component: NewDesign }),
  createRoute({ getParentRoute: () => rootRoute, path: '/register', component: Register }),
  createRoute({ getParentRoute: () => rootRoute, path: '/designs/$id', component: DesignDetail }),
  createRoute({ getParentRoute: () => rootRoute, path: '/admin', validateSearch: validateAdminSearch, component: Admin }),
];

const router = createRouter({ routeTree: rootRoute.addChildren(routes) });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={meltekTheme}>
        <AuthGate>
          <RouterProvider router={router} />
        </AuthGate>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
