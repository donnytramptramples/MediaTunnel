import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2, ChevronUp, ChevronDown, Play, Pause, Volume2, VolumeX, RefreshCw, Share2 } from 'lucide-react';
import KaliLoader from './KaliLoader';

function ShortPlayer({ short, isActive, onChannelClick }) {
  const videoRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [loading, setLoading] = useState(true);
  const [proxyReady, setProxyReady] = useState(false);

  // Load proxy URL when active
  useEffect(() => {
    if (!isActive) {
      setProxyReady(false);
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.src = '';
      }
      setPlaying(false);
      return;
    }
    setLoading(true);
    setProxyReady(true);
  }, [isActive, short.id]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !isActive || !proxyReady) return;

    const onCanPlay = () => { setLoading(false); v.play().catch(() => {}); };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => { v.currentTime = 0; v.play().catch(() => {}); };
    const onWaiting = () => setLoading(true);
    const onPlaying = () => setLoading(false);

    v.addEventListener('canplay', onCanPlay);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('ended', onEnded);
    v.addEventListener('waiting', onWaiting);
    v.addEventListener('playing', onPlaying);

    return () => {
      v.removeEventListener('canplay', onCanPlay);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('ended', onEnded);
      v.removeEventListener('waiting', onWaiting);
      v.removeEventListener('playing', onPlaying);
    };
  }, [isActive, proxyReady, short.id]);

  const togglePlay = (e) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  };

  const toggleMute = (e) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    v.muted = !muted;
    setMuted(!muted);
  };

  return (
    <div className="relative w-full h-full bg-black overflow-hidden">
      {/* Video element */}
      {proxyReady && (
        <video
          key={short.id}
          ref={videoRef}
          src={`/api/proxy/${short.id}?quality=360`}
          className="absolute inset-0 w-full h-full object-contain"
          muted={muted}
          playsInline
          loop
          preload="auto"
          onClick={togglePlay}
          style={{ cursor: 'pointer' }}
        />
      )}

      {/* Thumbnail shown while loading */}
      {(!proxyReady || loading) && (
        <img
          src={short.thumbnail}
          alt={short.title}
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}

      {/* Loading spinner */}
      {loading && isActive && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 pointer-events-none">
          <Loader2 size={44} className="text-white animate-spin" />
        </div>
      )}

      {/* Play/Pause overlay (tap anywhere to toggle) */}
      {!loading && isActive && !playing && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-black/50 rounded-full p-4">
            <Play size={36} fill="white" className="text-white" />
          </div>
        </div>
      )}

      {/* Bottom overlay: info */}
      <div
        className="absolute bottom-0 left-0 right-16 p-4 pointer-events-none"
        style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 100%)' }}
      >
        {short.channel && (
          <p
            className="text-white text-sm font-semibold mb-1 pointer-events-auto cursor-pointer hover:underline"
            onClick={(e) => { e.stopPropagation(); onChannelClick && short.channelId && onChannelClick(short.channelId); }}
          >
            @{short.channel}
          </p>
        )}
        <p className="text-white text-sm line-clamp-2 leading-snug">{short.title}</p>
        {short.views && <p className="text-white/70 text-xs mt-1">{short.views}</p>}
      </div>

      {/* Right side action buttons */}
      <div className="absolute right-3 bottom-16 flex flex-col items-center gap-5">
        {/* Mute */}
        <button
          onClick={toggleMute}
          className="flex flex-col items-center gap-1 text-white"
        >
          <div className="w-11 h-11 rounded-full bg-black/50 flex items-center justify-center hover:bg-black/70 transition-colors">
            {muted ? <VolumeX size={22} /> : <Volume2 size={22} />}
          </div>
        </button>
      </div>
    </div>
  );
}

