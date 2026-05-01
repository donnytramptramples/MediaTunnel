import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Shield, Users, Settings, LogOut, Trash2, RefreshCw, Eye, EyeOff, ChevronRight, ChevronLeft, Clock, Activity, Rss, Key, Radio, Play, ArrowLeft, TrendingUp } from 'lucide-react';
import VideoPlayer from './VideoPlayer';

function timeAgo(ts) {
  if (!ts) return 'Never';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function SetupForm({ onSetup }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [show, setShow] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password !== confirm) return setError('Passwords do not match');
    if (password.length < 8) return setError('Password must be at least 8 characters');
    setLoading(true);
    setError('');
    try {
      const r = await fetch('/api/admin/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
        credentials: 'include',
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      onSetup();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 text-white">
      <div className="w-full max-w-md p-8 rounded-2xl bg-gray-900 border border-gray-700 shadow-2xl">
        <div className="flex items-center gap-3 mb-8">
          <div className="p-3 rounded-xl bg-red-500/20 border border-red-500/30">
            <Shield size={28} className="text-red-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Admin Setup</h1>
            <p className="text-sm text-gray-400">Set your admin password (one time only)</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <label className="block text-sm text-gray-400 mb-1">Admin Password</label>
            <input
              type={show ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 pr-12 text-white placeholder-gray-500 focus:outline-none focus:border-red-500"
              placeholder="Min. 8 characters"
              required
            />
            <button type="button" onClick={() => setShow(s => !s)} className="absolute right-3 top-9 text-gray-400 hover:text-white">
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Confirm Password</label>
            <input
              type={show ? 'text' : 'password'}
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-red-500"
              placeholder="Repeat password"
              required
            />
          </div>

          {error && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}

          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 text-yellow-300 text-sm">
            ⚠ This password cannot be changed after setup. Store it securely.
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold transition-colors disabled:opacity-50"
          >
            {loading ? 'Setting up...' : 'Set Admin Password'}
          </button>
        </form>
      </div>
    </div>
  );
}

function LoginForm({ onLogin }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [show, setShow] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const r = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
        credentials: 'include',
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      onLogin();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 text-white">
      <div className="w-full max-w-sm p-8 rounded-2xl bg-gray-900 border border-gray-700 shadow-2xl">
        <div className="flex items-center gap-3 mb-8">
          <div className="p-3 rounded-xl bg-red-500/20 border border-red-500/30">
            <Shield size={28} className="text-red-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Admin Panel</h1>
            <p className="text-sm text-gray-400">Restricted access</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Username</label>
            <input
              type="text"
              value="admin"
              readOnly
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-gray-400 cursor-not-allowed"
            />
          </div>
          <div className="relative">
            <label className="block text-sm text-gray-400 mb-1">Password</label>
            <input
              type={show ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 pr-12 text-white placeholder-gray-500 focus:outline-none focus:border-red-500"
              placeholder="Admin password"
              required
            />
            <button type="button" onClick={() => setShow(s => !s)} className="absolute right-3 top-9 text-gray-400 hover:text-white">
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          {error && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold transition-colors disabled:opacity-50"
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>
      </div>
    </div>
  );
}

function UserWatchHistory({ userId, username, onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/admin/users/${userId}/watch-history`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => setData({ history: [] }))
      .finally(() => setLoading(false));
  }, [userId]);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full" />
    </div>
  );

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-2 text-gray-400 hover:text-white mb-6 transition-colors">
        <ChevronLeft size={18} /> Back to users
      </button>
      <h2 className="text-xl font-bold mb-2">Watch History</h2>
      <p className="text-gray-400 text-sm mb-6">User: <span className="text-white font-medium">{username}</span> — {data?.history?.length || 0} entries</p>

      {data?.history?.length === 0 ? (
        <p className="text-gray-500 text-center py-12">No watch history for this user yet.</p>
      ) : (
        <div className="space-y-2">
          {data.history.map((item) => (
            <div key={item.id} className="flex items-center gap-3 p-3 rounded-lg bg-gray-800 border border-gray-700">
              {item.thumbnail && (
                <img src={item.thumbnail} alt="" className="w-16 h-9 object-cover rounded flex-shrink-0 bg-gray-700" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{item.title}</p>
                <p className="text-xs text-gray-400 truncate">{item.channel}</p>
              </div>
              <div className="text-xs text-gray-500 flex-shrink-0 flex items-center gap-1">
                <Clock size={12} />
                {new Date(item.watched_at).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function UserSubscriptions({ userId, username, onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/admin/users/${userId}/subscriptions`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => setData({ subscriptions: [] }))
      .finally(() => setLoading(false));
  }, [userId]);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full" />
    </div>
  );

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-2 text-gray-400 hover:text-white mb-6 transition-colors">
        <ChevronLeft size={18} /> Back to users
      </button>
      <h2 className="text-xl font-bold mb-2">Subscriptions</h2>
      <p className="text-gray-400 text-sm mb-6">User: <span className="text-white font-medium">{username}</span> — {data?.subscriptions?.length || 0} subscribed</p>

      {data?.subscriptions?.length === 0 ? (
        <p className="text-gray-500 text-center py-12">No subscriptions for this user yet.</p>
      ) : (
        <div className="space-y-2">
          {data.subscriptions.map((sub) => (
            <div key={sub.channel_id} className="flex items-center gap-3 p-3 rounded-lg bg-gray-800 border border-gray-700">
              {sub.channel_avatar ? (
                <img src={sub.channel_avatar} alt="" className="w-9 h-9 object-cover rounded-full flex-shrink-0 bg-gray-700" />
              ) : (
                <div className="w-9 h-9 rounded-full bg-gray-700 flex-shrink-0 flex items-center justify-center text-xs font-bold">
                  {sub.channel_name?.[0]?.toUpperCase() || '?'}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{sub.channel_name}</p>
                <p className="text-xs text-gray-500 truncate">{sub.channel_id}</p>
              </div>
              <div className="text-xs text-gray-500 flex-shrink-0 flex items-center gap-1">
                <Clock size={12} />
                {new Date(sub.subscribed_at).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ResetPasswordModal({ user, onClose, onSuccess }) {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password.length < 6) return setError('Min 6 characters');
    setLoading(true); setError('');
    try {
      const r = await fetch(`/api/admin/users/${user.id}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
        credentials: 'include',
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setDone(true);
      onSuccess?.(password);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div className="w-full max-w-sm p-6 bg-gray-900 border border-gray-700 rounded-2xl" onClick={e => e.stopPropagation()}>
        <h3 className="font-bold text-lg mb-1">Reset Password</h3>
        <p className="text-gray-400 text-sm mb-4">User: <span className="text-white">{user.username}</span></p>
        {done ? (
          <div className="text-green-400 bg-green-500/10 border border-green-500/20 rounded-lg p-3 text-sm mb-4">
            Password reset. All sessions for this user have been invalidated.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="text"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              placeholder="New password (min 6 chars)"
            />
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <button type="submit" disabled={loading} className="w-full py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium disabled:opacity-50">
              {loading ? 'Resetting...' : 'Set New Password'}
            </button>
          </form>
        )}
        <button onClick={onClose} className="w-full py-2 mt-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm">
          {done ? 'Close' : 'Cancel'}
        </button>
      </div>
    </div>
  );
}

const BW_COLORS = ['#f87171','#60a5fa','#34d399','#fbbf24','#a78bfa','#fb923c','#38bdf8','#4ade80','#f472b6','#e879f9'];

function fmtBW(bytes, unit) {
  if (unit === 'Mbit') {
    const mbit = (bytes * 8) / 1e6;
    return mbit >= 100 ? mbit.toFixed(0) : mbit >= 10 ? mbit.toFixed(1) : mbit.toFixed(2);
  }
  const mb = bytes / 1e6;
  return mb >= 100 ? mb.toFixed(0) : mb >= 10 ? mb.toFixed(1) : mb.toFixed(2);
}

function BandwidthChart({ series, times, unit }) {
  if (!series.length || !times.length) return (
    <div className="flex items-center justify-center h-48 text-gray-600 text-sm">No data yet — start streaming to see bandwidth.</div>
  );

  const W = 900, H = 280;
  const PL = 62, PR = 16, PT = 16, PB = 36;
  const CW = W - PL - PR;
  const CH = H - PT - PB;

  const allVals = series.flatMap(s => s.data);
  const maxBytes = Math.max(...allVals, 1);

  const xOf = i => PL + (i / Math.max(times.length - 1, 1)) * CW;
  const yOf = v => PT + CH - (v / maxBytes) * CH;

  const yticks = [0, 0.25, 0.5, 0.75, 1].map(f => ({ v: maxBytes * f, y: yOf(maxBytes * f) }));

  const makePath = data => data
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`)
    .join(' ');

  const xTickStep = Math.ceil(times.length / 10);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 280 }}>
      {yticks.map(({ v, y }, i) => (
        <g key={i}>
          <line x1={PL} y1={y} x2={W - PR} y2={y} stroke="rgba(255,255,255,0.07)" strokeDasharray="4 4" />
          <text x={PL - 6} y={y + 4} textAnchor="end" fill="rgba(255,255,255,0.4)" fontSize={10}>
            {fmtBW(v, unit)}
          </text>
        </g>
      ))}
      {times.map((t, i) => {
        if (i % xTickStep !== 0 && i !== times.length - 1) return null;
        const d = new Date(t);
        const label = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        return (
          <text key={i} x={xOf(i)} y={H - 8} textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize={9}>{label}</text>
        );
      })}
      <line x1={PL} y1={PT} x2={PL} y2={PT + CH} stroke="rgba(255,255,255,0.15)" />
      <line x1={PL} y1={PT + CH} x2={W - PR} y2={PT + CH} stroke="rgba(255,255,255,0.15)" />
      {series.map((s, si) => (
        <g key={s.name}>
          <path d={makePath(s.data)} fill="none" stroke={s.color} strokeWidth={s.isTotal ? 2.5 : 1.5}
            strokeLinejoin="round" strokeLinecap="round"
            strokeDasharray={s.isTotal ? undefined : undefined}
            opacity={s.isTotal ? 1 : 0.85} />
          {s.data.map((v, i) => v > 0 && (
            <circle key={i} cx={xOf(i)} cy={yOf(v)} r={2.5} fill={s.color} opacity={0.7} />
          ))}
        </g>
      ))}
      <text x={PL - 54} y={PT + CH / 2} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize={9}
        transform={`rotate(-90,${PL - 54},${PT + CH / 2})`}>{unit}/min</text>
    </svg>
  );
}

function Dashboard({ onLogout }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('users');
  const [viewingUser, setViewingUser] = useState(null);
  const [viewingUserMode, setViewingUserMode] = useState('history');
  const [settings, setSettings] = useState({ max_accounts: 1000, max_connections: 500, max_sessions: 0, show_passwords: false, allow_co_watch: false });
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState('');
  const [resetUser, setResetUser] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [passwordsVisible, setPasswordsVisible] = useState(false);
  const [bwData, setBwData] = useState(null);
  const [bwLoading, setBwLoading] = useState(false);
  const [bwUnit, setBwUnit] = useState('MB');
  const [bwShowTotal, setBwShowTotal] = useState(true);
  const [bwShowUsers, setBwShowUsers] = useState(true);
  const [bwRealtime, setBwRealtime] = useState(false);
  const [revealedPasswords, setRevealedPasswords] = useState(new Set());
  // Watching / co-watch
  const [watching, setWatching] = useState([]);
  const [watchingLoading, setWatchingLoading] = useState(false);
  const [watchingConnected, setWatchingConnected] = useState(false);
  const [coWatchEntry, setCoWatchEntry] = useState(null); // currently co-watching this user
  const watchWsRef = useRef(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/admin/users', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        setData(d);
        if (d.settings) {
          setSettings({
            max_accounts: d.settings.max_accounts ?? 1000,
            max_connections: d.settings.max_connections ?? 500,
            max_sessions: d.settings.max_sessions ?? 0,
            show_passwords: !!(d.settings.show_passwords),
            allow_co_watch: !!(d.settings.allow_co_watch),
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadBandwidth = useCallback(() => {
    setBwLoading(true);
    fetch('/api/admin/bandwidth', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setBwData(d))
      .catch(() => {})
      .finally(() => setBwLoading(false));
  }, []);

  useEffect(() => {
    if (tab !== 'bandwidth') return;
    loadBandwidth();
    const iv = setInterval(loadBandwidth, bwRealtime ? 2000 : 30000);
    return () => clearInterval(iv);
  }, [tab, loadBandwidth, bwRealtime]);

  // Real-time watching updates via WebSocket when co-watch is enabled
  useEffect(() => {
    if ((tab !== 'watching' && tab !== 'users') || !settings.allow_co_watch) {
      watchWsRef.current?.close();
      watchWsRef.current = null;
      setWatchingConnected(false);
      setWatching([]);
      return;
    }

    // Already connected
    if (watchWsRef.current && watchWsRef.current.readyState < 2) return;

    setWatchingLoading(true);
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${window.location.host}/api/ws?admin=1`);
    watchWsRef.current = ws;

    ws.onopen = () => { setWatchingConnected(true); setWatchingLoading(false); };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'watching_update') setWatching(msg.watching || []);
      } catch {}
    };
    ws.onclose = () => { setWatchingConnected(false); watchWsRef.current = null; };
    ws.onerror = () => { setWatchingLoading(false); };

    return () => { ws.close(); watchWsRef.current = null; setWatchingConnected(false); };
  }, [tab, settings.allow_co_watch]);

  const handleDelete = async (userId) => {
    if (!window.confirm('Permanently delete this account and all its data?')) return;
    setDeletingId(userId);
    try {
      await fetch(`/api/admin/users/${userId}`, { method: 'DELETE', credentials: 'include' });
      load();
    } catch {}
    setDeletingId(null);
  };

  const handlePasswordReset = useCallback((userId, newPassword) => {
    setData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        users: prev.users.map(u =>
          u.id === userId ? { ...u, plain_password: newPassword } : u
        ),
      };
    });
    setResetUser(null);
  }, []);

  const handleSaveSettings = async () => {
    setSettingsSaving(true); setSettingsMsg('');
    try {
      const r = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
        credentials: 'include',
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      if (d.settings) {
        setSettings({
          max_accounts: d.settings.max_accounts ?? 1000,
          max_connections: d.settings.max_connections ?? 500,
          max_sessions: d.settings.max_sessions ?? 0,
          show_passwords: !!(d.settings.show_passwords),
          allow_co_watch: !!(d.settings.allow_co_watch),
        });
        // Reload users list so password column appears/disappears immediately
        load();
      }
      setSettingsMsg('Settings saved successfully.');
    } catch (e) {
      setSettingsMsg('Error: ' + e.message);
    } finally {
      setSettingsSaving(false);
    }
  };

  const handleLogout = async () => {
    await fetch('/api/admin/logout', { method: 'POST', credentials: 'include' });
    onLogout();
  };

  // Co-watch view — render VideoPlayer inside admin panel
  if (coWatchEntry) {
    const coVideo = {
      id: coWatchEntry.videoId,
      title: coWatchEntry.title || 'Unknown video',
      thumbnail: coWatchEntry.thumbnail || '',
      channel: coWatchEntry.username ? `User: ${coWatchEntry.username}` : '',
      channelId: '',
      channelAvatar: '',
      views: '',
    };
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col">
        {/* Compact top bar */}
        <div className="flex-shrink-0 bg-gray-900 border-b border-gray-800 px-3 py-2 flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setCoWatchEntry(null)}
            className="flex items-center gap-1.5 text-gray-400 hover:text-white transition-colors text-sm whitespace-nowrap"
          >
            <ArrowLeft size={15} /> Back
          </button>
          <span className="hidden sm:inline text-gray-600">|</span>
          <div className="flex items-center gap-1.5 text-xs text-gray-500 min-w-0">
            <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse flex-shrink-0" />
            <span className="truncate">
              Co-watching <span className="text-yellow-400 font-medium">{coWatchEntry.username}</span>
              {coWatchEntry.title && <span className="hidden sm:inline text-gray-600"> · {coWatchEntry.title}</span>}
            </span>
          </div>
        </div>
        {/* Player fills remaining screen */}
        <div className="flex-1 overflow-auto">
          <div className="w-full max-w-5xl mx-auto px-2 sm:px-4 py-2 sm:py-4">
            <VideoPlayer
              video={coVideo}
              user={null}
              onBack={() => setCoWatchEntry(null)}
              coWatchUserId={coWatchEntry.userId}
              onCoWatchVideoChange={(data) => setCoWatchEntry(prev => prev ? {
                ...prev,
                videoId: data.videoId,
                title: data.title || 'Unknown video',
                thumbnail: data.thumbnail || '',
              } : prev)}
            />
          </div>
        </div>
      </div>
    );
  }

  if (viewingUser) {
    return (
      <div className="min-h-screen bg-gray-950 text-white p-6">
        {viewingUserMode === 'subscriptions' ? (
          <UserSubscriptions
            userId={viewingUser.id}
            username={viewingUser.username}
            onBack={() => setViewingUser(null)}
          />
        ) : (
          <UserWatchHistory
            userId={viewingUser.id}
            username={viewingUser.username}
            onBack={() => setViewingUser(null)}
          />
        )}
      </div>
    );
  }

  const showPwdColumn = settings.show_passwords;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="bg-gray-900 border-b border-gray-800 px-3 sm:px-6 py-3 sm:py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield size={22} className="text-red-400" />
          <span className="font-bold text-lg">Admin Panel</span>
          <span className="text-xs bg-red-500/20 text-red-400 border border-red-500/30 rounded-full px-2 py-0.5">Restricted</span>
        </div>
        <button onClick={handleLogout} className="flex items-center gap-2 text-sm text-gray-400 hover:text-red-400 transition-colors">
          <LogOut size={16} /> Logout
        </button>
      </header>

      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-6 border-b border-gray-800">
          <div className="bg-gray-900 rounded-xl border border-gray-700 p-4">
            <div className="text-3xl font-bold text-white">{data.totalUsers}</div>
            <div className="text-sm text-gray-400 mt-1 flex items-center gap-1"><Users size={14} /> Total Accounts</div>
          </div>
          <div className="bg-gray-900 rounded-xl border border-gray-700 p-4">
            <div className="text-3xl font-bold text-green-400">{data.connectedUsers}</div>
            <div className="text-sm text-gray-400 mt-1 flex items-center gap-1"><Activity size={14} /> Active (15m)</div>
          </div>
          <div className="bg-gray-900 rounded-xl border border-gray-700 p-4">
            <div className="text-3xl font-bold text-blue-400">{data.settings?.max_accounts ?? '—'}</div>
            <div className="text-sm text-gray-400 mt-1">Account Limit</div>
          </div>
          <div className="bg-gray-900 rounded-xl border border-gray-700 p-4">
            <div className="text-3xl font-bold text-purple-400">
              {data.settings?.max_sessions > 0 ? data.settings.max_sessions : '∞'}
            </div>
            <div className="text-sm text-gray-400 mt-1">Session Limit</div>
          </div>
        </div>
      )}

      <div className="flex border-b border-gray-800 px-2 sm:px-6 overflow-x-auto">
        {[
          { id: 'users', label: 'Users', icon: Users },
          ...(settings.allow_co_watch ? [{ id: 'watching', label: 'Watching', icon: Radio }] : []),
          { id: 'bandwidth', label: 'Bandwidth', icon: TrendingUp },
          { id: 'settings', label: 'Settings', icon: Settings },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              tab === id ? 'border-red-500 text-red-400' : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            <Icon size={15} /> {label}
            {id === 'watching' && watching.length > 0 && (
              <span className="bg-green-500 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center">{watching.length}</span>
            )}
          </button>
        ))}
        <div className="ml-auto flex items-center py-3">
          <button onClick={load} disabled={loading} className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition-colors">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      <div className="p-3 sm:p-6">
        {tab === 'users' && (
          <div>
            {showPwdColumn && (
              <div className="flex items-center justify-end gap-2 mb-3">
                <span className="text-xs text-gray-500">{revealedPasswords.size} password{revealedPasswords.size !== 1 ? 's' : ''} revealed</span>
                {revealedPasswords.size > 0 && (
                  <button
                    onClick={() => setRevealedPasswords(new Set())}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 border border-gray-700 transition-colors"
                  >
                    <EyeOff size={12} /> Hide All
                  </button>
                )}
              </div>
            )}
            {loading ? (
              <div className="flex items-center justify-center h-48">
                <div className="animate-spin w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full" />
              </div>
            ) : (
              <div className="space-y-2">
                {(data?.users || []).map(user => {
                  const isActive = user.last_seen && (Date.now() - user.last_seen) < 15 * 60 * 1000;
                  const watchEntry = watching.find(w => w.userId === user.id && (Date.now() - w.updatedAt) < 35000);
                  return (
                    <div key={user.id} className={`flex items-center gap-4 p-4 bg-gray-900 rounded-xl border transition-colors ${watchEntry ? 'border-green-700 hover:border-green-600' : 'border-gray-700 hover:border-gray-600'}`}>
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-gray-600 to-gray-700 flex items-center justify-center text-sm font-bold flex-shrink-0">
                        {user.username[0]?.toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{user.username}</span>
                          {watchEntry ? (
                            <span className="flex items-center gap-1 text-xs bg-green-500/20 text-green-400 border border-green-500/30 rounded-full px-2 py-0.5">
                              <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
                              Watching now
                            </span>
                          ) : isActive ? (
                            <span className="flex items-center gap-1 text-xs bg-gray-700/60 text-gray-400 border border-gray-600 rounded-full px-2 py-0.5">
                              <span className="w-1.5 h-1.5 bg-gray-400 rounded-full" />
                              Online
                            </span>
                          ) : null}
                        </div>
                        {watchEntry && (
                          <div className="flex items-center gap-2 mt-1 bg-green-950/40 border border-green-800/40 rounded-lg px-2 py-1">
                            {watchEntry.thumbnail && (
                              <img src={watchEntry.thumbnail} alt="" className="w-12 h-7 object-cover rounded flex-shrink-0 bg-gray-700" />
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-xs text-green-300 truncate font-medium">{watchEntry.title}</p>
                              <p className="text-[11px] text-green-600">
                                At {Math.floor(watchEntry.position / 60)}:{String(Math.floor(watchEntry.position) % 60).padStart(2, '0')}
                              </p>
                            </div>
                          </div>
                        )}
                        <div className="text-sm text-gray-400 truncate mt-1">
                          {user.email || <span className="text-gray-600 italic text-xs">email hidden</span>}
                        </div>
                        <div className="text-xs text-gray-500 flex items-center gap-3 mt-1 flex-wrap">
                          <span>Joined {new Date(user.created_at).toLocaleDateString()}</span>
                          <span className="flex items-center gap-1"><Clock size={11} /> Last seen {timeAgo(user.last_seen)}</span>
                          <span className="flex items-center gap-1 text-blue-400/80">
                            <Users size={11} /> {user.sub_count ?? 0} subscription{user.sub_count !== 1 ? 's' : ''}
                          </span>
                          <span className="flex items-center gap-1 text-purple-400/80">
                            <Eye size={11} /> {user.watch_count ?? 0} watched
                          </span>
                        </div>
                        {/* Password display — only when show_passwords is enabled in settings */}
                        {showPwdColumn && (
                          <div className="flex items-center gap-2 mt-1.5">
                            <Key size={11} className="text-yellow-500/70 flex-shrink-0" />
                            <span className="text-xs font-mono text-yellow-300 select-all">
                              {revealedPasswords.has(user.id)
                                ? (user.plain_password || <span className="text-gray-500 italic">not recorded</span>)
                                : <span className="text-gray-500 tracking-widest">••••••••</span>}
                            </span>
                            <button
                              onClick={() => setRevealedPasswords(prev => {
                                const next = new Set(prev);
                                if (next.has(user.id)) next.delete(user.id);
                                else next.add(user.id);
                                return next;
                              })}
                              className="text-gray-500 hover:text-yellow-400 transition-colors flex-shrink-0"
                              title={revealedPasswords.has(user.id) ? 'Hide password' : 'Reveal password'}
                            >
                              {revealedPasswords.has(user.id) ? <EyeOff size={12} /> : <Eye size={12} />}
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
                        <button
                          onClick={() => { setViewingUserMode('history'); setViewingUser(user); }}
                          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-blue-600 text-gray-300 hover:text-white transition-colors border border-gray-700"
                        >
                          <Eye size={13} /> History <ChevronRight size={13} />
                        </button>
                        {watchEntry && settings.allow_co_watch && (
                          <button
                            onClick={() => setCoWatchEntry(watchEntry)}
                            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-green-900/60 hover:bg-yellow-600 text-green-300 hover:text-white transition-colors border border-green-700"
                          >
                            <Play size={13} /> Watch with
                          </button>
                        )}
                        <button
                          onClick={() => { setViewingUserMode('subscriptions'); setViewingUser(user); }}
                          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-green-600 text-gray-300 hover:text-white transition-colors border border-gray-700"
                        >
                          <Rss size={13} /> Subs <ChevronRight size={13} />
                        </button>
                        <button
                          onClick={() => setResetUser(user)}
                          className="text-xs px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-yellow-600 text-gray-300 hover:text-white transition-colors border border-gray-700"
                        >
                          Reset PW
                        </button>
                        <button
                          onClick={() => handleDelete(user.id)}
                          disabled={deletingId === user.id}
                          className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-red-600 text-gray-400 hover:text-white transition-colors border border-gray-700 disabled:opacity-50"
                        >
                          <Trash2 size={13} /> Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
                {data?.users?.length === 0 && (
                  <p className="text-gray-500 text-center py-12">No user accounts yet.</p>
                )}
              </div>
            )}
          </div>
        )}

        {tab === 'watching' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-gray-400 flex items-center gap-2">
                Users currently watching a video
                {watchingConnected ? (
                  <span className="flex items-center gap-1 text-xs text-green-400"><span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" /> Live</span>
                ) : (
                  <span className="text-xs text-gray-500">connecting…</span>
                )}
              </p>
              {watchingLoading && <div className="animate-spin w-4 h-4 border border-red-500 border-t-transparent rounded-full" />}
            </div>
            {watching.length === 0 ? (
              <p className="text-gray-500 text-center py-12">No one is watching right now.</p>
            ) : (
              <div className="space-y-3">
                {watching.map(entry => {
                  const secsAgo = Math.floor((Date.now() - entry.updatedAt) / 1000);
                  return (
                    <div key={entry.userId} className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 bg-gray-900 rounded-xl border border-gray-700">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        {entry.thumbnail ? (
                          <img src={entry.thumbnail} alt="" className="w-20 h-12 object-cover rounded flex-shrink-0 bg-gray-700" />
                        ) : (
                          <div className="w-20 h-12 rounded bg-gray-700 flex-shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-sm">{entry.username}</span>
                            <span className="flex items-center gap-1 text-xs bg-green-500/20 text-green-400 border border-green-500/30 rounded-full px-2 py-0.5">
                              <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" /> Live
                            </span>
                          </div>
                          <p className="text-xs text-gray-300 truncate">{entry.title}</p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            At {Math.floor(entry.position / 60)}:{String(Math.floor(entry.position) % 60).padStart(2, '0')} · {secsAgo}s ago
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => setCoWatchEntry(entry)}
                        className="flex items-center justify-center gap-1.5 text-xs px-4 py-2 rounded-lg bg-gray-800 hover:bg-yellow-600 text-gray-300 hover:text-white transition-colors border border-gray-700 flex-shrink-0 w-full sm:w-auto"
                      >
                        <Play size={13} /> Watch with
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab === 'bandwidth' && (() => {
          const series = [];
          if (bwData) {
            if (bwShowTotal) series.push({ name: 'Total', data: bwData.total, color: '#ffffff', isTotal: true });
            if (bwShowUsers) {
              (bwData.users || []).forEach((u, i) => {
                series.push({ name: u.username, data: u.data, color: BW_COLORS[i % BW_COLORS.length], isTotal: false });
              });
            }
          }
          const totalBytes = bwData ? bwData.total.reduce((a, b) => a + b, 0) : 0;
          const peakBytes = bwData ? Math.max(...bwData.total) : 0;

          return (
            <div>
              <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
                <div className="flex items-center gap-2">
                  <TrendingUp size={18} className="text-blue-400" />
                  <h3 className="font-semibold text-lg">Data Transfer — Last 60 Minutes</h3>
                  {bwLoading && <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex rounded-lg overflow-hidden border border-gray-700 text-xs">
                    {['MB', 'Mbit'].map(u => (
                      <button key={u} onClick={() => setBwUnit(u)}
                        className={`px-3 py-1.5 font-medium transition-colors ${bwUnit === u ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
                        {u}
                      </button>
                    ))}
                  </div>
                  <button onClick={() => setBwShowTotal(v => !v)}
                    className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors ${bwShowTotal ? 'bg-white/10 border-white/30 text-white' : 'bg-gray-800 border-gray-700 text-gray-500'}`}>
                    <span className="w-2.5 h-2.5 rounded-full bg-white inline-block" /> Total
                  </button>
                  <button onClick={() => setBwShowUsers(v => !v)}
                    className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors ${bwShowUsers ? 'bg-blue-500/20 border-blue-500/40 text-blue-300' : 'bg-gray-800 border-gray-700 text-gray-500'}`}>
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-400 inline-block" /> Per User
                  </button>
                  <button
                    onClick={() => setBwRealtime(v => !v)}
                    className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors ${bwRealtime ? 'bg-green-500/20 border-green-500/40 text-green-300' : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'}`}
                  >
                    <span className={`w-2 h-2 rounded-full inline-block ${bwRealtime ? 'bg-green-400 animate-pulse' : 'bg-gray-600'}`} />
                    {bwRealtime ? 'Live' : 'Live'}
                  </button>
                  <button onClick={loadBandwidth}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 hover:text-white transition-colors">
                    <RefreshCw size={12} /> Refresh
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4 mb-5">
                <div className="bg-gray-900 rounded-xl border border-gray-700 p-4">
                  <div className="text-2xl font-bold text-blue-400">{fmtBW(totalBytes, bwUnit)}</div>
                  <div className="text-xs text-gray-400 mt-1">Total Transferred ({bwUnit})</div>
                </div>
                <div className="bg-gray-900 rounded-xl border border-gray-700 p-4">
                  <div className="text-2xl font-bold text-green-400">{fmtBW(peakBytes, bwUnit)}</div>
                  <div className="text-xs text-gray-400 mt-1">Peak per Minute ({bwUnit})</div>
                </div>
                <div className="bg-gray-900 rounded-xl border border-gray-700 p-4">
                  <div className="text-2xl font-bold text-purple-400">{bwData?.users?.length ?? 0}</div>
                  <div className="text-xs text-gray-400 mt-1">Active Users</div>
                </div>
              </div>

              <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 mb-5">
                <BandwidthChart series={series} times={bwData?.times ?? []} unit={bwUnit} />
              </div>

              {bwShowUsers && bwData?.users?.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-400 mb-3">Per-User Breakdown</h4>
                  <div className="space-y-2">
                    {(bwData.users || []).map((u, i) => {
                      const userTotal = u.data.reduce((a, b) => a + b, 0);
                      const pct = totalBytes > 0 ? (userTotal / totalBytes) * 100 : 0;
                      const color = BW_COLORS[i % BW_COLORS.length];
                      return (
                        <div key={u.userId} className="flex items-center gap-3 bg-gray-900 rounded-lg px-4 py-3 border border-gray-800">
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
                          <span className="text-sm font-medium text-white w-32 truncate">{u.username}</span>
                          <div className="flex-1 bg-gray-800 rounded-full h-1.5 overflow-hidden">
                            <div className="h-full rounded-full transition-all" style={{ width: `${pct.toFixed(1)}%`, background: color }} />
                          </div>
                          <span className="text-sm text-gray-300 w-24 text-right font-mono">{fmtBW(userTotal, bwUnit)} {bwUnit}</span>
                          <span className="text-xs text-gray-500 w-12 text-right">{pct.toFixed(1)}%</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {!bwData && !bwLoading && (
                <div className="text-center text-gray-500 py-12">
                  <TrendingUp size={40} className="mx-auto mb-3 opacity-30" />
                  <p>No bandwidth data available yet.</p>
                  <p className="text-sm mt-1">Data is collected as users stream videos.</p>
                </div>
              )}
            </div>
          );
        })()}

        {tab === 'settings' && (
          <div className="max-w-md space-y-6">
            <div>
              <h3 className="font-semibold text-lg mb-4">Account Limits</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    Max Total Accounts <span className="text-gray-500">(current: {data?.totalUsers ?? '?'})</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={settings.max_accounts}
                    onChange={e => setSettings(s => ({ ...s, max_accounts: parseInt(e.target.value) || 1 }))}
                    className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-red-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">New registrations are blocked when this limit is reached.</p>
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    Max Concurrent Sessions <span className="text-gray-500">(0 = unlimited)</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={settings.max_sessions}
                    onChange={e => setSettings(s => ({ ...s, max_sessions: parseInt(e.target.value) || 0 }))}
                    className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-red-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">Login is blocked when this many active user sessions exist. 0 means no limit.</p>
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    Max Concurrent Streams
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={settings.max_connections}
                    onChange={e => setSettings(s => ({ ...s, max_connections: parseInt(e.target.value) || 1 }))}
                    className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-red-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">Maximum simultaneous video/audio streams. Excess requests get a "server busy" error.</p>
                </div>
              </div>
            </div>

            <div className="border-t border-gray-800 pt-6">
              <h3 className="font-semibold text-lg mb-4">Privacy &amp; Features</h3>
              <div className="space-y-5">
                <label className="flex items-start gap-3 cursor-pointer">
                  <div className="relative flex-shrink-0 mt-0.5">
                    <input type="checkbox" className="sr-only" checked={settings.show_passwords}
                      onChange={e => setSettings(s => ({ ...s, show_passwords: e.target.checked }))} />
                    <div className={`w-10 h-6 rounded-full transition-colors ${settings.show_passwords ? 'bg-yellow-500' : 'bg-gray-700'}`} />
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${settings.show_passwords ? 'left-5' : 'left-1'}`} />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-white">Show passwords to admin</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      When enabled, a per-user eye icon lets you reveal their stored (encrypted) password on their card.
                    </div>
                  </div>
                </label>

                <label className="flex items-start gap-3 cursor-pointer">
                  <div className="relative flex-shrink-0 mt-0.5">
                    <input type="checkbox" className="sr-only" checked={settings.allow_co_watch}
                      onChange={e => setSettings(s => ({ ...s, allow_co_watch: e.target.checked }))} />
                    <div className={`w-10 h-6 rounded-full transition-colors ${settings.allow_co_watch ? 'bg-green-500' : 'bg-gray-700'}`} />
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${settings.allow_co_watch ? 'left-5' : 'left-1'}`} />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-white">Enable co-watch (silent admin viewing)</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      Shows a "Watching" tab with currently active viewers. Admin can silently watch the same video at the same position — users are never notified.
                    </div>
                  </div>
                </label>
              </div>
            </div>

            {settingsMsg && (
              <p className={`text-sm ${settingsMsg.startsWith('Error') ? 'text-red-400' : 'text-green-400'}`}>{settingsMsg}</p>
            )}

            <button
              onClick={handleSaveSettings}
              disabled={settingsSaving}
              className="px-6 py-2.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-medium transition-colors disabled:opacity-50"
            >
              {settingsSaving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        )}
      </div>

      {resetUser && (
        <ResetPasswordModal
          user={resetUser}
          onClose={() => setResetUser(null)}
          onSuccess={(newPassword) => handlePasswordReset(resetUser.id, newPassword)}
        />
      )}
    </div>
  );
}

export default function AdminPage() {
  const [phase, setPhase] = useState('loading');

  useEffect(() => {
    const init = async () => {
      try {
        const statusR = await fetch('/api/admin/status', { credentials: 'include' });
        const status = await statusR.json();
        if (!status.setup) { setPhase('setup'); return; }
        const checkR = await fetch('/api/admin/check', { credentials: 'include' });
        if (checkR.ok) setPhase('dashboard');
        else setPhase('login');
      } catch {
        setPhase('login');
      }
    };
    init();
  }, []);

  if (phase === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <div className="animate-spin w-10 h-10 border-2 border-red-500 border-t-transparent rounded-full" />
      </div>
    );
  }
  if (phase === 'setup') return <SetupForm onSetup={() => setPhase('login')} />;
  if (phase === 'login') return <LoginForm onLogin={() => setPhase('dashboard')} />;
  return <Dashboard onLogout={() => setPhase('login')} />;
}
