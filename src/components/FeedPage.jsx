import React, { useState, useEffect } from 'react';
import { Loader2, Rss, TrendingUp, RefreshCw } from 'lucide-react';
import VideoCard from './VideoCard';
import KaliLoader from './KaliLoader';

export default function FeedPage({ user, onVideoSelect, onChannelSelect }) {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [subscriptions, setSubscriptions] = useState([]);
  const [error, setError] = useState('');

  const load = () => {
    if (!user) return;
    setLoading(true);
    setError('');

    Promise.all([
      fetch('/api/feed', { credentials: 'include' }).then(r => r.json()),
      fetch('/api/subscriptions', { credentials: 'include' }).then(r => r.json()),
    ])
      .then(([feedData, subsData]) => {
        setVideos(feedData.videos || []);
        setSubscriptions(subsData.subscriptions || []);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [user]);

  if (loading) {
    return <KaliLoader text="FETCHING VIDEO FEED..." />;
  }

  return (
    <div>
      {/* Subscribed channels row */}
      {subscriptions.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">Subscriptions</h2>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {subscriptions.map(sub => {
              // A small coloured corner-dot identifies which platform the
              // subscription came from at a glance — red=YT, pink=Bilibili,
              // purple=Twitch.
              const dot = sub.platform === 'bilibili' ? 'bg-pink-500'
                : sub.platform === 'twitch' ? 'bg-purple-500'
                : 'bg-red-500';
              return (
                <button
                  key={`${sub.platform || 'youtube'}:${sub.channel_id}`}
                  onClick={() => onChannelSelect(sub.channel_id, sub.platform || 'youtube')}
                  className="flex flex-col items-center gap-1 flex-shrink-0 group"
                  title={`${sub.channel_name} (${sub.platform || 'youtube'})`}
                >
                  <div className="relative">
                    {sub.channel_avatar ? (
                      <img
                        src={sub.channel_avatar}
                        alt={sub.channel_name}
                        className="w-12 h-12 rounded-full group-hover:ring-2 ring-[var(--accent)] transition-all"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-[var(--border)] flex items-center justify-center text-sm font-bold">
                        {sub.channel_name[0]?.toUpperCase()}
                      </div>
                    )}
                    <span className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-[var(--bg-primary)] ${dot}`} />
                  </div>
                  <span className="text-xs text-[var(--text-secondary)] max-w-[60px] truncate">{sub.channel_name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {error && (
        <div className="flex flex-col items-center gap-3 mb-6">
          <p className="text-red-400 text-sm">{error}</p>
          <button onClick={load} className="flex items-center gap-2 breeze-btn text-sm">
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      )}

      {videos.length === 0 && !loading ? (
        <div className="flex flex-col items-center justify-center h-64 gap-3">
          <Rss size={40} className="text-[var(--text-secondary)]" />
          <p className="text-[var(--text-secondary)] text-lg font-medium">No videos yet</p>
          <p className="text-[var(--text-secondary)] text-sm text-center max-w-xs">
            Subscribe to channels to see their latest videos, and we'll also mix in trending content.
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wide flex items-center gap-2">
              <TrendingUp size={14} />
              {subscriptions.length > 0 ? 'For You' : 'Trending Now'}
            </h2>
            <button
              onClick={load}
              className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors"
            >
              <RefreshCw size={12} />
              Refresh
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {videos.map(video => (
              <VideoCard
                key={`${video.id}-${video.channelId}`}
                video={video}
                onClick={() => onVideoSelect(video)}
                onChannelClick={onChannelSelect}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
