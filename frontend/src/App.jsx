import { useState, useEffect, useMemo, createContext, useContext } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';
import { LineChart, Line, ResponsiveContainer, Tooltip, YAxis, XAxis, CartesianGrid } from 'recharts';

const getApiBase = () => {
  if (typeof window !== 'undefined' && window.location.hostname) {
    return `http://${window.location.hostname}:8000`;
  }
  return 'http://localhost:8000';
};

const getWsUrl = () => {
  if (typeof window !== 'undefined' && window.location.hostname) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.hostname}:8000/ws`;
  }
  return 'ws://localhost:8000/ws';
};

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('pulsewatch_token'));
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('pulsewatch_user');
    return saved ? JSON.parse(saved) : null;
  });

  const login = async (username, password) => {
    const apiBase = getApiBase();
    const cleanUser = (username || '').trim();
    const res = await fetch(`${apiBase}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: cleanUser, password })
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || 'Login failed');
    }
    const data = await res.json();
    if (data.require_2fa) {
      return data;
    }
    setToken(data.access_token);
    setUser({ user_id: data.user_id, username: data.username });
    localStorage.setItem('pulsewatch_token', data.access_token);
    localStorage.setItem('pulsewatch_user', JSON.stringify({ user_id: data.user_id, username: data.username }));
    return data;
  };

  const verify2fa = async (username, otp_code) => {
    const apiBase = getApiBase();
    const cleanUser = (username || '').trim();
    const cleanOtp = (otp_code || '').trim();
    const res = await fetch(`${apiBase}/login/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: cleanUser, otp_code: cleanOtp })
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || '2FA verification failed');
    }
    const data = await res.json();
    setToken(data.access_token);
    setUser({ user_id: data.user_id, username: data.username });
    localStorage.setItem('pulsewatch_token', data.access_token);
    localStorage.setItem('pulsewatch_user', JSON.stringify({ user_id: data.user_id, username: data.username }));
    return data;
  };

  const register = async (username, password) => {
    const apiBase = getApiBase();
    const cleanUser = (username || '').trim();
    const res = await fetch(`${apiBase}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: cleanUser, password })
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || 'Registration failed');
    }
    const data = await res.json();
    setToken(data.access_token);
    setUser({ user_id: data.user_id, username: data.username });
    localStorage.setItem('pulsewatch_token', data.access_token);
    localStorage.setItem('pulsewatch_user', JSON.stringify({ user_id: data.user_id, username: data.username }));
    return data;
  };

  const updateUser = (newUsername, newToken) => {
    setUser(prev => {
      const updated = { ...(prev || {}), username: newUsername };
      localStorage.setItem('pulsewatch_user', JSON.stringify(updated));
      return updated;
    });
    if (newToken) {
      setToken(newToken);
      localStorage.setItem('pulsewatch_token', newToken);
    }
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('pulsewatch_token');
    localStorage.removeItem('pulsewatch_user');
  };

  const authFetch = async (url, options = {}) => {
    const headers = {
      ...(options.headers || {}),
      'Authorization': `Bearer ${token}`
    };
    const res = await fetch(url, { ...options, headers });
    if (res.status === 401) {
      logout();
    }
    return res;
  };

  return (
    <AuthContext.Provider value={{ token, user, login, verify2fa, register, logout, authFetch, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

function AuthScreen() {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const [require2fa, setRequire2fa] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [twoFaEmail, setTwoFaEmail] = useState('');

  const { login, verify2fa, register } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (isRegister) {
        await register(username, password);
      } else {
        const result = await login(username, password);
        if (result && result.require_2fa) {
          setRequire2fa(true);
          setTwoFaEmail(result.email || '');
        }
      }
    } catch (err) {
      setError(err.message || 'Authentication error');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify2fa = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await verify2fa(username, otpCode);
    } catch (err) {
      setError(err.message || 'Verification error');
    } finally {
      setLoading(false);
    }
  };

  const resetToLogin = () => {
    setRequire2fa(false);
    setOtpCode('');
    setError('');
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 font-mono text-white">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-8 space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-blue-600/20 text-blue-400 border border-blue-500/30 text-2xl mb-2">
            ⚡
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white">PulseWatch</h1>
          <p className="text-sm text-slate-400">Multi-Tenant Infrastructure Monitoring</p>
        </div>

        {!require2fa && (
          <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => { setIsRegister(false); setError(''); }}
              className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${
                !isRegister ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => { setIsRegister(true); setError(''); }}
              className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${
                isRegister ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              Register
            </button>
          </div>
        )}

        {error && (
          <div className="bg-red-950/60 border border-red-800/80 text-red-300 px-4 py-3 rounded-xl text-sm flex items-center space-x-2">
            <span>⚠️</span>
            <span className="flex-1">{error}</span>
          </div>
        )}

        {require2fa ? (
          <form onSubmit={handleVerify2fa} className="space-y-5">
            <div className="bg-blue-950/40 border border-blue-800/60 rounded-xl p-4 text-center space-y-2">
              <span className="text-2xl">🛡️</span>
              <h2 className="text-base font-bold text-blue-400">Two-Factor Authentication</h2>
              <p className="text-xs text-slate-300">
                A 6-digit verification code has been dispatched to <strong className="text-white">{twoFaEmail}</strong>.
              </p>
              <p className="text-xs text-slate-500 font-mono">
                [Mock Mode] Check server console logs for the code.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 text-center">
                Enter 6-Digit Code
              </label>
              <input
                type="text"
                maxLength="6"
                required
                autoFocus
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value)}
                placeholder="123456"
                className="w-full bg-slate-950 border border-blue-500 text-center tracking-widest font-mono text-2xl py-3 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold py-3 rounded-lg transition-colors shadow-lg shadow-blue-600/30"
            >
              {loading ? 'Verifying 2FA...' : 'Verify & Sign In'}
            </button>

            <button
              type="button"
              onClick={resetToLogin}
              className="w-full text-xs text-slate-400 hover:text-slate-200 text-center block pt-2 transition-colors"
            >
              ← Back to Sign In
            </button>
          </form>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Username</label>
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. admin or devops"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-white placeholder-slate-600 focus:outline-none focus:border-blue-500 transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-white placeholder-slate-600 focus:outline-none focus:border-blue-500 transition-colors"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold py-3 rounded-lg transition-colors shadow-lg shadow-blue-600/30"
            >
              {loading ? 'Authenticating...' : isRegister ? 'Create Tenant Account' : 'Sign In to Dashboard'}
            </button>
          </form>
        )}

        <div className="pt-4 border-t border-slate-800 text-center text-xs text-slate-500">
          Default admin: <span className="text-slate-300 font-mono">admin</span> / <span className="text-slate-300 font-mono">admin123</span>
        </div>
      </div>
    </div>
  );
}

