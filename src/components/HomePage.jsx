import React from 'react';
import { Rss, Zap, Tv, Gamepad2, Bookmark, Clock, Sliders } from 'lucide-react';

const TILES = [
  {
    id: 'feed',
    label: 'YouTube',
    desc: 'Personalised feed, search, subscriptions',
    icon: Rss,
    color: 'from-red-500/20 to-red-700/10',
    ring: 'ring-red-500/40 hover:ring-red-400',
    iconColor: 'text-red-400',
  },
  {
    id: 'shorts',
    label: 'Shorts',
    desc: 'Vertical short-form videos',
    icon: Zap,
    color: 'from-yellow-500/20 to-orange-600/10',
    ring: 'ring-yellow-500/40 hover:ring-yellow-400',
    iconColor: 'text-yellow-400',
  },
  {
    id: 'bilibili',
    label: 'Bilibili',
    desc: 'Trending and search across Bilibili',
    icon: Tv,
    color: 'from-pink-500/20 to-pink-700/10',
    ring: 'ring-pink-500/40 hover:ring-pink-400',
    iconColor: 'text-pink-400',
  },
  {
    id: 'twitch',
    label: 'Twitch',
    desc: 'Live streams from top channels',
    icon: Gamepad2,
    color: 'from-purple-500/20 to-purple-700/10',
    ring: 'ring-purple-500/40 hover:ring-purple-400',
    iconColor: 'text-purple-400',
  },
];

const QUICK_LINKS = [
  { id: 'saved', label: 'Saved', icon: Bookmark },
  { id: 'history', label: 'History', icon: Clock },
];

export default function HomePage({ onPick, onOpenSettings, defaultPlatform }) {
  return (
    <div className="py-8 md:py-12">
      <div className="text-center mb-10">
        <h1 className="text-3xl md:text-4xl font-bold text-[var(--text-primary)] tracking-tight">
          Welcome to <span className="text-[var(--accent)]">MediaTunnel</span>
        </h1>
        <p className="text-sm md:text-base text-[var(--text-secondary)] mt-2">
          Pick a platform to start streaming
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-5 max-w-3xl mx-auto">
        {TILES.map((t) => {
          const Icon = t.icon;
          const isDefault = defaultPlatform === t.id;
          return (
            <button
              key={t.id}
              onClick={() => onPick(t.id)}
              className={`group relative flex items-start gap-4 p-5 md:p-6 rounded-2xl bg-gradient-to-br ${t.color} border border-[var(--border)] ring-1 ${t.ring} transition-all hover:scale-[1.02] hover:shadow-lg text-left`}
            >
              <div className={`flex-shrink-0 p-3 rounded-xl bg-[var(--bg-secondary)]/60 ${t.iconColor}`}>
                <Icon size={26} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-[var(--text-primary)] text-base md:text-lg">
                    {t.label}
                  </span>
                  {isDefault && (
                    <span className="text-[10px] uppercase tracking-wider bg-[var(--accent)]/20 text-[var(--accent)] px-1.5 py-0.5 rounded">
                      Default
                    </span>
                  )}
                </div>
                <p className="text-xs md:text-sm text-[var(--text-secondary)] mt-1">
                  {t.desc}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-center gap-2 mt-8 flex-wrap">
        {QUICK_LINKS.map((q) => {
          const Icon = q.icon;
          return (
            <button
              key={q.id}
              onClick={() => onPick(q.id)}
              className="flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--bg-secondary)] border border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)] text-sm text-[var(--text-secondary)] transition-colors"
            >
              <Icon size={14} />
              {q.label}
            </button>
          );
        })}
        <button
          onClick={onOpenSettings}
          className="flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--bg-secondary)] border border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)] text-sm text-[var(--text-secondary)] transition-colors"
        >
          <Sliders size={14} />
          Set Default Platform
        </button>
      </div>
    </div>
  );
}
