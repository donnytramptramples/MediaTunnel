import React, { useState, useEffect } from 'react';
import { Loader2, Bookmark, Trash2, RefreshCw, Search, X } from 'lucide-react';
import VideoCard from './VideoCard';
import KaliLoader from './KaliLoader';

export default function SavedPage({ onVideoSelect, onChannelSelect }) {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const load = () => {
    setLoading(true);
    setError('');
    fetch('/api/saved')
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`Error ${r.status}`)))
      .then(data => setVideos(data.videos || []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleRemove = async (videoId, e) => {
    e.stopPropagation();
    await fetch(`/api/saved/${videoId}`, { method: 'DELETE' });
    setVideos(prev => prev.filter(v => v.id !== videoId));
  };

  const filtered = searchQuery.trim()
    ? videos.filter(v => v.title?.toLowerCase().includes(searchQuery.trim().toLowerCase()))
    : videos;

  if (loading) {
    return <KaliLoader text="QUERYING SAVED VIDEOS..." />;
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="flex items-center gap-2">
          <Bookmark size={20} className="text-[var(--accent)]" />
          <h2 className="text-xl font-bold">Saved Videos</h2>
          {videos.length > 0 && (
            <span className="text-sm text-[var(--text-secondary)] bg-[var(--bg-secondary)] px-2 py-0.5 rounded-full">
              {videos.length}
            </span>
          )}
        </div>

        {videos.length > 0 && (
          <div className="flex-1 min-w-[180px] max-w-xs relative ml-auto">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search saved…"
              className="w-full breeze-input pl-8 pr-8 text-sm py-1.5"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                <X size={13} />
              </button>
            )}
          </div>
        )}

        <button
          onClick={load}
          className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors"
        >
          <RefreshCw size={12} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="flex flex-col items-center gap-3 mb-6">
          <p className="text-red-400 text-sm">{error}</p>
          <button onClick={load} className="breeze-btn text-sm">Try Again</button>
        </div>
      )}

      {!error && videos.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <Bookmark size={48} className="text-[var(--text-secondary)] opacity-40" />
          <div className="text-center">
            <p className="text-[var(--text-secondary)] font-medium">No saved videos yet</p>
            <p className="text-sm text-[var(--text-secondary)] mt-1 opacity-70">
              Click the bookmark icon on any video to save it here
            </p>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex items-center justify-center h-40">
          <p className="text-[var(--text-secondary)]">No saved videos match "{searchQuery}"</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map(video => (
            <div key={video.id} className="relative group">
              <VideoCard
                video={video}
                onClick={() => onVideoSelect(video)}
                onChannelClick={(id, plat) => video.channelId && onChannelSelect && onChannelSelect(id || video.channelId, plat || video.platform)}
              />
              {/* Remove button */}
              <button
                onClick={(e) => handleRemove(video.id, e)}
                title="Remove from saved"
                className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/70 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 z-10"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
