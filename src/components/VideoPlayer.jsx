import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  ArrowLeft, Play, Pause, Volume2, VolumeX, Maximize, Minimize,
  Loader2, Settings, Download, Video, Music, Disc3, Headphones, FileAudio,
  Subtitles, ChevronDown, ChevronUp, MessageSquare, ThumbsUp, Bookmark, BookmarkCheck,
  Share2, Check
} from 'lucide-react';
import { useDownload } from '../DownloadContext';
import CollaboratorPicker from './CollaboratorPicker';
import { useVideoBuffer } from '../hooks/useVideoBuffer';
import TwitchChat from './TwitchChat';

// sessionStorage cache — auto-cleared when the tab closes
const SS_TTL = 30 * 60 * 1000; // 30 minutes

function ssGet(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const { data, exp } = JSON.parse(raw);
    if (Date.now() > exp) { sessionStorage.removeItem(key); return null; }
    return data;
  } catch { return null; }
}

function ssSet(key, data) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ data, exp: Date.now() + SS_TTL }));
  } catch {}
}

// localStorage cache — persists across sessions (7-day TTL for position)
const LS_POS_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

function lsGet(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { data, exp } = JSON.parse(raw);
    if (Date.now() > exp) { localStorage.removeItem(key); return null; }
    return data;
  } catch { return null; }
}

function lsSet(key, data, ttl = LS_POS_TTL) {
  try {
    localStorage.setItem(key, JSON.stringify({ data, exp: Date.now() + ttl }));
  } catch {}
}

function lsRemove(key) {
  try { localStorage.removeItem(key); } catch {}
}