export default function ShortsPage({ user, onVideoSelect, onChannelSelect }) {
  const [shorts, setShorts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentIdx, setCurrentIdx] = useState(0);
  const containerRef = useRef(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isPersonalized, setIsPersonalized] = useState(false);

  const load = (force = false) => {
    setLoading(true);
    setError('');
    setCurrentIdx(0);
    setShorts([]);
    setIsPersonalized(false);

    const tryPersonalized = user && !force;
    const regularUrl = force ? `/api/shorts?force=true&_=${Date.now()}` : '/api/shorts';

    const doLoad = (url, personalized) =>
      fetch(url, { credentials: 'include' })
        .then(r => r.json())
        .then(data => {
          if (data.error && !data.shorts?.length) throw new Error(data.error);
          const list = data.shorts || [];
          if (list.length === 0) throw new Error('No shorts');
          setShorts(list);
          setIsPersonalized(personalized);
        });

    if (tryPersonalized) {
      doLoad(`/api/shorts/personalized?_=${Date.now()}`, true)
        .catch(() => doLoad(regularUrl, false))
        .catch(e => setError(e.message))
        .finally(() => setLoading(false));
    } else {
      doLoad(regularUrl, false)
        .catch(e => setError(e.message))
        .finally(() => setLoading(false));
    }
  };

  useEffect(load, []);

  const goNext = useCallback(() => {
    if (isTransitioning || currentIdx >= shorts.length - 1) return;
    setIsTransitioning(true);
    setCurrentIdx(i => i + 1);
    setTimeout(() => setIsTransitioning(false), 350);
  }, [currentIdx, shorts.length, isTransitioning]);

  const goPrev = useCallback(() => {
    if (isTransitioning || currentIdx <= 0) return;
    setIsTransitioning(true);
    setCurrentIdx(i => i - 1);
    setTimeout(() => setIsTransitioning(false), 350);
  }, [currentIdx, isTransitioning]);

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowDown' || e.key === 'j') goNext();
      if (e.key === 'ArrowUp' || e.key === 'k') goPrev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goNext, goPrev]);

  // Touch swipe support
  const touchStartY = useRef(null);
  const onTouchStart = (e) => { touchStartY.current = e.touches[0].clientY; };
  const onTouchEnd = (e) => {
    if (touchStartY.current === null) return;
    const diff = touchStartY.current - e.changedTouches[0].clientY;
    if (Math.abs(diff) > 50) {
      if (diff > 0) goNext();
      else goPrev();
    }
    touchStartY.current = null;
  };

  if (loading) {
    return <KaliLoader text="FETCHING SHORT-FORM CONTENT..." />;
  }

  if (error || shorts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4" style={{ height: 'calc(100vh - 80px)' }}>
        <p className="text-[var(--text-secondary)] text-center">{error || 'No Shorts available right now'}</p>
        <button onClick={() => load(true)} className="breeze-btn flex items-center gap-2">
          <RefreshCw size={14} />
          Try Again
        </button>
      </div>
    );
  }

  const short = shorts[currentIdx];

  return (
    <div
      className="flex items-center justify-center"
      style={{ height: 'calc(100vh - 80px)', position: 'relative' }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Short viewer — YouTube Shorts proportions (9:16) */}
      <div
        ref={containerRef}
        className="relative rounded-xl overflow-hidden"
        style={{
          height: 'min(calc(100vh - 120px), 700px)',
          width: 'min(calc((100vh - 120px) * 9 / 16), 394px)',
          background: '#000',
          boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
        }}
      >
        {/* Slide animation wrapper */}
        <div
          key={currentIdx}
          className="w-full h-full"
          style={{
            animation: 'shortSlideIn 0.3s ease-out',
          }}
        >
          <ShortPlayer
            short={short}
            isActive={true}
            onChannelClick={onChannelSelect}
          />
        </div>

        {/* Open in full player button */}
        <button
          onClick={() => onVideoSelect(short)}
          className="absolute top-3 right-3 text-xs px-2.5 py-1 rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors border border-white/20 z-10"
        >
          Open ↗
        </button>

        {/* Progress dots */}
        <div className="absolute top-3 left-0 right-0 flex justify-center gap-1 pointer-events-none z-10">
          {shorts.slice(Math.max(0, currentIdx - 3), currentIdx + 4).map((_, i) => {
            const absIdx = Math.max(0, currentIdx - 3) + i;
            return (
              <div
                key={absIdx}
                className="rounded-full transition-all"
                style={{
                  width: absIdx === currentIdx ? 16 : 4,
                  height: 4,
                  backgroundColor: absIdx === currentIdx ? 'white' : 'rgba(255,255,255,0.4)',
                }}
              />
            );
          })}
        </div>
      </div>

      {/* Navigation arrows — outside the video card */}
      <div className="absolute right-4 md:right-8 flex flex-col items-center gap-3" style={{ top: '50%', transform: 'translateY(-50%)' }}>
        <button
          onClick={goPrev}
          disabled={currentIdx === 0}
          className={`flex flex-col items-center gap-1 group transition-opacity ${currentIdx === 0 ? 'opacity-30 cursor-not-allowed' : 'opacity-100 cursor-pointer'}`}
          title="Previous short"
        >
          <div className="w-12 h-12 rounded-full bg-[var(--bg-secondary)] border border-[var(--border)] flex items-center justify-center group-hover:bg-[var(--accent)] group-hover:border-[var(--accent)] group-hover:text-white transition-all shadow-lg">
            <ChevronUp size={22} />
          </div>
          <span className="text-xs text-[var(--text-secondary)]">Prev</span>
        </button>

        <div className="text-center text-xs text-[var(--text-secondary)] font-medium px-2 py-1 rounded-full bg-[var(--bg-secondary)] border border-[var(--border)]">
          {currentIdx + 1} / {shorts.length}
        </div>

        <button
          onClick={goNext}
          disabled={currentIdx >= shorts.length - 1}
          className={`flex flex-col items-center gap-1 group transition-opacity ${currentIdx >= shorts.length - 1 ? 'opacity-30 cursor-not-allowed' : 'opacity-100 cursor-pointer'}`}
          title="Next short"
        >
          <div className="w-12 h-12 rounded-full bg-[var(--bg-secondary)] border border-[var(--border)] flex items-center justify-center group-hover:bg-[var(--accent)] group-hover:border-[var(--accent)] group-hover:text-white transition-all shadow-lg">
            <ChevronDown size={22} />
          </div>
          <span className="text-xs text-[var(--text-secondary)]">Next</span>
        </button>
      </div>

      {/* Personalized badge + Refresh button */}
      <div className="absolute top-0 right-4 md:right-8 flex items-center gap-3">
        {isPersonalized && (
          <span className="text-xs text-[var(--accent)] font-medium opacity-80">For You</span>
        )}
        <button
          onClick={() => load(true)}
          className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors"
        >
          <RefreshCw size={12} />
          Refresh
        </button>
      </div>

      <style>{`
        @keyframes shortSlideIn {
          from { opacity: 0; transform: translateY(30px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
