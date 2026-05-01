import React, { useEffect, useMemo, useState } from 'react';
import { Users, Trash2, RefreshCw, Search, X } from 'lucide-react';
import KaliLoader from './KaliLoader';

const PLATFORM_META = {
  youtube:  { label: 'YouTube',  ring: 'ring-red-500/60',    dot: 'bg-red-500',    badge: 'bg-red-500/15 text-red-400 border-red-500/40' },
  bilibili: { label: 'Bilibili', ring: 'ring-pink-500/60',   dot: 'bg-pink-500',   badge: 'bg-pink-500/15 text-pink-400 border-pink-500/40' },
  twitch:   { label: 'Twitch',   ring: 'ring-purple-500/60', dot: 'bg-purple-500', badge: 'bg-purple-500/15 text-purple-400 border-purple-500/40' },
};

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'youtube', label: 'YouTube' },
  { key: 'bilibili', label: 'Bilibili' },
  { key: 'twitch', label: 'Twitch' },
];

export default function SubscriptionsPage({ user, onChannelSelect }) {
  const [subs, setSubs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [removingKey, setRemovingKey] = useState('');

  const load = () => {
    if (!user) return;
    setLoading(true);
    setError('');
    fetch('/api/subscriptions', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setSubs(Array.isArray(d.subscriptions) ? d.subscriptions : []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [user]);

  // Pre-compute per-platform counts so the filter chips can show how many
  // subscriptions live on each backend without re-iterating in render.
  const counts = useMemo(() => {
    const c = { all: subs.length, youtube: 0, bilibili: 0, twitch: 0 };
    for (const s of subs) {
      const p = (s.platform || 'youtube').toLowerCase();
      if (c[p] != null) c[p] += 1;
    }
    return c;
  }, [subs]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return subs
      .filter(s => filter === 'all' || (s.platform || 'youtube') === filter)
      .filter(s => !q || (s.channel_name || '').toLowerCase().includes(q));
  }, [subs, filter, query]);

  const handleRemove = async (sub) => {
    const key = `${sub.platform || 'youtube'}:${sub.channel_id}`;
    setRemovingKey(key);
    try {
      const platform = sub.platform || 'youtube';
      const platQS = platform !== 'youtube' ? `?platform=${platform}` : '';
      const r = await fetch(
        `/api/subscriptions/${encodeURIComponent(sub.channel_id)}${platQS}`,
        { method: 'DELETE', credentials: 'include' },
      );
      if (r.ok) setSubs(prev => prev.filter(s => !(s.channel_id === sub.channel_id && (s.platform || 'youtube') === platform)));
    } catch {}
    setRemovingKey('');
  };

  if (loading) return <KaliLoader text="LOADING SUBSCRIPTIONS..." />;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Users size={20} className="text-[var(--accent)]" />
          My Subscriptions
          <span className="text-sm font-normal text-[var(--text-secondary)]">({subs.length})</span>
        </h1>
        <button
          onClick={load}
          className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors"
          title="Refresh"
        >
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {/* Filter chips + search */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {FILTERS.map(f => {
          const active = filter === f.key;
          const count = counts[f.key] ?? 0;
          const dotKey = f.key === 'all' ? null : f.key;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                active
                  ? 'bg-[var(--accent)] border-[var(--accent)] text-white'
                  : 'bg-[var(--bg-secondary)] border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {dotKey && <span className={`w-2 h-2 rounded-full ${PLATFORM_META[dotKey].dot}`} />}
              {f.label}
              <span className={`text-[10px] px-1.5 rounded-full ${active ? 'bg-white/25' : 'bg-[var(--border)]'}`}>{count}</span>
            </button>
          );
        })}

        <div className="relative ml-auto min-w-[180px] max-w-xs flex-1">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
            <Search size={14} className="text-[var(--text-secondary)]" />
          </span>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Filter channels…"
            className="w-full breeze-input pl-8 pr-8 text-sm py-1.5"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

      {visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 gap-2 text-[var(--text-secondary)]">
          <Users size={36} className="opacity-50" />
          {subs.length === 0 ? (
            <>
              <p className="text-lg font-medium">No subscriptions yet</p>
              <p className="text-sm text-center max-w-sm opacity-75">
                Open any channel on YouTube, Bilibili, or Twitch and tap Subscribe — it'll show up here.
              </p>
            </>
          ) : (
            <p className="text-sm">No channels match the current filter.</p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {visible.map(sub => {
            const platform = (sub.platform || 'youtube').toLowerCase();
            const meta = PLATFORM_META[platform] || PLATFORM_META.youtube;
            const key = `${platform}:${sub.channel_id}`;
            return (
              <div
                key={key}
                className="breeze-card p-3 flex flex-col items-center text-center gap-2 group relative cursor-pointer hover:shadow-lg transition-shadow"
                onClick={() => onChannelSelect && onChannelSelect(sub.channel_id, platform)}
              >
                {/* Platform badge — top-left corner */}
                <span className={`absolute top-1.5 left-1.5 text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${meta.badge}`}>
                  {meta.label}
                </span>

                {/* Remove button — top-right corner, hover only */}
                <button
                  onClick={e => { e.stopPropagation(); handleRemove(sub); }}
                  disabled={removingKey === key}
                  title="Unsubscribe"
                  className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 disabled:opacity-30"
                >
                  <Trash2 size={12} />
                </button>

                <div className="relative pt-3">
                  {sub.channel_avatar ? (
                    <img
                      src={sub.channel_avatar}
                      alt={sub.channel_name}
                      className={`w-16 h-16 rounded-full ring-2 ${meta.ring}`}
                      onError={e => { e.target.style.display = 'none'; }}
                    />
                  ) : (
                    <div className={`w-16 h-16 rounded-full bg-[var(--border)] flex items-center justify-center text-xl font-bold ring-2 ${meta.ring}`}>
                      {(sub.channel_name || '?')[0]?.toUpperCase()}
                    </div>
                  )}
                  <span className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-[var(--bg-secondary)] ${meta.dot}`} />
                </div>

                <div className="w-full">
                  <p className="text-sm font-semibold truncate" title={sub.channel_name}>{sub.channel_name}</p>
                  <p className="text-[10px] text-[var(--text-secondary)] opacity-75">
                    Subscribed {sub.subscribed_at ? new Date(sub.subscribed_at).toLocaleDateString() : ''}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