function formatTime(secs) {
  const s = Math.floor(secs || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function parseTimestamp(ts) {
  const parts = ts.trim().replace(',', '.').split(':');
  if (parts.length === 3) return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
  if (parts.length === 2) return parseInt(parts[0]) * 60 + parseFloat(parts[1]);
  return parseFloat(parts[0]);
}

function decodeHtml(str) {
  return str.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function parseVTT(text) {
  const cues = [];
  if (!text) return cues;
  const blocks = text.replace(/\r\n/g, '\n').split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    const tsIdx = lines.findIndex(l => l.includes('-->'));
    if (tsIdx === -1) continue;
    const tsParts = lines[tsIdx].split('-->');
    if (tsParts.length < 2) continue;
    const start = parseTimestamp(tsParts[0].trim().split(' ')[0]);
    const end = parseTimestamp(tsParts[1].trim().split(' ')[0]);
    if (isNaN(start) || isNaN(end)) continue;

    const rawText = lines.slice(tsIdx + 1).join('\n');

    const words = [];
    const wordRe = /<(\d{2}:\d{2}[:.]\d{3})><c>(.*?)<\/c>/g;
    let wm;
    while ((wm = wordRe.exec(rawText)) !== null) {
      const wStart = parseTimestamp(wm[1]);
      const wText = decodeHtml(wm[2]);
      if (!isNaN(wStart) && wText.trim()) words.push({ start: wStart, text: wText });
    }

    const cleanText = decodeHtml(rawText.replace(/<[^>]+>/g, '')).trim();
    if (cleanText) cues.push({ start, end, text: cleanText, words: words.length >= 2 ? words : null });
  }
  return cues;
}

function SubtitleOverlay({ cue, currentTime, size, pos }) {
  if (!cue) return null;

  const baseStyle = {
    left: '50%',
    maxWidth: '90%',
    textAlign: 'center'
  };

  let posStyle;
  switch (pos) {
    case 'center':
      posStyle = { top: '50%', transform: 'translateX(-50%) translateY(-50%)', bottom: 'auto' };
      break;
    case 'top':
      posStyle = { top: '12px', bottom: 'auto', transform: 'translateX(-50%)' };
      break;
    case 'bottom':
    default:
      posStyle = { bottom: '68px', top: 'auto', transform: 'translateX(-50%)' };
  }

  return (
    <div
      className="absolute left-1/2 pointer-events-none text-center"
      style={{ ...baseStyle, ...posStyle }}
    >
      <span
        className="inline-block px-3 py-1 rounded"
        style={{ fontSize: `${size}px`, backgroundColor: 'rgba(0,0,0,0.82)', lineHeight: 1.4, whiteSpace: 'pre-wrap', textAlign: 'center' }}
      >
        {cue.words ? (
          cue.words.map((word, i) => {
            const nextStart = cue.words[i + 1]?.start ?? cue.end;
            const active = currentTime >= word.start && currentTime < nextStart;
            return (
              <span key={i} style={{ color: active ? '#fff' : 'rgba(255,255,255,0.6)', fontWeight: active ? 700 : 400, transition: 'color 0.1s' }}>
                {word.text}{' '}
              </span>
            );
          })
        ) : (
          <span style={{ color: '#fff' }}>{cue.text}</span>
        )}
      </span>
    </div>
  );
}

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

const FORMAT_OPTIONS = [
  { value: 'mp4',  label: 'MP4 (Video)',      Icon: Video,     hasQuality: true,  hasBitrate: false, hasCompression: false },
  { value: 'mp3',  label: 'MP3 (Audio)',       Icon: Music,     hasQuality: false, hasBitrate: true,  hasCompression: false },
  { value: 'flac', label: 'FLAC (Lossless)',   Icon: Disc3,     hasQuality: false, hasBitrate: false, hasCompression: true  },
  { value: 'opus', label: 'Opus',              Icon: Headphones,hasQuality: false, hasBitrate: true,  hasCompression: false },
  { value: 'ogg',  label: 'Ogg Vorbis',        Icon: FileAudio, hasQuality: false, hasBitrate: true,  hasCompression: false },
  { value: 'm4a',  label: 'M4A (AAC)',         Icon: Music,     hasQuality: false, hasBitrate: true,  hasCompression: false },
];

const BITRATE_OPTIONS = ['96k', '128k', '192k', '256k', '320k'];
const COMPRESSION_OPTIONS = [
  { value: '0', label: '0 – Fastest' },
  { value: '3', label: '3 – Fast' },
  { value: '5', label: '5 – Default' },
  { value: '8', label: '8 – Best' },
];

function DownloadPanel({ video, quality, availableHeights, onClose }) {
  const [selFormat, setSelFormat] = useState('mp4');
  const [selQuality, setSelQuality] = useState(quality || '720');
  const [selBitrate, setSelBitrate] = useState('320k');
  const [selCompression, setSelCompression] = useState('5');
  const { startDownload } = useDownload();

  const fmt = FORMAT_OPTIONS.find(f => f.value === selFormat);

  const handleDownload = () => {
    startDownload({
      videoId: video.id,
      format: selFormat,
      quality: fmt?.hasQuality ? selQuality : undefined,
      title: video.title || 'video',
      bitrate: fmt?.hasBitrate ? selBitrate : undefined,
      compression: fmt?.hasCompression ? selCompression : undefined,
    });
    onClose();
  };

  return (
    <div
      className="absolute bottom-full right-0 mb-2 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg p-4 min-w-[280px] z-50 text-[var(--text-primary)]"
      style={{ boxShadow: '0 -4px 32px rgba(0,0,0,0.6)' }}
      onClick={e => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold">Download</span>
        <button onClick={onClose} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-lg leading-none">×</button>
      </div>

      {/* Format selector */}
      <div className="mb-3">
        <label className="block text-xs font-semibold mb-1.5 text-[var(--text-secondary)] uppercase tracking-wide">Format</label>
        <div className="grid grid-cols-3 gap-1">
          {FORMAT_OPTIONS.map(({ value, label, Icon }) => (
            <button
              key={value}
              onClick={() => setSelFormat(value)}
              className={`flex flex-col items-center gap-1 p-2 rounded text-xs transition-colors ${selFormat === value ? 'bg-[var(--accent)] text-white' : 'bg-[var(--bg-primary)] hover:bg-[var(--border)]'}`}
            >
              <Icon size={14} />
              {value.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Quality selector (MP4 only) */}
      {fmt?.hasQuality && availableHeights.length > 0 && (
        <div className="mb-3">
          <label className="block text-xs font-semibold mb-1.5 text-[var(--text-secondary)] uppercase tracking-wide">Quality</label>
          <div className="flex flex-wrap gap-1">
            {availableHeights.map(h => (
              <button
                key={h}
                onClick={() => setSelQuality(String(h))}
                className={`px-2.5 py-1 rounded text-xs transition-colors ${selQuality === String(h) ? 'bg-[var(--accent)] text-white' : 'bg-[var(--bg-primary)] hover:bg-[var(--border)]'}`}
              >
                {h}p
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Bitrate selector (audio formats) */}
      {fmt?.hasBitrate && (
        <div className="mb-3">
          <label className="block text-xs font-semibold mb-1.5 text-[var(--text-secondary)] uppercase tracking-wide">Bitrate</label>
          <div className="flex flex-wrap gap-1">
            {BITRATE_OPTIONS.map(b => (
              <button
                key={b}
                onClick={() => setSelBitrate(b)}
                className={`px-2.5 py-1 rounded text-xs transition-colors ${selBitrate === b ? 'bg-[var(--accent)] text-white' : 'bg-[var(--bg-primary)] hover:bg-[var(--border)]'}`}
              >
                {b}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Compression selector (FLAC) */}
      {fmt?.hasCompression && (
        <div className="mb-3">
          <label className="block text-xs font-semibold mb-1.5 text-[var(--text-secondary)] uppercase tracking-wide">Compression</label>
          <select
            value={selCompression}
            onChange={e => setSelCompression(e.target.value)}
            className="w-full breeze-input text-xs py-1"
          >
            {COMPRESSION_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      )}

      {/* Download button */}
      <button
        onClick={handleDownload}
        className="w-full flex items-center justify-center gap-2 py-2 rounded bg-[var(--accent)] text-white text-sm font-semibold hover:opacity-90 transition-all"
      >
        <Download size={14} /> Download {selFormat.toUpperCase()}
      </button>
    </div>
  );
}

export default function VideoPlayer({ video, user, onBack, onChannelSelect, coWatchUserId = null, onCoWatchVideoChange = null, initialPosition = null }) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);

  // Declare state BEFORE hooks that depend on them to avoid TDZ errors
  const [availableHeights, setAvailableHeights] = useState([]);
  const [quality, setQuality] = useState(null);

  // MSE (MediaSource) buffer — lets seeks within already-buffered content be instant
  // and prevents the reset-to-00:00 bug caused by changing the video src on every seek.
  // `videoDuration` is forwarded so the hook can set MediaSource.duration up-front;
  // without that, `video.seekable` only covers the buffered range and the browser
  // silently rejects seeks to unloaded sections.
  const { objectUrl: mseUrl, isReady: mseReady, seekInBuffer, restartFrom, evict } =
    useVideoBuffer({ videoId: video.id, quality, videoRef, videoDuration: video.duration, platform: video.platform || 'youtube' });
  // Position to restore after MSE reinit (quality change or initial co-watch offset)
  const mseResumeRef  = useRef(0);
  // Throttle eviction calls (every ~10 s at 4fps timeUpdate)
  const evictFrameRef = useRef(0);
  const progressRef = useRef(null);
  const hideControlsTimer = useRef(null);
  const [speed, setSpeed] = useState(1);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const apiDuration = useRef(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);

  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState('quality');
  const [showDownload, setShowDownload] = useState(false);
  const [draggingProgress, setDraggingProgress] = useState(false);
  const [formatsLoading, setFormatsLoading] = useState(true);

  // Subtitle state
  const [availableSubtitles, setAvailableSubtitles] = useState([]);
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(false);
  const [currentSubtitleLang, setCurrentSubtitleLang] = useState('en');
  const [subtitleCues, setSubtitleCues] = useState([]);
  const [currentCue, setCurrentCue] = useState(null);
  const [subtitleSize, setSubtitleSize] = useState(18);
  const [subtitlePos, setSubtitlePos] = useState('bottom');
  const [loadingSubtitles, setLoadingSubtitles] = useState(false);
  const [autoTranslate, setAutoTranslate] = useState(false);
  const [translateTo, setTranslateTo] = useState('en');

  // Chapters
  const [chapters, setChapters] = useState([]);
  const [hoverInfo, setHoverInfo] = useState(null); // { pct, time, chapter }

  // Description + Comments
  const [description, setDescription] = useState('');
  const [comments, setComments] = useState([]);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [showDescription, setShowDescription] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);

  // Subscribe
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [subscribeLoading, setSubscribeLoading] = useState(false);

  // Save
  const [isSaved, setIsSaved] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);

  // Resume prompt
  const [resumeAt, setResumeAt] = useState(null);

  // Server busy state
  const [serverBusy, setServerBusy] = useState(false);
  const serverBusyRef = useRef(false);
  useEffect(() => { serverBusyRef.current = serverBusy; }, [serverBusy]);
  const [retryKey, setRetryKey] = useState(0);

  // CSS-based fullscreen fallback (when native fullscreen is unavailable, e.g. in iframes)
  const [cssFull, setCssFull] = useState(false);

  // Share copied toast
  const [shareCopied, setShareCopied] = useState(false);
  const [showSharePopup, setShowSharePopup] = useState(false);
  const sharePopupRef = useRef(null);

  // Skip indicator: { side: 'left'|'right', key: number }
  const [skipIndicator, setSkipIndicator] = useState(null);
  const skipIndicatorTimer = useRef(null);

  // Double-tap tracking for touch seek
  const lastTapRef = useRef({ time: 0, side: null });
  // Ref mirror of currentTime to avoid stale closures in non-reactive event handlers
  const currentTimeRef = useRef(0);
  // Stable ref for position reporting (avoids stale closures in seekTo)
  const reportWatchingRef = useRef(null);

  // Chapters list panel
  const [showChapters, setShowChapters] = useState(false);

  // Proxy seeking — all seeking goes through proxySeekRef; no native seeking for proxy streams
  const [proxySeek, setProxySeek] = useState(0);
  const proxySeekRef = useRef(0);
  // Mirrors the committed proxySeek *state* value so the seek debounce can detect no-ops
  const proxySeekStateRef = useRef(0);
  const seekReloadRef = useRef(false);
  const wasPlayingRef = useRef(false);
  // Debounce proxy seek reloads so rapid scrubbing only triggers one stream reload
  const proxySeekDebounceRef = useRef(null);
  // Suppress onTimeUpdate overwriting the display while a seek is pending
  const seekPendingRef = useRef(false);
  // When a proxy reload starts the stream N seconds before the target, this holds
  // the native-seek offset (seconds into the new stream) applied in onCanPlay.
  const seekTargetRelRef = useRef(0);
  // Monotonically-increasing ID — each seekTo call increments this so the debounce
  // callback can bail out if it has been superseded by a newer seek.
  const seekIdRef = useRef(0);
  // Stable ref so the video-reset effect can read the latest initialPosition
  // without being added to its dependency array (which would reset the video on every tick)
  const initialPositionRef = useRef(initialPosition);
  useEffect(() => { initialPositionRef.current = initialPosition; }, [initialPosition]);

  // Refs that mirror state values for use in effects/callbacks without stale closures
  const speedRef = useRef(1);
  const qualityRef = useRef(null);
  const subtitlesEnabledRef = useRef(false);
  const selectedSubtitleRef = useRef('en');

  // Server busy info
  const [serverBusyInfo, setServerBusyInfo] = useState(null); // { current, max }

  // Define ALL callbacks first before using them in effects

  const showControls = useCallback(() => {
    setControlsVisible(true);
    clearTimeout(hideControlsTimer.current);
    if (playing) hideControlsTimer.current = setTimeout(() => setControlsVisible(false), 3000);
  }, [playing]);

  const showSkip = useCallback((side) => {
    clearTimeout(skipIndicatorTimer.current);
    setSkipIndicator({ side, key: Date.now() });
    skipIndicatorTimer.current = setTimeout(() => setSkipIndicator(null), 700);
  }, []);

  const seekTo = useCallback((targetTime) => {
    const v = videoRef.current;
    if (!v) return;

    const clamped = Math.max(0, Math.min(duration > 0 ? duration - 1 : 1e9, targetTime));
    wasPlayingRef.current = !v.paused;
    const targetFloor = Math.floor(clamped);
    currentTimeRef.current = clamped;
    setCurrentTime(clamped);

    // ── MSE path (MediaSource active) ────────────────────────────────────────
    if (mseReady) {
      if (seekInBuffer(clamped)) {
        // In-buffer: instant native seek — no server round-trip, no reload.
        seekPendingRef.current = false;
        v.currentTime = clamped;
        reportWatchingRef.current?.();
        wsSendRef.current?.();
      } else {
        // Out-of-buffer: clear the SourceBuffer and restart the fetch from here.
        seekPendingRef.current = true;
        seekReloadRef.current = true;
        setIsLoading(true);
        if (proxySeekDebounceRef.current) clearTimeout(proxySeekDebounceRef.current);
        const seekId = ++seekIdRef.current;
        // Tight debounce — just enough to coalesce a rapid double-click on the
        // bar without making a single click feel sluggish. Combined with the
        // server-side fast-probe ffmpeg flags, this gets time-to-first-frame
        // after an out-of-buffer seek down to ~half a second.
        proxySeekDebounceRef.current = setTimeout(() => {
          proxySeekDebounceRef.current = null;
          if (seekIdRef.current !== seekId) return;
          proxySeekRef.current = targetFloor;
          restartFrom(targetFloor).then(() => {
            const v2 = videoRef.current;
            if (v2) v2.currentTime = clamped;
          });
          reportWatchingRef.current?.();
          wsSendRef.current?.();
        }, 50);
      }
      return;
    }

    // ── Fallback path: proxy URL seek (no MSE) ────────────────────────────────
    // For this proxy fMP4 format (frag_keyframe+empty_moov), native v.currentTime seeks
    // fail: the browser's seekable range is only the tiny amount buffered from the stream
    // start, so seeks beyond it are silently rejected and currentTime resets to 0.
    // The only reliable approach is a server-side seek: reload the stream starting at the
    // target second. seekTargetRelRef stays 0 so no post-load native seek is needed.
    proxySeekRef.current = targetFloor;
    seekTargetRelRef.current = 0;
    seekPendingRef.current = true;

    // Tag this seek so stale debounce callbacks can self-cancel
    const seekId = ++seekIdRef.current;

    if (proxySeekDebounceRef.current) clearTimeout(proxySeekDebounceRef.current);
    proxySeekDebounceRef.current = setTimeout(() => {
      proxySeekDebounceRef.current = null;

      // A newer seekTo has superseded this one
      if (seekIdRef.current !== seekId) return;

      // seekPendingRef was already cleared (e.g. quality change happened mid-seek)
      if (!seekPendingRef.current) {
        reportWatchingRef.current?.();
        wsSendRef.current?.();
        return;
      }

      seekReloadRef.current = true;

      if (targetFloor === proxySeekStateRef.current) {
        // setProxySeek() would be a React no-op, so the video src won't change.
        // The stream already starts at targetFloor; reset to the very beginning of
        // the current stream (v.currentTime = 0 is always seekable for fMP4).
        seekPendingRef.current = false;
        seekReloadRef.current = false;
        const v2 = videoRef.current;
        if (v2) {
          v2.currentTime = 0;
          if (wasPlayingRef.current && v2.paused) v2.play().catch(() => {});
        }
      } else {
        setProxySeek(targetFloor);
      }

      reportWatchingRef.current?.();
      wsSendRef.current?.();
    }, 150);
  }, [duration, mseReady, seekInBuffer, restartFrom]);

  const changeQuality = useCallback((q) => {
    const v = videoRef.current;
    if (!v || q === quality) return;
    // Cancel any pending seek debounce — quality change takes priority
    if (proxySeekDebounceRef.current) {
      clearTimeout(proxySeekDebounceRef.current);
      proxySeekDebounceRef.current = null;
    }
    seekPendingRef.current = false;
    seekTargetRelRef.current = 0;
    wasPlayingRef.current = !v.paused;
    seekReloadRef.current = true;
    setIsLoading(true);
    setShowSettings(false);

    if (mseReady) {
      // MSE active: save current position so the new MSE instance resumes from here.
      // The hook's useEffect([videoId, quality]) will reinitialize MSE for the new quality.
      mseResumeRef.current = Math.floor(currentTimeRef.current || 0);
    } else {
      // Fallback: trigger proxy URL seek (changes src)
      const absoluteTime = Math.floor(proxySeekRef.current + (v.currentTime || 0));
      proxySeekRef.current = absoluteTime;
      setProxySeek(absoluteTime);
    }
    setQuality(q);
  }, [quality, mseReady]);

  const getProgressRatio = useCallback((e) => {
    const rect = progressRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }, []);

  // Keep mirror refs in sync with their state counterparts
  useEffect(() => { proxySeekStateRef.current = proxySeek; }, [proxySeek]);
  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { qualityRef.current = quality; }, [quality]);
  useEffect(() => { subtitlesEnabledRef.current = subtitlesEnabled; }, [subtitlesEnabled]);
  useEffect(() => { selectedSubtitleRef.current = currentSubtitleLang; }, [currentSubtitleLang]);
  // Mirror mseReady into a ref so event handler closures (onTimeUpdate etc.) can read it
  const mseReadyRef = useRef(false);
  useEffect(() => { mseReadyRef.current = mseReady; }, [mseReady]);

  // When MSE becomes ready (new video, quality change, or initial co-watch offset),
  // seek to the saved position. If no explicit position is saved (normal load), use
  // currentTimeRef so we don't lose the user's place during the MSE init window.
  useEffect(() => {
    if (!mseReady) return;
    const explicit = mseResumeRef.current;
    const pos = explicit > 0 ? explicit : Math.floor(currentTimeRef.current || 0);
    mseResumeRef.current = 0;
    if (pos > 0) {
      seekReloadRef.current = true;
      restartFrom(pos).then(() => {
        const v = videoRef.current;
        if (v) v.currentTime = pos;
      });
    }
  }, [mseReady, restartFrom]);

  // Now define effects that use the callbacks above

  useEffect(() => {
    setFormatsLoading(true);
    setAvailableHeights([]);
    setQuality(null);
    setDuration(0);
    apiDuration.current = 0;
    setSubtitlesEnabled(false);
    setSubtitleCues([]);
    setCurrentCue(null);
    setAvailableSubtitles([]);
    setDescription('');
    setComments([]);
    setShowDescription(false);
    setShowComments(false);
    // For co-watch: load from the last-known position as a starting point.
    // The WebSocket sync handler will correct to the live position if needed.
    const startAt = coWatchUserId && initialPosition > 0 ? Math.floor(initialPosition) : 0;
    // Cancel any in-flight seek debounce from the previous video
    if (proxySeekDebounceRef.current) {
      clearTimeout(proxySeekDebounceRef.current);
      proxySeekDebounceRef.current = null;
    }
    seekPendingRef.current = false;
    seekTargetRelRef.current = 0;
    // MSE: store the initial offset — the hook will apply it when it becomes ready
    mseResumeRef.current = startAt;
    // Fallback proxy: still set proxySeek so the non-MSE path starts at the right time
    setProxySeek(startAt);
    proxySeekRef.current = startAt;
    seekReloadRef.current = false;
    wasPlayingRef.current = false;
    setServerBusy(false);
    setShowSharePopup(false);
    setChapters([]);
    setHoverInfo(null);
    setShowChapters(false);

    // No pre-check here — the proxy handler now does per-user slot management,
    // so seeking never falsely consumes an extra slot. Stream-full errors are
    // caught by the video element's onError handler below.

    // Formats — check sessionStorage first
    const cachedFormats = ssGet(`formats:${video.id}`);
    if (cachedFormats) {
      const heights = cachedFormats.availableHeights || [];
      setAvailableHeights(heights);
      const preferred = [720, 1080, 480, 360, 240, 144];
      const def = preferred.find(p => heights.includes(p)) || heights[0] || 360;
      setQuality(String(def));
      setFormatsLoading(false);
    } else {
      const platformParamFmt = video.platform && video.platform !== 'youtube' ? `?platform=${video.platform}` : '';
      fetch(`/api/formats/${video.id}${platformParamFmt}`)
        .then(r => r.json())
        .then(data => {
          const heights = data.availableHeights || [];
          setAvailableHeights(heights);
          const preferred = [720, 1080, 480, 360, 240, 144];
          const def = preferred.find(p => heights.includes(p)) || heights[0] || 360;
          setQuality(String(def));
          ssSet(`formats:${video.id}`, data);
        })
        .catch(() => { setAvailableHeights([360]); setQuality('360'); })
        .finally(() => setFormatsLoading(false));
    }

    // Info (duration + chapters) — check sessionStorage first
    const cachedInfo = ssGet(`info:${video.id}`);
    if (cachedInfo) {
      if (cachedInfo.duration) { apiDuration.current = cachedInfo.duration; setDuration(cachedInfo.duration); }
      if (cachedInfo.chapters?.length) setChapters(cachedInfo.chapters);
    } else {
      const platformParam = video.platform && video.platform !== 'youtube' ? `?platform=${video.platform}` : '';
      fetch(`/api/info/${video.id}${platformParam}`)
        .then(r => r.json())
        .then(data => {
          if (data.duration) { apiDuration.current = data.duration; setDuration(data.duration); }
          if (data.chapters?.length) setChapters(data.chapters);
          ssSet(`info:${video.id}`, data);
        })
        .catch(() => {});
    }

    // Subtitles list — check sessionStorage first
    const cachedSubs = ssGet(`subs:${video.id}`);
    if (cachedSubs) {
      if (cachedSubs.length > 0) {
        setAvailableSubtitles(cachedSubs);
        const enSub = cachedSubs.find(s => s.lang === 'en') || cachedSubs[0];
        setCurrentSubtitleLang(enSub.lang);
      }
    } else {
      const subListPlatformParam = video.platform && video.platform !== 'youtube' ? `?platform=${video.platform}` : '';
      fetch(`/api/subtitles/${video.id}/list${subListPlatformParam}`)
        .then(r => r.json())
        .then(data => {
          const subs = data.subtitles || [];
          if (subs.length > 0) {
            setAvailableSubtitles(subs);
            const enSub = subs.find(s => s.lang === 'en') || subs[0];
            setCurrentSubtitleLang(enSub.lang);
          }
          ssSet(`subs:${video.id}`, subs);
        })
        .catch(() => {});
    }

    setDetailsLoading(true);
    const detailsPlatformParam = video.platform && video.platform !== 'youtube' ? `?platform=${video.platform}` : '';
    fetch(`/api/video/${video.id}/details${detailsPlatformParam}`)
      .then(r => r.json())
      .then(data => { setDescription(data.description || ''); setComments(data.comments || []); })
      .catch(() => {})
      .finally(() => setDetailsLoading(false));

    if (video.channelId) {
      const subPlat = video.platform && video.platform !== 'youtube' ? `?platform=${video.platform}` : '';
      fetch(`/api/subscriptions/${encodeURIComponent(video.channelId)}/status${subPlat}`)
        .then(r => r.ok ? r.json() : { subscribed: false })
        .then(data => setIsSubscribed(data.subscribed || false))
        .catch(() => setIsSubscribed(false));
    }

    fetch(`/api/saved/${video.id}/status`)
      .then(r => r.ok ? r.json() : { saved: false })
      .then(data => setIsSaved(data.saved || false))
      .catch(() => setIsSaved(false));
  }, [video.id]);

  useEffect(() => {
    if (!subtitlesEnabled || !currentSubtitleLang || availableSubtitles.length === 0) {
      setSubtitleCues([]);
      setCurrentCue(null);
      return;
    }
    const sub = availableSubtitles.find(s => s.lang === currentSubtitleLang);
    if (!sub) return;

    setLoadingSubtitles(true);
    const autoFlag = sub.auto ? 'true' : 'false';
    const url = autoTranslate && translateTo
      ? `/api/subtitles/${video.id}/translate?lang=${currentSubtitleLang}&auto=${autoFlag}&to=${translateTo}`
      : `/api/subtitles/${video.id}?lang=${currentSubtitleLang}&auto=${autoFlag}`;

    fetch(url)
      .then(r => { if (!r.ok) throw new Error('Failed'); return r.text(); })
      .then(text => setSubtitleCues(parseVTT(text)))
      .catch(() => setSubtitleCues([]))
      .finally(() => setLoadingSubtitles(false));
  }, [subtitlesEnabled, currentSubtitleLang, availableSubtitles, video.id, autoTranslate, translateTo]);

  useEffect(() => {
    if (!subtitlesEnabled || subtitleCues.length === 0) { setCurrentCue(null); return; }
    const cue = subtitleCues.find(c => currentTime >= c.start && currentTime <= c.end) || null;
    setCurrentCue(cue);
  }, [currentTime, subtitleCues, subtitlesEnabled]);

  // Report position instantly when subtitles are toggled (for admin co-watch)
  useEffect(() => {
    reportWatchingRef.current?.();
  }, [subtitlesEnabled]);

  // Check for saved resume position when video changes (localStorage persists across sessions)
  useEffect(() => {
    const saved = lsGet(`pos:${video.id}`);
    if (saved && saved > 5) setResumeAt(saved);
    else setResumeAt(null);
  }, [video.id]);

  // Save playback position every 5 seconds to localStorage so it survives page refreshes
  useEffect(() => {
    const id = setInterval(() => {
      if (currentTime > 5 && duration > 0 && currentTime < duration - 5) {
        lsSet(`pos:${video.id}`, currentTime);
      }
    }, 5000);
    return () => clearInterval(id);
  }, [video.id, currentTime, duration]);

  // Record watch history when video loads (user is watching)
  useEffect(() => {
    if (!video?.id || !video?.title || !user) return;
    const timer = setTimeout(() => {
      fetch(`/api/watch/${video.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          title: video.title,
          channel: video.channel || '',
          channelId: video.channelId || '',
          thumbnail: video.thumbnail || '',
        }),
      }).catch(() => {});
    }, 5000);
    return () => clearTimeout(timer);
  }, [video.id]);

  // Report current watching position to server every 10s (for admin co-watch)
  // Also callable immediately via reportWatchingRef for instant seek/subtitle updates
  useEffect(() => {
    if (!video?.id || !user) return;
    const report = () => {
      // Don't report while stream-blocked — the user isn't actually playing anything
      if (serverBusyRef.current) return;
      fetch('/api/watching', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          videoId: video.id,
          title: video.title || '',
          thumbnail: video.thumbnail || '',
          position: Math.floor(currentTimeRef.current),
          paused: videoRef.current?.paused ?? true,
          speed: speedRef.current,
          quality: qualityRef.current,
          subtitleLang: selectedSubtitleRef.current,
          subtitlesOn: subtitlesEnabledRef.current,
        }),
      }).catch(() => {});
    };
    reportWatchingRef.current = report;
    report();
    const id = setInterval(report, 10000);
    return () => {
      clearInterval(id);
      reportWatchingRef.current = null;
      fetch('/api/watching/stop', { method: 'POST', credentials: 'include' }).catch(() => {});
    };
  }, [video.id, user]);

  // WS send ref — set by the user WS effect so seekTo can push instant updates
  const wsSendRef = useRef(null);

  // User-side WebSocket: sends position to server every 200ms so admin co-watch is live.
  // Only active for real users (not for the admin's co-watch VideoPlayer instance).
  useEffect(() => {
    if (!user || !video?.id || coWatchUserId) return;

    let ws = null;
    let sendId = null;
    let reconnectTimer = null;
    let alive = true;

    const buildPayload = () => ({
      type: 'position_update',
      videoId: video.id,
      title: video.title || '',
      thumbnail: video.thumbnail || '',
      position: currentTimeRef.current,
      paused: videoRef.current?.paused ?? true,
      speed: speedRef.current,
      quality: qualityRef.current,
      subtitleLang: selectedSubtitleRef.current,
      subtitlesOn: subtitlesEnabledRef.current,
      sentAt: Date.now(),
    });

    const send = () => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(buildPayload()));
      }
    };

    const sendImmediate = () => send();

    const connect = () => {
      if (!alive) return;
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${window.location.host}/api/ws?v=${video.id}`);
      ws.onopen = () => {
        send();
        sendId = setInterval(send, 100);
        const v = videoRef.current;
        if (v) {
          v.addEventListener('play', sendImmediate);
          v.addEventListener('pause', sendImmediate);
          v.addEventListener('seeked', sendImmediate);
          v.addEventListener('waiting', sendImmediate);
        }
      };
      ws.onclose = () => {
        clearInterval(sendId);
        const v = videoRef.current;
        if (v) {
          v.removeEventListener('play', sendImmediate);
          v.removeEventListener('pause', sendImmediate);
          v.removeEventListener('seeked', sendImmediate);
          v.removeEventListener('waiting', sendImmediate);
        }
        reconnectTimer = setTimeout(connect, 2000);
      };
      ws.onerror = () => ws.close();
    };

    connect();
    wsSendRef.current = send;

    return () => {
      alive = false;
      wsSendRef.current = null;
      clearInterval(sendId);
      clearTimeout(reconnectTimer);
      const v = videoRef.current;
      if (v) {
        v.removeEventListener('play', sendImmediate);
        v.removeEventListener('pause', sendImmediate);
        v.removeEventListener('seeked', sendImmediate);
        v.removeEventListener('waiting', sendImmediate);
      }
      ws?.close();
    };
  }, [video.id, user, coWatchUserId]);

  // Lock to prevent co-watch seeking loops: after seeking, block re-seek for 5s
  const coWatchSeekLockUntilRef = useRef(0);

  // Keep latest seekTo/changeQuality in refs so the sync interval never goes stale
  const seekToRef = useRef(seekTo);
  const changeQualityRef = useRef(changeQuality);
  useEffect(() => { seekToRef.current = seekTo; }, [seekTo]);
  useEffect(() => { changeQualityRef.current = changeQuality; }, [changeQuality]);

  // Co-watch sync: mirrors the user's exact position in real-time via WebSocket.
  // The user sends position every 200ms; admin uses tiered playback-rate drift correction.
  useEffect(() => {
    if (!coWatchUserId) return;

    const SYNC_THRESHOLD = 0.08; // 80ms  — ignore tiny jitter
    const JUMP_THRESHOLD = 2.5;  // 2.5s  — hard-jump; anything smaller uses rate correction

    const initialized = { current: false };
    const lastData    = { current: null };
    // Smoothed latency: keep last 5 round-trip estimates
    const latencySamples = [];
    const smoothLatency = () => {
      if (!latencySamples.length) return 0;
      return latencySamples.reduce((a, b) => a + b, 0) / latencySamples.length / 1000;
    };

    let wsInstance    = null;
    let reconnectTimer = null;
    let initRetryId   = null;
    let lastSeekAt    = 0;
    let lastVideoId   = null; // track video changes

    // Load-ahead: persisted in localStorage so each session improves on the last.
    // We only ever seek ONCE on join — all catch-up after that is via playback rate.
    // Seeking again restarts the ffmpeg mux on the server, which costs the same load
    // time every time and causes an infinite spiral.
    const LOAD_AHEAD_KEY = 'cowatchLoadAhead';
    let loadAhead = 5;
    try {
      const stored = parseFloat(localStorage.getItem(LOAD_AHEAD_KEY));
      if (!isNaN(stored) && stored >= 1 && stored <= 60) loadAhead = stored;
    } catch {}
    let initSeekTime     = 0;   // timestamp of initial seek — cleared once measured
    let loadTimeMeasured = false;

    // ── Core sync ─────────────────────────────────────────────────────────────
    const applyData = (data) => {
      lastData.current = data;

      // Track latency from the sentAt timestamp the user embeds
      if (data.sentAt) {
        const sample = Date.now() - data.sentAt;
        latencySamples.push(sample);
        if (latencySamples.length > 5) latencySamples.shift();
      }

      const latency    = smoothLatency();
      const userPos    = (parseFloat(data.position) || 0) + latency;
      const userPaused = data.paused ?? true;
      const now        = Date.now();
      const v          = videoRef.current;

      // ── Video change detection ───────────────────────────────────────────────
      // If the user navigated to a different video, tell the parent immediately.
      if (data.videoId && lastVideoId && data.videoId !== lastVideoId) {
        lastVideoId = data.videoId;
        initialized.current = false; // force re-init for the new video
        if (onCoWatchVideoChange) {
          onCoWatchVideoChange(data);
          return; // parent will remount VideoPlayer with the new video
        }
      }
      if (data.videoId && !lastVideoId) lastVideoId = data.videoId;

      // ── Initial join: seek ahead of the user to compensate for stream load time.
      // Starts 5s ahead; if the admin still can't catch up after buffering settles,
      // the measured load time is logged and the offset is increased until sync is achieved.
      // Retried every 500ms until quality resolves.
      if (!initialized.current) {
        if (v && qualityRef.current) {
          initialized.current = true;
          clearInterval(initRetryId);
          initRetryId = null;
          lastSeekAt = now;
          initSeekTime = now;
          adjustCount = 0;
          coWatchSeekLockUntilRef.current = now + 3000;
          console.log(`[cowatch] Initial seek: +${loadAhead}s ahead of user at ${userPos.toFixed(1)}s`);
          seekToRef.current(userPos + loadAhead);
          wasPlayingRef.current = !userPaused;
        }
        return;
      }

      if (!v) return;

      // ── User's intended playback speed (used to scale drift correction) ───────
      const userSpeed = (data.speed && data.speed > 0) ? data.speed : 1;

      // ── Play / pause sync ────────────────────────────────────────────────────
      if (userPaused) {
        if (!v.paused) v.pause();
        if (v.playbackRate !== 1.0) v.playbackRate = 1.0;
        return;
      }

      // User is playing — ensure admin plays too
      const seekInProgress = seekReloadRef.current;
      const seekLocked     = now < coWatchSeekLockUntilRef.current;

      if (seekInProgress) {
        wasPlayingRef.current = true;
        v.playbackRate = userSpeed;
        return;
      }

      if (!seekLocked) {
        const adminPos = currentTimeRef.current;
        const diff     = userPos - adminPos; // positive = admin is behind

        // ── One-time load measurement (no re-seek — re-seeking restarts ffmpeg) ─
        // After the seek lock clears we take a single snapshot of the actual drift.
        // That tells us the true stream load time. We save it to localStorage so
        // the next co-watch join can start with a better initial offset.
        // All catch-up from here on is done by playback rate — zero server cost.
        if (initSeekTime > 0 && !loadTimeMeasured) {
          const timeSinceSeek = (now - initSeekTime) / 1000;
          if (timeSinceSeek > 3.2) {
            loadTimeMeasured = true;
            initSeekTime = 0;
            const effectiveLoadTime = loadAhead + diff; // what we should have started with
            const clamped = Math.max(2, Math.min(60, effectiveLoadTime));
            console.log(
              `[cowatch] Stream settled after ${timeSinceSeek.toFixed(1)}s. ` +
              `Drift: ${diff > 0 ? '+' : ''}${diff.toFixed(2)}s. ` +
              `Effective load time: ${effectiveLoadTime.toFixed(1)}s. ` +
              `Saving load-ahead ${loadAhead.toFixed(1)}s → ${clamped.toFixed(1)}s for next session.`
            );
            try { localStorage.setItem(LOAD_AHEAD_KEY, clamped.toFixed(1)); } catch {}
            // Rate correction will close whatever gap remains — no re-seek.
          } else {
            // Still within lock window — only nudge, never hard-seek yet
            if (Math.abs(diff) > SYNC_THRESHOLD) {
              v.playbackRate = userSpeed * (diff > 0 ? 1.04 : 0.97);
            } else {
              v.playbackRate = userSpeed;
            }
            if (v.paused) v.play().catch(() => {});
            return;
          }
        }

        if (Math.abs(diff) > JUMP_THRESHOLD && now - lastSeekAt > 800) {
          // Hard seek — gap too large for rate correction to be practical
          lastSeekAt = now;
          coWatchSeekLockUntilRef.current = now + 2000;
          seekToRef.current(userPos);
          wasPlayingRef.current = true;
          v.playbackRate = userSpeed;
          return;
        } else if (Math.abs(diff) > 10) {
          // Very large gap — close it at 2× (still sounds normal-ish)
          v.playbackRate = userSpeed * (diff > 0 ? 2.0 : 0.5);
        } else if (Math.abs(diff) > 5) {
          // Large gap — close it fast
          v.playbackRate = userSpeed * (diff > 0 ? 1.5 : 0.7);
        } else if (Math.abs(diff) > 2) {
          // Moderate gap — close it in a few seconds without sounding choppy
          v.playbackRate = userSpeed * (diff > 0 ? 1.15 : 0.88);
        } else if (Math.abs(diff) > SYNC_THRESHOLD) {
          // Fine drift — imperceptible nudge
          v.playbackRate = userSpeed * (diff > 0 ? 1.04 : 0.97);
        } else {
          // Locked in — match user's speed exactly
          v.playbackRate = userSpeed;
        }
      }

      // Make sure admin is playing
      if (v.paused) {
        v.play().catch(() => {});
      }

      // ── Metadata sync (always, even during seek lock) ────────────────────────
      if (userSpeed !== speedRef.current) setSpeed(userSpeed);
      if (data.quality && data.quality !== qualityRef.current) changeQualityRef.current(data.quality);
      if (data.subtitlesOn !== undefined && data.subtitlesOn !== subtitlesEnabledRef.current) setSubtitlesEnabled(data.subtitlesOn);
      if (data.subtitleLang && data.subtitleLang !== selectedSubtitleRef.current) setCurrentSubtitleLang(data.subtitleLang);
    };

    // ── WebSocket with auto-reconnect ─────────────────────────────────────────
    const connect = () => {
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${window.location.host}/api/ws?admin=1`);
      wsInstance = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'cowatch_join', userId: coWatchUserId }));
      };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type !== 'cowatch_update' || !msg.data) return;
          applyData(msg.data);
          // If quality not ready yet, retry every 500ms until init succeeds
          if (!initialized.current && !initRetryId) {
            initRetryId = setInterval(() => {
              if (initialized.current) { clearInterval(initRetryId); initRetryId = null; return; }
              if (lastData.current) applyData(lastData.current);
            }, 500);
          }
        } catch {}
      };

      ws.onclose = () => { wsInstance = null; reconnectTimer = setTimeout(connect, 2000); };
      ws.onerror = () => ws.close();
    };

    connect();

    return () => {
      if (wsInstance) {
        wsInstance.onclose = null;
        if (wsInstance.readyState === WebSocket.OPEN) {
          wsInstance.send(JSON.stringify({ type: 'cowatch_leave' }));
        }
        wsInstance.close();
        wsInstance = null;
      }
      clearTimeout(reconnectTimer);
      clearInterval(initRetryId);
    };
  }, [coWatchUserId]);

  // Don't set proxyUrl when server is busy — prevents the video element from making a stream request
  const platformParam = video.platform && video.platform !== 'youtube' ? `&platform=${video.platform}` : '';
  const proxyUrl = (quality && !serverBusy) ? `/api/proxy/${video.id}?quality=${quality}${platformParam}${proxySeek > 0 ? `&t=${proxySeek}` : ''}` : null;

  const toggleSubscribe = async () => {
    if (!video.channelId || subscribeLoading) return;
    setSubscribeLoading(true);
    try {
      const subPlat = video.platform && video.platform !== 'youtube' ? `?platform=${video.platform}` : '';
      const method = isSubscribed ? 'DELETE' : 'POST';
      const r = await fetch(`/api/subscriptions/${encodeURIComponent(video.channelId)}${subPlat}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelName: video.channel,
          channelAvatar: video.channelAvatar,
          platform: video.platform || 'youtube',
        }),
      });
      if (r.ok) setIsSubscribed(s => !s);
    } catch {}
    setSubscribeLoading(false);
  };

  const toggleSave = async () => {
    if (saveLoading) return;
    setSaveLoading(true);
    try {
      const method = isSaved ? 'DELETE' : 'POST';
      const r = await fetch(`/api/saved/${video.id}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: video.title,
          thumbnail: video.thumbnail,
          channel: video.channel,
          channelId: video.channelId,
          channelAvatar: video.channelAvatar,
          duration: video.duration,
          views: video.views,
        }),
      });
      if (r.ok) setIsSaved(s => !s);
    } catch {}
    setSaveLoading(false);
  };

  // FIXED: Proper video event wiring
  // - onLoadStart does NOT change playing state (fixes wrong pause icon during loading)
  // - onCanPlay resumes play if was playing (for seek reloads and quality changes)
  // - All time tracking accounts for proxySeekRef offset
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const onTimeUpdate = () => {
      // With MSE, v.currentTime is already absolute (due to SourceBuffer.timestampOffset).
      // Without MSE, add proxySeekRef to get absolute time.
      const isMSE = mseReadyRef.current;
      // Don't override the scrub display while a proxy reload is debouncing
      if (!seekPendingRef.current) {
        const t = isMSE ? v.currentTime : proxySeekRef.current + v.currentTime;
        currentTimeRef.current = t;
        setCurrentTime(t);
      }
      if (v.buffered.length > 0) {
        const bufEnd = v.buffered.end(v.buffered.length - 1);
        setBufferedEnd(isMSE ? bufEnd : proxySeekRef.current + bufEnd);
      }
      // Periodically evict old buffer to keep memory bounded (~every 10 s at 4fps)
      evictFrameRef.current++;
      if (evictFrameRef.current % 40 === 0) {
        evict(v.currentTime);
      }
    };

    const onDurationChange = () => {
      if (v.duration && isFinite(v.duration)) {
        const isMSE = mseReadyRef.current;
        const elementDuration = isMSE ? v.duration : proxySeekRef.current + v.duration;
        const best = apiDuration.current > 0
          ? Math.max(apiDuration.current, elementDuration)
          : elementDuration;
        setDuration(prev => Math.max(prev, best));
      }
    };

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onWaiting = () => setIsLoading(true);
    const onCanPlay = () => {
      setIsLoading(false);
      // Always unblock onTimeUpdate here if no native seek is still pending.
      // onLoadStart fires before listeners are attached on video remount, so this
      // is the reliable fallback that un-freezes the progress bar after every load.
      if (!seekTargetRelRef.current) seekPendingRef.current = false;
      // Enter this branch when: a proxy reload just finished (seekReloadRef), OR there's a
      // pending native-seek offset to apply (seekTargetRelRef > 0), OR the video was playing
      // before the reload and needs to resume.
      if (seekReloadRef.current || seekTargetRelRef.current > 0 || wasPlayingRef.current) {
        seekReloadRef.current = false;
        if (seekTargetRelRef.current > 0) {
          // Post-load native seek: jump to the precise target within the pre-buffered window.
          // Playback and seekPendingRef clear happen in onSeeked after seek completes.
          v.currentTime = seekTargetRelRef.current;
          seekTargetRelRef.current = 0;
        } else if (wasPlayingRef.current && v.paused) {
          v.play().catch(() => {});
        }
      }
    };

    // FIXED: Do NOT call setPlaying(false) on loadstart.
    // The video is loading, not paused. The isLoading state shows the spinner.
    // If no post-load native seek is pending, unblock onTimeUpdate now.
    // If a native seek is pending (seekTargetRelRef > 0), keep seekPendingRef true
    // until onSeeked fires after onCanPlay applies the offset.
    const onLoadStart = () => {
      setIsLoading(true);
      if (!seekTargetRelRef.current) seekPendingRef.current = false;
    };

    const onSeeked = () => {
      // After a post-load native seek, unblock onTimeUpdate and resume playback.
      if (seekPendingRef.current) {
        seekPendingRef.current = false;
        if (wasPlayingRef.current && v.paused) v.play().catch(() => {});
      }
    };

    const onEnded = () => setPlaying(false);
    const onError = async () => {
      setIsLoading(false);
      seekReloadRef.current = false;
      if (proxyUrl) {
        // Brief wait so any old stream slot (e.g. from a previous seek) has time to
        // close on the server before we check capacity. Without this delay a seek
        // could briefly look like a new concurrent connection and show a false block.
        await new Promise(r => setTimeout(r, 600));
        try {
          const r = await fetch('/api/stream/available', { credentials: 'include' });
          if (r.ok) {
            const data = await r.json();
            if (!data.available) {
              setServerBusyInfo({ current: data.current, max: data.max });
              setServerBusy(true);
            }
          }
        } catch {}
      }
    };

    v.addEventListener('timeupdate', onTimeUpdate);
    v.addEventListener('durationchange', onDurationChange);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('waiting', onWaiting);
    v.addEventListener('canplay', onCanPlay);
    v.addEventListener('loadstart', onLoadStart);
    v.addEventListener('seeked', onSeeked);
    v.addEventListener('ended', onEnded);
    v.addEventListener('error', onError);

    // Sync play/pause state immediately in case the play/pause event fired before
    // this effect had a chance to attach the listeners (common on first load with autoPlay).
    setPlaying(!v.paused);

    return () => {
      v.removeEventListener('timeupdate', onTimeUpdate);
      v.removeEventListener('durationchange', onDurationChange);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('waiting', onWaiting);
      v.removeEventListener('canplay', onCanPlay);
      v.removeEventListener('loadstart', onLoadStart);
      v.removeEventListener('seeked', onSeeked);
      v.removeEventListener('ended', onEnded);
      v.removeEventListener('error', onError);
    };
  // mseUrl is included so the effect re-runs when the MSE video element first mounts.
  // Without it, the effect exits early (videoRef is null during async codec fetch),
  // and listeners are never attached when the element eventually appears.
  }, [quality, proxySeek, mseUrl]);

  useEffect(() => {
    // In co-watch mode the drift-correction loop controls playbackRate directly;
    // only update it here for normal (non-cowatch) playback.
    if (videoRef.current && !coWatchUserId) videoRef.current.playbackRate = speed;
  }, [speed, coWatchUserId]);

  useEffect(() => {
    const onChange = () => {
      const isFs = !!document.fullscreenElement;
      setFullscreen(isFs);
      if (!isFs) setCssFull(false); // sync CSS fallback when native exits
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // Keyboard: Escape exits CSS fullscreen; ArrowLeft/Right seek ±10 s
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && cssFull) { setCssFull(false); setFullscreen(false); return; }
      // Don't fire when focus is inside an input / textarea
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        seekTo(currentTimeRef.current - 10);
        showSkip('left');
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        seekTo(currentTimeRef.current + 10);
        showSkip('right');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cssFull, seekTo, showSkip]);

  useEffect(() => {
    if (!playing) setControlsVisible(true);
    else hideControlsTimer.current = setTimeout(() => setControlsVisible(false), 3000);
    return () => clearTimeout(hideControlsTimer.current);
  }, [playing]);

  const onProgressMouseDown = (e) => {
    e.preventDefault();
    setDraggingProgress(true);
    const ratio = getProgressRatio(e);
    setCurrentTime(ratio * duration);
  };

  // ── Live scrub (YouTube-style) ────────────────────────────────────────────
  // While the user drags the progress bar we want the main video display to
  // jump to whatever frame is under the cursor — exactly the way YT does it —
  // instead of staying frozen on the pre-drag frame and only updating once
  // the mouse is released. We only nudge `v.currentTime` when the target is
  // already in the buffered range so the browser can render the new frame
  // immediately without any network round-trip; out-of-buffer targets are
  // handled at drag-end via the normal `seekTo` path which kicks off the
  // server reload.
  useEffect(() => {
    if (!draggingProgress) return;
    const v = videoRef.current;
    // Pause during scrub so audio doesn't keep racing ahead while the user
    // is choosing a new position. We restore the play state on release.
    const wasPlayingAtDragStart = !!(v && !v.paused);
    if (v && wasPlayingAtDragStart) { try { v.pause(); } catch {} }

    // Returns true iff `absTime` is currently inside one of the buffered
    // ranges (accounting for the proxy-mode offset when MSE is not active).
    const isInBufferAbs = (absTime) => {
      if (!v) return false;
      const offset = mseReadyRef.current ? 0 : proxySeekRef.current;
      const relTime = absTime - offset;
      if (relTime < 0) return false;
      const buf = v.buffered;
      for (let i = 0; i < buf.length; i++) {
        if (relTime >= buf.start(i) && relTime < buf.end(i) - 0.2) return true;
      }
      return false;
    };

    const seekFrameTo = (absTime) => {
      if (!v) return;
      const offset = mseReadyRef.current ? 0 : proxySeekRef.current;
      const relTime = absTime - offset;
      if (relTime < 0) return;
      // Suppress the timeupdate listener from overwriting our scrub display
      // while we briefly drive currentTime ourselves.
      seekPendingRef.current = true;
      try { v.currentTime = relTime; } catch {}
    };

    const onMove = (e) => {
      const t = getProgressRatio(e) * duration;
      setCurrentTime(t);
      if (isInBufferAbs(t)) seekFrameTo(t);
    };
    const onUp = (e) => {
      const t = getProgressRatio(e) * duration;
      setDraggingProgress(false);
      // Restore the pre-drag play intent so seekTo / canplay knows whether
      // to resume after the seek completes.
      wasPlayingRef.current = wasPlayingAtDragStart;
      seekTo(t);
      // The in-buffer path of seekTo doesn't call play(), but we explicitly
      // paused the element on drag-start, so if the user was playing before
      // we need to resume here. The out-of-buffer path resumes via the
      // canplay handler once the new fetch produces enough data, so this
      // play() is safe in both cases (no-op if already playing).
      if (wasPlayingAtDragStart && v && v.paused) {
        v.play().catch(() => {});
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [draggingProgress, duration, seekTo, getProgressRatio]);

  const toggleMute = () => { const v = videoRef.current; v.muted = !muted; setMuted(!muted); };

  const setVolumeVal = (val) => {
    const v = videoRef.current;
    v.volume = val; v.muted = false;
    setVolume(val); setMuted(false);
  };

  const toggleFullscreen = () => {
    if (fullscreen || cssFull) {
      // Exit fullscreen
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      } else {
        setCssFull(false);
        setFullscreen(false);
      }
    } else {
      // Try native fullscreen first (with navigationUI: 'hide' for truly full screen),
      // fall back to CSS full screen
      if (containerRef.current?.requestFullscreen) {
        containerRef.current.requestFullscreen({ navigationUI: 'hide' }).catch(() => {
          setCssFull(true);
          setFullscreen(true);
        });
      } else {
        setCssFull(true);
        setFullscreen(true);
      }
    }
  };

  // Blocks the synthetic onClick that fires ~300ms after a touch so it doesn't
  // double-trigger play/pause when the touch handler already handled the tap.
  const touchBlockRef = useRef(false);
  const touchBlockTimer = useRef(null);

  // Touch double-tap handler — wired via onPointerDown prop so React always keeps
  // it current without any addEventListener/removeEventListener calls.
  //   Single tap anywhere  → show controls; center also toggles play/pause
  //   Double tap left      → seek −10 s
  //   Double tap right     → seek +10 s
  //   Double tap center    → toggle play/pause
  const handleContainerPointerDown = useCallback((e) => {
    if (e.pointerType !== 'touch') return; // mouse clicks go through onClick
    if (e.target.closest('.video-controls-layer')) return;

    // Suppress the upcoming synthetic click for this touch sequence
    touchBlockRef.current = true;
    clearTimeout(touchBlockTimer.current);
    touchBlockTimer.current = setTimeout(() => { touchBlockRef.current = false; }, 600);

    const now = Date.now();
    const last = lastTapRef.current;
    const DOUBLE_TAP_DELAY = 300;

    const rect = e.currentTarget.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const half = rect.width / 2;
    const side = relX < half ? 'left' : 'right';

    if (now - last.time < DOUBLE_TAP_DELAY) {
      lastTapRef.current = { time: 0, side: null };
      if (side === 'left') { seekTo(currentTimeRef.current - 10); showSkip('left'); }
      else { seekTo(currentTimeRef.current + 10); showSkip('right'); }
      showControls();
    } else {
      lastTapRef.current = { time: now, side };
      togglePlay();
      showControls();
    }
  }, [seekTo, showSkip, showControls, togglePlay]);

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferedPct = duration > 0 ? (bufferedEnd / duration) * 100 : 0;
  const noSubtitlesAvailable = availableSubtitles.length === 0;
  const currentChapter = chapters.length > 0 ? chapters.findLast(c => currentTime >= c.time) ?? null : null;

  return (
    <div className="max-w-5xl mx-auto">
      <button
        onClick={onBack}
        className="mb-4 flex items-center gap-2 hover:text-[var(--accent)] transition-colors text-sm"
      >
        <ArrowLeft size={16} />
        Back to results
      </button>

      {/* Resume prompt */}
      {resumeAt && (
        <div className="mb-3 flex items-center gap-3 px-4 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-sm">
          <span className="text-[var(--text-secondary)]">Resume from <strong className="text-[var(--text-primary)]">{formatTime(resumeAt)}</strong>?</span>
          <button
            className="px-3 py-1 rounded bg-[var(--accent)] text-white text-xs font-semibold hover:opacity-90"
            onClick={() => { seekTo(resumeAt); setResumeAt(null); }}
          >Resume</button>
          <button
            className="px-3 py-1 rounded bg-[var(--border)] text-[var(--text-secondary)] text-xs hover:bg-[var(--bg-primary)]"
            onClick={() => { lsRemove(`pos:${video.id}`); setResumeAt(null); }}
          >Start over</button>
        </div>
      )}

      {/* Video container */}
      <div
        ref={containerRef}
        className={`video-player-container${cssFull ? ' css-fullscreen' : ''}`}
        style={{ touchAction: 'none' }}
        onPointerDown={handleContainerPointerDown}
        onMouseMove={showControls}
        onClick={() => {
          // Skip if this click was synthesised from a touch (already handled above)
          if (touchBlockRef.current) return;
          togglePlay();
          showControls();
        }}
        onKeyDown={(e) => { if (e.key === 'Escape' && cssFull) { setCssFull(false); setFullscreen(false); } }}
        tabIndex={-1}
      >
        {(mseUrl || proxyUrl) && (
          <video
            key={mseUrl
              ? `${video.id}-${quality}-mse`
              : `${video.id}-${quality}-${proxySeek}-${retryKey}`}
            ref={videoRef}
            src={mseUrl || proxyUrl}
            className="video-element"
            autoPlay
            playsInline
            preload="auto"
            crossOrigin="anonymous"
            onError={(e) => { console.error('Video error:', e.target.error); setIsLoading(false); }}
          />
        )}

        {subtitlesEnabled && (
          <>
            <SubtitleOverlay cue={currentCue} currentTime={currentTime} size={subtitleSize} pos={subtitlePos} />
            {noSubtitlesAvailable && (
              <div className="absolute bottom-16 left-1/2 -translate-x-1/2 pointer-events-none">
                <span className="px-3 py-1 rounded text-sm bg-black/80 text-gray-300">Subtitles unavailable</span>
              </div>
            )}
          </>
        )}

        {serverBusy ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-5 px-8 py-7 rounded-2xl border border-[#3daee9]/25 bg-[#1a1d27] shadow-[0_8px_40px_rgba(0,0,0,0.7)] max-w-[280px] w-full mx-4">
              <div className="w-12 h-12 rounded-full flex items-center justify-center bg-[#3daee9]/10 border border-[#3daee9]/30">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#3daee9" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="3" width="20" height="14" rx="2"/>
                  <path d="M8 21h8M12 17v4"/>
                  <path d="M12 8v3M12 14h.01" stroke="#f39c12" strokeWidth="2"/>
                </svg>
              </div>
              <div className="text-center">
                <p className="text-[#3daee9] text-base font-semibold tracking-wide">Server Limit Reached</p>
                {serverBusyInfo && (
                  <p className="text-[#8b9bb4] text-sm mt-1.5">
                    {serverBusyInfo.current} / {serverBusyInfo.max} streams in use
                  </p>
                )}
                <p className="text-[#556070] text-xs mt-2 leading-relaxed">All stream slots are occupied.<br/>Wait for one to free up, then retry.</p>
              </div>
              <button
                className="w-full py-2 rounded-lg bg-[#3daee9]/15 border border-[#3daee9]/35 text-[#3daee9] text-sm font-medium hover:bg-[#3daee9]/25 hover:border-[#3daee9]/55 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  fetch('/api/stream/available', { credentials: 'include' })
                    .then(r => {
                      if (!r.ok) return null;
                      return r.json();
                    })
                    .then(data => {
                      if (!data || !data.available) {
                        if (data) setServerBusyInfo({ current: data.current, max: data.max });
                      } else {
                        setServerBusy(false);
                        setIsLoading(true);
                        setRetryKey(k => k + 1);
                      }
                    })
                    .catch(() => {
                      setServerBusy(false);
                      setIsLoading(true);
                      setRetryKey(k => k + 1);
                    });
                }}
              >Retry</button>
            </div>
          </div>
        ) : (isLoading || formatsLoading || !proxyUrl) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/75 pointer-events-none gap-4">
            <Loader2 size={56} className="text-[var(--accent)] animate-spin" />
            <div className="text-center">
              <p className="text-white text-base font-medium">
                {formatsLoading ? 'Preparing video…' : 'Loading video…'}
              </p>
              <p className="text-white/50 text-xs mt-1">This may take a moment</p>
            </div>
          </div>
        )}

        {/* Double-tap / arrow-key skip indicator */}
        {skipIndicator && (
          <div
            key={skipIndicator.key}
            className={`absolute inset-y-0 flex items-center justify-center pointer-events-none
              ${skipIndicator.side === 'left' ? 'left-0 w-1/3' : 'right-0 w-1/3'}`}
          >
            <div className="flex flex-col items-center gap-1 animate-skip-fade">
              <div className="rounded-full bg-white/20 backdrop-blur-sm p-4">
                {skipIndicator.side === 'left'
                  ? <svg width="32" height="32" viewBox="0 0 24 24" fill="white"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>
                  : <svg width="32" height="32" viewBox="0 0 24 24" fill="white"><path d="M6 18l8.5-6L6 6v12zm2-8.14L11.03 12 8 14.14V9.86zM16 6h2v12h-2z"/></svg>
                }
              </div>
              <span className="text-white text-sm font-semibold drop-shadow">
                {skipIndicator.side === 'left' ? '-10s' : '+10s'}
              </span>
            </div>
          </div>
        )}

        {/* Controls */}
        <div
          className={`video-controls-layer absolute inset-0 flex flex-col justify-end transition-opacity duration-200 ${controlsVisible || !playing ? 'opacity-100' : 'opacity-0'}`}
          style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 40%)' }}
          onClick={e => e.stopPropagation()}
          onDoubleClick={e => e.stopPropagation()}
        >
          <div className="px-4 pb-1 pt-4">
            {/* Chapter markers + progress bar */}
            <div className="relative">
              {/* Chapter hover tooltip */}
              {hoverInfo && (
                <div
                  className="absolute bottom-full mb-2 pointer-events-none z-10 flex flex-col items-center"
                  style={{ left: `${hoverInfo.pct}%`, transform: 'translateX(-50%)' }}
                >
                  {hoverInfo.chapter && (
                    <div className="text-xs bg-black/90 text-white px-2 py-0.5 rounded mb-0.5 whitespace-nowrap max-w-[200px] truncate">
                      {hoverInfo.chapter.title}
                    </div>
                  )}
                  <div className="text-xs bg-black/90 text-white px-2 py-0.5 rounded whitespace-nowrap font-mono">
                    {formatTime(hoverInfo.time)}
                  </div>
                </div>
              )}
              <div
                ref={progressRef}
                className="relative h-1.5 rounded-full bg-white/25 cursor-pointer group/bar"
                style={{ touchAction: 'none' }}
                onMouseDown={onProgressMouseDown}
                onMouseMove={(e) => {
                  if (!duration || !progressRef.current) return;
                  const rect = progressRef.current.getBoundingClientRect();
                  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                  const time = pct * duration;
                  const chapter = chapters.length > 0 ? (chapters.findLast(c => time >= c.time) ?? null) : null;
                  setHoverInfo({ pct: pct * 100, time, chapter });
                }}
                onMouseLeave={() => setHoverInfo(null)}
              >
                <div className="absolute inset-y-0 left-0 rounded-full bg-white/30" style={{ width: `${bufferedPct}%` }} />
                <div className="absolute inset-y-0 left-0 rounded-full bg-[var(--accent)]" style={{ width: `${progressPct}%` }} />
                {/* Chapter dividers */}
                {chapters.length > 1 && duration > 0 && chapters.slice(1).map((ch) => (
                  <div
                    key={ch.time}
                    className="absolute top-0 bottom-0 w-px bg-black/60 z-10"
                    style={{ left: `${(ch.time / duration) * 100}%` }}
                  />
                ))}
                <div
                  className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full -ml-1.5 opacity-0 group-hover/bar:opacity-100 transition-opacity"
                  style={{ left: `${progressPct}%` }}
                />
              </div>
            </div>
          </div>

          <div className="px-4 pb-3 flex items-center gap-3 text-white">
            <button className="hover:text-[var(--accent)] transition-colors" onClick={togglePlay}>
              {playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
            </button>

            <span className="text-xs tabular-nums whitespace-nowrap">
              {formatTime(currentTime)} / {duration ? formatTime(duration) : '--:--'}
            </span>

            {currentChapter && (
              <span className="text-xs text-white/60 truncate max-w-[180px] hidden sm:block" title={currentChapter.title}>
                {currentChapter.title}
              </span>
            )}

            <div className="flex items-center gap-1.5 group/vol">
              <button onClick={toggleMute} className="hover:text-[var(--accent)] transition-colors">
                {muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </button>
              <input
                type="range" min="0" max="1" step="0.05"
                value={muted ? 0 : volume}
                onChange={e => setVolumeVal(parseFloat(e.target.value))}
                className="w-0 group-hover/vol:w-20 transition-all duration-200 accent-[var(--accent)] cursor-pointer"
              />
            </div>

            <div className="flex-1" />

            {/* Subtitles */}
            <button
              className={`hover:text-[var(--accent)] transition-colors relative ${subtitlesEnabled ? 'text-[var(--accent)]' : ''}`}
              onClick={(e) => { e.stopPropagation(); setSubtitlesEnabled(s => !s); }}
              title={noSubtitlesAvailable ? 'Subtitles unavailable' : subtitlesEnabled ? 'Disable subtitles' : 'Enable subtitles'}
            >
              <Subtitles size={18} />
              {noSubtitlesAvailable && <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full" />}
            </button>

            {/* Speed */}
            <button
              className="text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20 transition-colors"
              onClick={(e) => { e.stopPropagation(); setSettingsTab('speed'); setShowSettings(s => !s); setShowDownload(false); }}
            >
              {speed}x
            </button>

            {/* Settings */}
            <div className="relative">
              <button
                className="flex items-center gap-1 hover:text-[var(--accent)] transition-colors"
                onClick={(e) => { e.stopPropagation(); setShowSettings(s => !s); setShowDownload(false); }}
              >
                <Settings size={17} />
              </button>

              {showSettings && (
                <div
                  className="absolute bottom-full right-0 mb-2 bg-[var(--bg-secondary)] border border-[var(--border)] rounded min-w-[240px] z-50 text-[var(--text-primary)]"
                  style={{ boxShadow: '0 -4px 24px rgba(0,0,0,0.5)' }}
                  onClick={e => e.stopPropagation()}
                >
                  <div className="flex border-b border-[var(--border)]">
                    {['quality', 'speed', 'subtitles'].map(tab => (
                      <button
                        key={tab}
                        onClick={() => setSettingsTab(tab)}
                        className={`flex-1 text-xs py-2 font-medium capitalize transition-colors ${settingsTab === tab ? 'text-[var(--accent)] border-b-2 border-[var(--accent)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                      >
                        {tab}
                      </button>
                    ))}
                  </div>

                  <div className="p-3">
                    {settingsTab === 'quality' && (
                      formatsLoading ? (
                        <div className="text-xs text-[var(--text-secondary)]">Loading…</div>
                      ) : (
                        <div className="flex flex-col gap-1">
                          {availableHeights.map(h => (
                            <button
                              key={h}
                              onClick={() => changeQuality(String(h))}
                              className={`text-xs py-1.5 px-2 rounded transition-colors text-left ${String(quality) === String(h) ? 'bg-[var(--accent)] text-white' : 'bg-[var(--bg-primary)] hover:bg-[var(--border)]'}`}
                            >
                              {h}p{h >= 2160 ? ' (4K)' : h >= 1080 ? ' (HD)' : h >= 720 ? ' (HD)' : ''}
                            </button>
                          ))}
                        </div>
                      )
                    )}

                    {settingsTab === 'speed' && (
                      <div className="grid grid-cols-4 gap-1">
                        {SPEEDS.map(s => (
                          <button
                            key={s}
                            onClick={() => { setSpeed(s); if (videoRef.current) videoRef.current.playbackRate = s; }}
                            className={`text-xs py-1.5 rounded transition-colors ${speed === s ? 'bg-[var(--accent)] text-white' : 'bg-[var(--bg-primary)] hover:bg-[var(--border)]'}`}
                          >
                            {s}x
                          </button>
                        ))}
                      </div>
                    )}

                    {settingsTab === 'subtitles' && (
                      <div className="flex flex-col gap-3">
                        {noSubtitlesAvailable ? (
                          <p className="text-xs text-[var(--text-secondary)] text-center py-2">Subtitles unavailable for this video</p>
                        ) : (
                          <>
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide">Subtitles</span>
                              <button
                                onClick={() => setSubtitlesEnabled(s => !s)}
                                className={`w-10 h-5 rounded-full transition-colors relative ${subtitlesEnabled ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'}`}
                              >
                                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${subtitlesEnabled ? 'left-5' : 'left-0.5'}`} />
                              </button>
                            </div>

                            {availableSubtitles.length > 0 && (
                              <div>
                                <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)] uppercase tracking-wide">Language</label>
                                <select
                                  value={currentSubtitleLang}
                                  onChange={e => { setCurrentSubtitleLang(e.target.value); setSubtitlesEnabled(true); }}
                                  className="w-full breeze-input text-xs py-1"
                                >
                                  {availableSubtitles.map(sub => (
                                    <option key={sub.lang} value={sub.lang}>{sub.name} {sub.auto ? '(Auto)' : ''}</option>
                                  ))}
                                </select>
                              </div>
                            )}

                            <div className="border-t border-[var(--border)] pt-2">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide">Auto-translate</span>
                                <button
                                  onClick={() => setAutoTranslate(s => !s)}
                                  className={`w-10 h-5 rounded-full transition-colors relative ${autoTranslate ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'}`}
                                >
                                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${autoTranslate ? 'left-5' : 'left-0.5'}`} />
                                </button>
                              </div>
                              {autoTranslate && (
                                <select
                                  value={translateTo}
                                  onChange={e => setTranslateTo(e.target.value)}
                                  className="w-full breeze-input text-xs py-1"
                                >
                                  {[
                                    ['en','English'],['es','Spanish'],['fr','French'],['de','German'],
                                    ['it','Italian'],['pt','Portuguese'],['nl','Dutch'],['ru','Russian'],
                                    ['ja','Japanese'],['ko','Korean'],['zh-CN','Chinese (Simplified)'],
                                    ['ar','Arabic'],['hi','Hindi'],['tr','Turkish'],['pl','Polish'],
                                  ].map(([code, name]) => (
                                    <option key={code} value={code}>{name}</option>
                                  ))}
                                </select>
                              )}
                            </div>

                            <div>
                              <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)] uppercase tracking-wide">Size: {subtitleSize}px</label>
                              <input
                                type="range" min="12" max="36" step="2"
                                value={subtitleSize}
                                onChange={e => setSubtitleSize(Number(e.target.value))}
                                className="w-full accent-[var(--accent)]"
                              />
                            </div>

                            <div>
                              <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)] uppercase tracking-wide">Position</label>
                              <div className="flex gap-1">
                                {['top', 'center', 'bottom'].map(pos => (
                                  <button
                                    key={pos}
                                    onClick={() => setSubtitlePos(pos)}
                                    className={`flex-1 text-xs py-1.5 rounded capitalize transition-colors ${subtitlePos === pos ? 'bg-[var(--accent)] text-white' : 'bg-[var(--bg-primary)] hover:bg-[var(--border)]'}`}
                                  >
                                    {pos}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {loadingSubtitles && <p className="text-xs text-[var(--text-secondary)] text-center">Loading subtitles…</p>}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Download with settings panel */}
            <div className="relative">
              <button
                className="flex items-center gap-1 hover:text-[var(--accent)] transition-colors"
                onClick={(e) => { e.stopPropagation(); setShowDownload(d => !d); setShowSettings(false); }}
                title="Download"
              >
                <Download size={17} />
              </button>
              {showDownload && (
                <DownloadPanel
                  video={video}
                  quality={quality}
                  availableHeights={availableHeights}
                  onClose={() => setShowDownload(false)}
                />
              )}
            </div>

            <button className="hover:text-[var(--accent)] transition-colors" onClick={toggleFullscreen}>
              {fullscreen ? <Minimize size={17} /> : <Maximize size={17} />}
            </button>
          </div>
        </div>
      </div>

      {/* Video info card */}
      <div className="mt-3 breeze-card p-4">
        <h2 className="text-lg font-semibold mb-3 leading-snug">{video.title}</h2>
        <div className="flex items-center gap-3">
          {video.channelAvatar && (
            <img
              src={video.channelAvatar}
              alt={video.channel}
              className="w-10 h-10 rounded-full flex-shrink-0 cursor-pointer hover:ring-2 ring-[var(--accent)]"
              onClick={() => onChannelSelect && video.channelId && onChannelSelect(video.channelId, video.platform)}
              onError={e => { e.target.style.display = 'none'; }}
            />
          )}
          <div className="flex-1 min-w-0">
            <CollaboratorPicker
              channelName={video.channel}
              channelId={video.channelId}
              onChannelClick={(id) => onChannelSelect && onChannelSelect(id, video.platform)}
              getChannelAvatar={(id) => id === video.channelId ? video.channelAvatar : null}
              className="text-sm font-semibold"
            />
            <p className="text-xs text-[var(--text-secondary)]">{video.views}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Share button + popup */}
            <div className="relative" ref={sharePopupRef}>
              <button
                onClick={() => setShowSharePopup(v => !v)}
                title="Share video"
                className={`p-2 rounded-full transition-all ${showSharePopup ? 'text-[var(--accent)] bg-[var(--accent)]/10' : 'hover:bg-[var(--border)]'}`}
              >
                <Share2 size={18} />
              </button>
              {showSharePopup && <div className="fixed inset-0 z-40" onClick={() => setShowSharePopup(false)} />}
              {showSharePopup && (() => {
                // Include the platform so shared Twitch / Bilibili links resolve
                // through the right extractor when the recipient opens them.
                const platParam = video.platform && video.platform !== 'youtube' ? `&p=${video.platform}` : '';
                const shareUrl = `${window.location.origin}${window.location.pathname}?v=${encodeURIComponent(video.id)}${platParam}`;
                const copyUrl = () => {
                  const tryExecCopy = () => {
                    try {
                      const ta = document.createElement('textarea');
                      ta.value = shareUrl;
                      ta.style.position = 'fixed'; ta.style.top = '-9999px'; ta.style.left = '-9999px';
                      document.body.appendChild(ta);
                      ta.focus(); ta.select();
                      document.execCommand('copy');
                      document.body.removeChild(ta);
                      setShareCopied(true);
                      setTimeout(() => setShareCopied(false), 2000);
                    } catch { /* manual copy from input below */ }
                  };
                  if (navigator.clipboard && window.isSecureContext) {
                    navigator.clipboard.writeText(shareUrl).then(() => {
                      setShareCopied(true);
                      setTimeout(() => setShareCopied(false), 2000);
                    }).catch(tryExecCopy);
                  } else {
                    tryExecCopy();
                  }
                };
                return (
                  <div
                    className="absolute right-0 top-full mt-2 z-50 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl shadow-xl p-3 w-72"
                    onClick={e => e.stopPropagation()}
                  >
                    <p className="text-xs font-semibold text-[var(--text-secondary)] mb-2">Share this video</p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        readOnly
                        value={shareUrl}
                        onFocus={e => e.target.select()}
                        className="flex-1 text-xs bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-[var(--text-primary)] cursor-text select-all min-w-0"
                      />
                      <button
                        onClick={copyUrl}
                        className={`flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${shareCopied ? 'bg-green-600 text-white' : 'bg-[var(--accent)] text-white hover:opacity-90'}`}
                      >
                        {shareCopied ? <><Check size={12} /> Copied</> : 'Copy'}
                      </button>
                    </div>
                    <p className="text-[10px] text-[var(--text-secondary)] mt-1.5">Click the URL to select it, or use Copy</p>
                  </div>
                );
              })()}
            </div>
            {/* Save button */}
            <button
              onClick={toggleSave}
              disabled={saveLoading}
              title={isSaved ? 'Remove from saved' : 'Save video'}
              className={`p-2 rounded-full transition-all ${isSaved ? 'text-[var(--accent)] bg-[var(--accent)]/10' : 'hover:bg-[var(--border)]'} ${saveLoading ? 'opacity-50' : ''}`}
            >
              {isSaved ? <BookmarkCheck size={18} /> : <Bookmark size={18} />}
            </button>
            {video.channelId && (
              <button
                onClick={toggleSubscribe}
                disabled={subscribeLoading}
                className={`px-4 py-2 rounded-full text-sm font-semibold transition-all ${
                  isSubscribed
                    ? 'bg-[var(--border)] text-[var(--text-secondary)] hover:bg-red-500/20 hover:text-red-400'
                    : 'bg-[var(--accent)] text-white hover:opacity-90'
                } ${subscribeLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {subscribeLoading ? '…' : isSubscribed ? 'Subscribed' : 'Subscribe'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Chapters list */}
      {chapters.length >= 2 && (
        <div className="mt-3 breeze-card">
          <button
            className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-[var(--bg-primary)] transition-colors"
            onClick={() => setShowChapters(s => !s)}
          >
            <span className="font-medium text-sm flex items-center gap-2">
              <span className="text-[var(--accent)]">▶</span>
              Chapters <span className="text-[var(--text-secondary)] font-normal text-xs">({chapters.length})</span>
            </span>
            {showChapters ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          {showChapters && (
            <div className="px-2 pb-3 flex flex-col gap-0.5 max-h-72 overflow-y-auto">
              {chapters.map((ch, i) => {
                const isActive = currentChapter === ch;
                return (
                  <button
                    key={ch.time}
                    onClick={() => seekTo(ch.time)}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors w-full ${
                      isActive
                        ? 'bg-[var(--accent)]/15 text-[var(--accent)]'
                        : 'hover:bg-[var(--bg-primary)] text-[var(--text-primary)]'
                    }`}
                  >
                    <span className={`text-xs font-mono tabular-nums flex-shrink-0 ${isActive ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'}`}>
                      {formatTime(ch.time)}
                    </span>
                    <span className={`text-sm truncate ${isActive ? 'font-semibold' : ''}`}>{ch.title}</span>
                    {isActive && <span className="ml-auto flex-shrink-0 w-1.5 h-1.5 bg-[var(--accent)] rounded-full" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Twitch live chat — only for live Twitch streams. The IRC channel
          name for live broadcasts is the broadcaster's login (== video.id). */}
      {video.platform === 'twitch' && video.isLive && (
        <div className="mt-3 breeze-card overflow-hidden">
          <TwitchChat channel={video.id} />
        </div>
      )}

      {/* Description */}
      <div className="mt-3 breeze-card">
        <button
          className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-[var(--bg-primary)] transition-colors"
          onClick={() => setShowDescription(s => !s)}
        >
          <span className="font-medium text-sm">Description</span>
          {showDescription ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {showDescription && (
          <div className="px-4 pb-4">
            {detailsLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 size={20} className="animate-spin text-[var(--accent)]" />
              </div>
            ) : description ? (
              <>
                <p className={`text-sm text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed ${!descExpanded ? 'line-clamp-5' : ''}`}>
                  {description}
                </p>
                {description.length > 300 && (
                  <button className="text-xs text-[var(--accent)] mt-2 hover:underline" onClick={() => setDescExpanded(s => !s)}>
                    {descExpanded ? 'Show less' : 'Show more'}
                  </button>
                )}
              </>
            ) : (
              <p className="text-sm text-[var(--text-secondary)]">No description available.</p>
            )}
          </div>
        )}
      </div>

      {/* Comments */}
      <div className="mt-3 breeze-card">
        <button
          className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-[var(--bg-primary)] transition-colors"
          onClick={() => setShowComments(s => !s)}
        >
          <span className="font-medium text-sm flex items-center gap-2">
            <MessageSquare size={15} />
            Comments {comments.length > 0 ? `(${comments.length})` : ''}
          </span>
          {showComments ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {showComments && (
          <div className="px-4 pb-4 flex flex-col gap-4">
            {detailsLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 size={20} className="animate-spin text-[var(--accent)]" />
              </div>
            ) : comments.length === 0 ? (
              <p className="text-sm text-[var(--text-secondary)]">No comments available.</p>
            ) : (
              comments.map(c => (
                <div key={c.id} className="flex gap-3">
                  {c.authorAvatar ? (
                    <img src={c.authorAvatar} alt={c.author} className="w-8 h-8 rounded-full flex-shrink-0" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-[var(--border)] flex items-center justify-center text-xs font-bold flex-shrink-0">
                      {c.author?.[0]?.toUpperCase() || '?'}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-semibold">{c.author}</span>
                      {c.published && <span className="text-xs text-[var(--text-secondary)]">{c.published}</span>}
                    </div>
                    <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{c.text}</p>
                    {Number(c.likes) > 0 && (
                      <div className="flex items-center gap-1 mt-1 text-xs text-[var(--text-secondary)]">
                        <ThumbsUp size={11} />
                        {c.likes}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
