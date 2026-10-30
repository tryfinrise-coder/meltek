import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'flowbite-react';
import { meltekTheme } from './shared/flowbite-theme';
import {
  createRootRoute, createRoute, createRouter, Outlet, RouterProvider,
} from '@tanstack/react-router';
import { Shell } from './shared/Shell';
import { Dashboard } from './design/Dashboard';
import { NewDesign } from './design/NewDesign';
import { Register } from './auth/Register';
import { DesignDetail } from './design/DesignDetail';
import { Admin } from './admin/Admin';
import { Card, EmptyState } from './shared/primitives';
import { AuthGate } from './auth/AuthGate';
import './index.css';
import './calculator-theme.css';
import { validateAdminSearch } from './admin/adminTabs';

const rootRoute = createRootRoute({
  component: () => <Shell><Outlet /></Shell>,
  notFoundComponent: () => (
    <Card><EmptyState title="That page does not exist">
      Use the rail on the left: dashboard, new design, register, or calculator.
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
