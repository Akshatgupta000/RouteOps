import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Mail, Lock, User, Eye, EyeOff, Loader2, ArrowRight, CheckCircle2, AlertCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import authService from '../services/authService';

const AuthModal = ({ isOpen, onClose, initialMode = 'signup' }) => {
  const [mode, setMode] = useState(initialMode);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [shake, setShake] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
  });
  const [fieldErrors, setFieldErrors] = useState({});
  const [generalError, setGeneralError] = useState('');

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      setIsLoading(false);
      setIsSuccess(false);
      setShowPassword(false);
      setFieldErrors({});
      setGeneralError('');
      setFormData({ name: '', email: '', password: '' });
    }
  }, [isOpen, initialMode]);

  const triggerShake = () => {
    setShake(true);
    setTimeout(() => setShake(false), 400);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setGeneralError('');
    setFieldErrors({});
    
    try {
      const data = mode === 'signup' 
        ? await authService.register(formData.name, formData.email, formData.password)
        : await authService.login(formData.email, formData.password);

      if (!data.success) {
        throw new Error(data.message || 'Authentication failed');
      }

      // Store token and user info (local to landing)
      localStorage.setItem('auth_token', data.data.access_token);
      localStorage.setItem('user', JSON.stringify(data.data.user));

      setIsSuccess(true);
      
      // Delay redirection for success animation
      setTimeout(() => {
        setIsLoading(false);
        onClose();

        // Redirect to dashboard with token in URL (cross-origin fix for dev)
        const userData = encodeURIComponent(JSON.stringify(data.data.user));
        const dashboardUrl = import.meta.env.VITE_DASHBOARD_URL;
        window.location.href = `${dashboardUrl}?token=${data.data.access_token}&user=${userData}`;
      }, 1000);
      
    } catch (error) {
      console.error('Auth error:', error);
      setIsLoading(false);
      triggerShake();
      
      if (error.data && error.data.errors) {
        setFieldErrors(error.data.errors);
      } else {
        let msg = error.message;
        if (msg === 'Failed to fetch') {
          msg = 'Connection Failed: Could not reach the API server. Please ensure VITE_API_URL is correctly set in Vercel and the backend is running.';
        }
        setGeneralError(msg);
      }
    }
  };

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    if (fieldErrors[e.target.name]) {
      setFieldErrors({ ...fieldErrors, [e.target.name]: null });
    }
    if (generalError) {
      setGeneralError('');
    }
  };

  const getPasswordStrength = (pass) => {
    let score = 0;
    if (!pass) return { score: 0, label: '', color: 'bg-gray-200' };
    if (pass.length > 7) score += 1;
    if (pass.length > 10) score += 1;
    if (/[A-Z]/.test(pass)) score += 1;
    if (/[0-9]/.test(pass)) score += 1;
    if (/[^A-Za-z0-9]/.test(pass)) score += 1;

    if (score <= 2) return { score, label: 'Weak', color: 'bg-red-500', w: 'w-1/3' };
    if (score <= 4) return { score, label: 'Good', color: 'bg-yellow-500', w: 'w-2/3' };
    return { score, label: 'Strong', color: 'bg-green-500', w: 'w-full' };
  };

  const pwdStrength = getPasswordStrength(formData.password);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />

          {/* Modal Card */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="relative w-full max-w-sm overflow-hidden bg-white rounded-[2rem] shadow-2xl"
          >
            {/* Close Button */}
            <button
              onClick={onClose}
              disabled={isSuccess}
              className="absolute top-5 right-5 p-2 text-dark/30 hover:text-dark hover:bg-gray-100 rounded-full transition-all z-10 disabled:opacity-50"
            >
              <X size={18} />
            </button>

            <div className="p-7 pt-10">
              {/* Header */}
              <div className="text-center mb-6">
                <h2 className="text-2xl font-bold text-dark mb-2">
                  {mode === 'signup' ? 'Create Account' : 'Welcome Back'}
                </h2>
                <p className="text-sm text-dark/60">
                  {mode === 'signup' 
                    ? 'Join Routiqo to start optimizing your fleet.' 
                    : 'Log in to manage your logistics operations.'}
                </p>
              </div>

              {/* Tabs */}
              <div className="flex p-1 bg-gray-50 rounded-2xl mb-6 border border-gray-100 relative">
                <button
                  type="button"
                  onClick={() => setMode('signup')}
                  disabled={isLoading || isSuccess}
                  className={`flex-1 py-2.5 text-sm font-bold rounded-xl transition-all z-10 ${
                    mode === 'signup' 
                      ? 'text-dark' 
                      : 'text-dark/60 hover:text-dark'
                  }`}
                >
                  Sign Up
                </button>
                <button
                  type="button"
                  onClick={() => setMode('login')}
                  disabled={isLoading || isSuccess}
                  className={`flex-1 py-2.5 text-sm font-bold rounded-xl transition-all z-10 ${
                    mode === 'login' 
                      ? 'text-dark' 
                      : 'text-dark/60 hover:text-dark'
                  }`}
                >
                  Log In
                </button>
                
                {/* Sliding Tab Indicator */}
                <motion.div
                  initial={false}
                  animate={{ x: mode === 'signup' ? 0 : '100%' }}
                  transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                  className="absolute top-1 bottom-1 left-1 w-[calc(50%-4px)] bg-white rounded-xl shadow-sm border border-gray-100"
                />
              </div>

              {/* Inline General Error Banner */}
              <AnimatePresence>
                {generalError && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0, mb: 0 }}
                    animate={{ opacity: 1, height: 'auto', mb: 16 }}
                    exit={{ opacity: 0, height: 0, mb: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="flex items-center gap-2 p-3 bg-red-50 text-red-600 rounded-xl text-sm border border-red-100">
                      <AlertCircle size={16} className="shrink-0" />
                      <p>{generalError}</p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Form */}
              <motion.form 
                onSubmit={handleSubmit} 
                className="space-y-4"
                animate={shake ? { x: [-8, 8, -8, 8, 0] } : {}}
                transition={{ duration: 0.4 }}
              >
                <div className="space-y-4">
                  <AnimatePresence mode="popLayout">
                    {mode === 'signup' && (
                      <motion.div 
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                      >
                        <div className="relative group">
                          <div className="absolute left-4 top-1/2 -translate-y-1/2 text-dark/40 group-focus-within:text-primary transition-colors">
                            <User size={18} />
                          </div>
                          <input
                            type="text"
                            name="name"
                            placeholder="Full Name"
                            required={mode === 'signup'}
                            value={formData.name}
                            onChange={handleChange}
                            className={`w-full bg-gray-50 border ${fieldErrors.name ? 'border-red-500 focus:border-red-500 focus:ring-red-500/50' : 'border-gray-100 focus:border-primary/50 focus:ring-primary/50'} rounded-xl py-3 pl-11 pr-4 text-sm text-dark placeholder:text-dark/30 focus:outline-none focus:ring-1 transition-all`}
                          />
                        </div>
                        <AnimatePresence>
                          {fieldErrors.name && (
                            <motion.p 
                              initial={{ opacity: 0, y: -5 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -5 }}
                              className="text-red-500 text-xs mt-1 text-left pl-2"
                            >
                              {fieldErrors.name[0]}
                            </motion.p>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div>
                    <div className="relative group">
                      <div className="absolute left-4 top-1/2 -translate-y-1/2 text-dark/40 group-focus-within:text-primary transition-colors">
                        <Mail size={16} />
                      </div>
                      <input
                        type="email"
                        name="email"
                        placeholder="Email Address"
                        required
                        value={formData.email}
                        onChange={handleChange}
                        className={`w-full bg-gray-50 border ${fieldErrors.email ? 'border-red-500 focus:border-red-500 focus:ring-red-500/50' : 'border-gray-100 focus:border-primary/50 focus:ring-primary/50'} rounded-xl py-3 pl-11 pr-4 text-sm text-dark placeholder:text-dark/30 focus:outline-none focus:ring-1 transition-all`}
                      />
                    </div>
                    <AnimatePresence>
                      {fieldErrors.email && (
                        <motion.p 
                          initial={{ opacity: 0, y: -5 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -5 }}
                          className="text-red-500 text-xs mt-1 text-left pl-2"
                        >
                          {fieldErrors.email[0]}
                        </motion.p>
                      )}
                    </AnimatePresence>
                  </div>

                  <div>
                    <div className="relative group">
                      <div className="absolute left-4 top-1/2 -translate-y-1/2 text-dark/40 group-focus-within:text-primary transition-colors">
                        <Lock size={16} />
                      </div>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        name="password"
                        placeholder="Password"
                        required
                        value={formData.password}
                        onChange={handleChange}
                        className={`w-full bg-gray-50 border ${fieldErrors.password ? 'border-red-500 focus:border-red-500 focus:ring-red-500/50' : 'border-gray-100 focus:border-primary/50 focus:ring-primary/50'} rounded-xl py-3 pl-11 pr-11 text-sm text-dark placeholder:text-dark/30 focus:outline-none focus:ring-1 transition-all`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-dark/40 hover:text-dark transition-colors"
                      >
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    
                    {/* Password Strength Indicator */}
                    <AnimatePresence>
                      {mode === 'signup' && formData.password.length > 0 && (
                        <motion.div 
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="mt-2"
                        >
                          <div className="flex justify-between items-center mb-1 pl-2 pr-1">
                            <span className="text-[10px] text-dark/50">Password strength</span>
                            <span className={`text-[10px] font-medium ${pwdStrength.color.replace('bg-', 'text-')}`}>
                              {pwdStrength.label}
                            </span>
                          </div>
                          <div className="h-1 w-full bg-gray-100 rounded-full overflow-hidden">
                            <motion.div 
                              className={`h-full ${pwdStrength.color} transition-all duration-300`} 
                              initial={{ width: 0 }}
                              animate={{ width: pwdStrength.score === 0 ? '0%' : (pwdStrength.score <= 2 ? '33%' : (pwdStrength.score <= 4 ? '66%' : '100%')) }}
                            />
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <AnimatePresence>
                      {fieldErrors.password && (
                        <motion.p 
                          initial={{ opacity: 0, y: -5 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -5 }}
                          className="text-red-500 text-xs mt-1 text-left pl-2"
                        >
                          {fieldErrors.password[0]}
                        </motion.p>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                <AnimatePresence mode="popLayout">
                  {mode === 'login' && (
                    <motion.div 
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="text-right"
                    >
                      <Link 
                        to="/forgot-password" 
                        onClick={onClose}
                        className="text-[10px] text-dark/40 hover:text-primary transition-colors"
                      >
                        Forgot Password?
                      </Link>
                    </motion.div>
                  )}
                </AnimatePresence>

                <button
                  type="submit"
                  disabled={isLoading || isSuccess}
                  className={`w-full py-3 mt-4 flex items-center justify-center gap-2 group relative overflow-hidden text-sm rounded-xl transition-all duration-300 ${
                    isSuccess 
                      ? 'bg-green-500 text-white shadow-lg shadow-green-500/30' 
                      : 'btn-primary'
                  }`}
                >
                  {isSuccess ? (
                    <motion.div 
                      initial={{ scale: 0 }} 
                      animate={{ scale: 1 }} 
                      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                      className="flex items-center gap-2"
                    >
                      <CheckCircle2 size={20} />
                      <span>{mode === 'signup' ? 'Account Created!' : 'Logged In!'}</span>
                    </motion.div>
                  ) : isLoading ? (
                    <Loader2 className="animate-spin" size={20} />
                  ) : (
                    <>
                      {mode === 'signup' ? 'Create Account' : 'Sign In'}
                      <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                    </>
                  )}
                </button>
              </motion.form>

              {/* Footer Toggle */}
              <div className="mt-8 text-center">
                <p className="text-dark/40 text-sm">
                  {mode === 'signup' ? 'Already have an account?' : "Don't have an account?"}{' '}
                  <button
                    onClick={() => setMode(mode === 'signup' ? 'login' : 'signup')}
                    disabled={isLoading || isSuccess}
                    className="text-primary font-bold hover:underline disabled:opacity-50"
                  >
                    {mode === 'signup' ? 'Log In' : 'Sign Up'}
                  </button>
                </p>
              </div>
            </div>

            {/* Bottom Accent */}
            <div className="h-2 bg-gradient-to-r from-primary/50 via-primary to-primary/50" />
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default AuthModal;
