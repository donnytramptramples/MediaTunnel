import React, { useState, useEffect } from 'react';
import { Clock, Trash2 } from 'lucide-react';

export default function WatchHistoryPage({ onVideoSelect }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);

  const load = () => {
    setLoading(true);
    fetch('/api/watch/history', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => setData({ history: [] }))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const clearHistory = async () => {
    if (!window.confirm('Clear all watch history?')) return;
    setClearing(true);
    try {
      await fetch('/api/watch/history', { method: 'DELETE', credentials: 'include' });
      setData({ history: [] });
    } catch {}
    setClearing(false);
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold">Watch History</h2>
          <p className="text-[var(--text-secondary)] text-sm mt-0.5">{data?.history?.length || 0} entries</p>
        </div>
        {data?.history?.length > 0 && (
          <button
            onClick={clearHistory}
            disabled={clearing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
          >
            <Trash2 size={14} />
            Clear all
          </button>
        )}
      </div>

      {data?.history?.length === 0 ? (
        <p className="text-[var(--text-secondary)] text-center py-16">No watch history yet.</p>
      ) : (
        <div className="space-y-2">
          {data.history.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-3 p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] cursor-pointer hover:border-[var(--accent)] transition-colors"
              onClick={() => onVideoSelect && onVideoSelect({
                id: item.video_id,
                title: item.title,
                thumbnail: item.thumbnail,
                channel: item.channel,
                channelId: item.channel_id,
                channelAvatar: '',
                views: '',
              })}
            >
              {item.thumbnail && (
                <img src={item.thumbnail} alt="" className="w-16 h-9 object-cover rounded flex-shrink-0 bg-[var(--bg-primary)]" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{item.title}</p>
                <p className="text-xs text-[var(--text-secondary)] truncate">{item.channel}</p>
              </div>
              <div className="text-xs text-[var(--text-secondary)] flex-shrink-0 flex items-center gap-1">
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
