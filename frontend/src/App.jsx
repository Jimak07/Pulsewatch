import { useState, useEffect, useMemo, createContext, useContext } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';
import {
  LineChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  YAxis,
  XAxis,
  CartesianGrid,
  Brush,
  AreaChart,
  Area,
} from 'recharts';
import {
  Activity,
  Server,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Bell,
  Mail,
  Lock,
  Wifi,
  WifiOff,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Cpu,
  HardDrive,
  Clock,
  Trash2,
  Copy,
  Check,
  Sun,
  Moon,
  Plus,
  Search,
  ExternalLink,
  Radio,
  Eye,
  Settings as SettingsIcon,
  BarChart3,
  LayoutDashboard,
  LogOut,
  Menu,
  X,
  Send,
  Terminal,
  Heart,
  Zap,
  Globe,
  Sliders,
  Database,
  Key,
} from 'lucide-react';

import AddMonitorModal from './AddMonitorModal.jsx';
import { Button } from './components/ui/button';
import { Badge } from './components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from './components/ui/card';
import { Input } from './components/ui/input';
import { Switch } from './components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './components/ui/tabs';
import { ChartContainer, ChartTooltipContent } from './components/ui/chart';
import { HeartbeatStrip } from './components/ui/heartbeat-strip';
import { EkgLoadingScreen } from './components/ui/ekg-loader';

const getApiBase = () => {
  const configuredBase = import.meta.env.VITE_API_BASE?.trim();
  if (configuredBase) return configuredBase.replace(/\/$/, '');
  if (typeof window !== 'undefined' && window.location.hostname) {
    return `${window.location.protocol}//${window.location.hostname}:8000`;
  }
  return 'http://localhost:8000';
};

const getWsUrl = () => {
  const configuredWs = import.meta.env.VITE_WS_URL?.trim();
  if (configuredWs) {
    const wsUrl = new URL(configuredWs);
    if (wsUrl.protocol !== 'ws:' && wsUrl.protocol !== 'wss:') {
      throw new Error('VITE_WS_URL must use ws:// or wss://');
    }
    return wsUrl.toString();
  }
  const apiUrl = new URL('/ws', `${getApiBase()}/`);
  apiUrl.protocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  apiUrl.search = '';
  return apiUrl.toString();
};

const AuthContext = createContext();
const ThemeContext = createContext();

export const useAuth = () => useContext(AuthContext);
export const useTheme = () => useContext(ThemeContext);

