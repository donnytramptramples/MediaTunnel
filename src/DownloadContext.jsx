import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { Download, CheckCircle, XCircle, X, Loader2 } from 'lucide-react';

const DownloadContext = createContext(null);

function formatMB(bytes) {
  if (!bytes || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  return mb < 10 ? `${mb.toFixed(2)} MB` : `${mb.toFixed(1)} MB`;
}

function formatSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec <= 0) return null;
  const mbps = bytesPerSec / (1024 * 1024);
  return `${mbps.toFixed(1)} MB/s`;
}

function DownloadToastItem({ dl, onDismiss }) {
  const hasTotal = dl.total && dl.total > 0;
  const pct = hasTotal ? Math.min(100, Math.round((dl.received / dl.total) * 100)) : 0;
  const speed = formatSpeed(dl.speed);

  // Bar is real whenever we have a percentage; pulse only when truly unknown
  const showBar = dl.status === 'muxing' || dl.status === 'fetching';
  const indeterminate = showBar && !hasTotal;

  return (
    <div
      className="flex flex-col gap-2 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg p-3 shadow-xl"
      style={{ minWidth: 280, maxWidth: 340 }}
    >
      {/* Header row */}
      <div className="flex items-center gap-2">
        {(dl.status === 'preparing' || dl.status === 'muxing') && (
          <Loader2 size={13} className="animate-spin text-[var(--accent)] flex-shrink-0" />
        )}
        {dl.status === 'fetching' && (
          <Download size={13} className="text-[var(--accent)] flex-shrink-0" />
        )}
        {dl.status === 'done' && (
          <CheckCircle size={13} className="text-green-400 flex-shrink-0" />
        )}
        {dl.status === 'error' && (
          <XCircle size={13} className="text-red-400 flex-shrink-0" />
        )}

        <span className="text-xs font-medium text-[var(--text-primary)] truncate flex-1" title={dl.filename}>
          {dl.filename}
        </span>

        {(dl.status === 'done' || dl.status === 'error') && (
          <button
            onClick={() => onDismiss(dl.id)}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex-shrink-0"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* Progress bar */}
      {showBar && (
        <div className="w-full h-1.5 rounded-full bg-[var(--bg-primary)] overflow-hidden">
          {indeterminate ? (
            <div className="h-full w-full rounded-full bg-[var(--accent)] opacity-60 animate-pulse" />
          ) : (
            <div
              className="h-full rounded-full bg-[var(--accent)] transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          )}
        </div>
      )}

      {/* Stats row — processing shows only percentage; sending shows MB/s details */}
      {dl.status === 'muxing' && (
        <div className="flex justify-between items-center text-[10px]">
          <span className="text-[var(--text-secondary)]">Processing</span>
          <span className="font-semibold text-[var(--text-primary)]">
            {hasTotal ? `${pct}%` : '…'}
          </span>
        </div>
      )}

      {dl.status === 'fetching' && (
        <div className="flex justify-between items-center text-[10px]">
          <span className="text-[var(--text-secondary)]">Sending to device</span>
          <span className="flex items-center gap-2">
            {hasTotal && (
              <span className="text-[var(--text-primary)]">
                {formatMB(dl.received)} / {formatMB(dl.total)}
              </span>
            )}
            {speed && (
              <span className="text-[var(--accent)] font-medium">{speed}</span>
            )}
          </span>
        </div>
      )}

      {dl.status === 'preparing' && (
        <p className="text-[10px] text-[var(--text-secondary)]">Fetching video info…</p>
      )}

      {dl.status === 'done' && (
        <p className="text-[10px] text-green-400">Saved · {formatMB(dl.total || dl.received)}</p>
      )}

      {dl.status === 'error' && (
        <p className="text-[10px] text-red-400 truncate" title={dl.error}>{dl.error}</p>
      )}
    </div>
  );
}

export function DownloadProvider({ children }) {
  const [downloads, setDownloads] = useState([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id) => {
    setDownloads(prev => prev.filter(d => d.id !== id));
  }, []);

  const update = useCallback((id, patch) => {
    setDownloads(prev => prev.map(d => d.id === id ? { ...d, ...patch } : d));
  }, []);

  const startDownload = useCallback(async ({ videoId, format, quality, title, channel, bitrate, compression }) => {
    const id = ++idRef.current;
    const rawName = channel
      ? `${channel} - ${title || 'video'}`
      : (title || 'video');
    const filename = `${rawName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '').replace(/\.+$/, '').trim()}.${format || 'mp4'}`;

    setDownloads(prev => [
      ...prev,
      { id, filename, status: 'preparing', received: 0, total: null, speed: 0, error: null },
    ]);

    try {
      // ── Phase 1: start job on server (returns immediately) ───────────────
      const params = new URLSearchParams({ videoId, format: format || 'mp4', quality: quality || '720' });
      if (title) params.set('title', title);
      if (channel) params.set('channel', channel);
      if (bitrate) params.set('bitrate', bitrate);
      if (compression) params.set('compression', compression);

      const startRes = await fetch(`/api/download/start?${params}`, { method: 'POST' });
      if (!startRes.ok) {
        const j = await startRes.json().catch(() => ({}));
        throw new Error(j.error || `Server error ${startRes.status}`);
      }
      const { jobId } = await startRes.json();

      // ── Phase 2: poll for muxing progress ────────────────────────────────
      const finalStatus = await new Promise((resolve, reject) => {
        let lastSize = 0;
        let lastTime = Date.now();

        const poll = async () => {
          try {
            const r = await fetch(`/api/download/status/${jobId}`);
            if (!r.ok) { reject(new Error(`Status check failed: ${r.status}`)); return; }
            const s = await r.json();

            if (s.status === 'error') { reject(new Error(s.error || 'Processing failed')); return; }

            const now = Date.now();
            const elapsed = (now - lastTime) / 1000;
            const delta = s.fileSizeOnDisk - lastSize;
            const speed = elapsed > 0 ? delta / elapsed : 0;
            lastSize = s.fileSizeOnDisk;
            lastTime = now;

            update(id, {
              status: s.status === 'ready' ? 'fetching' : 'muxing',
              received: s.fileSizeOnDisk,
              total: s.estimatedSize,
              speed: speed > 0 ? speed : undefined,
            });

            if (s.status === 'ready') { resolve(s); return; }
            setTimeout(poll, 400);
          } catch (err) {
            reject(err);
          }
        };
        setTimeout(poll, 600);
      });

      // ── Phase 3: trigger the actual file save ────────────────────────────
      // We deliberately do NOT fetch + Blob + URL.createObjectURL here.
      // That approach breaks inside in-browser proxies like Scramjet /
      // Ultraviolet — blob: URLs created in the proxied page context are
      // not visible to the proxy's service-worker download interceptor,
      // which surfaces as "Couldn't download — No file".
      //
      // Instead we point an <a download> at a real HTTP URL. The browser
      // (or the proxy SW) handles the download natively, which is the
      // path both Scramjet and standard browsers know how to save.
      //
      // The filename is included as a path segment so that even when no
      // Content-Disposition header is sent (we omit it on purpose so
      // school web filters don't block the response) the proxy / browser
      // still has a sensible suggested filename to fall back on.
      //
      // We also use the /api/d/ alias path because some school filters
      // block any URL containing the word "download".
      const safeFilename = encodeURIComponent(filename);
      const downloadUrl = `/api/d/${jobId}/${safeFilename}`;

      // Use the final size reported by the server (set once muxing finishes)
      // so the "Saved · X MB" toast shows the real file size instead of 0 B.
      const finalSize = finalStatus?.estimatedSize || 0;
      update(id, { status: 'fetching', received: finalSize, total: finalSize, speed: 0 });

      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;
      a.rel = 'noopener';
      // Keep the click out of any iframe ancestor chain that might block it
      a.target = '_self';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      update(id, { status: 'done', received: finalSize, total: finalSize, speed: 0 });
      setTimeout(() => dismiss(id), 5000);

    } catch (err) {
      if (err.name === 'AbortError') return;
      update(id, { status: 'error', error: err.message });
    }
  }, [update, dismiss]);

  return (
    <DownloadContext.Provider value={{ startDownload }}>
      {children}

      {downloads.length > 0 && (
        <div
          className="fixed bottom-4 right-4 flex flex-col gap-2 z-[9999]"
          style={{ pointerEvents: 'none' }}
        >
          {downloads.map(dl => (
            <div key={dl.id} style={{ pointerEvents: 'auto' }}>
              <DownloadToastItem dl={dl} onDismiss={dismiss} />
            </div>
          ))}
        </div>
      )}
    </DownloadContext.Provider>
  );
}

export function useDownload() {
  const ctx = useContext(DownloadContext);
  if (!ctx) throw new Error('useDownload must be used inside DownloadProvider');
  return ctx;
}
