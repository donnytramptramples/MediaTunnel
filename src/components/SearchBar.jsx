import React, { useState, useEffect, useRef } from 'react';
import { Search, ChevronDown, Rss, Tv, Gamepad2 } from 'lucide-react';

const PLATFORMS = [
  { value: 'youtube',  label: 'YouTube',  icon: Rss,      color: 'text-red-400'    },
  { value: 'bilibili', label: 'Bilibili', icon: Tv,       color: 'text-pink-400'   },
  { value: 'twitch',   label: 'Twitch',   icon: Gamepad2, color: 'text-purple-400' },
];

// Map an App view name → which platform the search bar should default to.
function viewToPlatform(view) {
  if (view === 'bilibili') return 'bilibili';
  if (view === 'twitch')   return 'twitch';
  return 'youtube';
}

function SearchBar({ onSearch, currentView }) {
  const [query, setQuery] = useState('');
  const [platform, setPlatform] = useState(viewToPlatform(currentView));
  const [open, setOpen] = useState(false);
  const popRef = useRef(null);

  // Sync the selector when the user navigates to a different platform's view
  useEffect(() => {
    setPlatform(viewToPlatform(currentView));
  }, [currentView]);

  // Close the dropdown when clicking outside
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (!popRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    onSearch(q, platform);
  };

  const current = PLATFORMS.find(p => p.value === platform) || PLATFORMS[0];
  const CurrentIcon = current.icon;

  const placeholders = {
    youtube:  'Search YouTube…',
    bilibili: 'Search Bilibili…',
    twitch:   'Search Twitch channels…',
  };

  return (
    <form onSubmit={handleSubmit} className="flex-1 max-w-2xl flex gap-2">
      <div className="flex-1 flex items-stretch rounded-md overflow-hidden border border-[var(--border)] bg-[var(--bg-primary)] focus-within:border-[var(--accent)]">
        {/* Platform selector */}
        <div className="relative" ref={popRef}>
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            className={`flex items-center gap-1.5 px-2.5 h-full text-xs font-medium border-r border-[var(--border)] hover:bg-[var(--bg-secondary)] transition-colors ${current.color}`}
            title="Search on…"
          >
            <CurrentIcon size={14} />
            <span className="hidden sm:inline">{current.label}</span>
            <ChevronDown size={12} className="text-[var(--text-secondary)]" />
          </button>
          {open && (
            <div className="absolute left-0 top-full mt-1 z-50 min-w-[160px] bg-[var(--bg-secondary)] border border-[var(--border)] rounded-md shadow-xl py-1">
              {PLATFORMS.map(opt => {
                const Icon = opt.icon;
                const selected = opt.value === platform;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => { setPlatform(opt.value); setOpen(false); }}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-[var(--bg-primary)] ${selected ? 'text-[var(--accent)] font-medium' : 'text-[var(--text-primary)]'}`}
                  >
                    <Icon size={14} className={opt.color} />
                    {opt.label}
                    {selected && <span className="ml-auto text-[var(--accent)]">•</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholders[platform]}
          className="flex-1 min-w-0 bg-transparent px-3 text-sm text-[var(--text-primary)] focus:outline-none"
        />
      </div>
      <button type="submit" className="breeze-btn flex items-center gap-2">
        <Search size={16} />
        <span className="hidden sm:inline">Search</span>
      </button>
    </form>
  );
}

export default SearchBar;