function Settings() {
  const { user, authFetch, updateUser } = useAuth();
  const apiBase = getApiBase();

  const [email, setEmail] = useState('');
  const [is2faEnabled, setIs2faEnabled] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  const [twoFaLoading, setTwoFaLoading] = useState(false);
  const [emailSuccess, setEmailSuccess] = useState('');
  const [emailError, setEmailError] = useState('');
  const [twoFaSuccess, setTwoFaSuccess] = useState('');
  const [twoFaError, setTwoFaError] = useState('');

  const [newUsername, setNewUsername] = useState(user ? user.username : '');
  const [usernameOtp, setUsernameOtp] = useState('');
  const [isUsernameOtpSent, setIsUsernameOtpSent] = useState(false);
  const [usernameOtpLoading, setUsernameOtpLoading] = useState(false);
  const [usernameLoading, setUsernameLoading] = useState(false);
  const [usernameSuccess, setUsernameSuccess] = useState('');
  const [usernameError, setUsernameError] = useState('');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordOtp, setPasswordOtp] = useState('');
  const [isPasswordOtpSent, setIsPasswordOtpSent] = useState(false);
  const [passwordOtpLoading, setPasswordOtpLoading] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [channels, setChannels] = useState([]);
  const [channelType, setChannelType] = useState('webhook');
  const [destinationUrl, setDestinationUrl] = useState('');
  const [channelLoading, setChannelLoading] = useState(false);
  const [channelSuccess, setChannelSuccess] = useState('');
  const [channelError, setChannelError] = useState('');
  const [testingChannelId, setTestingChannelId] = useState(null);

  const fetchProfile = () => {
    authFetch(`${apiBase}/users/me`)
      .then(res => res.json())
      .then(data => {
        if (data) {
          if (data.email) setEmail(data.email);
          setIs2faEnabled(Boolean(data.is_2fa_enabled));
        }
      })
      .catch(err => console.error(err));
  };

  const fetchChannels = () => {
    authFetch(`${apiBase}/notification-channels`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setChannels(data);
      })
      .catch(err => console.error(err));
  };

  useEffect(() => {
    fetchProfile();
    fetchChannels();
  }, [apiBase]);

  const handleUpdateEmail = async (e) => {
    e.preventDefault();
    setEmailError('');
    setEmailSuccess('');
    setEmailLoading(true);

    try {
      const res = await authFetch(`${apiBase}/users/email`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to update email');
      }
      setEmailSuccess(data.message || 'Email updated successfully');
    } catch (err) {
      setEmailError(err.message || 'Error updating email');
    } finally {
      setEmailLoading(false);
    }
  };

  const handleToggle2fa = async () => {
    setTwoFaError('');
    setTwoFaSuccess('');
    setTwoFaLoading(true);

    try {
      const res = await authFetch(`${apiBase}/users/2fa-toggle`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_2fa_enabled: !is2faEnabled })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to toggle 2FA');
      }
      setIs2faEnabled(Boolean(data.is_2fa_enabled));
      setTwoFaSuccess(data.message || '2FA preference updated');
    } catch (err) {
      setTwoFaError(err.message || 'Error updating 2FA preference');
    } finally {
      setTwoFaLoading(false);
    }
  };

  const handleRequestUsernameOtp = async () => {
    setUsernameOtpLoading(true);
    setUsernameError('');
    setUsernameSuccess('');
    try {
      const res = await authFetch(`${apiBase}/users/request-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_settings' })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to generate verification code');
      }
      setIsUsernameOtpSent(true);
      setUsernameSuccess(data.message || `Verification code sent to ${data.email}. Check your inbox!`);
    } catch (err) {
      setUsernameError(err.message || 'Error requesting verification code');
    } finally {
      setUsernameOtpLoading(false);
    }
  };

  const handleRequestPasswordOtp = async () => {
    setPasswordOtpLoading(true);
    setPasswordError('');
    setPasswordSuccess('');
    try {
      const res = await authFetch(`${apiBase}/users/request-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_settings' })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to generate verification code');
      }
      setIsPasswordOtpSent(true);
      setPasswordSuccess(data.message || `Verification code sent to ${data.email}. Check your inbox!`);
    } catch (err) {
      setPasswordError(err.message || 'Error requesting verification code');
    } finally {
      setPasswordOtpLoading(false);
    }
  };

  const handleUpdateUsername = async (e) => {
    e.preventDefault();
    setUsernameError('');
    setUsernameSuccess('');

    if (!newUsername.trim()) {
      setUsernameError('Username cannot be blank');
      return;
    }

    if (!usernameOtp) {
      setUsernameError('Please enter the 6-digit OTP code sent to your email.');
      return;
    }

    setUsernameLoading(true);

    try {
      const res = await authFetch(`${apiBase}/users/username`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: newUsername.trim(),
          otp_code: usernameOtp
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to update username');
      }

      setUsernameSuccess(data.message || 'Username updated successfully');
      if (updateUser) {
        updateUser({ username: data.username });
      }
      setUsernameOtp('');
      setIsUsernameOtpSent(false);
    } catch (err) {
      setUsernameError(err.message || 'Error updating username');
    } finally {
      setUsernameLoading(false);
    }
  };

  const handleUpdatePassword = async (e) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match');
      return;
    }

    if (newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters');
      return;
    }

    if (!passwordOtp) {
      setPasswordError('Please enter the 6-digit OTP code sent to your email.');
      return;
    }

    setPasswordLoading(true);

    try {
      const res = await authFetch(`${apiBase}/users/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
          otp_code: passwordOtp
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to update password');
      }

      setPasswordSuccess(data.message || 'Password updated successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordOtp('');
      setIsPasswordOtpSent(false);
    } catch (err) {
      setPasswordError(err.message || 'Error updating password');
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleCreateChannel = async (e) => {
    e.preventDefault();
    setChannelError('');
    setChannelSuccess('');
    setChannelLoading(true);

    try {
      const res = await authFetch(`${apiBase}/notification-channels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel_type: channelType,
          destination_url: destinationUrl.trim(),
          is_active: 1
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to create notification channel');
      }

      setChannelSuccess(data.message || 'Notification channel added successfully');
      setDestinationUrl('');
      fetchChannels();
    } catch (err) {
      setChannelError(err.message || 'Error creating channel');
    } finally {
      setChannelLoading(false);
    }
  };

  const handleToggleChannel = async (id, currentStatus) => {
    try {
      const res = await authFetch(`${apiBase}/notification-channels/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: currentStatus ? 0 : 1 })
      });
      if (res.ok) {
        fetchChannels();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteChannel = async (id) => {
    try {
      const res = await authFetch(`${apiBase}/notification-channels/${id}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        setChannelSuccess('Notification channel removed');
        fetchChannels();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleTestChannel = async (id) => {
    setTestingChannelId(id);
    setChannelSuccess('');
    setChannelError('');
    try {
      const res = await authFetch(`${apiBase}/notification-channels/${id}/test`, {
        method: 'POST'
      });
      const data = await res.json();
      if (res.ok) {
        setChannelSuccess(data.message || 'Test alert dispatched successfully');
      } else {
        setChannelError(data.detail || 'Failed to dispatch test alert');
      }
    } catch (err) {
      setChannelError(err.message || 'Error dispatching test alert');
    } finally {
      setTestingChannelId(null);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
        <div className="flex items-center space-x-3 mb-6">
          <span className="text-2xl">🛡️</span>
          <div>
            <h2 className="text-xl font-semibold text-slate-200">Account Security & Authentication Settings</h2>
            <p className="text-sm text-slate-400">Configure your recovery email, optional 2FA login verification, and profile security credentials.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div className="bg-slate-900/60 p-6 rounded-xl border border-slate-700/70 flex flex-col justify-between">
            <form onSubmit={handleUpdateEmail} className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-emerald-400">Security Email Address</h3>
                <span className="text-xs text-slate-500 font-mono">OTP Receiver</span>
              </div>

              {emailSuccess && (
                <div className="bg-green-950/60 border border-green-800/80 text-green-300 px-3 py-2 rounded-lg text-xs">
                  {emailSuccess}
                </div>
              )}
              {emailError && (
                <div className="bg-red-950/60 border border-red-800/80 text-red-300 px-3 py-2 rounded-lg text-xs">
                  {emailError}
                </div>
              )}

              <div>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="e.g. devops@company.com"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white focus:outline-none focus:border-blue-500 text-sm"
                />
              </div>

              <button
                type="submit"
                disabled={emailLoading}
                className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold py-2.5 px-4 rounded-lg transition-colors text-sm"
              >
                {emailLoading ? 'Saving...' : 'Save Email'}
              </button>
            </form>
          </div>

          <div className="bg-slate-900/60 p-6 rounded-xl border border-slate-700/70 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-purple-400">Two-Factor Authentication</h3>
                <span className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${
                  is2faEnabled ? 'bg-purple-950/80 text-purple-300 border-purple-700' : 'bg-slate-800 text-slate-400 border-slate-700'
                }`}>
                  {is2faEnabled ? '🟢 2FA Active' : '⚪ Disabled'}
                </span>
              </div>

              <p className="text-xs text-slate-300">
                When enabled, sign-ins will require a 6-digit OTP code dispatched to your registered email.
              </p>

              {twoFaSuccess && (
                <div className="bg-green-950/60 border border-green-800/80 text-green-300 px-3 py-2 rounded-lg text-xs">
                  {twoFaSuccess}
                </div>
              )}
              {twoFaError && (
                <div className="bg-red-950/60 border border-red-800/80 text-red-300 px-3 py-2 rounded-lg text-xs">
                  {twoFaError}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={handleToggle2fa}
              disabled={twoFaLoading}
              className={`w-full font-bold py-2.5 px-4 rounded-lg transition-colors text-sm mt-4 ${
                is2faEnabled 
                  ? 'bg-red-950/80 hover:bg-red-900 text-red-300 border border-red-800/80' 
                  : 'bg-purple-600 hover:bg-purple-500 text-white shadow-md shadow-purple-600/30'
              }`}
            >
              {twoFaLoading ? 'Updating 2FA...' : is2faEnabled ? 'Disable 2FA Login' : 'Enable 2FA Login'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="bg-slate-900/60 p-6 rounded-xl border border-slate-700/70 flex flex-col justify-between">
            <form onSubmit={handleUpdateUsername} className="space-y-4">
              <h3 className="text-base font-semibold text-blue-400">Change Username</h3>
              
              {usernameSuccess && (
                <div className="bg-green-950/60 border border-green-800/80 text-green-300 px-3 py-2 rounded-lg text-xs break-words">
                  {usernameSuccess}
                </div>
              )}
              {usernameError && (
                <div className="bg-red-950/60 border border-red-800/80 text-red-300 px-3 py-2 rounded-lg text-xs">
                  {usernameError}
                </div>
              )}

              <div>
                <label className="block text-xs text-slate-400 uppercase tracking-wider mb-1">New Username</label>
                <input
                  type="text"
                  required
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              {!isUsernameOtpSent ? (
                <button
                  type="button"
                  onClick={handleRequestUsernameOtp}
                  disabled={usernameOtpLoading}
                  className="w-full bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 text-blue-300 font-semibold py-2.5 px-4 rounded-lg transition-colors text-xs flex items-center justify-center space-x-2"
                >
                  <span>🔑</span>
                  <span>{usernameOtpLoading ? 'Sending OTP...' : 'Request Verification Code'}</span>
                </button>
              ) : (
                <div className="space-y-3 pt-2 border-t border-slate-800">
                  <div className="flex items-center justify-between text-xs">
                    <label className="text-slate-400 uppercase tracking-wider">6-Digit Verification Code</label>
                    <button
                      type="button"
                      onClick={handleRequestUsernameOtp}
                      className="text-blue-400 hover:text-blue-300 underline"
                    >
                      Resend Code
                    </button>
                  </div>
                  <input
                    type="text"
                    maxLength="6"
                    required
                    placeholder="123456"
                    value={usernameOtp}
                    onChange={(e) => setUsernameOtp(e.target.value)}
                    className="w-full bg-slate-950 border border-blue-500/60 text-center tracking-widest font-mono text-lg rounded-lg p-2.5 text-white focus:outline-none focus:border-blue-400"
                  />
                  <p className="text-xs text-slate-500">Check your email inbox for your 6-digit verification code</p>
                </div>
              )}

              <button
                type="submit"
                disabled={usernameLoading || !isUsernameOtpSent}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold py-2.5 px-4 rounded-lg transition-colors text-sm shadow-md shadow-blue-600/20"
              >
                {usernameLoading ? 'Saving...' : 'Update Username'}
              </button>
            </form>
          </div>

          <div className="bg-slate-900/60 p-6 rounded-xl border border-slate-700/70">
            <form onSubmit={handleUpdatePassword} className="space-y-4">
              <h3 className="text-base font-semibold text-cyan-400">Change Password</h3>

              {passwordSuccess && (
                <div className="bg-green-950/60 border border-green-800/80 text-green-300 px-3 py-2 rounded-lg text-xs break-words">
                  {passwordSuccess}
                </div>
              )}
              {passwordError && (
                <div className="bg-red-950/60 border border-red-800/80 text-red-300 px-3 py-2 rounded-lg text-xs">
                  {passwordError}
                </div>
              )}

              <div>
                <label className="block text-xs text-slate-400 uppercase tracking-wider mb-1">Current Password</label>
                <input
                  type="password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 uppercase tracking-wider mb-1">New Password</label>
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 uppercase tracking-wider mb-1">Confirm New Password</label>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              {!isPasswordOtpSent ? (
                <button
                  type="button"
                  onClick={handleRequestPasswordOtp}
                  disabled={passwordOtpLoading}
                  className="w-full bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/40 text-cyan-300 font-semibold py-2.5 px-4 rounded-lg transition-colors text-xs flex items-center justify-center space-x-2"
                >
                  <span>🔑</span>
                  <span>{passwordOtpLoading ? 'Sending OTP...' : 'Request Verification Code'}</span>
                </button>
              ) : (
                <div className="space-y-3 pt-2 border-t border-slate-800">
                  <div className="flex items-center justify-between text-xs">
                    <label className="text-slate-400 uppercase tracking-wider">6-Digit Verification Code</label>
                    <button
                      type="button"
                      onClick={handleRequestPasswordOtp}
                      className="text-cyan-400 hover:text-cyan-300 underline"
                    >
                      Resend Code
                    </button>
                  </div>
                  <input
                    type="text"
                    maxLength="6"
                    required
                    placeholder="123456"
                    value={passwordOtp}
                    onChange={(e) => setPasswordOtp(e.target.value)}
                    className="w-full bg-slate-950 border border-cyan-500/60 text-center tracking-widest font-mono text-lg rounded-lg p-2.5 text-white focus:outline-none focus:border-cyan-400"
                  />
                  <p className="text-xs text-slate-500">Check your email inbox for your 6-digit verification code</p>
                </div>
              )}

              <button
                type="submit"
                disabled={passwordLoading || !isPasswordOtpSent}
                className="w-full bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-bold py-2.5 px-4 rounded-lg transition-colors text-sm shadow-md shadow-cyan-600/20"
              >
                {passwordLoading ? 'Updating Password...' : 'Update Password'}
              </button>
            </form>
          </div>
        </div>
      </div>

      <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
        <div className="flex items-center space-x-3 mb-6">
          <span className="text-2xl">⚡</span>
          <div>
            <h2 className="text-xl font-semibold text-slate-200">Alerting & Webhook Dispatcher Channels</h2>
            <p className="text-sm text-slate-400">Receive real-time state transition alerts (UP ↔ DOWN) across email, webhooks, Discord, Slack, and Telegram.</p>
          </div>
        </div>

        {channelSuccess && (
          <div className="bg-green-950/60 border border-green-800/80 text-green-300 px-4 py-2.5 rounded-lg text-xs mb-6">
            {channelSuccess}
          </div>
        )}
        {channelError && (
          <div className="bg-red-950/60 border border-red-800/80 text-red-300 px-4 py-2.5 rounded-lg text-xs mb-6">
            {channelError}
          </div>
        )}

        <form onSubmit={handleCreateChannel} className="bg-slate-900/60 p-5 rounded-xl border border-slate-700/70 mb-6">
          <h3 className="text-sm font-semibold text-slate-300 mb-4">Add Notification Destination</h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1 font-medium">Channel Type</label>
              <select
                value={channelType}
                onChange={(e) => setChannelType(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm focus:outline-none focus:border-blue-500"
              >
                <option value="webhook">Custom Webhook (JSON)</option>
                <option value="discord">Discord Webhook</option>
                <option value="slack">Slack Incoming Webhook</option>
                <option value="telegram">Telegram Bot Webhook</option>
                <option value="email">Email Alert</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs text-slate-400 mb-1 font-medium">Destination URL or Email Address</label>
              <input
                type="text"
                required
                value={destinationUrl}
                onChange={(e) => setDestinationUrl(e.target.value)}
                placeholder={channelType === 'email' ? 'devops@company.com' : 'https://discord.com/api/webhooks/... or https://hooks.slack.com/...'}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm focus:outline-none focus:border-blue-500 font-mono"
              />
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={channelLoading}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold py-2.5 px-4 rounded-lg transition-colors text-sm shadow-md shadow-blue-600/30"
              >
                {channelLoading ? 'Adding...' : 'Add Channel'}
              </button>
            </div>
          </div>
        </form>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-300">Configured Notification Destinations ({channels.length})</h3>
          {channels.length === 0 ? (
            <div className="bg-slate-900/40 border border-dashed border-slate-700/80 rounded-xl p-8 text-center text-slate-500 text-sm">
              No alert channels configured. Add your first webhook or email above to start receiving outage alerts.
            </div>
          ) : (
            <div className="divide-y divide-slate-700/60 border border-slate-700/70 rounded-xl overflow-hidden bg-slate-900/40">
              {channels.map((ch) => (
                <div key={ch.id} className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="flex items-center space-x-3">
                    <span className="text-xl">
                      {ch.channel_type === 'discord' && '🎮'}
                      {ch.channel_type === 'slack' && '💬'}
                      {ch.channel_type === 'telegram' && '✈️'}
                      {ch.channel_type === 'email' && '✉️'}
                      {ch.channel_type === 'webhook' && '🔗'}
                    </span>
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="text-xs uppercase font-bold px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300">
                          {ch.channel_type}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                          ch.is_active ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800' : 'bg-slate-800 text-slate-500 border border-slate-700'
                        }`}>
                          {ch.is_active ? 'Active' : 'Muted'}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400 font-mono mt-1 break-all">
                        {ch.destination_url}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2 self-end sm:self-center">
                    <button
                      type="button"
                      onClick={() => handleTestChannel(ch.id)}
                      disabled={testingChannelId === ch.id}
                      className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs px-3 py-1.5 rounded-lg border border-slate-600 transition-colors"
                    >
                      {testingChannelId === ch.id ? 'Sending...' : 'Test Alert'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleChannel(ch.id, ch.is_active)}
                      className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                        ch.is_active 
                          ? 'bg-amber-950/60 hover:bg-amber-900/80 text-amber-300 border-amber-800/80' 
                          : 'bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-300 border-emerald-800/80'
                      }`}
                    >
                      {ch.is_active ? 'Mute' : 'Enable'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteChannel(ch.id)}
                      className="bg-red-950/60 hover:bg-red-900/80 text-red-300 text-xs px-3 py-1.5 rounded-lg border border-red-800/80 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const formatHistoryData = (rawData, requestedStartTime) => {
  if (!rawData || rawData.length === 0) return [];
  const reversed = [...rawData].reverse();
  const formatted = [];

  const firstLogTime = new Date(reversed[0].timestamp).getTime();

  if (requestedStartTime && requestedStartTime < firstLogTime) {
    let fillTime = requestedStartTime;
    while (fillTime < firstLogTime - 60000) {
      formatted.push({
        timestamp: fillTime,
        time: new Date(fillTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        fullDate: new Date(fillTime).toLocaleString([], { dateStyle: 'medium', timeStyle: 'medium' }),
        status: 1,
        statusText: 'Unmonitored',
        cpu_usage: null,
        ram_usage: null
      });
      fillTime += 60000;
    }
  }

  for (let i = 0; i < reversed.length; i++) {
    const currentLog = reversed[i];
    const currentTime = new Date(currentLog.timestamp).getTime();
    const currentStatus = currentLog.status;
    const currentCpu = currentLog.cpu_usage != null ? currentLog.cpu_usage : null;
    const currentRam = currentLog.ram_usage != null ? currentLog.ram_usage : null;

    if (i > 0) {
      const prevLog = reversed[i - 1];
      const prevTime = new Date(prevLog.timestamp).getTime();
      const prevStatus = prevLog.status;
      const prevCpu = prevLog.cpu_usage != null ? prevLog.cpu_usage : null;
      const prevRam = prevLog.ram_usage != null ? prevLog.ram_usage : null;

      let fillTime = prevTime + 30000;
      while (fillTime < currentTime - 30000) {
        formatted.push({
          timestamp: fillTime,
          time: new Date(fillTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          fullDate: new Date(fillTime).toLocaleString([], { dateStyle: 'medium', timeStyle: 'medium' }),
          status: prevStatus,
          statusText: prevStatus === 1 ? 'Online' : 'Offline',
          cpu_usage: prevCpu,
          ram_usage: prevRam
        });
        fillTime += 30000;
      }

      if (prevStatus !== currentStatus) {
        const cornerTime = currentTime - 1000;
        if (cornerTime > prevTime) {
          formatted.push({
            timestamp: cornerTime,
            time: new Date(cornerTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            fullDate: new Date(cornerTime).toLocaleString([], { dateStyle: 'medium', timeStyle: 'medium' }),
            status: prevStatus,
            statusText: prevStatus === 1 ? 'Online' : 'Offline',
            cpu_usage: prevCpu,
            ram_usage: prevRam
          });
        }
      }
    }

    formatted.push({
      timestamp: currentTime,
      time: new Date(currentTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      fullDate: new Date(currentTime).toLocaleString([], { dateStyle: 'medium', timeStyle: 'medium' }),
      status: currentStatus,
      statusText: currentStatus === 1 ? 'Online' : 'Offline',
      cpu_usage: currentCpu,
      ram_usage: currentRam
    });
  }
  
  return formatted;
};

const generateGradientStops = (data, onlineColor) => {
  if (!data || data.length === 0) return <stop offset="0%" stopColor={onlineColor} />;
  const stops = [];
  const minTime = data[0].timestamp;
  const maxTime = data[data.length - 1].timestamp;
  const timeRange = maxTime - minTime || 1;

  stops.push(<stop key="start" offset="0%" stopColor={data[0].status === 0 ? '#ef4444' : onlineColor} />);

  for (let i = 1; i < data.length; i++) {
    const d = data[i];
    const prev = data[i - 1];
    const color = d.status === 0 ? '#ef4444' : onlineColor;
    const prevColor = prev.status === 0 ? '#ef4444' : onlineColor;

    if (prevColor !== color) {
      const percentage = ((d.timestamp - minTime) / timeRange) * 100;
      const prevPercentage = ((prev.timestamp - minTime) / timeRange) * 100;

      if (color === '#ef4444') {
        stops.push(<stop key={`stop-${i}-a`} offset={`${prevPercentage}%`} stopColor={onlineColor} />);
        stops.push(<stop key={`stop-${i}-b`} offset={`${prevPercentage}%`} stopColor="#ef4444" />);
      } else {
        stops.push(<stop key={`stop-${i}-a`} offset={`${percentage}%`} stopColor="#ef4444" />);
        stops.push(<stop key={`stop-${i}-b`} offset={`${percentage}%`} stopColor={onlineColor} />);
      }
    }
  }
  return stops;
};

function ServerCard({ server, onDelete }) {
  const [history, setHistory] = useState([]);
  const endTime = new Date().getTime();
  const startTime = endTime - 3600000;
  const apiBase = getApiBase();
  const { authFetch } = useAuth();

  useEffect(() => {
    authFetch(`${apiBase}/servers/${server.server_id}/history`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setHistory(formatHistoryData(data, startTime));
        }
      })
      .catch(err => console.error(err));
  }, [server.server_id, server.is_active, apiBase]);

  return (
    <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg transition-all hover:border-slate-500 flex flex-col h-full">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-semibold text-blue-400 truncate pr-2">{server.hostname}</h2>
        <div className="flex items-center space-x-3 shrink-0">
          <span className="text-2xl select-none" title={server.is_active ? 'Online' : 'Offline'}>
            {server.is_active ? '🟢' : '🔴'}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(server.server_id);
            }}
            className="text-xs bg-red-950/60 hover:bg-red-600 border border-red-800/80 hover:border-red-500 text-red-300 hover:text-white px-2.5 py-1 rounded transition-colors"
            title="Delete Server"
          >
            Delete
          </button>
        </div>
      </div>
      
      <div className="space-y-2 text-slate-300 mb-4 flex-grow text-xs">
        <p><span className="font-bold text-slate-500">Target:</span> {server.target_address || 'N/A'}</p>
        <p><span className="font-bold text-slate-500">Role:</span> {server.server_role}</p>
        <p><span className="font-bold text-slate-500">Connections:</span> {server.active_connections}</p>
        {server.ssl_days_remaining !== null && server.ssl_days_remaining !== undefined && (
          <p className="flex items-center space-x-1.5 pt-1">
            <span className="font-bold text-slate-500">SSL Cert:</span>
            <span className={`px-2 py-0.5 rounded font-mono font-medium ${
              server.ssl_days_remaining <= 7
                ? 'bg-red-950/80 text-red-300 border border-red-800'
                : server.ssl_days_remaining <= 30
                ? 'bg-amber-950/80 text-amber-300 border border-amber-800'
                : 'bg-emerald-950/80 text-emerald-300 border border-emerald-800'
            }`}>
              🔒 {server.ssl_days_remaining}d left ({server.ssl_expiry_date ? new Date(server.ssl_expiry_date).toLocaleDateString() : ''})
            </span>
          </p>
        )}
      </div>

      <div className="h-32 w-full mt-4 border-t border-slate-700 pt-4">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={history} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id={`colorStatusDashboard-${server.server_id}`} x1="0%" y1="0%" x2="100%" y2="0%">
                {generateGradientStops(history, '#22c55e')}
              </linearGradient>
            </defs>
            <XAxis 
              dataKey="timestamp" 
              type="number"
              domain={[startTime, endTime]}
              tickFormatter={(unixTime) => new Date(unixTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              stroke="#64748b" 
              fontSize={11} 
              tickMargin={8} 
              minTickGap={15} 
              tickCount={12}
            />
            <YAxis domain={[0, 1]} hide={true} />
            
            <Tooltip 
              contentStyle={{ backgroundColor: '#1e293b', borderColor: '#475569', color: '#f8fafc', borderRadius: '0.5rem' }}
              labelStyle={{ color: '#94a3b8', marginBottom: '4px', fontSize: '12px' }}
              labelFormatter={(label, payload) => {
                 if (payload && payload.length > 0) {
                   return payload[0].payload.fullDate;
                 }
                 return label;
              }}
              formatter={(value, name, props) => [props.payload.statusText, 'Status']}
            />
            
            <Line 
              type="linear" 
              dataKey="status" 
              stroke={`url(#colorStatusDashboard-${server.server_id})`} 
              strokeWidth={2} 
              dot={false} 
              activeDot={(props) => {
                const { cx, cy, payload } = props;
                return <circle key={`dot-${cx}-${cy}`} cx={cx} cy={cy} r={5} fill={payload.status === 0 ? "#ef4444" : "#22c55e"} stroke="#1e293b" strokeWidth={2} />;
              }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Dashboard() {
  const [servers, setServers] = useState([]);
  const [hostname, setHostname] = useState("");
  const [serverRole, setServerRole] = useState("");
  const [targetAddress, setTargetAddress] = useState("");
  const [copied, setCopied] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);

  const apiBase = getApiBase();
  const { authFetch } = useAuth();
  const currentHost = typeof window !== 'undefined' && window.location.hostname ? window.location.hostname : 'localhost';
  const installCmd = `curl -fsSL http://${currentHost}:8000/install.sh | bash -s http://${currentHost}:8000/agent/metric_agent.py`;

  const fetchServers = () => {
    authFetch(`${apiBase}/servers`)
      .then(response => response.json())
      .then(data => {
        if (Array.isArray(data)) {
          setServers(data);
        }
      })
      .catch(error => console.error(error));
  };

  useEffect(() => {
    fetchServers();

    let ws = null;
    let reconnectTimer = null;
    let isMounted = true;

    const connectWs = () => {
      if (!isMounted) return;
      try {
        const wsUrl = getWsUrl();
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          if (isMounted) setWsConnected(true);
        };

        ws.onmessage = (event) => {
          if (!isMounted) return;
          try {
            const data = JSON.parse(event.data);
            if ((data.type === 'SERVERS_UPDATE' || data.type === 'INITIAL_STATE') && Array.isArray(data.servers)) {
              setServers(data.servers);
            }
          } catch (err) {
            console.error(err);
          }
        };

        ws.onclose = () => {
          if (isMounted) {
            setWsConnected(false);
            reconnectTimer = setTimeout(connectWs, 3000);
          }
        };

        ws.onerror = () => {
          if (ws) ws.close();
        };
      } catch (err) {
        if (isMounted) {
          reconnectTimer = setTimeout(connectWs, 3000);
        }
      }
    };

    connectWs();

    const fallbackInterval = setInterval(() => {
      fetchServers();
    }, 15000);

    return () => {
      isMounted = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      clearInterval(fallbackInterval);
      if (ws) ws.close();
    };
  }, [apiBase]);

  const handleAddServer = (e) => {
    e.preventDefault();
    const newServer = { hostname, server_role: serverRole, target_address: targetAddress };

    authFetch(`${apiBase}/servers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newServer),
    })
    .then(response => response.json())
    .then(() => {
      setHostname("");
      setServerRole("");
      setTargetAddress(""); 
      fetchServers();
    })
    .catch(error => console.error(error));
  };

  const deleteServer = async (serverId) => {
    setServers(prevServers => prevServers.filter(s => String(s.server_id) !== String(serverId)));
    try {
      const response = await authFetch(`${apiBase}/servers/${serverId}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        fetchServers();
      }
    } catch (error) {
      console.error(error);
      fetchServers();
    }
  };

  const handleCopyCommand = () => {
    navigator.clipboard.writeText(installCmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
          <h2 className="text-xl font-semibold mb-4 text-slate-200">Add New Server</h2>
          <form onSubmit={handleAddServer} className="space-y-4">
            <div>
              <label className="block text-slate-400 text-sm mb-1">Hostname</label>
              <input 
                type="text" value={hostname} onChange={(e) => setHostname(e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white focus:outline-none focus:border-blue-500" required
              />
            </div>
            <div>
              <label className="block text-slate-400 text-sm mb-1">Server Role</label>
              <input 
                type="text" value={serverRole} onChange={(e) => setServerRole(e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white focus:outline-none focus:border-blue-500" required
              />
            </div>
            <div>
              <label className="block text-slate-400 text-sm mb-1">Target Address (IP or URL)</label>
              <input 
                type="text" value={targetAddress} onChange={(e) => setTargetAddress(e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white focus:outline-none focus:border-blue-500" required
              />
            </div>
            <button type="submit" className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 px-4 rounded w-full transition-colors">
              Deploy Server
            </button>
          </form>
        </div>

        <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg flex flex-col justify-between">
          <div>
            <div className="flex items-center space-x-2 mb-2">
              <span className="text-xl">⚡</span>
              <h2 className="text-xl font-semibold text-slate-200">One-Click Agent Deployment</h2>
            </div>
            <p className="text-slate-400 text-sm mb-4">
              Run this automated command on your target Linux machine (Ubuntu, Debian, RHEL, CentOS) to install dependencies, configure systemd, and open port 8001.
            </p>
            <div className="bg-slate-950 border border-slate-700 rounded-lg p-3 relative group">
              <pre className="text-xs md:text-sm text-green-400 font-mono overflow-x-auto whitespace-pre-wrap break-all pr-16 select-all">
                {installCmd}
              </pre>
              <button
                type="button"
                onClick={handleCopyCommand}
                className={`absolute top-2.5 right-2.5 px-3 py-1.5 rounded text-xs font-semibold transition-all ${
                  copied ? "bg-green-600 text-white" : "bg-slate-700 hover:bg-slate-600 text-slate-200"
                }`}
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-slate-700/60 flex items-center justify-between text-xs text-slate-400">
            <span>Listens on TCP port <strong className="text-slate-200 font-mono">8001</strong></span>
            <span>Root / Sudo Required</span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-slate-200">Monitored Infrastructure ({servers.length})</h2>
        <div className="flex items-center space-x-2 text-xs font-mono bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-full">
          <span className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`}></span>
          <span className={wsConnected ? 'text-emerald-400 font-semibold' : 'text-amber-400'}>
            {wsConnected ? 'WebSocket Live' : 'Reconnecting...'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {servers.map((server) => (
          <ServerCard key={server.server_id} server={server} onDelete={deleteServer} />
        ))}
      </div>
    </div>
  );
}

function Analytics() {
  const [servers, setServers] = useState([]);
  const [selectedServer, setSelectedServer] = useState("");
  const [matrix, setMatrix] = useState({ "24h": "0.00", "7d": "0.00", "14d": "0.00", "30d": "0.00" });
  const [downtimeLogs, setDowntimeLogs] = useState([]);
  const [uptimeLogs, setUptimeLogs] = useState([]);
  const [graphHours, setGraphHours] = useState(24);
  const [graphData, setGraphData] = useState([]);
  const [isCpuOpen, setIsCpuOpen] = useState(true);
  const [isRamOpen, setIsRamOpen] = useState(true);
  const [retentionStats, setRetentionStats] = useState(null);
  const [isRollupRunning, setIsRollupRunning] = useState(false);
  const [rollupFeedback, setRollupFeedback] = useState("");

  const apiBase = getApiBase();
  const { authFetch } = useAuth();
  const endTime = new Date().getTime();
  const startTime = endTime - (graphHours * 3600000);

  const fetchRetentionStats = () => {
    authFetch(`${apiBase}/system/retention-stats`)
      .then(res => res.json())
      .then(data => setRetentionStats(data))
      .catch(err => console.error(err));
  };

  useEffect(() => {
    authFetch(`${apiBase}/servers`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setServers(data);
          if (data.length > 0) {
            setSelectedServer(data[0].server_id);
          }
        }
      })
      .catch(err => console.error(err));
      
    fetchRetentionStats();
  }, [apiBase]);

  useEffect(() => {
    if (!selectedServer) return;

    authFetch(`${apiBase}/servers/${selectedServer}/uptime`)
      .then(res => res.json())
      .then(data => setMatrix(data))
      .catch(err => console.error(err));

    authFetch(`${apiBase}/servers/${selectedServer}/logs?status=0&limit=10`)
      .then(res => res.json())
      .then(data => setDowntimeLogs(data))
      .catch(err => console.error(err));

    authFetch(`${apiBase}/servers/${selectedServer}/logs?status=1&limit=10`)
      .then(res => res.json())
      .then(data => setUptimeLogs(data))
      .catch(err => console.error(err));
  }, [selectedServer, apiBase]);

  useEffect(() => {
    if (!selectedServer) return;

    authFetch(`${apiBase}/servers/${selectedServer}/history?hours=${graphHours}`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setGraphData(formatHistoryData(data, startTime));
        }
      })
      .catch(err => console.error(err));
  }, [selectedServer, graphHours, apiBase]);

  const handleTriggerRollup = async () => {
    setIsRollupRunning(true);
    setRollupFeedback("");
    try {
      const res = await authFetch(`${apiBase}/system/trigger-rollup`, { method: 'POST' });
      const data = await res.json();
      setRollupFeedback(data.message || "Rollup executed");
      fetchRetentionStats();
    } catch (err) {
      console.error(err);
      setRollupFeedback("Error executing rollup");
    } finally {
      setIsRollupRunning(false);
      setTimeout(() => setRollupFeedback(""), 4000);
    }
  };

  const latestMetrics = useMemo(() => {
    if (!graphData || graphData.length === 0) return { cpu: null, ram: null };
    for (let i = graphData.length - 1; i >= 0; i--) {
      if (graphData[i].cpu_usage !== null || graphData[i].ram_usage !== null) {
        return {
          cpu: graphData[i].cpu_usage,
          ram: graphData[i].ram_usage
        };
      }
    }
    return { cpu: null, ram: null };
  }, [graphData]);

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
        <label className="block text-slate-400 text-sm mb-2">Select Target Server</label>
        <select 
          value={selectedServer} 
          onChange={(e) => setSelectedServer(e.target.value)}
          className="w-full md:w-1/3 bg-slate-900 border border-slate-600 rounded p-2 text-white focus:outline-none focus:border-blue-500"
        >
          {servers.map(s => (
            <option key={s.server_id} value={s.server_id}>{s.hostname} ({s.target_address})</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Object.entries(matrix).map(([timeframe, percentage]) => (
          <div key={timeframe} className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg flex flex-col items-center justify-center">
            <span className="text-slate-400 text-sm uppercase tracking-wider mb-2">{timeframe} Uptime</span>
            <span className={`text-3xl font-bold ${parseFloat(percentage) > 99 ? 'text-green-500' : parseFloat(percentage) > 95 ? 'text-yellow-500' : 'text-red-500'}`}>
              {percentage}%
            </span>
          </div>
        ))}
      </div>

      <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-semibold text-slate-200">Historical Timeline</h3>
          <div className="flex space-x-2">
            {[
              { label: '1H', value: 1 },
              { label: '24H', value: 24 },
              { label: '7D', value: 168 }
            ].map(btn => (
              <button
                key={btn.label}
                onClick={() => setGraphHours(btn.value)}
                className={`px-3 py-1 rounded text-sm transition-colors ${
                  graphHours === btn.value ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
              >
                {btn.label}
              </button>
            ))}
          </div>
        </div>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={graphData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorStatusAnalytics" x1="0%" y1="0%" x2="100%" y2="0%">
                  {generateGradientStops(graphData, '#3b82f6')}
                </linearGradient>
              </defs>
              <XAxis 
                dataKey="timestamp" 
                type="number"
                domain={[startTime, endTime]}
                tickFormatter={(unixTime) => new Date(unixTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                stroke="#64748b" 
                fontSize={11} 
                tickMargin={8} 
                minTickGap={15} 
                tickCount={12}
              />
              <YAxis domain={[0, 1]} hide={true} />
              
              <Tooltip 
                contentStyle={{ backgroundColor: '#1e293b', borderColor: '#475569', color: '#f8fafc', borderRadius: '0.5rem' }}
                labelStyle={{ color: '#94a3b8', marginBottom: '4px', fontSize: '12px' }}
                labelFormatter={(label, payload) => {
                   if (payload && payload.length > 0) {
                     return payload[0].payload.fullDate;
                   }
                   return label;
                }}
                formatter={(value, name, props) => [props.payload.statusText, 'Status']}
              />
              
              <Line 
                type="linear" 
                dataKey="status" 
                stroke="url(#colorStatusAnalytics)" 
                strokeWidth={2} 
                dot={false} 
                activeDot={(props) => {
                  const { cx, cy, payload } = props;
                  return <circle key={`dot-${cx}-${cy}`} cx={cx} cy={cy} r={5} fill={payload.status === 0 ? "#ef4444" : "#3b82f6"} stroke="#1e293b" strokeWidth={2} />;
                }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center space-x-3">
            <h3 className="text-xl font-semibold text-purple-400">CPU Performance</h3>
            {latestMetrics.cpu !== null && (
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-900/60 text-purple-300 border border-purple-700">
                {latestMetrics.cpu.toFixed(1)}% Current
              </span>
            )}
          </div>
          <button 
            onClick={() => setIsCpuOpen(!isCpuOpen)}
            className="px-3 py-1 rounded text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
          >
            {isCpuOpen ? 'Collapse' : 'Expand'}
          </button>
        </div>
        {isCpuOpen && (
          <div className="h-64 w-full mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={graphData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="cpuGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#a855f7" stopOpacity={0.8}/>
                    <stop offset="95%" stopColor="#a855f7" stopOpacity={0.1}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis 
                  dataKey="timestamp" 
                  type="number"
                  domain={[startTime, endTime]}
                  tickFormatter={(unixTime) => new Date(unixTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  stroke="#64748b" 
                  fontSize={11} 
                  tickMargin={8} 
                  minTickGap={15} 
                  tickCount={12}
                />
                <YAxis 
                  domain={[0, 100]} 
                  stroke="#64748b" 
                  fontSize={11}
                  tickFormatter={(val) => `${val}%`}
                  width={45}
                />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#1e293b', borderColor: '#475569', color: '#f8fafc', borderRadius: '0.5rem' }}
                  labelStyle={{ color: '#94a3b8', marginBottom: '4px', fontSize: '12px' }}
                  labelFormatter={(label, payload) => {
                    if (payload && payload.length > 0) {
                      return payload[0].payload.fullDate;
                    }
                    return label;
                  }}
                  formatter={(value) => [value != null ? `${Number(value).toFixed(1)}%` : 'N/A', 'CPU Load']}
                />
                <Line 
                  type="monotone" 
                  dataKey="cpu_usage" 
                  stroke="#a855f7" 
                  strokeWidth={2} 
                  dot={false}
                  connectNulls={true}
                  activeDot={{ r: 5, fill: '#a855f7', stroke: '#1e293b', strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center space-x-3">
            <h3 className="text-xl font-semibold text-cyan-400">RAM Performance</h3>
            {latestMetrics.ram !== null && (
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-cyan-900/60 text-cyan-300 border border-cyan-700">
                {latestMetrics.ram.toFixed(1)}% Current
              </span>
            )}
          </div>
          <button 
            onClick={() => setIsRamOpen(!isRamOpen)}
            className="px-3 py-1 rounded text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
          >
            {isRamOpen ? 'Collapse' : 'Expand'}
          </button>
        </div>
        {isRamOpen && (
          <div className="h-64 w-full mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={graphData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis 
                  dataKey="timestamp" 
                  type="number"
                  domain={[startTime, endTime]}
                  tickFormatter={(unixTime) => new Date(unixTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  stroke="#64748b" 
                  fontSize={11} 
                  tickMargin={8} 
                  minTickGap={15} 
                  tickCount={12}
                />
                <YAxis 
                  domain={[0, 100]} 
                  stroke="#64748b" 
                  fontSize={11}
                  tickFormatter={(val) => `${val}%`}
                  width={45}
                />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#1e293b', borderColor: '#475569', color: '#f8fafc', borderRadius: '0.5rem' }}
                  labelStyle={{ color: '#94a3b8', marginBottom: '4px', fontSize: '12px' }}
                  labelFormatter={(label, payload) => {
                    if (payload && payload.length > 0) {
                      return payload[0].payload.fullDate;
                    }
                    return label;
                  }}
                  formatter={(value) => [value != null ? `${Number(value).toFixed(1)}%` : 'N/A', 'RAM Load']}
                />
                <Line 
                  type="monotone" 
                  dataKey="ram_usage" 
                  stroke="#06b6d4" 
                  strokeWidth={2} 
                  dot={false}
                  connectNulls={true}
                  activeDot={{ r: 5, fill: '#06b6d4', stroke: '#1e293b', strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-xl">🗄️</span>
              <h3 className="text-xl font-semibold text-slate-200">Database Retention & Storage Lifecycle</h3>
            </div>
            <p className="text-sm text-slate-400 mt-1">
              Automated 3-tier lifecycle: 30-day raw downsampling, 15-month hourly rollups, and auto-purge.
            </p>
          </div>
          <div className="flex items-center space-x-3">
            {rollupFeedback && (
              <span className="text-xs text-green-400 font-mono bg-green-950/60 border border-green-800/80 px-2.5 py-1 rounded">
                {rollupFeedback}
              </span>
            )}
            <button
              onClick={handleTriggerRollup}
              disabled={isRollupRunning}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors flex items-center space-x-2 shrink-0"
            >
              <span>{isRollupRunning ? "Running Rollup..." : "⚡ Run Rollup Now"}</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-slate-900/70 p-4 rounded-lg border border-slate-700">
            <span className="text-xs text-slate-400 uppercase tracking-wider block mb-1">Hot Tier (Raw Metrics)</span>
            <div className="text-2xl font-bold text-blue-400">
              {retentionStats ? retentionStats.raw_count.toLocaleString() : "..."}
            </div>
            <span className="text-xs text-slate-500 mt-1 block">Full resolution (&lt; 30 days)</span>
          </div>

          <div className="bg-slate-900/70 p-4 rounded-lg border border-slate-700">
            <span className="text-xs text-slate-400 uppercase tracking-wider block mb-1">Warm Tier (Hourly Rollups)</span>
            <div className="text-2xl font-bold text-amber-400">
              {retentionStats ? retentionStats.hourly_count.toLocaleString() : "..."}
            </div>
            <span className="text-xs text-slate-500 mt-1 block">Downsampled (30d - 15m)</span>
          </div>

          <div className="bg-slate-900/70 p-4 rounded-lg border border-slate-700">
            <span className="text-xs text-slate-400 uppercase tracking-wider block mb-1">Scheduled Rollup</span>
            <div className="text-lg font-bold text-emerald-400">
              {retentionStats ? retentionStats.next_schedule : "02:00 UTC"}
            </div>
            <span className="text-xs text-slate-500 mt-1 block">Automated background cron</span>
          </div>

          <div className="bg-slate-900/70 p-4 rounded-lg border border-slate-700">
            <span className="text-xs text-slate-400 uppercase tracking-wider block mb-1">Max Hard Retention</span>
            <div className="text-lg font-bold text-purple-400">15 Months</div>
            <span className="text-xs text-slate-500 mt-1 block">Automatic cold purge</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
          <h3 className="text-xl font-semibold text-red-400 mb-4">Downtime Incident Log</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="text-xs text-slate-500 uppercase bg-slate-900/50">
                <tr>
                  <th className="px-4 py-3 rounded-tl-lg">Status</th>
                  <th className="px-4 py-3 rounded-tr-lg">Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {downtimeLogs.length === 0 ? (
                  <tr><td colSpan="2" className="px-4 py-4 text-center text-slate-500">No downtime incidents recorded.</td></tr>
                ) : (
                  downtimeLogs.map((log, idx) => (
                    <tr key={idx} className="border-b border-slate-700/50 last:border-0">
                      <td className="px-4 py-3 text-red-500">Offline</td>
                      <td className="px-4 py-3">{new Date(log.timestamp).toLocaleString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
          <h3 className="text-xl font-semibold text-green-400 mb-4">Recent Uptime Log</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="text-xs text-slate-500 uppercase bg-slate-900/50">
                <tr>
                  <th className="px-4 py-3 rounded-tl-lg">Status</th>
                  <th className="px-4 py-3 rounded-tr-lg">Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {uptimeLogs.length === 0 ? (
                  <tr><td colSpan="2" className="px-4 py-4 text-center text-slate-500">No uptime logs recorded.</td></tr>
                ) : (
                  uptimeLogs.map((log, idx) => (
                    <tr key={idx} className="border-b border-slate-700/50 last:border-0">
                      <td className="px-4 py-3 text-green-500">Online</td>
                      <td className="px-4 py-3">{new Date(log.timestamp).toLocaleString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function Layout({ children }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const location = useLocation();
  const { user, logout } = useAuth();

  const getPageTitle = () => {
    if (location.pathname === "/analytics") return "System Analytics";
    if (location.pathname === "/settings") return "Account Settings";
    return "PulseWatch Dashboard";
  };

  return (
    <div className="flex min-h-screen bg-slate-900 text-white font-mono overflow-hidden">
      <div 
        className={`fixed inset-y-0 left-0 z-30 bg-slate-800 border-slate-700 transition-all duration-300 ease-in-out md:relative
        ${isSidebarOpen ? "w-64 translate-x-0 border-r" : "w-64 -translate-x-full md:w-0 md:translate-x-0 md:border-r-0 md:overflow-hidden"}`}
      >
        <div className="w-64 h-full flex flex-col">
          <div className="p-6 flex items-center justify-between">
            <h1 className="text-2xl font-bold text-blue-500">PulseWatch</h1>
            <button onClick={() => setIsSidebarOpen(false)} className="md:hidden text-slate-400 hover:text-white text-2xl">
              ✕
            </button>
          </div>
          <nav className="px-4 mt-6 space-y-2 flex-grow">
            <Link 
              to="/" 
              className={`block px-4 py-3 rounded-lg transition-colors ${location.pathname === "/" ? "bg-blue-600 text-white" : "text-slate-400 hover:bg-slate-700 hover:text-white"}`}
            >
              Dashboard
            </Link>
            <Link 
              to="/analytics" 
              className={`block px-4 py-3 rounded-lg transition-colors ${location.pathname === "/analytics" ? "bg-blue-600 text-white" : "text-slate-400 hover:bg-slate-700 hover:text-white"}`}
            >
              Analytics
            </Link>
            <Link 
              to="/settings" 
              className={`block px-4 py-3 rounded-lg transition-colors ${location.pathname === "/settings" ? "bg-blue-600 text-white" : "text-slate-400 hover:bg-slate-700 hover:text-white"}`}
            >
              Settings
            </Link>
          </nav>
          
          {user && (
            <Link to="/settings" className="p-4 m-4 bg-slate-900/60 hover:bg-slate-900 rounded-xl border border-slate-700/60 transition-colors block">
              <div className="text-xs text-slate-400 mb-1">Signed in as</div>
              <div className="font-semibold text-blue-400 truncate">{user.username}</div>
            </Link>
          )}
        </div>
      </div>

      {isSidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-20 md:hidden" onClick={() => setIsSidebarOpen(false)}></div>
      )}

      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-y-auto">
        <header className="bg-slate-800/50 border-b border-slate-700 p-4 flex items-center justify-between sticky top-0 z-10">
          <div className="flex items-center">
            <button 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)} 
              className="mr-4 text-slate-400 hover:text-white text-2xl transition-colors"
            >
              ☰
            </button>
            <h2 className="text-xl font-semibold text-slate-200">{getPageTitle()}</h2>
          </div>
          
          <div className="flex items-center space-x-3">
            {user && (
              <Link to="/settings" className="hidden sm:inline-block text-xs bg-slate-900 hover:bg-slate-800 border border-slate-700 px-3 py-1.5 rounded-full text-slate-300 transition-colors">
                👤 <strong className="text-blue-400">{user.username}</strong>
              </Link>
            )}
            <button
              onClick={logout}
              className="text-xs bg-red-950/60 hover:bg-red-600 border border-red-800/80 hover:border-red-500 text-red-300 hover:text-white px-3 py-1.5 rounded-lg transition-colors font-semibold"
              title="Sign Out"
            >
              Sign Out
            </button>
          </div>
        </header>
        
        <main className="p-6 md:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}

function ProtectedApp() {
  const { token } = useAuth();

  if (!token) {
    return <AuthScreen />;
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ProtectedApp />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;