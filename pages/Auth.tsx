import React, { useState } from 'react';
import { auth } from '../services/firebase';

export const AuthPage: React.FC = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (isLogin) {
        await auth.signInWithEmailAndPassword(email, password);
      } else {
        await auth.createUserWithEmailAndPassword(email, password);
      }
    } catch (err: any) {
      setError(err.message.replace('Firebase: ', ''));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 to-emerald-100 flex flex-col justify-center items-center p-6 font-sans relative overflow-hidden">
      {/* Background Decor */}
      <div className="absolute top-0 left-0 w-64 h-64 bg-teal-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 -translate-x-1/2 -translate-y-1/2"></div>
      <div className="absolute bottom-0 right-0 w-64 h-64 bg-emerald-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 translate-x-1/2 translate-y-1/2"></div>

      <div className="w-full max-w-md bg-white/80 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/50 p-8 relative z-10 animate-fade-in">
        
        {/* Brand */}
        <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-tr from-teal-500 to-emerald-500 rounded-2xl shadow-lg shadow-teal-200 mb-4">
                <i className="fas fa-heartbeat text-3xl text-white"></i>
            </div>
            <h1 className="text-3xl font-bold text-gray-800 tracking-tight">PillCare</h1>
            <p className="text-sm text-gray-500 mt-2 font-medium">
                {isLogin ? 'Your personal health companion' : 'Start your health journey today'}
            </p>
        </div>

        {/* Error Alert */}
        {error && (
            <div className="mb-6 bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm font-medium border border-red-100 flex items-start animate-shake">
                <i className="fas fa-exclamation-circle mt-0.5 mr-2 text-lg"></i>
                <span>{error}</span>
            </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wide ml-1">Email</label>
                <div className="relative group">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                        <i className="fas fa-envelope text-gray-400 group-focus-within:text-teal-500 transition-colors"></i>
                    </div>
                    <input 
                        type="email" 
                        required 
                        className="w-full pl-11 pr-4 py-3.5 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 outline-none transition-all font-medium text-gray-800 placeholder-gray-400"
                        placeholder="hello@example.com"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                    />
                </div>
            </div>

            <div className="space-y-1">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wide ml-1">Password</label>
                <div className="relative group">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                        <i className="fas fa-lock text-gray-400 group-focus-within:text-teal-500 transition-colors"></i>
                    </div>
                    <input 
                        type="password" 
                        required 
                        className="w-full pl-11 pr-4 py-3.5 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 outline-none transition-all font-medium text-gray-800 placeholder-gray-400"
                        placeholder="••••••••"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                    />
                </div>
                {isLogin && (
                    <div className="flex justify-end pt-1">
                        <button type="button" className="text-xs font-bold text-teal-600 hover:text-teal-700">Forgot Password?</button>
                    </div>
                )}
            </div>

            <button 
                type="submit" 
                disabled={loading}
                className="w-full bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 text-white font-bold py-4 rounded-xl shadow-lg shadow-teal-500/20 transition-all transform active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed flex justify-center items-center mt-4"
            >
                {loading ? (
                    <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                ) : (
                    <>
                        {isLogin ? 'Sign In' : 'Create Account'}
                        <i className={`fas ${isLogin ? 'fa-arrow-right' : 'fa-user-plus'} ml-2`}></i>
                    </>
                )}
            </button>
        </form>

        <div className="mt-8 pt-6 border-t border-gray-100 text-center">
            <p className="text-gray-500 text-sm">
                {isLogin ? "Don't have an account?" : "Already have an account?"}
                <button 
                    onClick={() => setIsLogin(!isLogin)}
                    className="ml-2 font-bold text-teal-600 hover:text-teal-700 transition-colors"
                >
                    {isLogin ? "Sign Up" : "Log In"}
                </button>
            </p>
        </div>
      </div>
      
      <p className="mt-8 text-center text-teal-800/40 text-xs font-medium">
        &copy; 2024 PillCare. Secure & Private.
      </p>
    </div>
  );
};