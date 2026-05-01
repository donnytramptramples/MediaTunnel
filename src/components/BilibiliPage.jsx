import React, { useState, useEffect } from 'react';
import { Search, Tv } from 'lucide-react';
import VideoCard from './VideoCard';
import KaliLoader from './KaliLoader';

export default function BilibiliPage({ onVideoSelect, initialQuery = '' }) {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState(initialQuery);
  const [activeQuery, setActiveQuery] = useState(initialQuery);

  // When the parent passes a new initialQuery (e.g. user searched
  // "bilibili" via the top SearchBar), pick it up and run the search.
  useEffect(() => {
    if (initialQuery !== undefined && initialQuery !== activeQuery) {
      setQuery(initialQuery);
      setActiveQuery(initialQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  const load = (q) => {
    setLoading(true);
    setError('');
    const url = q
      ? `/api/bilibili/search?q=${encodeURIComponent(q)}`
      : '/api/bilibili/popular';
    fetch(url)
      .then(r => r.json())
      .then(data => {
        if (data.error) setError(data.error);
        setVideos(data.videos || []);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load(activeQuery);
  }, [activeQuery]);

  const submitSearch = (e) => {
    e.preventDefault();
    setActiveQuery(query.trim());
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Tv size={20} className="text-pink-500" />
        <h2 className="text-lg font-semibold">Bilibili</h2>
        <span className="text-xs text-[var(--text-secondary)]">
          {activeQuery ? `Search: "${activeQuery}"` : 'Popular today'}
        </span>
      </div>

      <form onSubmit={submitSearch} className="mb-4 flex gap-2">
        <div className="flex-1 relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search Bilibili..."
            className="w-full pl-9 pr-3 py-2 bg-[var(--bg-secondary)] border border-[var(--border)] rounded text-sm focus:outline-none focus:border-[var(--accent)]"
          />
        </div>
        <button type="submit" className="breeze-btn px-4">Search</button>
        {activeQuery && (
          <button
            type="button"
            onClick={() => { setQuery(''); setActiveQuery(''); }}
            className="px-3 py-2 text-sm rounded bg-[var(--bg-secondary)] border border-[var(--border)] hover:bg-[var(--border)]"
          >
            Clear
          </button>
        )}
      </form>

      {loading ? (
        <KaliLoader text="LOADING BILIBILI..." />
      ) : error ? (
        <div className="text-red-400 text-center py-8">
          {error}
        </div>
      ) : videos.length === 0 ? (
        <div className="text-[var(--text-secondary)] text-center py-8">
          No videos found.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {videos.map(v => (
            <VideoCard
              key={v.id}
              video={v}
              onClick={() => onVideoSelect(v)}
              onChannelClick={() => {}}
            />
          ))}
        </div>
      )}
    </div>
  );
}
