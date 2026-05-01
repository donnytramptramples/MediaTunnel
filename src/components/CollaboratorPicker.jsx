import React, { useState, useEffect } from 'react';

function parseCollaborators(channelName) {
  if (!channelName) return null;
  const parts = channelName.split(/ and | & /i).map(s => s.trim()).filter(Boolean);
  return parts.length > 1 ? parts : null;
}

// Simple cache to avoid repeated API calls
const channelCache = new Map();

export default function CollaboratorPicker({ 
  channelName, 
  channelId, 
  onChannelClick, 
  className = "",
  getChannelAvatar 
}) {
  const collaborators = parseCollaborators(channelName);
  const [avatars, setAvatars] = useState({});
  const [channelIds, setChannelIds] = useState({});

  // Load avatars and IDs silently (no error display)
  useEffect(() => {
    if (!collaborators) return;

    const loadData = async () => {
      const newAvatars = {};
      const newIds = {};

      for (let i = 0; i < collaborators.length; i++) {
        const name = collaborators[i];

        // Check cache first
        if (channelCache.has(name)) {
          const cached = channelCache.get(name);
          newAvatars[i] = cached.avatar;
          newIds[i] = cached.id;
          continue;
        }

        // First channel - we already know its ID, but the avatar may or may
        // not be available from the parent. Try the parent-supplied avatar
        // first; if that's empty, fall through to the API search so the
        // little circle isn't left as a bare initial.
        let primarySeeded = false;
        if (i === 0 && channelId) {
          const avatarFromParent = getChannelAvatar ? getChannelAvatar(channelId) : null;
          newIds[0] = channelId;
          if (avatarFromParent) {
            newAvatars[0] = avatarFromParent;
            channelCache.set(name, { id: channelId, avatar: avatarFromParent });
            continue;
          }
          // Mark as seeded so the API-search branch below doesn't overwrite
          // the (already-correct) primary channel ID with a search-result
          // ID, but still uses the search to fill in the missing avatar.
          primarySeeded = true;
        }

        // Search API for the avatar (silent fail - no error shown)
        try {
          const r = await fetch(`/api/channel/search?q=${encodeURIComponent(name)}`);
          if (!r.ok) {
            if (primarySeeded) channelCache.set(name, { id: channelId, avatar: null });
            continue;
          }
          const data = await r.json();
          const match = data.channels?.find(c =>
            c.name?.toLowerCase().includes(name.toLowerCase())
          ) || data.channels?.[0];

          if (match) {
            newAvatars[i] = match.avatar;
            // For the primary slot, keep the authoritative parent-supplied
            // ID so navigation still goes to the right channel.
            const idToUse = primarySeeded ? channelId : match.id;
            newIds[i] = idToUse;
            channelCache.set(name, { id: idToUse, avatar: match.avatar });
          } else if (primarySeeded) {
            channelCache.set(name, { id: channelId, avatar: null });
          }
        } catch {
          // Silent fail - no error message displayed
        }
      }

      setAvatars(newAvatars);
      setChannelIds(newIds);
    };

    loadData();
  }, [collaborators, channelId, getChannelAvatar]);

  // Single channel - simple text display
  if (!collaborators) {
    return (
      <span
        className={`cursor-pointer hover:text-[var(--accent)] transition-colors ${className}`}
        onClick={(e) => { 
          e.stopPropagation(); 
          if (onChannelClick && channelId) onChannelClick(channelId); 
        }}
      >
        {channelName}
      </span>
    );
  }

  const handleClick = (e, index) => {
    e.stopPropagation();
    const id = channelIds[index];
    if (id && onChannelClick) {
      onChannelClick(id);
    }
  };

  return (
    <div className={`flex items-center gap-2 flex-wrap ${className}`}>
      {/* Channel 1 */}
      <button 
        onClick={(e) => handleClick(e, 0)}
        className="flex items-center gap-1.5 group min-w-0 disabled:opacity-50 disabled:cursor-default"
        disabled={!channelIds[0]}
      >
        <div className="w-5 h-5 rounded-full overflow-hidden bg-[var(--bg-primary)] border border-[var(--border)] flex-shrink-0">
          {avatars[0] ? (
            <img 
              src={avatars[0]} 
              alt=""
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-[var(--accent)]/30 to-[var(--accent)]/10 flex items-center justify-center">
              <span className="text-[9px] font-bold text-[var(--accent)]">
                {collaborators[0].charAt(0).toUpperCase()}
              </span>
            </div>
          )}
        </div>
        <span className="text-xs text-[var(--text-secondary)] group-hover:text-[var(--accent)] transition-colors truncate">
          {collaborators[0]}
        </span>
      </button>

      <span className="text-[var(--text-secondary)] text-xs mx-0.5">&</span>

      {/* Channel 2 */}
      <button 
        onClick={(e) => handleClick(e, 1)}
        className="flex items-center gap-1.5 group min-w-0 disabled:opacity-50 disabled:cursor-default"
        disabled={!channelIds[1]}
      >
        <div className="w-5 h-5 rounded-full overflow-hidden bg-[var(--bg-primary)] border border-[var(--border)] flex-shrink-0">
          {avatars[1] ? (
            <img 
              src={avatars[1]} 
              alt=""
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-[var(--accent)]/30 to-[var(--accent)]/10 flex items-center justify-center">
              <span className="text-[9px] font-bold text-[var(--accent)]">
                {collaborators[1].charAt(0).toUpperCase()}
              </span>
            </div>
          )}
        </div>
        <span className="text-xs text-[var(--text-secondary)] group-hover:text-[var(--accent)] transition-colors truncate">
          {collaborators[1]}
        </span>
      </button>
    </div>
  );
}

