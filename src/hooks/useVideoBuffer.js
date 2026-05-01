import { useState, useRef, useEffect, useCallback } from 'react';

// ── Buffering policy ────────────────────────────────────────────────────────
// YouTube-style: buffer as much as the browser will let us. We do NOT
// proactively evict behind the playhead — that would force a network round
// trip every time the user scrubs back, which is exactly what we want to
// avoid. Memory is still bounded because the browser raises QuotaExceededError
// when the SourceBuffer fills up; the flush() handler catches that and
// trims the oldest content just enough to fit the next chunk.
const EVICT_BEHIND_S = Infinity; // never auto-drop behind the playhead
const MAX_BUFFER_S   = Infinity; // no soft cap — rely on quota errors

const FALLBACK_MIMES = [
  'video/mp4; codecs="avc1.640028,mp4a.40.2"',
  'video/mp4; codecs="avc1.4D401F,mp4a.40.2"',
  'video/mp4; codecs="avc1.42E01E,mp4a.40.2"',
];

export function useVideoBuffer({ videoId, quality, videoRef, videoDuration, platform = 'youtube' }) {
  const [objectUrl, setObjectUrl] = useState(null);
  const [isReady,   setIsReady]   = useState(false);

  const msRef     = useRef(null);
  const sbRef     = useRef(null);
  const urlRef    = useRef(null);
  const fetchCtrl = useRef(null);
  const appendQ   = useRef([]);
  const busy      = useRef(false);
  // Mirror duration in a ref so initMSE / restartFrom can read the latest
  // value without being re-created (which would tear down MSE on every
  // duration change). The effect below pushes updates into the live
  // MediaSource when the duration first becomes known.
  const durationRef = useRef(videoDuration || 0);
  useEffect(() => {
    durationRef.current = videoDuration || 0;
    const ms = msRef.current;
    if (!ms || ms.readyState !== 'open') return;
    if (!videoDuration || !isFinite(videoDuration) || videoDuration <= 0) return;
    // Only widen, never shrink — shrinking can truncate already-buffered data.
    if (!isFinite(ms.duration) || videoDuration > ms.duration) {
      const sb = sbRef.current;
      // Setting duration while the SourceBuffer is updating throws
      // InvalidStateError. Defer until it's idle.
      const apply = () => { try { ms.duration = videoDuration; } catch {} };
      if (sb && sb.updating) {
        sb.addEventListener('updateend', apply, { once: true });
      } else {
        apply();
      }
    }
  }, [videoDuration]);

  const flush = useCallback(() => {
    const sb = sbRef.current;
    if (!sb || sb.updating || busy.current || !appendQ.current.length) return;
    const chunk = appendQ.current[0]; // peek; only shift after a successful append
    busy.current = true;
    try {
      sb.appendBuffer(chunk);
      appendQ.current.shift();
    } catch (e) {
      busy.current = false;
      if (e.name === 'QuotaExceededError') {
        // Browser is out of room. Drop the oldest behind-playhead content in
        // chunks of 30s until the next append can succeed. We keep at least
        // the last 10s before the playhead so backward micro-scrubs still
        // hit the buffer; everything older is fair game. Don't shift the
        // queued chunk — flush() will be re-invoked from the updateend
        // listener after the remove() completes.
        const v = videoRef.current;
        if (v && sbRef.current && !sbRef.current.updating) {
          const buf = sbRef.current.buffered;
          if (buf.length > 0) {
            const oldestStart = buf.start(0);
            const removeUntil = Math.min(
              oldestStart + 30,
              Math.max(0, v.currentTime - 10)
            );
            if (removeUntil > oldestStart) {
              try { sbRef.current.remove(oldestStart, removeUntil); } catch {}
            }
          }
        }
      }
    }
  }, [videoRef]);

  const startFetch = useCallback(async (fromSec, ctrl) => {
    const platformParam = platform && platform !== 'youtube' ? `&platform=${platform}` : '';
    const url = `/api/proxy/${videoId}?quality=${quality}${platformParam}${fromSec > 0 ? `&t=${fromSec}` : ''}`;
    try {
      const resp = await fetch(url, { signal: ctrl.signal, credentials: 'include' });
      if (!resp.ok || !resp.body) return;
      const reader = resp.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done || ctrl.signal.aborted) break;
        appendQ.current.push(value);
        flush();
      }
    } catch (e) {
      if (e.name !== 'AbortError') console.warn('[MSE] fetch error:', e.message);
    }
  }, [videoId, quality, flush, platform]);

  const initMSE = useCallback((mimeType) => {
    fetchCtrl.current?.abort();
    appendQ.current = [];
    busy.current = false;
    if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null; }
    msRef.current  = null;
    sbRef.current  = null;
    setIsReady(false);

    const ms  = new MediaSource();
    msRef.current = ms;
    const url = URL.createObjectURL(ms);
    urlRef.current = url;
    setObjectUrl(url);

    ms.addEventListener('sourceopen', () => {
      try {
        const sb = ms.addSourceBuffer(mimeType);
        sbRef.current = sb;
        sb.timestampOffset = 0;
        sb.addEventListener('updateend', () => { busy.current = false; flush(); });
        // ── Critical for out-of-buffer seeks ───────────────────────────────
        // Without an explicit duration, MediaSource auto-grows duration to
        // cover only the buffered ranges. The video element then refuses to
        // seek past that "implicit" duration — which is exactly why seeking
        // to an unloaded section silently fails: the seek target is outside
        // `video.seekable`, so the browser snaps back without ever fetching.
        // Setting duration up-front to the real video length makes the
        // entire timeline seekable, so the seek+restart pipeline can run.
        const dur = durationRef.current;
        if (dur && isFinite(dur) && dur > 0) {
          try { ms.duration = dur; } catch {}
        }
        setIsReady(true);
        const ctrl = new AbortController();
        fetchCtrl.current = ctrl;
        startFetch(0, ctrl);
      } catch (e) {
        console.error('[MSE] SourceBuffer init failed:', e.message);
        setObjectUrl(null);
        setIsReady(false);
      }
    }, { once: true });
  }, [flush, startFetch]);

  useEffect(() => {
    if (!videoId || !quality || !window.MediaSource) return;
    let cancelled = false;

    (async () => {
      let mime = null;
      try {
        const platformParam = platform && platform !== 'youtube' ? `&platform=${platform}` : '';
        const r = await fetch(`/api/codec/${videoId}?quality=${quality}${platformParam}`, { credentials: 'include' });
        if (!r.ok || cancelled) return;
        const { mimeType } = await r.json();
        if (MediaSource.isTypeSupported(mimeType)) mime = mimeType;
      } catch {}
      if (!mime) mime = FALLBACK_MIMES.find(m => MediaSource.isTypeSupported(m)) ?? null;
      if (!mime || cancelled) {
        if (!cancelled) console.warn('[MSE] no supported codec, falling back to proxy URL');
        return;
      }
      if (!cancelled) initMSE(mime);
    })();

    return () => {
      cancelled = true;
      fetchCtrl.current?.abort();
      appendQ.current = [];
      if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null; }
      setObjectUrl(null);
      setIsReady(false);
      msRef.current = null;
      sbRef.current = null;
    };
  }, [videoId, quality, initMSE, platform]);

  const seekInBuffer = useCallback((targetSec) => {
    const v = videoRef.current;
    if (!v || !isReady) return false;
    const buf = v.buffered;
    for (let i = 0; i < buf.length; i++) {
      if (targetSec >= buf.start(i) - 0.1 && targetSec < buf.end(i) - 0.2) return true;
    }
    return false;
  }, [videoRef, isReady]);

  const restartFrom = useCallback(async (fromSec) => {
    const sb = sbRef.current;
    const ms = msRef.current;
    if (!sb || !ms || ms.readyState !== 'open') return;

    fetchCtrl.current?.abort();
    appendQ.current = [];
    busy.current = false;

    if (sb.updating) {
      await new Promise(r => sb.addEventListener('updateend', r, { once: true }));
    }
    try { sb.abort(); } catch {}

    // ── YouTube-style non-destructive seek ────────────────────────────────
    // Always preserve everything BEFORE the seek point so the user can
    // scrub back into the grey "already loaded" bar instantly, exactly the
    // way YouTube's player behaves. Earlier code would wipe the entire
    // buffer on a forward seek with a large gap (out of fear that
    // non-contiguous SourceBuffer ranges would stall the browser), but
    // setting MediaSource.duration up-front made that workaround
    // unnecessary — the browser is happy to play a fragmented timeline as
    // long as the seek target is within `seekable`.
    //
    // We clear from a tiny epsilon before the seek point onwards so the
    // new server fetch (which lands at exactly fromSec) can populate the
    // forward range without colliding with stale data left over from a
    // previous fetch that overshot.
    const clearFrom = Math.max(0, fromSec - 0.1);

    try {
      sb.remove(clearFrom, Infinity);
      // IMPORTANT: only await updateend if remove actually started an operation.
      // If the removed range is empty (no buffered data in that range) some browsers
      // skip firing updateend entirely, which would cause this await to hang forever
      // and prevent startFetch from ever being called.
      if (sb.updating) {
        await new Promise(r => sb.addEventListener('updateend', r, { once: true }));
      }
    } catch {}

    // The server now emits fragments with their original absolute PTS
    // (via ffmpeg `-copyts`), so each tfdt already lands at the correct
    // position in the SourceBuffer timeline. Keep timestampOffset at 0
    // — adding `fromSec` here would double-shift and place the new data
    // at 2 × fromSec, producing a black/silent player after every seek.
    try { sb.timestampOffset = 0; } catch {}

    const ctrl = new AbortController();
    fetchCtrl.current = ctrl;
    startFetch(fromSec, ctrl);
  }, [startFetch, videoRef]);

  const evict = useCallback((currentSec) => {
    const sb = sbRef.current;
    const v  = videoRef.current;
    if (!sb || sb.updating) return;

    // 1. Always drop content more than EVICT_BEHIND_S seconds behind the playhead.
    const evictTo = Math.max(0, currentSec - EVICT_BEHIND_S);
    if (evictTo >= 2) {
      try { sb.remove(0, evictTo); } catch {}
      return; // let the updateend cycle finish before doing more
    }

    // 2. Cap total buffer to MAX_BUFFER_S to keep RAM bounded.
    //    If over the cap, trim the furthest-ahead content that is well past the playhead.
    if (!v) return;
    let totalBuffered = 0;
    const buf = v.buffered;
    for (let i = 0; i < buf.length; i++) {
      totalBuffered += buf.end(i) - buf.start(i);
    }
    if (totalBuffered > MAX_BUFFER_S && buf.length > 0) {
      const excess    = totalBuffered - MAX_BUFFER_S;
      const farEnd    = buf.end(buf.length - 1);
      const trimStart = Math.max(currentSec + EVICT_BEHIND_S, farEnd - excess);
      if (trimStart < farEnd) {
        try { sb.remove(trimStart, farEnd); } catch {}
      }
    }
  }, [videoRef]);

  return { objectUrl, isReady, seekInBuffer, restartFrom, evict };
}
