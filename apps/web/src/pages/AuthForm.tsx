import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, registerSchema } from '@txillapp/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { Wordmark, btnPrimary, inputCls } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

type Mode = 'login' | 'register';

export default function AuthForm({ mode }: { mode: Mode }) {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const { register, handleSubmit, formState } = useForm<Record<string, string>>({
    resolver: zodResolver(mode === 'login' ? loginSchema : registerSchema),
  });

  const onSubmit = handleSubmit(async (data) => {
    setError('');
    try {
      signIn(await (mode === 'login' ? api.login(data) : api.register(data)));
      navigate('/');
    } catch (e) {
      setError((e as Error).message);
    }
  });

  const field = (name: string, label: string, type = 'text', autoComplete?: string) => (
    <label className="block space-y-1">
      <span className="text-sm text-zinc-500">{label}</span>
      <input className={inputCls} type={type} autoComplete={autoComplete} {...register(name)} />
      {formState.errors[name] && (
        <span className="text-sm text-red-600">{formState.errors[name]?.message as string}</span>
      )}
    </label>
  );

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-4">
      <h1 className="text-center">
        <Wordmark className="text-5xl" />
      </h1>
      <form onSubmit={onSubmit} className="space-y-4 rounded-3xl bg-white p-5 shadow-sm" noValidate>
        {mode === 'register' && field('displayName', 'Nome', 'text', 'name')}
        {mode === 'register' && field('username', 'Nome de utilizador', 'text', 'username')}
        {field('email', 'Email', 'email', 'email')}
        {field('password', 'Palavra-passe', 'password', mode === 'login' ? 'current-password' : 'new-password')}
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <button disabled={formState.isSubmitting} className={`${btnPrimary} w-full`}>
          {mode === 'login' ? 'Entrar' : 'Criar conta'}
        </button>
      </form>
      <Link className="text-center text-sm text-zinc-500 underline" to={mode === 'login' ? '/register' : '/login'}>
        {mode === 'login' ? 'Criar conta' : 'Já tenho conta'}
      </Link>
    </main>
  );
}
