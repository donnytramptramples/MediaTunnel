import React, { useState, useEffect, useRef } from 'react';

const infoCache = new Map();

function useLazyChannelInfo(name, existingAvatar, existingId) {
  const [info, setInfo] = useState({ avatar: existingAvatar || '', id: existingId || '' });
  const fetchedRef = useRef(false);

  useEffect(() => {
    setInfo({ avatar: existingAvatar || '', id: existingId || '' });
    fetchedRef.current = false;
  }, [name, existingAvatar, existingId]);

  useEffect(() => {
    if (existingAvatar && existingId) return;
    if (!name || fetchedRef.current) return;

    const key = name.toLowerCase().trim();
    if (infoCache.has(key)) {
      const cached = infoCache.get(key);
      setInfo({ avatar: existingAvatar || cached.avatar, id: existingId || cached.id });
      return;
    }

    fetchedRef.current = true;
    let cancelled = false;

    fetch(`/api/channel/info?name=${encodeURIComponent(name)}`)
      .then(r => r.json())
      .then(data => {
        if (!cancelled) {
          const result = { avatar: data.avatar || '', id: data.id || '' };
          infoCache.set(key, result);
          setInfo({ avatar: existingAvatar || result.avatar, id: existingId || result.id });
        }
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [name, existingAvatar, existingId]);

  return info;
}

function ChannelAvatar({ author, offset = 0, onChannelClick, platform }) {
  const { avatar, id } = useLazyChannelInfo(author.name, author.avatar, author.id);
  const resolvedId = id || author.id;
  const canClick = !!resolvedId;

  return (
    <button
      type="button"
      title={author.name}
      onClick={e => { e.stopPropagation(); if (onChannelClick && resolvedId) onChannelClick(resolvedId, platform); }}
      className={`w-8 h-8 rounded-full flex-shrink-0 overflow-hidden outline outline-2 outline-[var(--bg-primary)] transition-all focus:outline-none ${canClick ? 'hover:ring-2 ring-[var(--accent)] cursor-pointer' : 'cursor-default'}`}
      style={offset ? { marginLeft: `-${offset}px` } : {}}
    >
      {avatar ? (
        <img
          src={avatar}
          alt={author.name}
          className="w-full h-full object-contain"
          style={{ background: 'var(--bg-secondary)' }}
        />
      ) : (
        <div className="w-full h-full bg-[var(--bg-secondary)] flex items-center justify-center text-xs font-bold select-none">
          {author.name?.[0]?.toUpperCase() || '?'}
        </div>
      )}
    </button>
  );
}

function ChannelNameButton({ author, onChannelClick, platform }) {
  const { id } = useLazyChannelInfo(author.name, author.avatar, author.id);
  const resolvedId = id || author.id;

  if (resolvedId) {
    return (
      <button
        type="button"
        onClick={e => { e.stopPropagation(); onChannelClick && onChannelClick(resolvedId, platform); }}
        className="text-xs text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors text-left"
      >
        {author.name}
      </button>
    );
  }

  return <span className="text-xs text-[var(--text-secondary)]">{author.name}</span>;
}

function VideoCard({ video, onClick, onChannelClick }) {
  const authors = video.authors && video.authors.length > 0
    ? video.authors
    : video.channel
      ? [{ name: video.channel, id: video.channelId || '', avatar: video.channelAvatar || '' }]
      : [];

  const isCollaboration = authors.length > 1;
  const avatarsWidth = isCollaboration ? 32 + (authors.length - 1) * 16 : 32;

  return (
    <div className="breeze-card cursor-pointer hover:shadow-md transition-shadow overflow-hidden">
      <div className="relative" onClick={onClick}>
        <img
          src={video.thumbnail}
          alt={video.title}
          className="w-full aspect-video object-cover"
        />
        <div className="absolute bottom-2 right-2 bg-black bg-opacity-80 text-white text-xs px-1.5 py-0.5">
          {video.duration}
        </div>
      </div>

      <div className="p-3">
        <div className="flex gap-3">
          {authors.length > 0 && (
            <div
              className="flex flex-shrink-0 items-start pt-0.5"
              style={{ width: `${avatarsWidth}px` }}
            >
              {authors.map((author, i) => (
                <ChannelAvatar
                  key={author.id || author.name || i}
                  author={author}
                  offset={i > 0 ? 16 : 0}
                  onChannelClick={onChannelClick}
                  platform={video.platform}
                />
              ))}
            </div>
          )}

          <div className="flex-1 min-w-0">
            <h3
              className="font-medium text-sm line-clamp-2 mb-1 cursor-pointer hover:text-[var(--accent)] transition-colors"
              onClick={onClick}
            >
              {video.title}
            </h3>

            <div className="flex flex-wrap gap-x-1 gap-y-0.5 mb-0.5">
              {authors.map((author, i) => (
                <React.Fragment key={author.id || author.name || i}>
                  <ChannelNameButton author={author} onChannelClick={onChannelClick} platform={video.platform} />
                  {i < authors.length - 1 && (
                    <span className="text-xs text-[var(--text-secondary)] select-none"> &amp;</span>
                  )}
                </React.Fragment>
              ))}
            </div>

            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              {video.views}
              {video.published && <span className="ml-2">{video.published}</span>}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default VideoCard;
