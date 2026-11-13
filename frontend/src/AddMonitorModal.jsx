import { useEffect, useState } from 'react';
import { Globe, Server, Radio, Mail, Terminal, Activity, Zap, X, ShieldAlert } from 'lucide-react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Badge } from './components/ui/badge';

const PROTOCOLS = [
  { id: 'http', label: 'HTTP(S)', icon: Globe },
  { id: 'head', label: 'HEAD', icon: Globe },
  { id: 'tcp', label: 'TCP Port', icon: Server },
  { id: 'dns', label: 'DNS Record', icon: Radio },
  { id: 'smtp', label: 'SMTP Mail', icon: Mail },
  { id: 'ssh', label: 'SSH Server', icon: Terminal },
  { id: 'ping', label: 'ICMP Ping', icon: Activity },
  { id: 'push', label: 'Heartbeat Push', icon: Zap },
];

const targetLabels = {
  http: 'Target URL',
  head: 'Target URL',
  tcp: 'Hostname or IP Address',
  dns: 'Domain Name',
  smtp: 'Hostname or IP Address',
  ssh: 'Hostname or IP Address',
  ping: 'Hostname or IP Address',
};

export default function AddMonitorModal({ apiBase, authFetch, onClose, onCreated }) {
  const [type, setType] = useState('http');
  const [hostname, setHostname] = useState('');
  const [serverRole, setServerRole] = useState('');
  const [target, setTarget] = useState('');
  const [port, setPort] = useState('');
  const [expectedStatusCode, setExpectedStatusCode] = useState(200);
  const [recordType, setRecordType] = useState('A');
  const [heartbeatInterval, setHeartbeatInterval] = useState(300);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (type === 'ssh') setPort(22);
    else if (type === 'smtp') setPort(587);
    else if (!['tcp', 'ssh', 'smtp'].includes(type)) setPort('');
  }, [type]);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setSaving(true);
    const payload = {
      hostname: hostname.trim(),
      server_role: serverRole.trim() || `${type.toUpperCase()} monitor`,
      type,
      ...(type !== 'push' ? { target_address: target.trim() } : { target_address: 'push' }),
      ...(['tcp', 'ssh', 'smtp'].includes(type) ? { port: Number(port) } : {}),
      ...(['http', 'head'].includes(type) ? { expected_status_code: Number(expectedStatusCode) } : {}),
      ...(type === 'dns' ? { record_type: recordType } : {}),
      ...(type === 'push' ? { heartbeat_interval_seconds: Number(heartbeatInterval) } : {}),
    };
    try {
      const response = await authFetch(`${apiBase}/servers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || 'Unable to create monitor');
      onCreated(data);
      onClose();
    } catch (err) {
      setError(err.message || 'Unable to create monitor');
    } finally {
      setSaving(false);
    }
  };

  const needsPort = ['tcp', 'ssh', 'smtp'].includes(type);
  const needsTarget = type !== 'push';
  const needsExpected = ['http', 'head'].includes(type);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-monitor-title"
    >
      <div className="relative w-full max-w-2xl rounded-2xl border border-neutral-200 bg-white text-neutral-950 shadow-2xl dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-50 overflow-hidden my-8">
        <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4 dark:border-neutral-800">
          <div>
            <h2 id="add-monitor-title" className="text-lg font-bold tracking-tight">
              Create New Monitor
            </h2>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Configure automated health checks, heartbeat thresholds, and alert triggers.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-900 dark:hover:text-neutral-50 transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={submit} className="p-6 space-y-6">
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
              Monitoring Protocol
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" role="tablist" aria-label="Monitor protocol">
              {PROTOCOLS.map((protocol) => {
                const Icon = protocol.icon;
                const isSelected = type === protocol.id;
                return (
                  <button
                    key={protocol.id}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    onClick={() => setType(protocol.id)}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                      isSelected
                        ? 'border-neutral-900 bg-neutral-900 text-white dark:border-neutral-50 dark:bg-neutral-50 dark:text-neutral-950 shadow-sm'
                        : 'border-neutral-200 bg-transparent text-neutral-600 hover:border-neutral-300 hover:text-neutral-950 dark:border-neutral-800 dark:text-neutral-400 dark:hover:border-neutral-700 dark:hover:text-neutral-50'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{protocol.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                Friendly Monitor Name
              </label>
              <Input
                value={hostname}
                onChange={(e) => setHostname(e.target.value)}
                required
                placeholder="e.g. Production API Gateway"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                Role or Environment <span className="text-neutral-400">(Optional)</span>
              </label>
              <Input
                value={serverRole}
                onChange={(e) => setServerRole(e.target.value)}
                placeholder="e.g. Primary Edge Router"
              />
            </div>

            {needsTarget && (
              <div className="space-y-1.5 sm:col-span-2">
                <label className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                  {targetLabels[type]}
                </label>
                <Input
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  required
                  placeholder={
                    type === 'dns'
                      ? 'api.company.com'
                      : type === 'ping'
                      ? '198.51.100.1'
                      : 'https://api.company.com/health'
                  }
                />
              </div>
            )}

            {needsPort && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                  TCP Port
                </label>
                <Input
                  type="number"
                  min="1"
                  max="65535"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  required
                />
              </div>
            )}

            {needsExpected && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                  Expected Status Code
                </label>
                <Input
                  type="number"
                  min="100"
                  max="599"
                  value={expectedStatusCode}
                  onChange={(e) => setExpectedStatusCode(e.target.value)}
                />
              </div>
            )}

            {type === 'dns' && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                  DNS Record Type
                </label>
                <select
                  value={recordType}
                  onChange={(e) => setRecordType(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-neutral-200 bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-neutral-950 dark:border-neutral-800 dark:focus-visible:ring-neutral-300"
                >
                  <option value="A">A (IPv4 Address)</option>
                  <option value="AAAA">AAAA (IPv6 Address)</option>
                  <option value="CNAME">CNAME (Alias)</option>
                  <option value="MX">MX (Mail Exchange)</option>
                </select>
              </div>
            )}

            {type === 'push' && (
              <div className="sm:col-span-2 space-y-2">
                <label className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                  Expected Heartbeat Interval (Seconds)
                </label>
                <Input
                  type="number"
                  min="5"
                  value={heartbeatInterval}
                  onChange={(e) => setHeartbeatInterval(e.target.value)}
                  required
                />
                <p className="text-xs text-neutral-500 dark:text-neutral-400 bg-neutral-100 dark:bg-neutral-900 p-3 rounded-lg border border-neutral-200 dark:border-neutral-800">
                  A unique Push Token and Webhook endpoint will be provisioned immediately upon creation. Your application or cron job can POST to it periodically.
                </p>
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs font-medium text-red-600 dark:text-red-400">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-neutral-200 dark:border-neutral-800">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Creating Monitor...' : 'Create Monitor'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
