import clsx from 'clsx';
import { NavLink, Outlet } from 'react-router-dom';
import { Button } from '@/components/ui';
import { useAuth } from '@/lib/auth';

const NAV = [
  { to: '/', label: 'Pedidos', icon: '📋', end: true },
  { to: '/asistente', label: 'Asistente', icon: '💬' },
  { to: '/historial', label: 'Historial', icon: '🗂️' },
  { to: '/menu', label: 'Menú', icon: '🍕' },
  { to: '/clientes', label: 'Clientes', icon: '👥' },
  { to: '/dashboard', label: 'Dashboard', icon: '📊' },
  { to: '/configuracion', label: 'Configuración', icon: '⚙️' },
];

export function AppLayout() {
  const { user, logout } = useAuth();

  return (
    <div className="flex h-full flex-col lg:flex-row">
      <nav className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-slate-200 bg-white px-3 py-2 lg:w-56 lg:flex-col lg:items-stretch lg:overflow-y-auto lg:border-b-0 lg:border-r lg:px-3 lg:py-4">
        <div className="mr-3 hidden items-center gap-2 px-2 pb-4 lg:flex">
          <span className="text-2xl">🍕</span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">
              {user?.commerce?.name ?? 'AutoElite'}
            </p>
            <p className="truncate text-xs text-slate-500">{user?.name}</p>
          </div>
        </div>

        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              clsx(
                'flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition',
                isActive
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
              )
            }
          >
            <span aria-hidden>{item.icon}</span>
            {item.label}
          </NavLink>
        ))}

        <div className="ml-auto lg:ml-0 lg:mt-auto lg:pt-4">
          <Button variant="ghost" size="sm" onClick={() => void logout()} className="w-full">
            Salir
          </Button>
        </div>
      </nav>

      <main className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-6">
        <Outlet />
      </main>
    </div>
  );
}
