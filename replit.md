# MediaTunnel

A high-performance multi-platform streaming client (YouTube, Bilibili, Twitch) with proxied streaming, downloads, subtitles, user auth, subscriptions, feed, and Shorts — styled with a KDE Breeze-inspired UI.

The app opens on a **Home / platform-chooser** landing page by default. Users can pick a default platform in **Settings → Feed → Default Platform** to skip the chooser on subsequent logins.

## Architecture

**Backend** (`server.js`) — Express on port 10000 (dev) / 8080 (prod):
- `youtubei.js` (TV_EMBEDDED client) for search, metadata, comments, channel data, trending
- `yt-dlp` for format extraction with multi-client fallback (tv_embedded → android_vr → mweb → android → ios)
- `ffmpeg` for real-time muxing of separate video+audio streams and audio format transcoding
- SQLite via `better-sqlite3`:
  - `data/auth.db` — users + sessions + admin_config + admin_settings + admin_sessions + watch_history + user_preferences
  - `data/subscriptions.db` — channel subscriptions per user
  - `data/saved.db` — saved/bookmarked videos
- Custom cookie-based auth (no express-session needed)
- Admin panel at `/admin` (secret page, bcrypt-hashed password, set once)

**Frontend** (`src/`) — React + Vite + TailwindCSS on port 5000 (dev):
- Proxies `/api/*` to backend at port 10000

## Key Features

1. **Auth** — Login/signup on first visit, 30-day persistent sessions, stored in SQLite. Admin can set max account/connection limits.
2. **Search** — Video + channel search with Load More pagination
3. **Feed (YT-like algorithm)** — Mixes subscription content with trending. User-configurable via Feed Settings (slider for subscription weight, trending weight, toggle trending). Algorithm scores use recency + popularity + randomness. Weights from user_preferences table.
4. **Subscriptions (multi-platform)** — Subscribe/unsubscribe from any YouTube, Bilibili, or Twitch channel page. Stored as `(user_id, platform, channel_id)` in `subscriptions.db`. Dedicated **Subscriptions** view (Users icon in nav) shows all subs gridded with platform badges, filter chips, search, and per-card unsubscribe. Feed dispatcher fans out per-platform: YT via yt-dlp, Twitch via GQL `user(login)` (live stream + ARCHIVE VODs), Bilibili via WBI-signed `/x/space/wbi/arc/search` using cached `buvid3` cookies. Bilibili user-listing is best-effort: from datacenter IPs it often returns code -352/HTTP 412 — the sub is still stored, just shows empty in feed. Live Twitch streams get a +1.5 score boost so they pin to the top of the feed.
5. **Channel Pages** — Search for channels, view all videos, sort by newest/oldest/popular.
6. **Video Playback** — Custom proxy player with quality switching, speed control, double-tap seek (±10s), arrow key seek, A/V sync fix (`-avoid_negative_ts make_zero`)
7. **Watch History** — Auto-recorded after 5s of watching; powers the admin analytics view
8. **Subtitles** — Custom VTT renderer with word-level karaoke highlighting; auto-translate
9. **Description + Comments** — Expandable below player
10. **Downloads** — MP4, MP3, FLAC, Opus, Ogg
11. **Shorts** — Vertical TikTok-style player; multiple source fallbacks
12. **Admin Panel** (`/admin`) — Secret page; password set once and cannot be changed; bcrypt-hashed in admin_config; shows total/connected users, per-user watch history, account limits, delete accounts, reset passwords

## Admin Panel

Access at `/admin`. Not linked from any UI.
- First visit: setup page to set an admin password (one-time, permanent, cannot be changed)
- Login: username "admin" + chosen password, 4-hour session cookie
- Dashboard: user list with online status, watch history per user, settings for max accounts/connections, delete users, reset passwords

## File Structure

```
server.js              # All backend logic
src/
  App.jsx              # Auth routing, navigation state (feed | shorts | search)
  main.jsx             # React entry
  index.css            # KDE Breeze theme variables
  components/
    AuthPage.jsx        # Login/signup form
    SearchBar.jsx       # Search input + platform selector (YT/Bilibili/Twitch)
    VideoGrid.jsx       # Search results + Load More + Channel tabs
    VideoCard.jsx       # Thumbnail card with channel click
    VideoPlayer.jsx     # Custom player + subtitles + description + comments + Twitch chat
    TwitchChat.jsx      # Anonymous Twitch IRC chat (WebSocket, justinfan*)
    ChannelPage.jsx     # Channel videos with subscribe button + sort
    FeedPage.jsx        # YT-algorithm feed (subscriptions + trending)
    ShortsPage.jsx      # YouTube Shorts section
    HomePage.jsx        # Landing page with platform tiles
    BilibiliPage.jsx    # Bilibili browse + per-page search (accepts initialQuery)
    TwitchPage.jsx      # Twitch browse + per-page search (accepts initialQuery)
data/
  auth.db              # Users and sessions (auto-created)
  subscriptions.db     # Subscriptions (auto-created)
```

