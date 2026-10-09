import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'flowbite-react';
import { meltekTheme } from './lib/flowbite-theme';
import {
  createRootRoute, createRoute, createRouter, Outlet, RouterProvider,
} from '@tanstack/react-router';
import { Shell } from './components/Shell';
import { NewDesign } from './routes/NewDesign';
import { Register } from './routes/Register';
import { DesignDetail } from './routes/DesignDetail';
import { Admin } from './routes/Admin';
import { Card, EmptyState } from './components/primitives';
import { AuthGate } from './components/AuthGate';
import './index.css';
import { validateAdminSearch } from './lib/adminTabs';

const rootRoute = createRootRoute({
  component: () => <Shell><Outlet /></Shell>,
  notFoundComponent: () => (
    <Card><EmptyState title="That page does not exist">
      Use the rail on the left: a new design, the register, or the reference data.
    </EmptyState></Card>
  ),
});

const routes = [
  createRoute({ getParentRoute: () => rootRoute, path: '/', component: NewDesign }),
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
