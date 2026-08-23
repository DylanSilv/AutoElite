import { useState } from 'react';
import { Button, Card, ErrorMessage, Field, Input } from '@/components/ui';
import { useAuth } from '@/lib/auth';

/**
 * Nombre del comercio en la pantalla de login.
 *
 * Antes de iniciar sesión no sabemos a qué comercio pertenece quien está
 * mirando, así que no se puede leer de la API: se define al compilar. Con
 * varios comercios en la misma instalación, esto pasa a ser el nombre del
 * producto y el del local aparece recién adentro.
 */
const COMMERCE_NAME = import.meta.env.VITE_COMMERCE_NAME ?? 'Nuevo Quijote';

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-slate-100 p-4">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-6 text-center">
          <div className="mb-2 text-3xl">🍕</div>
          <h1 className="text-xl font-semibold text-slate-900">{COMMERCE_NAME}</h1>
          <p className="text-sm text-slate-500">Gestión de pedidos</p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <Field label="Email">
            <Input
              type="email"
              autoComplete="username"
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>

          <Field label="Contraseña">
            <Input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>

          {error ? <ErrorMessage error={error} /> : null}

          <Button type="submit" size="lg" className="w-full" disabled={submitting}>
            {submitting ? 'Entrando…' : 'Entrar'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
