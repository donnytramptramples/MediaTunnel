import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';

export default function AuthPage({ onAuth }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ username: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const body = mode === 'login'
        ? { username: form.username, password: form.password }
        : { username: form.username, email: form.email, password: form.password };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong');
      onAuth(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)] p-4">
      <div className="w-full max-w-sm">
        <div className="breeze-card p-8">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-[var(--accent)]">MediaTunnel</h1>
            <p className="text-sm text-[var(--text-secondary)] mt-1">
              {mode === 'login' ? 'Sign in to your account' : 'Create a new account'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)] uppercase tracking-wide">
                Username
              </label>
              <input
                type="text"
                className="breeze-input w-full"
                placeholder="Username"
                value={form.username}
                onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                required
                autoFocus
              />
            </div>

            {mode === 'register' && (
              <div>
                <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)] uppercase tracking-wide">
                  Email
                </label>
                <input
                  type="email"
                  className="breeze-input w-full"
                  placeholder="Email address"
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  required
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)] uppercase tracking-wide">
                Password
              </label>
              <input
                type="password"
                className="breeze-input w-full"
                placeholder="Password"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                required
              />
            </div>

            {error && (
              <p className="text-red-400 text-sm text-center">{error}</p>
            )}

            <button
              type="submit"
              className="breeze-btn w-full flex items-center justify-center gap-2 mt-2"
              disabled={loading}
            >
              {loading && <Loader2 size={16} className="animate-spin" />}
              {mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          <div className="mt-4 text-center text-sm text-[var(--text-secondary)]">
            {mode === 'login' ? (
              <>
                Don't have an account?{' '}
                <button
                  className="text-[var(--accent)] hover:underline"
                  onClick={() => { setMode('register'); setError(''); }}
                >
                  Sign up
                </button>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <button
                  className="text-[var(--accent)] hover:underline"
                  onClick={() => { setMode('login'); setError(''); }}
                >
                  Sign in
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
