import React, { useState, useEffect } from 'react';
import { Loader2, Search } from 'lucide-react';
import VideoCard from './VideoCard';
import KaliLoader from './KaliLoader';

function ChannelCard({ channel, onClick }) {
  return (
    <div
      onClick={() => onClick(channel.id)}
      className="breeze-card p-4 flex items-center gap-4 cursor-pointer hover:shadow-md transition-shadow"
    >
      {channel.avatar ? (
        <img src={channel.avatar} alt={channel.name} className="w-14 h-14 rounded-full flex-shrink-0" />
      ) : (
        <div className="w-14 h-14 rounded-full bg-[var(--border)] flex items-center justify-center text-xl font-bold flex-shrink-0">
          {channel.name?.[0]?.toUpperCase()}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <h3 className="font-semibold text-sm mb-0.5">{channel.name}</h3>
        {channel.subscribers && (
          <p className="text-xs text-[var(--text-secondary)]">{channel.subscribers}</p>
        )}
        {channel.description && (
          <p className="text-xs text-[var(--text-secondary)] line-clamp-1 mt-0.5">{channel.description}</p>
        )}
      </div>
    </div>
  );
}

export default function VideoGrid({ searchQuery, onVideoSelect, onChannelSelect }) {
  const [videos, setVideos] = useState([]);
  const [channels, setChannels] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isError, setIsError] = useState(false);
  const [searchId, setSearchId] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [activeTab, setActiveTab] = useState('videos');

  useEffect(() => {
    if (!searchQuery) {
      setVideos([]);
      setChannels([]);
      setSearchId(null);
      setHasMore(false);
      return;
    }

    setIsLoading(true);
    setIsError(false);
    setVideos([]);
    setChannels([]);
    setSearchId(null);
    setHasMore(false);
    setActiveTab('videos');

    Promise.all([
      fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`).then(r => r.json()),
      fetch(`/api/channel/search?q=${encodeURIComponent(searchQuery)}`).then(r => r.json()),
    ])
      .then(([videoData, channelData]) => {
        setVideos(videoData.videos || []);
        setSearchId(videoData.searchId || null);
        setHasMore(videoData.hasMore ?? false);
        setChannels(channelData.channels || []);
      })
      .catch(() => setIsError(true))
      .finally(() => setIsLoading(false));
  }, [searchQuery]);

  const loadMore = async () => {
    if (!searchId || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/search/more?searchId=${searchId}`);
      const data = await res.json();
      if (data.videos?.length) {
        setVideos(prev => [...prev, ...data.videos]);
        setSearchId(data.searchId || searchId);
        setHasMore(data.hasMore ?? false);
      } else {
        setHasMore(false);
      }
    } catch {
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  };

  if (!searchQuery) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <Search size={40} className="text-[var(--text-secondary)]" />
        <p className="text-[var(--text-secondary)]">Search for videos to get started</p>
      </div>
    );
  }

  if (isLoading) {
    return <KaliLoader text="EXECUTING SEARCH QUERY..." />;
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-red-400 text-center">Search failed. The API may still be initialising — try again in a moment.</p>
      </div>
    );
  }

  const hasChannels = channels.length > 0;
  const hasVideos = videos.length > 0;

  return (
    <div>
      {/* Tabs */}
      {hasChannels && (
        <div className="flex gap-1 mb-4">
          <button
            onClick={() => setActiveTab('videos')}
            className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${activeTab === 'videos' ? 'bg-[var(--accent)] text-white' : 'bg-[var(--bg-secondary)] hover:bg-[var(--border)]'}`}
          >
            Videos {hasVideos ? `(${videos.length}+)` : ''}
          </button>
          <button
            onClick={() => setActiveTab('channels')}
            className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${activeTab === 'channels' ? 'bg-[var(--accent)] text-white' : 'bg-[var(--bg-secondary)] hover:bg-[var(--border)]'}`}
          >
            Channels ({channels.length})
          </button>
        </div>
      )}

      {activeTab === 'channels' && hasChannels && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {channels.map(channel => (
            <ChannelCard key={channel.id} channel={channel} onClick={onChannelSelect} />
          ))}
        </div>
      )}

      {activeTab === 'videos' && (
        <>
          {!hasVideos ? (
            <div className="flex items-center justify-center h-64">
              <p className="text-[var(--text-secondary)]">No video results found.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {videos.map(video => (
                  <VideoCard key={video.id} video={video} onClick={() => onVideoSelect(video)} onChannelClick={onChannelSelect} />
                ))}
              </div>

              {hasMore && (
                <div className="flex justify-center mt-6">
                  <button
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="breeze-btn flex items-center gap-2 px-6"
                  >
                    {loadingMore && <Loader2 size={16} className="animate-spin" />}
                    {loadingMore ? 'Loading…' : 'Load More'}
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