function ThemeProvider({ children }) {
  const [isDark, setIsDark] = useState(() => {
    try {
      return localStorage.getItem('pulsewatch-theme') !== 'light';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
    try {
      localStorage.setItem('pulsewatch-theme', isDark ? 'dark' : 'light');
    } catch {}
  }, [isDark]);

  const toggleTheme = () => {
    setIsDark((val) => !val);
  };

  return (
    <ThemeContext.Provider value={{ isDark, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(true);

  const authFetch = async (url, options = {}) => {
    const headers = { ...(options.headers || {}) };
    const res = await fetch(url, { ...options, headers, credentials: 'include' });
    if (res.status === 401) setUser(null);
    return res;
  };

  useEffect(() => {
    const controller = new AbortController();
    const checkSession = async () => {
      try {
        const res = await fetch(`${getApiBase()}/users/me`, {
          credentials: 'include',
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });
        if (res.ok) {
          setUser(await res.json());
        } else if (res.status === 401) {
          setUser(null);
        }
      } catch (error) {
        if (error?.name !== 'AbortError') setUser(null);
      } finally {
        if (!controller.signal.aborted) setSessionLoading(false);
      }
    };
    checkSession();
    return () => controller.abort();
  }, []);

  const login = async (username, password) => {
    const apiBase = getApiBase();
    const cleanUser = (username || '').trim();
    const res = await fetch(`${apiBase}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username: cleanUser, password }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || 'Login failed');
    }
    const data = await res.json();
    if (data.require_2fa) {
      return data;
    }
    setUser({ user_id: data.user_id, username: data.username });
    return data;
  };

  const verify2fa = async (username, otp_code) => {
    const apiBase = getApiBase();
    const cleanUser = (username || '').trim();
    const cleanOtp = (otp_code || '').trim();
    const res = await fetch(`${apiBase}/login/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username: cleanUser, otp_code: cleanOtp }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || '2FA verification failed');
    }
    const data = await res.json();
    setUser({ user_id: data.user_id, username: data.username });
    return data;
  };

  const register = async (username, password) => {
    const apiBase = getApiBase();
    const cleanUser = (username || '').trim();
    const res = await fetch(`${apiBase}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username: cleanUser, password }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || 'Registration failed');
    }
    const data = await res.json();
    setUser({ user_id: data.user_id, username: data.username });
    return data;
  };

  const updateUser = (newUsername) => {
    setUser((prev) => ({ ...(prev || {}), username: newUsername }));
  };

  const logout = async () => {
    await fetch(`${getApiBase()}/logout`, { method: 'POST', credentials: 'include' }).catch(() => {});
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        sessionLoading,
        login,
        verify2fa,
        register,
        logout,
        authFetch,
        updateUser,
      }}
    >
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
  const { isDark, toggleTheme } = useTheme();

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

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-black flex flex-col items-center justify-center p-4 font-sans text-neutral-950 dark:text-neutral-50 relative selection:bg-neutral-900 selection:text-white dark:selection:bg-white dark:selection:text-black">
      <div className="absolute top-6 right-6">
        <Button
          variant="outline"
          size="icon"
          onClick={toggleTheme}
          aria-label="Toggle theme"
        >
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
      </div>

      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-neutral-900 text-white dark:bg-neutral-50 dark:text-neutral-950 shadow-lg mb-2">
            <Activity className="h-6 w-6 animate-pulse text-emerald-500" />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight font-mono">PULSEWATCH</h1>
          <p className="text-xs uppercase tracking-widest text-neutral-500 dark:text-neutral-400">
            Enterprise Infrastructure Telemetry
          </p>
        </div>

        <Card className="shadow-2xl border-neutral-200 dark:border-neutral-800 backdrop-blur-md">
          <CardHeader className="space-y-1 pb-4">
            {!require2fa && (
              <div className="grid grid-cols-2 p-1 rounded-lg bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
                <button
                  type="button"
                  onClick={() => {
                    setIsRegister(false);
                    setError('');
                  }}
                  className={`py-1.5 text-xs font-semibold rounded-md transition-all ${
                    !isRegister
                      ? 'bg-white text-neutral-950 dark:bg-neutral-950 dark:text-neutral-50 shadow-sm'
                      : 'text-neutral-500 hover:text-neutral-950 dark:hover:text-neutral-50'
                  }`}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsRegister(true);
                    setError('');
                  }}
                  className={`py-1.5 text-xs font-semibold rounded-md transition-all ${
                    isRegister
                      ? 'bg-white text-neutral-950 dark:bg-neutral-950 dark:text-neutral-50 shadow-sm'
                      : 'text-neutral-500 hover:text-neutral-950 dark:hover:text-neutral-50'
                  }`}
                >
                  Register
                </button>
              </div>
            )}
          </CardHeader>

          <CardContent className="space-y-4 pt-2">
            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs font-medium text-red-600 dark:text-red-400">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {require2fa ? (
              <form onSubmit={handleVerify2fa} className="space-y-4">
                <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/60 p-4 text-center space-y-2">
                  <ShieldCheck className="h-8 w-8 mx-auto text-emerald-500" />
                  <h2 className="text-sm font-bold tracking-tight">Two-Factor Authentication</h2>
                  <p className="text-xs text-neutral-600 dark:text-neutral-400">
                    A 6-digit verification code has been dispatched to{' '}
                    <strong className="text-neutral-950 dark:text-neutral-50">{twoFaEmail}</strong>
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-500 text-center">
                    Enter Verification Code
                  </label>
                  <Input
                    type="text"
                    maxLength="6"
                    required
                    autoFocus
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value)}
                    placeholder="123456"
                    className="text-center tracking-widest font-mono text-xl py-2"
                  />
                </div>

                <Button type="submit" disabled={loading} className="w-full">
                  {loading ? 'Verifying...' : 'Verify & Continue'}
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setRequire2fa(false);
                    setOtpCode('');
                    setError('');
                  }}
                  className="w-full text-xs"
                >
                  Back to Login
                </Button>
              </form>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                    Username
                  </label>
                  <Input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="e.g. devops-admin"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                    Password
                  </label>
                  <Input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                </div>

                <Button type="submit" disabled={loading} className="w-full font-bold">
                  {loading
                    ? 'Authenticating...'
                    : isRegister
                    ? 'Create Tenant Account'
                    : 'Sign In to Cluster'}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
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
        onlineStatus: 1,
        offlineStatus: null,
        statusText: 'Unmonitored',
        cpu_usage: null,
        ram_usage: null,
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
          status: prevStatus === 1 || prevStatus === '1' || prevStatus === 'Online' ? 1 : 0,
          onlineStatus: prevStatus === 1 || prevStatus === '1' || prevStatus === 'Online' ? 1 : null,
          offlineStatus: prevStatus === 1 || prevStatus === '1' || prevStatus === 'Online' ? null : 0,
          statusText: prevStatus === 1 || prevStatus === '1' || prevStatus === 'Online' ? 'Online' : 'Offline',
          cpu_usage: prevCpu,
          ram_usage: prevRam,
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
            status: prevStatus === 1 || prevStatus === '1' || prevStatus === 'Online' ? 1 : 0,
            onlineStatus: prevStatus === 1 || prevStatus === '1' || prevStatus === 'Online' ? 1 : null,
            offlineStatus: prevStatus === 1 || prevStatus === '1' || prevStatus === 'Online' ? null : 0,
            statusText: prevStatus === 1 || prevStatus === '1' || prevStatus === 'Online' ? 'Online' : 'Offline',
            cpu_usage: prevCpu,
            ram_usage: prevRam,
          });
        }
      }
    }

    formatted.push({
      timestamp: currentTime,
      time: new Date(currentTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      fullDate: new Date(currentTime).toLocaleString([], { dateStyle: 'medium', timeStyle: 'medium' }),
      status: currentStatus === 1 || currentStatus === '1' || currentStatus === 'Online' ? 1 : 0,
      onlineStatus: currentStatus === 1 || currentStatus === '1' || currentStatus === 'Online' ? 1 : null,
      offlineStatus: currentStatus === 1 || currentStatus === '1' || currentStatus === 'Online' ? null : 0,
      statusText: currentStatus === 1 || currentStatus === '1' || currentStatus === 'Online' ? 'Online' : 'Offline',
      cpu_usage: currentCpu,
      ram_usage: currentRam,
    });
  }

  return formatted;
};

const formatHistoryTick = (unixTime, hours) => {
  const date = new Date(unixTime);
  if (hours >= 168) {
    return date.toLocaleDateString([], { month: 'short', day: '2-digit' });
  }
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

function ServerCard({ server, onDelete }) {
  const [history, setHistory] = useState([]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const endTime = new Date().getTime();
  const startTime = endTime - 3600000;
  const apiBase = getApiBase();
  const { authFetch } = useAuth();
  const telemetry = server.telemetry || {};
  const monitorType = (server.monitor_type || 'http').toLowerCase();
  const isUp = Boolean(server.is_active);
  const checkedAt = server.last_checked_at
    ? Math.max(0, Math.round((Date.now() - new Date(server.last_checked_at).getTime()) / 1000))
    : null;

  const badgeText =
    monitorType === 'push'
      ? isUp
        ? `Heartbeat (${checkedAt ?? 0}s ago)`
        : 'Missed Heartbeat'
      : monitorType === 'dns'
      ? isUp
        ? `Resolved (${telemetry.resolved_value || 'A'})`
        : 'NXDOMAIN'
      : monitorType === 'ping'
      ? isUp
        ? `Ping ${telemetry.latency_ms ?? '-'} ms`
        : '100% Packet Loss'
      : monitorType === 'tcp'
      ? isUp
        ? `Port ${server.port || '-'} Open`
        : `Port ${server.port || '-'} Closed`
      : monitorType === 'smtp'
      ? isUp
        ? `Mail Gateway Active (:${server.port || 587})`
        : 'SMTP Unreachable'
      : monitorType === 'ssh'
      ? isUp
        ? 'SSH Port 22 Open'
        : 'SSH Refused'
      : isUp
      ? `${telemetry.status_code || server.expected_status_code || 200} OK`
      : `${telemetry.status_code || 'Connection'} Error`;

  const latency =
    monitorType === 'push'
      ? `Interval: ${server.heartbeat_interval_seconds || '-'}s`
      : `${telemetry.response_time_ms ?? telemetry.handshake_time_ms ?? telemetry.latency_ms ?? '-'} ms`;

  useEffect(() => {
    authFetch(`${apiBase}/servers/${server.server_id}/history`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setHistory(formatHistoryData(data, startTime));
        }
      })
      .catch((err) => console.error(err));
  }, [server.server_id, server.is_active, apiBase]);

  return (
    <Card className="hover:border-neutral-400 dark:hover:border-neutral-600 transition-all flex flex-col justify-between shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono uppercase text-[10px] tracking-wider">
                {monitorType}
              </Badge>
              <span className="flex items-center gap-1.5 text-xs font-semibold">
                <span
                  className={`h-2 w-2 rounded-full ${
                    isUp ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'
                  }`}
                />
                <span className={isUp ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                  {isUp ? 'Operational' : 'Outage'}
                </span>
              </span>
            </div>
            <CardTitle className="text-base font-bold truncate">
              {server.hostname}
            </CardTitle>
            <CardDescription className="text-xs truncate font-mono">
              {server.target_address || 'push'}
            </CardDescription>
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(server.server_id);
            }}
            className="text-neutral-400 hover:text-red-600 h-8 w-8"
            title="Delete monitor"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 flex-grow">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-neutral-500 dark:text-neutral-400 font-medium">Uptime History</span>
            <span className="font-mono text-[11px] text-neutral-400">{latency}</span>
          </div>
          <HeartbeatStrip history={history} totalBars={32} />
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-neutral-100 dark:border-neutral-900">
          <div className="rounded-md bg-neutral-50 dark:bg-neutral-900/60 p-2">
            <span className="text-neutral-400 block text-[10px] uppercase font-mono">Telemetry</span>
            <span className="font-semibold text-neutral-800 dark:text-neutral-200 truncate block mt-0.5">
              {badgeText}
            </span>
          </div>
          <div className="rounded-md bg-neutral-50 dark:bg-neutral-900/60 p-2">
            <span className="text-neutral-400 block text-[10px] uppercase font-mono">Role</span>
            <span className="font-semibold text-neutral-800 dark:text-neutral-200 truncate block mt-0.5">
              {server.server_role || 'Standard'}
            </span>
          </div>
        </div>

        {server.ssl_days_remaining !== null && server.ssl_days_remaining !== undefined && (
          <div className="flex items-center justify-between rounded-lg border border-neutral-200 dark:border-neutral-800 p-2 text-xs">
            <span className="flex items-center gap-1.5 text-neutral-500 dark:text-neutral-400">
              <Lock className="h-3 w-3 text-neutral-400" />
              <span>TLS Certificate</span>
            </span>
            <Badge
              variant={
                server.ssl_days_remaining <= 7
                  ? 'destructive'
                  : server.ssl_days_remaining <= 30
                  ? 'warning'
                  : 'success'
              }
              className="font-mono text-[11px]"
            >
              {server.ssl_days_remaining}d remaining
            </Badge>
          </div>
        )}
      </CardContent>

      <CardFooter className="pt-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDetailsOpen(true)}
          className="w-full text-xs font-semibold"
        >
          <Eye className="h-3.5 w-3.5 mr-1.5" />
          Inspect Telemetry
        </Button>
      </CardFooter>

      {detailsOpen && (
        <MonitorDetailsModal
          server={server}
          history={history}
          authFetch={authFetch}
          apiBase={apiBase}
          onClose={() => setDetailsOpen(false)}
        />
      )}
    </Card>
  );
}

function MonitorDetailsModal({ server, history, authFetch, apiBase, onClose }) {
  const [detailHistory, setDetailHistory] = useState(history);
  const [timeRange, setTimeRange] = useState('24h');
  const type = (server.monitor_type || 'http').toLowerCase();

  useEffect(() => {
    authFetch(`${apiBase}/servers/${server.server_id}/history?time_range=${timeRange}`)
      .then((res) => res.json())
      .then(
        (data) =>
          Array.isArray(data) &&
          setDetailHistory(
            data.map((point) => ({
              ...point,
              timestamp: new Date(point.timestamp).getTime(),
              fullDate: new Date(point.timestamp).toLocaleString(),
            }))
          )
      );
  }, [server.server_id, apiBase, timeRange]);

  const chartData = detailHistory
    .map((point) => ({
      ...point,
      latency:
        point.telemetry?.response_time_ms ??
        point.telemetry?.handshake_time_ms ??
        point.telemetry?.latency_ms ??
        null,
      activity: point.status ? 1 : 0,
    }))
    .sort((a, b) => a.timestamp - b.timestamp);

  const formatDetailXAxisTick = (value) => {
    const date = new Date(value);
    if (timeRange === '24h') {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { month: 'short', day: '2-digit' });
  };

  const latest = chartData[chartData.length - 1];
  const metrics =
    type === 'push'
      ? [
          ['Heartbeat Interval', `${server.heartbeat_interval_seconds || '-'}s`],
          ['Last Received', server.last_heartbeat_at ? new Date(server.last_heartbeat_at).toLocaleTimeString() : 'Never'],
          ['Health State', latest?.status ? 'Operational' : 'Overdue'],
        ]
      : [
          ['Target Destination', server.target_address || 'N/A'],
          ['Listening Port', server.port || 'Standard'],
          ['Latest Latency', latest?.latency != null ? `${latest.latency} ms` : 'Unavailable'],
          ...(server.ssl_days_remaining != null ? [['SSL Expiration', `${server.ssl_days_remaining} days remaining`]] : []),
        ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
    >
      <div className="relative w-full max-w-4xl rounded-2xl border border-neutral-200 bg-white text-neutral-950 shadow-2xl dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-50 overflow-hidden my-8">
        <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4 dark:border-neutral-800">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="outline" className="font-mono uppercase text-[10px]">
                {type}
              </Badge>
              <Badge variant={server.is_active ? 'success' : 'destructive'}>
                {server.is_active ? 'Online' : 'Offline'}
              </Badge>
            </div>
            <h2 className="text-xl font-bold tracking-tight">{server.hostname}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-900 dark:hover:text-neutral-50 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {metrics.map(([label, value]) => (
              <div
                key={label}
                className="rounded-xl border border-neutral-200 bg-neutral-50 p-3.5 dark:border-neutral-800 dark:bg-neutral-900/60"
              >
                <span className="text-[10px] uppercase font-mono font-medium tracking-wider text-neutral-500 dark:text-neutral-400">
                  {label}
                </span>
                <span className="mt-1 block text-sm font-bold text-neutral-950 dark:text-neutral-50 truncate">
                  {value}
                </span>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                Latency & Heartbeat Waveform
              </h3>
              <div className="inline-flex rounded-lg border border-neutral-200 bg-neutral-100 p-0.5 dark:border-neutral-800 dark:bg-neutral-900">
                {['24h', '7d', '30d'].map((range) => (
                  <button
                    key={range}
                    type="button"
                    onClick={() => setTimeRange(range)}
                    className={`px-3 py-1 text-xs font-bold uppercase rounded-md transition-all ${
                      timeRange === range
                        ? 'bg-white text-neutral-950 dark:bg-neutral-950 dark:text-neutral-50 shadow-sm'
                        : 'text-neutral-500 hover:text-neutral-950 dark:hover:text-neutral-50'
                    }`}
                  >
                    {range}
                  </button>
                ))}
              </div>
            </div>

            <div className="h-72 w-full rounded-xl border border-neutral-200 dark:border-neutral-800 p-4 bg-neutral-50/50 dark:bg-neutral-900/20">
              <ChartContainer>
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="latencyGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.5} />
                  <XAxis
                    dataKey="timestamp"
                    type="number"
                    domain={['dataMin', 'dataMax']}
                    tickFormatter={formatDetailXAxisTick}
                    stroke="var(--muted-foreground)"
                    fontSize={11}
                    tickMargin={8}
                  />
                  <YAxis
                    stroke="var(--muted-foreground)"
                    fontSize={11}
                    width={55}
                    tickFormatter={(v) => (type === 'push' ? (v ? 'UP' : 'DOWN') : `${v}ms`)}
                  />
                  <Tooltip
                    content={
                      <ChartTooltipContent
                        formatter={(val) => [type === 'push' ? (val ? 'OK' : 'MISSED') : `${val} ms`, 'Response Time']}
                      />
                    }
                  />
                  <Area
                    type="monotone"
                    dataKey={type === 'push' ? 'activity' : 'latency'}
                    stroke="#10b981"
                    strokeWidth={2}
                    fill="url(#latencyGradient)"
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ChartContainer>
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
              Recent Health Events
            </h3>
            <div className="divide-y divide-neutral-200 dark:divide-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
              {chartData
                .slice(-6)
                .reverse()
                .map((point, index) => (
                  <div
                    key={`${point.timestamp}-${index}`}
                    className="flex items-center justify-between px-4 py-2.5 text-xs bg-neutral-50/50 dark:bg-neutral-900/30"
                  >
                    <span className="flex items-center gap-2 font-medium">
                      <span
                        className={`h-2 w-2 rounded-full ${
                          point.status ? 'bg-emerald-500' : 'bg-rose-500'
                        }`}
                      />
                      <span>{point.status ? 'Operational Check Passed' : 'Health Check Failed'}</span>
                    </span>
                    <span className="font-mono text-neutral-400">
                      {new Date(point.timestamp).toLocaleString()}
                    </span>
                  </div>
                ))}
            </div>
          </div>

          <div className="flex justify-end pt-2 border-t border-neutral-200 dark:border-neutral-800">
            <Button variant="outline" onClick={onClose}>
              Dismiss
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Dashboard() {
  const [servers, setServers] = useState([]);
  const [copied, setCopied] = useState(false);
  const [isMonitorModalOpen, setIsMonitorModalOpen] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [protocolFilter, setProtocolFilter] = useState('all');

  const apiBase = getApiBase();
  const { user, authFetch } = useAuth();
  const currentHost =
    typeof window !== 'undefined' && window.location.hostname
      ? window.location.hostname
      : 'localhost';
  const installCmd = `curl -fsSL http://${currentHost}:8000/install.sh | bash -s http://${currentHost}:8000/agent/metric_agent.py`;

  const fetchServers = () => {
    authFetch(`${apiBase}/servers`)
      .then((response) => response.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setServers(data);
        }
      })
      .catch((error) => console.error(error));
  };

  useEffect(() => {
    fetchServers();

    let ws = null;
    let reconnectTimer = null;
    let isMounted = true;

    const connectWs = () => {
      if (!isMounted || !user) return;
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
            if (
              (data.type === 'SERVERS_UPDATE' || data.type === 'INITIAL_STATE') &&
              Array.isArray(data.servers)
            ) {
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
      } catch {
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
  }, [apiBase, user]);

  const deleteServer = async (serverId) => {
    setServers((prevServers) =>
      prevServers.filter((s) => String(s.server_id) !== String(serverId))
    );
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

  const activeAlerts = useMemo(() => {
    return servers.filter((s) => !s.is_active);
  }, [servers]);

  const filteredServers = useMemo(() => {
    return servers.filter((s) => {
      const matchesSearch =
        (s.hostname || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (s.target_address || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (s.server_role || '').toLowerCase().includes(searchQuery.toLowerCase());
      const type = (s.monitor_type || 'http').toLowerCase();
      const matchesProtocol = protocolFilter === 'all' || type === protocolFilter;
      return matchesSearch && matchesProtocol;
    });
  }, [servers, searchQuery, protocolFilter]);

  const operationalCount = servers.length - activeAlerts.length;
  const globalUptime = servers.length
    ? `${((operationalCount / servers.length) * 100).toFixed(1)}%`
    : '100%';

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-5 flex flex-col justify-between">
            <span className="text-xs uppercase font-mono font-medium text-neutral-500">
              Monitored Nodes
            </span>
            <div className="text-3xl font-extrabold tracking-tight mt-2 font-mono">
              {servers.length}
            </div>
            <span className="text-[11px] text-neutral-400 mt-1">Multi-tenant fleet</span>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 flex flex-col justify-between">
            <span className="text-xs uppercase font-mono font-medium text-emerald-600 dark:text-emerald-400">
              Operational
            </span>
            <div className="text-3xl font-extrabold tracking-tight mt-2 font-mono text-emerald-600 dark:text-emerald-400">
              {operationalCount}
            </div>
            <span className="text-[11px] text-neutral-400 mt-1">All checks passing</span>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 flex flex-col justify-between">
            <span className="text-xs uppercase font-mono font-medium text-rose-600 dark:text-rose-400">
              Active Incidents
            </span>
            <div className="text-3xl font-extrabold tracking-tight mt-2 font-mono text-rose-600 dark:text-rose-400">
              {activeAlerts.length}
            </div>
            <span className="text-[11px] text-neutral-400 mt-1">Outages detected</span>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 flex flex-col justify-between">
            <span className="text-xs uppercase font-mono font-medium text-neutral-500">
              Cluster Availability
            </span>
            <div className="text-3xl font-extrabold tracking-tight mt-2 font-mono">
              {globalUptime}
            </div>
            <span className="text-[11px] text-neutral-400 mt-1">Real-time availability</span>
          </CardContent>
        </Card>
      </div>

      {activeAlerts.length > 0 && (
        <Card className="border-rose-500/30 bg-rose-500/5">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
              <AlertTriangle className="h-5 w-5 animate-bounce" />
              <CardTitle className="text-base font-bold">Active Outage Incidents</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {activeAlerts.map((server) => (
              <div
                key={server.server_id}
                className="flex items-center justify-between rounded-lg border border-rose-500/20 bg-white dark:bg-neutral-900 p-3 text-xs"
              >
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-rose-500 animate-ping" />
                  <span className="font-bold">{server.hostname}</span>
                  <span className="text-neutral-400 font-mono">({server.target_address})</span>
                </div>
                <Badge variant="destructive">
                  {server.telemetry?.error || 'Target Unreachable'}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1 flex flex-col justify-between">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-neutral-900 dark:text-neutral-100" />
              <CardTitle className="text-base font-bold">Add Monitor</CardTitle>
            </div>
            <CardDescription className="text-xs">
              Provision automated HTTP, TCP, DNS, SSH, SMTP, PING or Push monitors with SSL tracking.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <Button
              onClick={() => setIsMonitorModalOpen(true)}
              className="w-full font-bold shadow-sm"
            >
              <Plus className="h-4 w-4 mr-1.5" />
              Create Monitor
            </Button>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="h-5 w-5 text-emerald-500" />
                <CardTitle className="text-base font-bold">One-Click Agent Daemon</CardTitle>
              </div>
              <Badge variant="outline" className="font-mono text-[10px]">
                PORT: 8001
              </Badge>
            </div>
            <CardDescription className="text-xs">
              Deploy the lightweight metric daemon on target machines to monitor CPU & RAM in real time.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="relative rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-950 p-3.5 font-mono text-xs text-emerald-400 overflow-x-auto flex items-center justify-between gap-4">
              <code className="truncate">{installCmd}</code>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyCommand}
                className="shrink-0 h-7 text-xs bg-neutral-900 hover:bg-neutral-800 text-white border-neutral-700"
              >
                {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                <span className="ml-1.5">{copied ? 'Copied' : 'Copy'}</span>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold tracking-tight">Monitors Fleet</h2>
            <Badge variant="outline" className="font-mono text-xs">
              {filteredServers.length} / {servers.length}
            </Badge>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <div className="relative w-full sm:w-60">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-neutral-400 pointer-events-none" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search hostname or IP..."
                className="pl-9 h-9 text-xs"
              />
            </div>

            <select
              value={protocolFilter}
              onChange={(e) => setProtocolFilter(e.target.value)}
              className="h-9 rounded-md border border-neutral-200 bg-transparent px-3 py-1 text-xs shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-neutral-950 dark:border-neutral-800 dark:focus-visible:ring-neutral-300"
            >
              <option value="all">All Protocols</option>
              <option value="http">HTTP(S)</option>
              <option value="tcp">TCP</option>
              <option value="dns">DNS</option>
              <option value="ping">PING</option>
              <option value="ssh">SSH</option>
              <option value="smtp">SMTP</option>
              <option value="push">PUSH</option>
            </select>
          </div>
        </div>

        {filteredServers.length === 0 ? (
          <Card className="border-dashed p-12 text-center space-y-3">
            <Server className="h-8 w-8 mx-auto text-neutral-400" />
            <div className="space-y-1">
              <p className="text-sm font-semibold">No monitors match your criteria</p>
              <p className="text-xs text-neutral-500">
                Create your first monitor or adjust your search filter above.
              </p>
            </div>
            <Button size="sm" onClick={() => setIsMonitorModalOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Add Monitor
            </Button>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {filteredServers.map((server) => (
              <ServerCard
                key={server.server_id}
                server={server}
                onDelete={deleteServer}
              />
            ))}
          </div>
        )}
      </div>

      {isMonitorModalOpen && (
        <AddMonitorModal
          apiBase={apiBase}
          authFetch={authFetch}
          onClose={() => setIsMonitorModalOpen(false)}
          onCreated={() => fetchServers()}
        />
      )}
    </div>
  );
}

function Analytics() {
  const [servers, setServers] = useState([]);
  const [selectedServer, setSelectedServer] = useState('');
  const [matrix, setMatrix] = useState({ '24h': '0.00', '7d': '0.00', '14d': '0.00', '30d': '0.00' });
  const [graphHours, setGraphHours] = useState(24);
  const [graphData, setGraphData] = useState([]);
  const [isCpuOpen, setIsCpuOpen] = useState(true);
  const [isRamOpen, setIsRamOpen] = useState(true);

  const apiBase = getApiBase();
  const { authFetch } = useAuth();
  const endTime = new Date().getTime();
  const startTime = endTime - graphHours * 3600000;

  useEffect(() => {
    authFetch(`${apiBase}/servers`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setServers(data);
          if (data.length > 0 && !selectedServer) {
            setSelectedServer(data[0].server_id);
          }
        }
      })
      .catch((err) => console.error(err));
  }, [apiBase]);

  useEffect(() => {
    if (!selectedServer) return;
    authFetch(`${apiBase}/servers/${selectedServer}/uptime`)
      .then((res) => res.json())
      .then((data) => setMatrix(data))
      .catch((err) => console.error(err));
  }, [selectedServer, apiBase]);

  useEffect(() => {
    if (!selectedServer) return;
    authFetch(`${apiBase}/servers/${selectedServer}/history?hours=${graphHours}`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setGraphData(formatHistoryData(data, startTime));
        }
      })
      .catch((err) => console.error(err));
  }, [selectedServer, graphHours, apiBase]);

  const latestMetrics = useMemo(() => {
    if (!graphData || graphData.length === 0) return { cpu: null, ram: null };
    for (let i = graphData.length - 1; i >= 0; i--) {
      if (graphData[i].cpu_usage !== null || graphData[i].ram_usage !== null) {
        return {
          cpu: graphData[i].cpu_usage,
          ram: graphData[i].ram_usage,
        };
      }
    }
    return { cpu: null, ram: null };
  }, [graphData]);

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <Card>
        <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-0.5">
            <span className="text-xs uppercase font-mono font-medium text-neutral-500">
              Active Telemetry Node
            </span>
            <h3 className="text-sm font-bold">Select Target Monitor</h3>
          </div>
          <select
            value={selectedServer}
            onChange={(e) => setSelectedServer(e.target.value)}
            className="h-9 w-full sm:w-80 rounded-md border border-neutral-200 bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-neutral-950 dark:border-neutral-800 dark:focus-visible:ring-neutral-300"
          >
            {servers.map((s) => (
              <option key={s.server_id} value={s.server_id}>
                {s.hostname} ({s.target_address})
              </option>
            ))}
          </select>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Object.entries(matrix).map(([timeframe, percentage]) => {
          const num = parseFloat(percentage);
          const isOptimal = num >= 99;
          const isWarning = num >= 95 && num < 99;
          return (
            <Card key={timeframe}>
              <CardContent className="p-5 flex flex-col items-center text-center">
                <span className="text-xs uppercase font-mono font-medium text-neutral-500">
                  {timeframe} Availability
                </span>
                <span
                  className={`text-3xl font-extrabold tracking-tight mt-2 font-mono ${
                    isOptimal
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : isWarning
                      ? 'text-amber-500'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {percentage}%
                </span>
                <Badge
                  variant={isOptimal ? 'success' : isWarning ? 'warning' : 'destructive'}
                  className="mt-2 text-[10px]"
                >
                  {isOptimal ? 'SLA Met' : isWarning ? 'Degraded' : 'Critical Outage'}
                </Badge>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <CardTitle className="text-base font-bold">Historical Uptime Timeline</CardTitle>
              <CardDescription className="text-xs">
                State transition history across selected time boundary.
              </CardDescription>
            </div>
            <div className="inline-flex rounded-lg border border-neutral-200 bg-neutral-100 p-0.5 dark:border-neutral-800 dark:bg-neutral-900">
              {[
                { label: '1H', value: 1 },
                { label: '24H', value: 24 },
                { label: '7D', value: 168 },
              ].map((btn) => (
                <button
                  key={btn.label}
                  onClick={() => setGraphHours(btn.value)}
                  className={`px-3 py-1 text-xs font-bold uppercase rounded-md transition-all ${
                    graphHours === btn.value
                      ? 'bg-white text-neutral-950 dark:bg-neutral-950 dark:text-neutral-50 shadow-sm'
                      : 'text-neutral-500 hover:text-neutral-950 dark:hover:text-neutral-50'
                  }`}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-64 w-full">
            <ChartContainer>
              <LineChart data={graphData} margin={{ top: 10, right: 10, left: -20, bottom: 8 }}>
                <XAxis
                  dataKey="timestamp"
                  type="number"
                  domain={[startTime, endTime]}
                  tickFormatter={(t) => formatHistoryTick(t, graphHours)}
                  stroke="var(--muted-foreground)"
                  fontSize={11}
                  tickMargin={8}
                />
                <YAxis domain={[0, 1]} hide={true} />
                <Tooltip
                  content={
                    <ChartTooltipContent
                      formatter={(val, name, item) => [item.payload.statusText, 'State']}
                    />
                  }
                />
                <Line
                  type="stepAfter"
                  dataKey="onlineStatus"
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="stepAfter"
                  dataKey="offlineStatus"
                  stroke="#ef4444"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                <Brush
                  dataKey="timestamp"
                  height={22}
                  stroke="var(--border)"
                  fill="var(--background)"
                  travellerWidth={10}
                  tickFormatter={(t) => formatHistoryTick(t, graphHours)}
                />
              </LineChart>
            </ChartContainer>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Cpu className="h-4 w-4 text-neutral-900 dark:text-neutral-100" />
                <CardTitle className="text-sm font-bold">CPU Load Dynamics</CardTitle>
                {latestMetrics.cpu !== null && (
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {latestMetrics.cpu.toFixed(1)}% Current
                  </Badge>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsCpuOpen(!isCpuOpen)}
                className="text-xs h-7"
              >
                {isCpuOpen ? 'Collapse' : 'Expand'}
              </Button>
            </div>
          </CardHeader>
          {isCpuOpen && (
            <CardContent>
              <div className="h-60 w-full">
                <ChartContainer>
                  <AreaChart data={graphData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="cpuArea" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#18181b" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#18181b" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.5} />
                    <XAxis
                      dataKey="timestamp"
                      type="number"
                      domain={[startTime, endTime]}
                      tickFormatter={(t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      stroke="var(--muted-foreground)"
                      fontSize={11}
                    />
                    <YAxis
                      domain={[0, 100]}
                      stroke="var(--muted-foreground)"
                      fontSize={11}
                      tickFormatter={(v) => `${v}%`}
                      width={45}
                    />
                    <Tooltip
                      content={
                        <ChartTooltipContent
                          formatter={(v) => [v != null ? `${Number(v).toFixed(1)}%` : 'N/A', 'CPU Utilization']}
                        />
                      }
                    />
                    <Area
                      type="monotone"
                      dataKey="cpu_usage"
                      stroke="var(--foreground)"
                      strokeWidth={2}
                      fill="url(#cpuArea)"
                      connectNulls={true}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ChartContainer>
              </div>
            </CardContent>
          )}
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <HardDrive className="h-4 w-4 text-neutral-900 dark:text-neutral-100" />
                <CardTitle className="text-sm font-bold">RAM Memory Allocation</CardTitle>
                {latestMetrics.ram !== null && (
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {latestMetrics.ram.toFixed(1)}% Current
                  </Badge>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsRamOpen(!isRamOpen)}
                className="text-xs h-7"
              >
                {isRamOpen ? 'Collapse' : 'Expand'}
              </Button>
            </div>
          </CardHeader>
          {isRamOpen && (
            <CardContent>
              <div className="h-60 w-full">
                <ChartContainer>
                  <AreaChart data={graphData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="ramArea" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#18181b" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#18181b" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.5} />
                    <XAxis
                      dataKey="timestamp"
                      type="number"
                      domain={[startTime, endTime]}
                      tickFormatter={(t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      stroke="var(--muted-foreground)"
                      fontSize={11}
                    />
                    <YAxis
                      domain={[0, 100]}
                      stroke="var(--muted-foreground)"
                      fontSize={11}
                      tickFormatter={(v) => `${v}%`}
                      width={45}
                    />
                    <Tooltip
                      content={
                        <ChartTooltipContent
                          formatter={(v) => [v != null ? `${Number(v).toFixed(1)}%` : 'N/A', 'Memory Load']}
                        />
                      }
                    />
                    <Area
                      type="monotone"
                      dataKey="ram_usage"
                      stroke="var(--foreground)"
                      strokeWidth={2}
                      fill="url(#ramArea)"
                      connectNulls={true}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ChartContainer>
              </div>
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  );
}

function Settings() {
  const { user, authFetch, updateUser } = useAuth();
  const apiBase = getApiBase();

  const [email, setEmail] = useState('');
  const [emailCurrentPassword, setEmailCurrentPassword] = useState('');
  const [emailOtp, setEmailOtp] = useState('');
  const [is2faEnabled, setIs2faEnabled] = useState(false);
  const [twoFaCurrentPassword, setTwoFaCurrentPassword] = useState('');
  const [twoFaOtp, setTwoFaOtp] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailOtpLoading, setEmailOtpLoading] = useState(false);
  const [twoFaLoading, setTwoFaLoading] = useState(false);
  const [twoFaOtpLoading, setTwoFaOtpLoading] = useState(false);
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
  const [targetServerId, setTargetServerId] = useState('');
  const [monitors, setMonitors] = useState([]);
  const [channelLoading, setChannelLoading] = useState(false);
  const [channelSuccess, setChannelSuccess] = useState('');
  const [channelError, setChannelError] = useState('');
  const [testingChannelId, setTestingChannelId] = useState(null);
  const [retentionStats, setRetentionStats] = useState(null);

  const fetchProfile = () => {
    authFetch(`${apiBase}/users/me`)
      .then((res) => res.json())
      .then((data) => {
        if (data) {
          if (data.email) setEmail(data.email);
          setIs2faEnabled(Boolean(data.is_2fa_enabled));
        }
      })
      .catch((err) => console.error(err));
  };

  const fetchChannels = () => {
    authFetch(`${apiBase}/notification-channels`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setChannels(data);
      })
      .catch((err) => console.error(err));
  };

  const fetchMonitors = () => {
    authFetch(`${apiBase}/servers`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setMonitors(data);
      })
      .catch((err) => console.error(err));
  };

  const monitorLabel = (serverId) => {
    if (serverId === null || serverId === undefined) return 'All Monitors (Global)';
    const match = monitors.find((m) => String(m.server_id) === String(serverId));
    return match ? match.hostname : `Monitor #${serverId}`;
  };

  useEffect(() => {
    fetchProfile();
    fetchChannels();
    fetchMonitors();
    authFetch(`${apiBase}/system/retention-stats`)
      .then((res) => res.json())
      .then((data) => setRetentionStats(data))
      .catch((err) => console.error(err));
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
        body: JSON.stringify({ email, current_password: emailCurrentPassword, otp_code: emailOtp }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to update email');
      }
      setEmailSuccess(data.message || 'Email updated successfully');
      setEmailCurrentPassword('');
      setEmailOtp('');
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
        body: JSON.stringify({
          is_2fa_enabled: !is2faEnabled,
          current_password: twoFaCurrentPassword,
          otp_code: twoFaOtp,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to toggle 2FA');
      }
      setIs2faEnabled(Boolean(data.is_2fa_enabled));
      setTwoFaSuccess(data.message || '2FA preference updated');
      setTwoFaCurrentPassword('');
      setTwoFaOtp('');
    } catch (err) {
      setTwoFaError(err.message || 'Error updating 2FA preference');
    } finally {
      setTwoFaLoading(false);
    }
  };

  const requestSensitiveChangeOtp = async (setLoading, setError, setSuccess) => {
    setLoading(true);
    setError('');
    try {
      const res = await authFetch(`${apiBase}/users/request-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_settings' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to send verification code');
      setSuccess(data.message || 'Verification code sent');
    } catch (err) {
      setError(err.message || 'Failed to send verification code');
    } finally {
      setLoading(false);
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
        body: JSON.stringify({ action: 'update_settings' }),
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
        body: JSON.stringify({ action: 'update_settings' }),
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
          otp_code: usernameOtp,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to update username');
      }

      setUsernameSuccess(data.message || 'Username updated successfully');
      if (updateUser) {
        updateUser(data.username);
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

    if (
      newPassword.length < 8 ||
      newPassword.length > 64 ||
      !/\d/.test(newPassword) ||
      !/[^A-Za-z0-9]/.test(newPassword)
    ) {
      setPasswordError('New password must be 8-64 characters and include a number and special character');
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
          otp_code: passwordOtp,
        }),
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
          server_id: targetServerId === '' ? null : Number(targetServerId),
          is_active: 1,
        }),
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
        body: JSON.stringify({ is_active: currentStatus ? 0 : 1 }),
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
        method: 'DELETE',
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
        method: 'POST',
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
    <div className="space-y-8 max-w-5xl mx-auto">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Shield className="h-5 w-5 text-neutral-900 dark:text-neutral-100" />
            <div>
              <CardTitle className="text-base font-bold">Account Security & Credentials</CardTitle>
              <CardDescription className="text-xs">
                Manage your notification email, multi-factor authentication, and profile credentials.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-5 space-y-4 bg-neutral-50/50 dark:bg-neutral-900/30">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold">Primary Notification Email</span>
                <Badge variant="outline" className="font-mono text-[10px]">OTP Target</Badge>
              </div>

              {emailSuccess && <p className="text-xs text-emerald-600 font-medium">{emailSuccess}</p>}
              {emailError && <p className="text-xs text-rose-600 font-medium">{emailError}</p>}

              <form onSubmit={handleUpdateEmail} className="space-y-3">
                <Input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="devops@company.com"
                />
                <Input
                  type="password"
                  required
                  value={emailCurrentPassword}
                  onChange={(e) => setEmailCurrentPassword(e.target.value)}
                  placeholder="Current password"
                  autoComplete="current-password"
                />
                <div className="flex gap-2">
                  <Input
                    type="text"
                    required
                    value={emailOtp}
                    onChange={(e) => setEmailOtp(e.target.value)}
                    placeholder="6-digit verification code"
                    inputMode="numeric"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={emailOtpLoading}
                    onClick={() => requestSensitiveChangeOtp(setEmailOtpLoading, setEmailError, setEmailSuccess)}
                  >
                    {emailOtpLoading ? 'Sending...' : 'Send OTP'}
                  </Button>
                </div>
                <Button type="submit" disabled={emailLoading} className="w-full">
                  {emailLoading ? 'Saving...' : 'Update Email'}
                </Button>
              </form>
            </div>

            <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-5 space-y-4 bg-neutral-50/50 dark:bg-neutral-900/30 flex flex-col justify-between">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold">Two-Factor Authentication</span>
                  <Badge variant={is2faEnabled ? 'success' : 'outline'}>
                    {is2faEnabled ? '2FA Enabled' : 'Disabled'}
                  </Badge>
                </div>
                <p className="text-xs text-neutral-500">
                  Enforces a mandatory 6-digit email OTP challenge on every tenant sign-in.
                </p>

                {twoFaSuccess && <p className="text-xs text-emerald-600 font-medium">{twoFaSuccess}</p>}
                {twoFaError && <p className="text-xs text-rose-600 font-medium">{twoFaError}</p>}

                <Input
                  type="password"
                  required
                  value={twoFaCurrentPassword}
                  onChange={(e) => setTwoFaCurrentPassword(e.target.value)}
                  placeholder="Current password"
                  autoComplete="current-password"
                />
                <div className="flex gap-2">
                  <Input
                    type="text"
                    required
                    value={twoFaOtp}
                    onChange={(e) => setTwoFaOtp(e.target.value)}
                    placeholder="6-digit verification code"
                    inputMode="numeric"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={twoFaOtpLoading}
                    onClick={() => requestSensitiveChangeOtp(setTwoFaOtpLoading, setTwoFaError, setTwoFaSuccess)}
                  >
                    {twoFaOtpLoading ? 'Sending...' : 'Send OTP'}
                  </Button>
                </div>
              </div>

              <Button
                type="button"
                variant={is2faEnabled ? 'destructive' : 'default'}
                disabled={twoFaLoading}
                onClick={handleToggle2fa}
                className="w-full mt-4"
              >
                {twoFaLoading
                  ? 'Updating...'
                  : is2faEnabled
                  ? 'Disable Two-Factor Authentication'
                  : 'Enable Two-Factor Authentication'}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-neutral-200 dark:border-neutral-800">
            <form onSubmit={handleUpdateUsername} className="space-y-3">
              <h3 className="text-sm font-bold">Change Tenant Username</h3>
              {usernameSuccess && <p className="text-xs text-emerald-600 font-medium">{usernameSuccess}</p>}
              {usernameError && <p className="text-xs text-rose-600 font-medium">{usernameError}</p>}
              <Input
                type="text"
                required
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="New username"
              />
              {!isUsernameOtpSent ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleRequestUsernameOtp}
                  disabled={usernameOtpLoading}
                  className="w-full text-xs"
                >
                  <Key className="h-3.5 w-3.5 mr-1.5" />
                  {usernameOtpLoading ? 'Requesting...' : 'Request Username OTP'}
                </Button>
              ) : (
                <div className="space-y-2">
                  <Input
                    type="text"
                    maxLength="6"
                    required
                    placeholder="6-digit OTP code"
                    value={usernameOtp}
                    onChange={(e) => setUsernameOtp(e.target.value)}
                  />
                  <Button type="submit" disabled={usernameLoading} className="w-full">
                    {usernameLoading ? 'Saving...' : 'Confirm Username Change'}
                  </Button>
                </div>
              )}
            </form>

            <form onSubmit={handleUpdatePassword} className="space-y-3">
              <h3 className="text-sm font-bold">Update Account Password</h3>
              {passwordSuccess && <p className="text-xs text-emerald-600 font-medium">{passwordSuccess}</p>}
              {passwordError && <p className="text-xs text-rose-600 font-medium">{passwordError}</p>}
              <Input
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Current password"
              />
              <Input
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password (8+ chars, special char & digit)"
              />
              <Input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
              />
              {!isPasswordOtpSent ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleRequestPasswordOtp}
                  disabled={passwordOtpLoading}
                  className="w-full text-xs"
                >
                  <Key className="h-3.5 w-3.5 mr-1.5" />
                  {passwordOtpLoading ? 'Requesting...' : 'Request Password OTP'}
                </Button>
              ) : (
                <div className="space-y-2">
                  <Input
                    type="text"
                    maxLength="6"
                    required
                    placeholder="6-digit OTP code"
                    value={passwordOtp}
                    onChange={(e) => setPasswordOtp(e.target.value)}
                  />
                  <Button type="submit" disabled={passwordLoading} className="w-full">
                    {passwordLoading ? 'Updating...' : 'Confirm Password Update'}
                  </Button>
                </div>
              )}
            </form>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Bell className="h-5 w-5 text-neutral-900 dark:text-neutral-100" />
            <div>
              <CardTitle className="text-base font-bold">Alerting & Webhook Dispatcher</CardTitle>
              <CardDescription className="text-xs">
                Broadcast real-time incident state transitions (UP ↔ DOWN) across external endpoints.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {channelSuccess && (
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
              {channelSuccess}
            </div>
          )}
          {channelError && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400 font-medium">
              {channelError}
            </div>
          )}

          <form
            onSubmit={handleCreateChannel}
            className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-4 space-y-4 bg-neutral-50/50 dark:bg-neutral-900/30"
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-neutral-600 dark:text-neutral-400">
                  Channel Protocol
                </label>
                <select
                  value={channelType}
                  onChange={(e) => setChannelType(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-neutral-200 bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-neutral-950 dark:border-neutral-800 dark:focus-visible:ring-neutral-300"
                >
                  <option value="webhook">Custom Webhook (JSON)</option>
                  <option value="discord">Discord Webhook</option>
                  <option value="slack">Slack Webhook</option>
                  <option value="telegram">Telegram Bot</option>
                  <option value="email">Email Alert</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-neutral-600 dark:text-neutral-400">
                  Scope Target
                </label>
                <select
                  value={targetServerId}
                  onChange={(e) => setTargetServerId(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-neutral-200 bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-neutral-950 dark:border-neutral-800 dark:focus-visible:ring-neutral-300"
                >
                  <option value="">All Monitors (Global)</option>
                  {monitors.map((m) => (
                    <option key={m.server_id} value={m.server_id}>
                      {m.hostname}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-neutral-600 dark:text-neutral-400">
                  Destination URL or Address
                </label>
                <Input
                  type="text"
                  required
                  value={destinationUrl}
                  onChange={(e) => setDestinationUrl(e.target.value)}
                  placeholder={channelType === 'email' ? 'devops@company.com' : 'https://discord.com/api/webhooks/...'}
                />
              </div>
            </div>

            <div className="flex justify-end">
              <Button type="submit" disabled={channelLoading}>
                <Plus className="h-4 w-4 mr-1.5" />
                {channelLoading ? 'Adding...' : 'Register Notification Channel'}
              </Button>
            </div>
          </form>

          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
              Active Dispatch Endpoints ({channels.length})
            </h3>
            {channels.length === 0 ? (
              <p className="text-xs text-neutral-500 text-center py-6 border border-dashed rounded-xl">
                No notification channels configured. Add your first webhook or email above.
              </p>
            ) : (
              <div className="divide-y divide-neutral-200 dark:divide-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
                {channels.map((ch) => (
                  <div
                    key={ch.id}
                    className="p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-neutral-50/30 dark:bg-neutral-900/20"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="font-mono uppercase text-[10px]">
                          {ch.channel_type}
                        </Badge>
                        <Badge variant={ch.is_active ? 'success' : 'outline'}>
                          {ch.is_active ? 'Active' : 'Muted'}
                        </Badge>
                        <Badge variant="secondary" className="text-[10px]">
                          {monitorLabel(ch.server_id)}
                        </Badge>
                      </div>
                      <div className="text-xs font-mono text-neutral-500 truncate max-w-md">
                        {ch.destination_url}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleTestChannel(ch.id)}
                        disabled={testingChannelId === ch.id}
                        className="text-xs h-8"
                      >
                        <Send className="h-3 w-3 mr-1" />
                        {testingChannelId === ch.id ? 'Sending...' : 'Test'}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleToggleChannel(ch.id, ch.is_active)}
                        className="text-xs h-8"
                      >
                        {ch.is_active ? 'Mute' : 'Enable'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteChannel(ch.id)}
                        className="h-8 w-8 text-neutral-400 hover:text-red-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <RetentionPanel retentionStats={retentionStats} />
    </div>
  );
}

function RetentionPanel({ retentionStats }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <Database className="h-5 w-5 text-neutral-900 dark:text-neutral-100" />
          <div>
            <CardTitle className="text-base font-bold">Storage Lifecycle & Data Retention</CardTitle>
            <CardDescription className="text-xs">
              Automated 3-tier lifecycle: 30-day raw downsampling, 15-month hourly rollups, and auto-purge.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            ['Hot Tier (Raw)', retentionStats ? retentionStats.raw_count.toLocaleString() : '...', 'Full granularity (<30d)'],
            ['Warm Tier (Rollups)', retentionStats ? retentionStats.hourly_count.toLocaleString() : '...', 'Hourly averages (30d-15m)'],
            ['Scheduled Cron', retentionStats ? retentionStats.next_schedule : '02:00 UTC', 'Automated maintenance'],
            ['Hard Retention', '15 Months', 'Automated data purge'],
          ].map(([label, value, hint]) => (
            <div
              key={label}
              className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-4 bg-neutral-50/50 dark:bg-neutral-900/40"
            >
              <span className="text-[10px] uppercase font-mono tracking-wider text-neutral-500">
                {label}
              </span>
              <div className="text-xl font-bold font-mono text-neutral-900 dark:text-neutral-100 mt-1">
                {value}
              </div>
              <span className="text-[11px] text-neutral-400 block mt-1">{hint}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function Layout({ children }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const location = useLocation();
  const { user, logout } = useAuth();
  const { isDark, toggleTheme } = useTheme();

  const getPageTitle = () => {
    if (location.pathname === '/analytics') return 'Analytics & Telemetry';
    if (location.pathname === '/settings') return 'Settings & Dispatcher';
    return 'Infrastructure Fleet';
  };

  return (
    <div className="flex min-h-screen bg-neutral-50 text-neutral-950 dark:bg-black dark:text-neutral-50 font-sans antialiased overflow-hidden">
      <div
        className={`fixed inset-y-0 left-0 z-40 bg-white border-neutral-200 dark:bg-neutral-950 dark:border-neutral-800 transition-all duration-300 ease-in-out md:relative ${
          isSidebarOpen
            ? 'w-64 translate-x-0 border-r shadow-lg md:shadow-none'
            : 'w-64 -translate-x-full md:w-0 md:translate-x-0 md:border-r-0 md:overflow-hidden'
        }`}
      >
        <div className="w-64 h-full flex flex-col justify-between p-4">
          <div className="space-y-6">
            <div className="flex items-center justify-between px-2 pt-2">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-lg bg-neutral-900 text-white dark:bg-neutral-50 dark:text-neutral-950 flex items-center justify-center font-bold">
                  <Activity className="h-4 w-4 animate-pulse text-emerald-500" />
                </div>
                <span className="font-extrabold tracking-wider font-mono text-base">PULSEWATCH</span>
              </div>
              <button
                onClick={() => setIsSidebarOpen(false)}
                className="md:hidden text-neutral-400 hover:text-neutral-950 dark:hover:text-neutral-50"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <nav className="space-y-1">
              <Link
                to="/"
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                  location.pathname === '/'
                    ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-950 shadow-sm'
                    : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-100'
                }`}
              >
                <LayoutDashboard className="h-4 w-4" />
                <span>Dashboard</span>
              </Link>

              <Link
                to="/analytics"
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                  location.pathname === '/analytics'
                    ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-950 shadow-sm'
                    : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-100'
                }`}
              >
                <BarChart3 className="h-4 w-4" />
                <span>Analytics</span>
              </Link>

              <Link
                to="/settings"
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                  location.pathname === '/settings'
                    ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-950 shadow-sm'
                    : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-100'
                }`}
              >
                <SettingsIcon className="h-4 w-4" />
                <span>Settings</span>
              </Link>
            </nav>
          </div>

          {user && (
            <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-3 bg-neutral-50 dark:bg-neutral-900/50 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase font-mono font-medium text-neutral-400">
                  Tenant
                </span>
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </div>
              <div className="font-bold text-xs truncate">{user.username}</div>
              <Button
                variant="outline"
                size="sm"
                onClick={logout}
                className="w-full text-xs h-7 text-neutral-600 dark:text-neutral-400 hover:text-red-600 dark:hover:text-red-400"
              >
                <LogOut className="h-3 w-3 mr-1.5" />
                Sign Out
              </Button>
            </div>
          )}
        </div>
      </div>

      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-30 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-y-auto">
        <header className="border-b border-neutral-200 dark:border-neutral-800 bg-white/80 dark:bg-neutral-950/80 backdrop-blur-md px-6 py-3.5 flex items-center justify-between sticky top-0 z-20">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="h-8 w-8"
              aria-label="Toggle sidebar"
            >
              <Menu className="h-4 w-4" />
            </Button>
            <h1 className="text-sm font-bold tracking-tight">{getPageTitle()}</h1>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="icon"
              onClick={toggleTheme}
              className="h-8 w-8"
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </div>
        </header>

        <main className="p-6 md:p-8 flex-grow">
          {children}
        </main>
      </div>
    </div>
  );
}

function ProtectedApp() {
  const { user, sessionLoading } = useAuth();

  if (sessionLoading) {
    return <EkgLoadingScreen />;
  }

  if (!user) {
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
      <ThemeProvider>
        <AuthProvider>
          <ProtectedApp />
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

export default App;
