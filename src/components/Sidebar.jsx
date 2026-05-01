import React from 'react';
import { Home, TrendingUp, Users, Clock, Bookmark, ThumbsUp } from 'lucide-react';

const menuItems = [
  { icon: Home, label: 'Home' },
  { icon: TrendingUp, label: 'Trending' },
  { icon: Users, label: 'Subscriptions' },
  { icon: Clock, label: 'History' },
  { icon: Bookmark, label: 'Watch Later' },
  { icon: ThumbsUp, label: 'Liked Videos' }
];

function Sidebar({ collapsed, onToggle }) {
  return (
    <aside
      className={`bg-[var(--bg-secondary)] border-r border-[var(--border)] flex-shrink-0 transition-all duration-200 ${collapsed ? 'w-14' : 'w-56'}`}
    >
      <div className="p-3">
        {!collapsed && (
          <div className="px-3 py-3 mb-2">
            <h1 className="text-lg font-bold text-[var(--accent)]">YouTube</h1>
          </div>
        )}

        <nav className="space-y-0.5">
          {menuItems.map((item, index) => {
            const Icon = item.icon;
            return (
              <button
                key={index}
                className="w-full flex items-center gap-3 px-3 py-2 rounded hover:bg-[var(--bg-primary)] transition-colors text-sm"
              >
                <Icon size={18} className="flex-shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </button>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}

export default Sidebar;