## Development

```bash
bash start.sh
# Backend: PORT=10000 node server.js
# Frontend: npx vite --port 5000
```

## Production Deployment

- Build: `npm run build` (creates `dist/`)
- Run: `node server.js` (serves dist/ statically + API on PORT)

## Video Chapters

Chapters are extracted in this order:
1. From YouTube's `MultiMarkersPlayerBar` via youtubei.js `player_overlays`
2. Parsed from the video description (timestamp lines like `0:00 Intro`)

Chapters are returned in `/api/info/:videoId` and cached in sessionStorage. The VideoPlayer displays:
- White divider marks on the progress bar at each chapter boundary
- Chapter name + time tooltip when hovering over the progress bar
- Current chapter name displayed inline next to the timestamp

## Database Encryption

Sensitive fields in `auth.db` are encrypted at rest using AES-256-GCM:
- `users.email` — stored encrypted, looked up via `users.email_hash` (SHA-256)
- `users.plain_password` — stored encrypted

The encryption key is auto-generated on first run and stored at `data/.key`.
Existing plaintext records are automatically migrated to encrypted form on startup.
The `enc:` prefix is used to distinguish encrypted from legacy plaintext data.

## Bot Detection Fixes

yt-dlp tries these clients in order until one works:
1. `tv_embedded` (best bypass)
2. `android_vr`
3. `mweb`
4. `android`
5. `ios`

All attempts include proper Origin/Referer headers.

## Environment

- Node.js 22
- yt-dlp auto-downloaded to `$HOME/bin/yt-dlp` if missing
- ffmpeg from system PATH
- Python 3 required (for better-sqlite3 native compilation)
- `better-sqlite3` compiled natively — if Node.js version changes, run `npm rebuild better-sqlite3`

## Multi-Platform Support (Bilibili + Twitch)

Beyond YouTube, the app supports browsing/searching/playing Bilibili and Twitch:

### Bilibili
- Browse popular + search via Bilibili's public web API (`api.bilibili.com`).
- Stream extraction goes **directly** through Bilibili's `view` + `wbi/playurl` APIs
  (yt-dlp's bilibili extractor returns 412 from datacenter IPs).
- A real `buvid3` cookie is fetched from `api.bilibili.com/x/frontend/finger/spi`
  on demand and cached for 1 hour at `$TMPDIR/bili_cookies.txt`.
- DASH manifests give separate video + audio streams that are muxed by
  `muxToResponse()` exactly like YouTube. `muxToResponse` auto-detects
  bilivideo.com URLs and switches to bilibili-origin headers (Referer
  hotlink protection).
- Thumbnails (hdslb.com) are routed through `/api/img-proxy` with an
  allowlist to bypass hotlink protection.
- API endpoints: `/api/bilibili/popular`, `/api/bilibili/search`.

### Twitch
- Browse top live channels + search via inline GraphQL on `gql.twitch.tv`
  (public web Client-ID `kimne78kx3ncx6brgo4mv6wki5h1ko`, no auth).
- Stream extraction via yt-dlp (works fine for Twitch).
- HLS streams are muxed as a single input through `muxHlsToResponse()`.
- Live streams (alphanumeric channel IDs) vs VODs (numeric IDs) are
  auto-detected.
- Twitch's GraphQL `first` arg is capped at 30.
- API endpoints: `/api/twitch/streams`, `/api/twitch/search`.

### Frontend integration
- `video.platform` field (`'youtube' | 'bilibili' | 'twitch'`) routes
  `/api/proxy/:videoId`, `/api/info/:videoId`, `/api/codec/:videoId`
  via `?platform=...` query.
- `App.jsx` adds Tv (pink) + Gamepad2 (purple) header buttons to switch
  between sections.
- New pages: `BilibiliPage.jsx`, `TwitchPage.jsx` — both use the existing
  `VideoCard` component.
