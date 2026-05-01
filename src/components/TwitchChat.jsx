import React, { useEffect, useRef, useState } from 'react';
import { MessageSquare, Wifi, WifiOff } from 'lucide-react';

// Anonymous Twitch IRC over WebSocket. The `justinfan*` username pattern
// authenticates as a read-only guest, no OAuth token required.
const TWITCH_IRC_WS = 'wss://irc-ws.chat.twitch.tv:443';
const MAX_MESSAGES = 200;

// Parse a single IRC line into { tags, prefix, command, params }.
// Twitch uses IRCv3 message tags ("@key=value;... :prefix command params").
function parseIrc(line) {
  let rest = line;
  let tags = null;
  if (rest.startsWith('@')) {
    const sp = rest.indexOf(' ');
    const tagStr = rest.slice(1, sp);
    rest = rest.slice(sp + 1);
    tags = {};
    for (const kv of tagStr.split(';')) {
      const eq = kv.indexOf('=');
      if (eq < 0) tags[kv] = '';
      else tags[kv.slice(0, eq)] = kv.slice(eq + 1);
    }
  }
  let prefix = null;
  if (rest.startsWith(':')) {
    const sp = rest.indexOf(' ');
    prefix = rest.slice(1, sp);
    rest = rest.slice(sp + 1);
  }
  // Trailing param: split before final ` :`
  let trailing = null;
  const trailIdx = rest.indexOf(' :');
  if (trailIdx >= 0) {
    trailing = rest.slice(trailIdx + 2);
    rest = rest.slice(0, trailIdx);
  }
  const parts = rest.split(' ').filter(Boolean);
  const command = parts[0];
  const params = parts.slice(1);
  if (trailing != null) params.push(trailing);
  return { tags, prefix, command, params };
}

export default function TwitchChat({ channel }) {
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState('connecting'); // connecting | connected | error | closed
  const wsRef = useRef(null);
  const scrollRef = useRef(null);
  const reconnectTimer = useRef(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    if (!channel) return;
    let cancelled = false;
    let attempt = 0;

    const connect = () => {
      if (cancelled) return;
      setStatus('connecting');
      const ws = new WebSocket(TWITCH_IRC_WS);
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) { try { ws.close(); } catch {} return; }
        // Request IRCv3 capabilities so we get color/display-name tags
        ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
        const nick = 'justinfan' + Math.floor(10000 + Math.random() * 89999);
        ws.send(`NICK ${nick}`);
        ws.send(`JOIN #${channel.toLowerCase()}`);
        attempt = 0;
        setStatus('connected');
      };

      ws.onmessage = (e) => {
        if (cancelled) return;
        const lines = String(e.data).split('\r\n').filter(Boolean);
        const newMsgs = [];
        for (const line of lines) {
          // Reply to PINGs to keep the connection alive
          if (line.startsWith('PING')) {
            try { ws.send('PONG :tmi.twitch.tv'); } catch {}
            continue;
          }
          const m = parseIrc(line);
          if (m.command === 'PRIVMSG') {
            const text = m.params[m.params.length - 1] || '';
            const author = m.tags?.['display-name'] || (m.prefix?.split('!')[0] ?? 'unknown');
            const color = m.tags?.color || '';
            const id = m.tags?.id || `${Date.now()}-${Math.random()}`;
            newMsgs.push({ id, author, text, color });
          }
        }
        if (newMsgs.length) {
          setMessages(prev => {
            const merged = prev.concat(newMsgs);
            return merged.length > MAX_MESSAGES ? merged.slice(merged.length - MAX_MESSAGES) : merged;
          });
        }
      };

      ws.onerror = () => { if (!cancelled) setStatus('error'); };
      ws.onclose = () => {
        if (cancelled) return;
        setStatus('closed');
        // Exponential backoff reconnect (max 30s)
        attempt += 1;
        const delay = Math.min(30000, 1000 * Math.pow(2, attempt - 1));
        reconnectTimer.current = setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      try { wsRef.current?.close(); } catch {}
    };
  }, [channel]);

  // Auto-scroll to bottom when new messages arrive (unless user scrolled up)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickToBottom.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stickToBottom.current = nearBottom;
  };

  const statusLabel = {
    connecting: 'Connecting…',
    connected: 'Live chat',
    error: 'Disconnected (retrying)',
    closed: 'Reconnecting…',
  }[status] || status;

  return (
    <div className="flex flex-col h-[480px] md:h-[520px]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)] bg-[var(--bg-primary)] rounded-t">
        <span className="font-medium text-sm flex items-center gap-2">
          <MessageSquare size={14} className="text-purple-400" />
          Twitch Chat — <span className="text-[var(--text-secondary)] font-normal">#{channel}</span>
        </span>
        <span className={`text-[11px] flex items-center gap-1 ${status === 'connected' ? 'text-green-400' : 'text-[var(--text-secondary)]'}`}>
          {status === 'connected' ? <Wifi size={11} /> : <WifiOff size={11} />}
          {statusLabel}
        </span>
      </div>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5 text-sm font-mono leading-snug"
      >
        {messages.length === 0 ? (
          <p className="text-xs text-[var(--text-secondary)] text-center pt-6">
            Waiting for chat messages…
          </p>
        ) : (
          messages.map(m => (
            <div key={m.id} className="break-words">
              <span
                className="font-semibold mr-1.5"
                style={{ color: m.color || 'var(--accent)' }}
              >
                {m.author}:
              </span>
              <span className="text-[var(--text-primary)]">{m.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
