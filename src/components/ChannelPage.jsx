import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ArrowLeft, Loader2, Users, SortAsc, ChevronDown, Search, X } from 'lucide-react';
import VideoCard from './VideoCard';
import KaliLoader from './KaliLoader';

const SERVER_PAGE_SIZE = 60;

export default function ChannelPage({ channelId, platform = 'youtube', onBack, onVideoSelect, user, onSubscribeChange }) {
  // Normalize once so we can safely append it to every backend URL on this page
  const plat = (platform === 'bilibili' || platform === 'twitch') ? platform : 'youtube';
  const platformParam = plat !== 'youtube' ? `&platform=${plat}` : '';
  const platformQuery = plat !== 'youtube' ? `?platform=${plat}` : '';
  const platformLabels = { youtube: 'YouTube', bilibili: 'Bilibili', twitch: 'Twitch' };
  const platformBadgeColors = {
    youtube: 'bg-red-500/15 text-red-400 border-red-500/40',
    bilibili: 'bg-pink-500/15 text-pink-400 border-pink-500/40',
    twitch: 'bg-purple-500/15 text-purple-400 border-purple-500/40',
  };
  const [channel, setChannel] = useState(null);
  const [allVideos, setAllVideos] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [sort, setSort] = useState('newest');
  const [subscribed, setSubscribed] = useState(false);
  const [subLoading, setSubLoading] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [scanState, setScanState] = useState({ active: false, pagesScanned: 0, totalFetched: 0, done: false });

  const scanCancelRef = useRef(false);
  const scanActiveRef = useRef(false);

  const fetchPage = useCallback(async (cId, s, page) => {
    const params = new URLSearchParams({ id: cId, sort: s, page, pageSize: SERVER_PAGE_SIZE, platform: plat });
    const r = await fetch(`/api/channel/videos?${params}`);
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new Error(text.startsWith('<') ? `Server error ${r.status}` : text || `Server error ${r.status}`);
    }
    return r.json();
  }, [plat]);

  // Initial load: reset everything and fetch page 1
  useEffect(() => {
    if (!channelId) return;
    setLoading(true);
    setError('');
    setAllVideos([]);
    setCurrentPage(1);
    setHasMore(false);
    setSearchQuery('');
    setScanState({ active: false, pagesScanned: 0, totalFetched: 0, done: false });
    scanCancelRef.current = true;
    scanActiveRef.current = false;

    fetchPage(channelId, sort, 1)
      .then(data => {
        if (data.error) { setError(data.error); return; }
        setChannel(data.channel || null);
        setAllVideos(data.videos || []);
        setHasMore(data.hasMore ?? false);
        setCurrentPage(1);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [channelId, sort, retryKey, plat]);

  // Auto-scan all pages when search query is active
  useEffect(() => {
    if (!searchQuery.trim() || loading) {
      if (!searchQuery.trim()) {
        scanCancelRef.current = true;
        scanActiveRef.current = false;
        setScanState({ active: false, pagesScanned: 0, totalFetched: 0, done: false });
      }
      return;
    }

    if (!hasMore || scanActiveRef.current) return;

    scanCancelRef.current = false;
    scanActiveRef.current = true;

    const runScan = async () => {
      setScanState(prev => ({ ...prev, active: true, done: false }));
      let page = currentPage;
      let more = hasMore;
      let pagesScanned = 0;
      let totalFetched = allVideos.length;

      try {
        while (more && !scanCancelRef.current) {
          page += 1;
          const data = await fetchPage(channelId, sort, page);
          if (scanCancelRef.current) break;

          if (data.videos?.length > 0) {
            const newVids = data.videos;
            setAllVideos(prev => {
              const existingIds = new Set(prev.map(v => v.id));
              return [...prev, ...newVids.filter(v => !existingIds.has(v.id))];
            });
            setCurrentPage(page);
            more = data.hasMore ?? false;
            setHasMore(more);
            pagesScanned += 1;
            totalFetched += newVids.length;
            setScanState({ active: true, pagesScanned, totalFetched, done: false });
          } else {
            more = false;
            setHasMore(false);
          }
        }
      } catch (e) {
        console.error('Scan error:', e.message);
      } finally {
        scanActiveRef.current = false;
        if (!scanCancelRef.current) {
          setScanState(prev => ({ ...prev, active: false, done: true }));
        }
      }
    };

    runScan();

    return () => {
      scanCancelRef.current = true;
      scanActiveRef.current = false;
    };
  }, [searchQuery, hasMore, loading]);

  const handleLoadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const nextPage = currentPage + 1;
      const data = await fetchPage(channelId, sort, nextPage);
      if (data.videos?.length > 0) {
        setAllVideos(prev => {
          const existingIds = new Set(prev.map(v => v.id));
          return [...prev, ...data.videos.filter(v => !existingIds.has(v.id))];
        });
        setCurrentPage(nextPage);
        setHasMore(data.hasMore ?? false);
      } else {
        setHasMore(false);
      }
    } catch (e) {
      console.error('Load more error:', e.message);
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    if (!user || !channelId) return;
    fetch(`/api/subscriptions/${encodeURIComponent(channelId)}/status${platformQuery}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : { subscribed: false })
      .then(data => setSubscribed(data.subscribed || false))
      .catch(() => {});
  }, [user, channelId, plat]);

  const handleSubscribe = async () => {
    if (!user) return;
    setSubLoading(true);
    try {
      if (subscribed) {
        await fetch(`/api/subscriptions/${encodeURIComponent(channelId)}${platformQuery}`, {
          method: 'DELETE', credentials: 'include',
        });
        setSubscribed(false);
      } else {
        await fetch('/api/subscriptions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            channelId,
            platform: plat,
            channelName: channel?.name || channelId,
            channelAvatar: channel?.avatar || '',
          }),
        });
        setSubscribed(true);
      }
      if (onSubscribeChange) onSubscribeChange();
    } catch { }
    finally { setSubLoading(false); }
  };

  const filteredVideos = useMemo(() => {
    if (!searchQuery.trim()) return allVideos;
    const q = searchQuery.trim().toLowerCase();
    return allVideos.filter(v => v.title?.toLowerCase().includes(q));
  }, [allVideos, searchQuery]);

  // Scan progress bar: logarithmic fill so it never hits 100% until actually done
  const scanBarPercent = scanState.done
    ? 100
    : scanState.pagesScanned > 0
      ? Math.min(95, Math.round((scanState.pagesScanned / (scanState.pagesScanned + 3)) * 100))
      : 0;

  const countLabel = searchQuery
    ? `${filteredVideos.length}${scanState.active ? '+' : ''} results`
    : `${allVideos.length}${hasMore ? '+' : ''} Videos`;

  return (
    <div className="max-w-6xl mx-auto">
      <button
        onClick={onBack}
        className="mb-4 flex items-center gap-2 hover:text-[var(--accent)] transition-colors text-sm"
      >
        <ArrowLeft size={16} />
        Back
      </button>

      {loading ? (
        <KaliLoader text="LOADING CHANNEL METADATA..." />
      ) : error ? (
        <div className="flex flex-col items-center justify-center h-40 gap-3">
          <p className="text-red-400 text-sm text-center max-w-sm">{error}</p>
          <button className="breeze-btn text-sm" onClick={() => setRetryKey(k => k + 1)}>Retry</button>
        </div>
      ) : (
        <>
          {channel && (
            <div className="breeze-card p-6 mb-6 flex items-start gap-4">
              {channel.avatar && (
                <img src={channel.avatar} alt={channel.name} className="w-20 h-20 rounded-full flex-shrink-0"
                  onError={e => { e.target.style.display = 'none'; }} />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <h1 className="text-2xl font-bold">{channel.name || channelId}</h1>
                  <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${platformBadgeColors[plat]}`}>
                    {platformLabels[plat]}
                  </span>
                </div>
                {channel.subscribers && (
                  <p className="text-sm text-[var(--text-secondary)] flex items-center gap-1 mb-2">
                    <Users size={14} />
                    {channel.subscribers} subscribers
                  </p>
                )}
                {channel.description && (
                  <p className="text-sm text-[var(--text-secondary)] line-clamp-2">{channel.description}</p>
                )}
              </div>
              {user && (
                <button
                  onClick={handleSubscribe}
                  disabled={subLoading}
                  className={`flex-shrink-0 px-5 py-2 rounded-full text-sm font-semibold transition-all ${
                    subscribed
                      ? 'bg-[var(--border)] text-[var(--text-secondary)] hover:bg-red-500/20 hover:text-red-400'
                      : 'bg-[var(--accent)] text-white hover:opacity-90'
                  } ${subLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {subLoading ? <Loader2 size={14} className="animate-spin inline" /> : subscribed ? 'Subscribed' : 'Subscribe'}
                </button>
              )}
            </div>
          )}

          {/* Controls row */}
          <div className="flex flex-wrap items-center gap-3 mb-2">
            <h2 className="text-lg font-semibold flex-shrink-0">{countLabel}</h2>

            {/* Video search within channel */}
            <div className="flex-1 min-w-[180px] max-w-xs relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none flex items-center">
                <Search size={14} className="text-[var(--text-secondary)]" />
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search videos…"
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

            <div className="flex items-center gap-2 ml-auto flex-shrink-0">
              <SortAsc size={16} className="text-[var(--text-secondary)]" />
              <select
                value={sort}
                onChange={e => setSort(e.target.value)}
                className="breeze-input text-sm py-1"
              >
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="popular">Most Popular</option>
              </select>
            </div>
          </div>

          {/* Scan progress bar — shown when search is active and scanning */}
          {searchQuery && (scanState.active || scanState.done) && (
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-[var(--text-secondary)]">
                  {scanState.active
                    ? `Scanning… ${scanState.totalFetched} videos checked`
                    : `Scan complete — ${scanState.totalFetched} videos searched`}
                </span>
                <span className="text-xs text-[var(--text-secondary)]">{scanBarPercent}%</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-[var(--border)] overflow-hidden">
                <div
                  className="h-full rounded-full bg-[var(--accent)] transition-all duration-500"
                  style={{ width: `${scanBarPercent}%` }}
                />
              </div>
            </div>
          )}

          {/* No-results state while scanning */}
          {filteredVideos.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-2">
              {scanState.active ? (
                <>
                  <Loader2 size={24} className="text-[var(--accent)] animate-spin" />
                  <p className="text-[var(--text-secondary)] text-sm">Scanning all videos…</p>
                </>
              ) : (
                <div className="text-center max-w-md">
                  <p className="text-[var(--text-secondary)]">
                    {searchQuery ? `No videos match "${searchQuery}"` : 'No videos found for this channel.'}
                  </p>
                  {!searchQuery && plat === 'bilibili' && (
                    <p className="text-xs text-[var(--text-secondary)] mt-2 opacity-75">
                      Bilibili sometimes blocks channel listings from server IPs. The subscription is still saved — try opening the channel directly on bilibili.com.
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {filteredVideos.map(video => (
                  <VideoCard key={video.id} video={video} onClick={() => onVideoSelect(video)} onChannelClick={() => {}} />
                ))}
              </div>

              {/* Load more — only show when not searching */}
              {!searchQuery && hasMore && (
                <div className="flex justify-center mt-8">
                  <button
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    className="flex items-center gap-2 px-6 py-2.5 rounded-full bg-[var(--bg-secondary)] border border-[var(--border)] hover:bg-[var(--border)] transition-colors text-sm font-medium disabled:opacity-60"
                  >
                    {loadingMore ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <ChevronDown size={16} />
                    )}
                    {loadingMore ? 'Loading…' : 'Load More Videos'}
                  </button>
                </div>
              )}

              {!searchQuery && !hasMore && allVideos.length > 0 && (
                <p className="text-center text-[var(--text-secondary)] text-sm mt-8">
                  All {allVideos.length} videos loaded
                </p>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
