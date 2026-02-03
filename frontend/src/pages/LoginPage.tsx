import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiService } from '../services/api';

const LoginPage = () => {
  const navigate = useNavigate();
  const [isRegistering, setIsRegistering] = useState(false);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const input = document.getElementById('username-input') as HTMLInputElement | null;
    input?.focus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (isRegistering) {
        await apiService.register(username.trim(), email.trim(), password);
      } else {
        await apiService.login(username.trim(), password);
      }
      navigate('/landing', { replace: true });
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const toggleMode = () => {
    setIsRegistering((v) => !v);
    setError(null);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-950 to-black px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/70 backdrop-blur-xl shadow-2xl p-8 space-y-6">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.2em] text-sky-400">Agentic Lab</p>
          <h1 className="text-2xl font-bold text-white">
            {isRegistering ? 'Create Account' : 'Welcome back'}
          </h1>
          <p className="text-sm text-slate-400">
            {isRegistering
              ? 'Sign up to launch simulations and research.'
              : 'Log in to continue to your simulations.'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm text-slate-300" htmlFor="username-input">
              Username
            </label>
            <input
              id="username-input"
              type="text"
              placeholder="Enter username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-lg bg-slate-800 border border-slate-700 text-slate-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500"
              required
            />
          </div>

          {isRegistering && (
            <div className="space-y-2">
              <label className="text-sm text-slate-300" htmlFor="email-input">
                Email (optional)
              </label>
              <input
                id="email-input"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg bg-slate-800 border border-slate-700 text-slate-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm text-slate-300" htmlFor="password-input">
              Password
            </label>
            <input
              id="password-input"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg bg-slate-800 border border-slate-700 text-slate-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500"
              required
            />
          </div>

          {error && (
            <div className="rounded-lg border border-rose-500/60 bg-rose-500/10 text-rose-100 px-3 py-2 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-sky-500 hover:bg-sky-600 text-white font-semibold py-2.5 transition disabled:opacity-60 disabled:cursor-not-allowed shadow-lg shadow-sky-900/40"
          >
            {loading ? 'Please wait...' : isRegistering ? 'Create account' : 'Login'}
          </button>
        </form>

        <div className="flex items-center justify-between text-sm text-slate-400">
          <span>
            {isRegistering ? 'Have an account?' : "Don't have an account?"}{' '}
            <button
              type="button"
              onClick={toggleMode}
              className="text-sky-400 hover:text-sky-300 underline underline-offset-4"
            >
              {isRegistering ? 'Login' : 'Register'}
            </button>
          </span>
          <span className="text-xs bg-slate-800/80 px-2 py-1 rounded border border-slate-700">
            API: {import.meta.env.VITE_API_URL || 'http://localhost:8000'}
          </span>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
