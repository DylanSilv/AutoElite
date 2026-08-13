import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Suspense, lazy } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Spinner } from '@/components/ui';
import { AuthProvider, useAuth } from '@/lib/auth';
import { AssistantPage } from '@/pages/AssistantPage';
import { BoardPage } from '@/pages/BoardPage';
import { CustomersPage } from '@/pages/CustomersPage';
import { HistoryPage } from '@/pages/HistoryPage';
import { LoginPage } from '@/pages/LoginPage';
import { NewOrderPage } from '@/pages/NewOrderPage';
import { ProductsPage } from '@/pages/ProductsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { AppLayout } from './AppLayout';

// El dashboard arrastra la librería de gráficos, que pesa más que todo el resto
// del panel junto. Se carga aparte para que el tablero —la pantalla que está
// abierta todo el servicio— no pague ese costo al abrirse.
const DashboardPage = lazy(() =>
  import('@/pages/DashboardPage').then((module) => ({ default: module.DashboardPage })),
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Los datos del servicio cambian rápido: se revalidan al volver a la
      // pestaña, pero sin reintentar en bucle cuando algo falla de verdad.
      staleTime: 5_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

function ProtectedRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-8" />
      </div>
    );
  }

  if (!user) return <LoginPage />;

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<BoardPage />} />
        <Route path="pedidos/nuevo" element={<NewOrderPage />} />
        <Route path="asistente" element={<AssistantPage />} />
        <Route path="historial" element={<HistoryPage />} />
        <Route path="menu" element={<ProductsPage />} />
        <Route path="clientes" element={<CustomersPage />} />
        <Route
          path="dashboard"
          element={
            <Suspense fallback={<div className="flex justify-center py-20"><Spinner className="size-8" /></div>}>
              <DashboardPage />
            </Suspense>
          }
        />
        <Route path="configuracion" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <ProtectedRoutes />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
