import React, { useState, useEffect } from 'react';
import { Sun, Moon, Rss, Home, Search, LogOut, User, Zap, Bookmark, Sliders, Clock, Tv, Gamepad2, Users } from 'lucide-react';
import { DownloadProvider } from './DownloadContext';
import KaliLoader from './components/KaliLoader';
import SearchBar from './components/SearchBar';
import VideoGrid from './components/VideoGrid';
import VideoPlayer from './components/VideoPlayer';
import AuthPage from './components/AuthPage';
import ChannelPage from './components/ChannelPage';
import FeedPage from './components/FeedPage';
import ShortsPage from './components/ShortsPage';
import SavedPage from './components/SavedPage';
import AdminPage from './components/AdminPage';
import FeedSettingsModal from './components/FeedSettingsModal';
import WatchHistoryPage from './components/WatchHistoryPage';
import BilibiliPage from './components/BilibiliPage';
import TwitchPage from './components/TwitchPage';
import HomePage from './components/HomePage';
import SubscriptionsPage from './components/SubscriptionsPage';

const isAdminPath = window.location.pathname === '/admin';
const sharedQS = new URLSearchParams(window.location.search);
const sharedVideoId = sharedQS.get('v');
const sharedPlatform = sharedQS.get('p') || 'youtube'; // 'youtube' | 'bilibili' | 'twitch'

