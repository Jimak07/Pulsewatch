import { useState, useEffect, useMemo } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { LineChart, Line, ResponsiveContainer, Tooltip, YAxis, XAxis, CartesianGrid } from 'recharts';

const getApiBase = () => {
  if (typeof window !== 'undefined' && window.location.hostname) {
    return `http://${window.location.hostname}:8000`;
  }
  return 'http://localhost:8000';
};

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

  useEffect(() => {
    fetch(`${apiBase}/servers/${server.server_id}/history`)
      .then(res => res.json())
      .then(data => {
        setHistory(formatHistoryData(data, startTime));
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
      
      <div className="space-y-2 text-slate-300 mb-4 flex-grow">
        <p><span className="font-bold text-slate-500">Target:</span> {server.target_address || 'N/A'}</p>
        <p><span className="font-bold text-slate-500">Role:</span> {server.server_role}</p>
        <p><span className="font-bold text-slate-500">Connections:</span> {server.active_connections}</p>
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

  const apiBase = getApiBase();
  const currentHost = typeof window !== 'undefined' && window.location.hostname ? window.location.hostname : 'localhost';
  const installCmd = `curl -fsSL http://${currentHost}:8000/install.sh | bash -s http://${currentHost}:8000/agent/metric_agent.py`;

  const fetchServers = () => {
    fetch(`${apiBase}/servers`)
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
    const intervalId = setInterval(() => {
      fetchServers();
    }, 5000);
    return () => clearInterval(intervalId);
  }, [apiBase]);

  const handleAddServer = (e) => {
    e.preventDefault();
    const newServer = { hostname, server_role: serverRole, target_address: targetAddress };

    fetch(`${apiBase}/servers`, {
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
      const response = await fetch(`${apiBase}/servers/${serverId}`, {
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
  const endTime = new Date().getTime();
  const startTime = endTime - (graphHours * 3600000);

  const fetchRetentionStats = () => {
    fetch(`${apiBase}/system/retention-stats`)
      .then(res => res.json())
      .then(data => setRetentionStats(data))
      .catch(err => console.error(err));
  };

  useEffect(() => {
    fetch(`${apiBase}/servers`)
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

    fetch(`${apiBase}/servers/${selectedServer}/uptime`)
      .then(res => res.json())
      .then(data => setMatrix(data))
      .catch(err => console.error(err));

    fetch(`${apiBase}/servers/${selectedServer}/logs?status=0&limit=10`)
      .then(res => res.json())
      .then(data => setDowntimeLogs(data))
      .catch(err => console.error(err));

    fetch(`${apiBase}/servers/${selectedServer}/logs?status=1&limit=10`)
      .then(res => res.json())
      .then(data => setUptimeLogs(data))
      .catch(err => console.error(err));
  }, [selectedServer, apiBase]);

  useEffect(() => {
    if (!selectedServer) return;

    fetch(`${apiBase}/servers/${selectedServer}/history?hours=${graphHours}`)
      .then(res => res.json())
      .then(data => {
        setGraphData(formatHistoryData(data, startTime));
      })
      .catch(err => console.error(err));
  }, [selectedServer, graphHours, apiBase]);

  const handleTriggerRollup = async () => {
    setIsRollupRunning(true);
    setRollupFeedback("");
    try {
      const res = await fetch(`${apiBase}/system/trigger-rollup`, { method: 'POST' });
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

  const getPageTitle = () => {
    if (location.pathname === "/analytics") return "System Analytics";
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
          <nav className="px-4 mt-6 space-y-2">
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
          </nav>
        </div>
      </div>

      {isSidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-20 md:hidden" onClick={() => setIsSidebarOpen(false)}></div>
      )}

      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-y-auto">
        <header className="bg-slate-800/50 border-b border-slate-700 p-4 flex items-center sticky top-0 z-10">
          <button 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)} 
            className="mr-4 text-slate-400 hover:text-white text-2xl transition-colors"
          >
            ☰
          </button>
          <h2 className="text-xl font-semibold text-slate-200">{getPageTitle()}</h2>
        </header>
        
        <main className="p-6 md:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/analytics" element={<Analytics />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

export default App;