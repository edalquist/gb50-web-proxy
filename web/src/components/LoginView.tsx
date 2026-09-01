import React, { useState } from 'react';
import { Building2, Lock, User, ShieldAlert, ArrowRight, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../AuthContext';

interface LoginViewProps {
  onSuccess?: () => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ onSuccess }) => {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError('Please enter both username and password.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await login(username.trim(), password);
      onSuccess?.();
    } catch (err: any) {
      setError(err.message || 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickLogin = async (u: string, p: string) => {
    setUsername(u);
    setPassword(p);
    setError(null);
    setLoading(true);
    try {
      await login(u, p);
      onSuccess?.();
    } catch (err: any) {
      setError(err.message || 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8 bg-slate-900/90 border border-slate-800 p-8 rounded-3xl shadow-2xl backdrop-blur-sm">
        {/* Header Branding */}
        <div className="text-center">
          <div className="mx-auto w-16 h-16 bg-blue-600/20 text-blue-400 rounded-2xl flex items-center justify-center border border-blue-500/30 shadow-inner mb-4">
            <Building2 className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-black text-slate-100 tracking-tight">
            GB-50 Centralized Controller
          </h2>
          <p className="text-sm font-semibold text-blue-400 mt-0.5">
            City Multi Management Gateway
          </p>
          <p className="text-xs text-slate-400 mt-2">
            Enter your credentials to access centralized HVAC management.
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="p-3.5 bg-rose-500/10 border border-rose-500/30 rounded-2xl flex items-center gap-2.5 text-xs text-rose-300 font-semibold shadow">
            <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-bold text-slate-300 block mb-1.5">Username</label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Username (e.g. admin, staff)"
                className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-300 block mb-1.5">Password</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 py-3 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold transition shadow-lg shadow-blue-900/30 flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? (
              <span>Verifying Credentials...</span>
            ) : (
              <>
                <span>Sign In to Dashboard</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* Quick Access Helper */}
        <div className="pt-4 border-t border-slate-800 text-center space-y-3">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
            Default Access Accounts
          </span>
          <div className="grid grid-cols-2 gap-2 text-left">
            <button
              type="button"
              onClick={() => handleQuickLogin('admin', 'admin')}
              className="p-2.5 bg-slate-950/80 hover:bg-slate-800 border border-slate-800 rounded-xl transition group text-xs"
            >
              <div className="flex items-center gap-1.5 text-blue-400 font-bold">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Administrator</span>
              </div>
              <span className="text-[11px] text-slate-400 block mt-0.5 font-mono">admin / admin</span>
            </button>

            <button
              type="button"
              onClick={() => handleQuickLogin('staff', 'staff123')}
              className="p-2.5 bg-slate-950/80 hover:bg-slate-800 border border-slate-800 rounded-xl transition group text-xs"
            >
              <div className="flex items-center gap-1.5 text-emerald-400 font-bold">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Operator</span>
              </div>
              <span className="text-[11px] text-slate-400 block mt-0.5 font-mono">staff / staff123</span>
            </button>
          </div>
        </div>

        {/* Role Matrix Note */}
        <div className="bg-slate-950/50 p-3 rounded-xl border border-slate-800/80 text-[11px] text-slate-500 text-center">
          Role-Based Access Control enforced at the proxy gateway layer.
        </div>
      </div>
    </div>
  );
};