function App() {
  const [darkMode, setDarkMode] = useState(true);
  const [user, setUser] = useState(undefined);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [selectedChannel, setSelectedChannel] = useState(null);
  const [view, setView] = useState('home');
  const [defaultPlatform, setDefaultPlatform] = useState('');
  const [bilibiliQuery, setBilibiliQuery] = useState('');
  const [twitchQuery, setTwitchQuery] = useState('');
  const [channelRefreshKey, setChannelRefreshKey] = useState(0);
  const [showFeedSettings, setShowFeedSettings] = useState(false);

  useEffect(() => {
    if (darkMode) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [darkMode]);

  useEffect(() => {
    if (isAdminPath) return;
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        setUser(data?.user || null);
        if (data?.user) {
          // Pull the user's default-platform preference and route the
          // initial view accordingly. Empty string = always show the
          // platform-chooser landing page.
          fetch('/api/preferences', { credentials: 'include' })
            .then(r => r.ok ? r.json() : null)
            .then(p => {
              const dp = p?.preferences?.default_platform || '';
              setDefaultPlatform(dp);
              if (dp && !sharedVideoId) setView(dp);
            })
            .catch(() => {});
        }
        if (data?.user && sharedVideoId) {
          // Shared link: respect the ?p= platform param so we can also share
          // Twitch / Bilibili videos. YouTube remains the default for back-compat.
          const platformQS = sharedPlatform !== 'youtube' ? `?platform=${sharedPlatform}` : '';
          const fallbackThumb =
            sharedPlatform === 'youtube'
              ? `https://i.ytimg.com/vi/${sharedVideoId}/hqdefault.jpg`
              : '';
          fetch(`/api/info/${sharedVideoId}${platformQS}`)
            .then(r => r.ok ? r.json() : null)
            .then(info => {
              setSelectedVideo({
                id: sharedVideoId,
                platform: sharedPlatform,
                title: info?.title || 'Video',
                thumbnail: fallbackThumb,
                channel: '',
                channelId: '',
                channelAvatar: '',
                views: '',
                isLive: !!info?.isLive,
              });
            })
            .catch(() => {
              setSelectedVideo({
                id: sharedVideoId,
                platform: sharedPlatform,
                title: 'Video',
                thumbnail: fallbackThumb,
                channel: '',
                channelId: '',
                channelAvatar: '',
                views: '',
              });
            });
        }
      })
      .catch(() => setUser(null));
  }, []);

  if (isAdminPath) {
    return (
      <div className={darkMode ? 'dark' : ''}>
        <AdminPage />
      </div>
    );
  }

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    setUser(null);
    setSelectedVideo(null);
    setSelectedChannel(null);
    setView('home');
    setSearchQuery('');
  };

  const handleVideoSelect = (video) => {
    setSelectedVideo(video);
    setSelectedChannel(null);
  };

  // Channel selection now carries a platform alongside the id so we can route
  // to the correct backend (YouTube / Bilibili / Twitch). Default = youtube
  // for back-compat with callers that still pass a bare id string.
  const handleChannelSelect = (channelId, platform = 'youtube') => {
    if (!channelId) return;
    const p = (platform === 'bilibili' || platform === 'twitch') ? platform : 'youtube';
    setSelectedChannel({ id: String(channelId), platform: p });
    setSelectedVideo(null);
  };

  const handleBack = () => {
    if (selectedVideo) setSelectedVideo(null);
    else if (selectedChannel) setSelectedChannel(null);
  };

  const goToView = (v) => {
    setView(v);
    setSelectedVideo(null);
    setSelectedChannel(null);
  };

  if (user === undefined) {
    return <KaliLoader fullScreen text="AUTHENTICATING SESSION..." />;
  }

  if (user === null) {
    return (
      <div className={darkMode ? 'dark' : ''}>
        <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
          <div className="absolute top-4 right-4">
            <button onClick={() => setDarkMode(!darkMode)} className="p-2 hover:bg-[var(--bg-secondary)] rounded transition-colors">
              {darkMode ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>
          <AuthPage onAuth={(authedUser) => {
            setUser(authedUser);
            // If there's a shared video in the URL, open it after login
            if (sharedVideoId) {
              fetch(`/api/info/${sharedVideoId}`)
                .then(r => r.ok ? r.json() : null)
                .then(info => {
                  setSelectedVideo({
                    id: sharedVideoId,
                    title: info?.title || 'Video',
                    thumbnail: `https://i.ytimg.com/vi/${sharedVideoId}/hqdefault.jpg`,
                    channel: info?.channel || '',
                    channelId: info?.channelId || '',
                    channelAvatar: '',
                    views: info?.views || '',
                  });
                })
                .catch(() => {
                  setSelectedVideo({
                    id: sharedVideoId,
                    title: 'Video',
                    thumbnail: `https://i.ytimg.com/vi/${sharedVideoId}/hqdefault.jpg`,
                    channel: '', channelId: '', channelAvatar: '', views: '',
                  });
                });
            }
          }} />
        </div>
      </div>
    );
  }

  const isMain = !selectedVideo && !selectedChannel;
  const isShorts = isMain && view === 'shorts';

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <header className="bg-[var(--bg-secondary)] border-b border-[var(--border)] px-4 py-3 flex-shrink-0">
        <div className="flex items-center gap-3 max-w-6xl mx-auto w-full">
          {isMain && (
            <>
              <button
                onClick={() => goToView('home')}
                className={`p-2 rounded transition-colors flex-shrink-0 ${view === 'home' ? 'text-[var(--accent)] bg-[var(--bg-primary)]' : 'hover:bg-[var(--bg-primary)]'}`}
                title="Home — choose platform"
              >
                <Home size={18} />
              </button>

              <button
                onClick={() => goToView('feed')}
                className={`p-2 rounded transition-colors flex-shrink-0 ${view === 'feed' ? 'text-[var(--accent)] bg-[var(--bg-primary)]' : 'hover:bg-[var(--bg-primary)]'}`}
                title="YouTube Feed"
              >
                <Rss size={18} />
              </button>

              <button
                onClick={() => goToView('shorts')}
                className={`p-2 rounded transition-colors flex-shrink-0 ${view === 'shorts' ? 'text-[var(--accent)] bg-[var(--bg-primary)]' : 'hover:bg-[var(--bg-primary)]'}`}
                title="Shorts"
              >
                <Zap size={18} />
              </button>

              <button
                onClick={() => goToView('saved')}
                className={`p-2 rounded transition-colors flex-shrink-0 ${view === 'saved' ? 'text-[var(--accent)] bg-[var(--bg-primary)]' : 'hover:bg-[var(--bg-primary)]'}`}
                title="Saved Videos"
              >
                <Bookmark size={18} />
              </button>

              <button
                onClick={() => goToView('history')}
                className={`p-2 rounded transition-colors flex-shrink-0 ${view === 'history' ? 'text-[var(--accent)] bg-[var(--bg-primary)]' : 'hover:bg-[var(--bg-primary)]'}`}
                title="Watch History"
              >
                <Clock size={18} />
              </button>

              <button
                onClick={() => goToView('subscriptions')}
                className={`p-2 rounded transition-colors flex-shrink-0 ${view === 'subscriptions' ? 'text-[var(--accent)] bg-[var(--bg-primary)]' : 'hover:bg-[var(--bg-primary)]'}`}
                title="My Subscriptions"
              >
                <Users size={18} />
              </button>

              <button
                onClick={() => goToView('bilibili')}
                className={`p-2 rounded transition-colors flex-shrink-0 ${view === 'bilibili' ? 'text-pink-500 bg-[var(--bg-primary)]' : 'hover:bg-[var(--bg-primary)] hover:text-pink-500'}`}
                title="Bilibili"
              >
                <Tv size={18} />
              </button>

              <button
                onClick={() => goToView('twitch')}
                className={`p-2 rounded transition-colors flex-shrink-0 ${view === 'twitch' ? 'text-purple-500 bg-[var(--bg-primary)]' : 'hover:bg-[var(--bg-primary)] hover:text-purple-500'}`}
                title="Twitch"
              >
                <Gamepad2 size={18} />
              </button>

              <button
                onClick={() => setShowFeedSettings(true)}
                className="p-2 rounded transition-colors flex-shrink-0 hover:bg-[var(--bg-primary)] hover:text-[var(--accent)]"
                title="Settings"
              >
                <Sliders size={18} />
              </button>
            </>
          )}

          {isMain && (
            <div className="flex-1">
              <SearchBar
                currentView={view}
                onSearch={(q, plat) => {
                  setSelectedVideo(null);
                  setSelectedChannel(null);
                  if (plat === 'bilibili') {
                    setBilibiliQuery(q);
                    setView('bilibili');
                  } else if (plat === 'twitch') {
                    setTwitchQuery(q);
                    setView('twitch');
                  } else {
                    setSearchQuery(q);
                    setView('search');
                  }
                }}
              />
            </div>
          )}

          {(selectedVideo || selectedChannel) && <div className="flex-1" />}

          <div className="flex items-center gap-2 ml-auto flex-shrink-0">
            <span className="text-xs text-[var(--text-secondary)] hidden sm:block">
              <User size={12} className="inline mr-1" />
              {user.username}
            </span>
            <button onClick={handleLogout} className="p-2 hover:bg-[var(--bg-primary)] rounded transition-colors" title="Logout">
              <LogOut size={16} />
            </button>
            <button onClick={() => setDarkMode(!darkMode)} className="p-2 hover:bg-[var(--bg-primary)] rounded transition-colors">
              {darkMode ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>
        </div>
      </header>

      <main className={`flex-1 overflow-y-auto ${isShorts ? '' : 'p-4 md:p-6'}`}>
        <div className={isShorts ? 'h-full' : 'max-w-6xl mx-auto'}>
          {selectedVideo ? (
            <VideoPlayer
              video={selectedVideo}
              user={user}
              onBack={handleBack}
              onChannelSelect={handleChannelSelect}
            />
          ) : selectedChannel ? (
            <ChannelPage
              channelId={selectedChannel.id}
              platform={selectedChannel.platform}
              onBack={handleBack}
              onVideoSelect={handleVideoSelect}
              user={user}
              onSubscribeChange={() => setChannelRefreshKey(k => k + 1)}
            />
          ) : view === 'home' ? (
            <HomePage
              defaultPlatform={defaultPlatform}
              onPick={(v) => goToView(v)}
              onOpenSettings={() => setShowFeedSettings(true)}
            />
          ) : view === 'feed' ? (
            <FeedPage
              key={channelRefreshKey}
              user={user}
              onVideoSelect={handleVideoSelect}
              onChannelSelect={handleChannelSelect}
            />
          ) : view === 'shorts' ? (
            <ShortsPage
              user={user}
              onVideoSelect={handleVideoSelect}
              onChannelSelect={handleChannelSelect}
            />
          ) : view === 'saved' ? (
            <SavedPage
              onVideoSelect={handleVideoSelect}
              onChannelSelect={handleChannelSelect}
            />
          ) : view === 'history' ? (
            <WatchHistoryPage
              onVideoSelect={handleVideoSelect}
            />
          ) : view === 'subscriptions' ? (
            <SubscriptionsPage
              key={channelRefreshKey}
              user={user}
              onChannelSelect={handleChannelSelect}
            />
          ) : view === 'bilibili' ? (
            <BilibiliPage onVideoSelect={handleVideoSelect} initialQuery={bilibiliQuery} />
          ) : view === 'twitch' ? (
            <TwitchPage onVideoSelect={handleVideoSelect} initialQuery={twitchQuery} />
          ) : (
            <VideoGrid
              searchQuery={searchQuery}
              onVideoSelect={handleVideoSelect}
              onChannelSelect={handleChannelSelect}
            />
          )}
        </div>
      </main>

      {showFeedSettings && (
        <FeedSettingsModal
          onClose={() => setShowFeedSettings(false)}
          onSaved={(p) => {
            if (p && typeof p.default_platform === 'string') {
              setDefaultPlatform(p.default_platform);
            }
          }}
          user={user}
          onLogout={handleLogout}
        />
      )}
    </div>
  );
}

function AppWithProviders() {
  return (
    <DownloadProvider>
      <App />
    </DownloadProvider>
  );
}

export default AppWithProviders;
