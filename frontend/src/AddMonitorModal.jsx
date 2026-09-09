import { useEffect, useState } from 'react';

const PROTOCOLS = ['http', 'head', 'tcp', 'dns', 'smtp', 'ssh', 'ping', 'push'];

const targetLabels = {
  http: 'Target URL', head: 'Target URL', tcp: 'Hostname / IP', dns: 'Domain Name',
  smtp: 'Hostname / IP', ssh: 'Hostname / IP', ping: 'Hostname / IP',
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
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="add-monitor-title">
      <form onSubmit={submit} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-neutral-700 bg-neutral-900 p-6 text-white shadow-2xl dark:bg-black">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div><h2 id="add-monitor-title" className="text-xl font-bold">Add New Monitor</h2><p className="mt-1 text-sm text-neutral-400">Choose a protocol and configure its health check.</p></div>
          <button type="button" onClick={onClose} className="text-2xl leading-none text-neutral-400 hover:text-white" aria-label="Close">&times;</button>
        </div>
        <div className="mb-6 grid grid-cols-4 gap-2 sm:grid-cols-8" role="tablist" aria-label="Monitor protocol">
          {PROTOCOLS.map(protocol => <button key={protocol} type="button" role="tab" aria-selected={type === protocol} onClick={() => setType(protocol)} className={`rounded-lg border px-2 py-2 text-xs font-semibold uppercase transition ${type === protocol ? 'border-white bg-white text-black' : 'border-neutral-700 bg-neutral-800 text-neutral-300 hover:border-neutral-400'}`}>{protocol}</button>)}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium">Monitor name<input value={hostname} onChange={e => setHostname(e.target.value)} required className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2.5 text-white outline-none focus:border-white" /></label>
          <label className="text-sm font-medium">Role <span className="text-neutral-500">(optional)</span><input value={serverRole} onChange={e => setServerRole(e.target.value)} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2.5 text-white outline-none focus:border-white" /></label>
          {needsTarget && <label className="text-sm font-medium sm:col-span-2">{targetLabels[type]}<input value={target} onChange={e => setTarget(e.target.value)} required className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2.5 text-white outline-none focus:border-white" placeholder={type === 'dns' ? 'example.com' : type === 'ping' ? 'host.example.com' : 'https://example.com'} /></label>}
          {needsPort && <label className="text-sm font-medium">Port<input type="number" min="1" max="65535" value={port} onChange={e => setPort(e.target.value)} required className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2.5 text-white outline-none focus:border-white" /></label>}
          {needsExpected && <label className="text-sm font-medium">Expected status code<input type="number" min="100" max="599" value={expectedStatusCode} onChange={e => setExpectedStatusCode(e.target.value)} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2.5 text-white outline-none focus:border-white" /></label>}
          {type === 'dns' && <label className="text-sm font-medium">DNS record type<select value={recordType} onChange={e => setRecordType(e.target.value)} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2.5 text-white outline-none focus:border-white"><option>A</option><option>AAAA</option><option>CNAME</option><option>MX</option></select></label>}
          {type === 'push' && <div className="sm:col-span-2"><label className="text-sm font-medium">Heartbeat interval (seconds)<input type="number" min="1" value={heartbeatInterval} onChange={e => setHeartbeatInterval(e.target.value)} required className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2.5 text-white outline-none focus:border-white" /></label><p className="mt-3 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-xs text-neutral-300">A unique Push Token and Webhook URL will be generated after creation.</p></div>}
        </div>
        {error && <p className="mt-4 rounded-lg border border-neutral-600 bg-neutral-800 px-3 py-2 text-sm text-white">{error}</p>}
        <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={onClose} className="rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-800">Cancel</button><button type="submit" disabled={saving} className="rounded-lg bg-white px-4 py-2 text-sm font-bold text-black hover:bg-neutral-200 disabled:opacity-60">{saving ? 'Creating...' : 'Create Monitor'}</button></div>
      </form>
    </div>
  );
}
