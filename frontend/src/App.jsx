
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

const API = (import.meta.env.VITE_API_URL || "http://127.0.0.1:5000").replace(/\/$/, "");
const FAV_KEY = "streambox-favorites-v1";

const fmt = (n = 0) => {
  n = Number(n) || 0;
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let i = -1;
  do {
    n /= 1024;
    i++;
  } while (n >= 1024 && i < units.length - 1);
  return `${n.toFixed(n >= 10 ? 1 : 2)} ${units[i]}`;
};

const title = (s = "") =>
  s.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || s;

const readFav = () => {
  try {
    const value = JSON.parse(localStorage.getItem(FAV_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
};

async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, options);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }

  return data;
}

function VideoCard({ video, index, favorite, onPlay, onFavorite, onLongPress }) {
  const timer = useRef(null);
  const longPressed = useRef(false);

  const startPress = () => {
    longPressed.current = false;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      longPressed.current = true;
      onLongPress(video);
    }, 650);
  };

  const stopPress = () => clearTimeout(timer.current);

  return (
    <article
      className="video-card"
      role="button"
      tabIndex={0}
      aria-label={`Play ${title(video.name)}`}
      onClick={() => {
        if (longPressed.current) {
          longPressed.current = false;
          return;
        }
        onPlay(video);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPlay(video);
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onLongPress(video);
      }}
      onTouchStart={startPress}
      onTouchEnd={stopPress}
      onTouchMove={stopPress}
      onTouchCancel={stopPress}
    >
      <div className="poster">
        <div className="poster-fallback">
          {title(video.name).slice(0, 1).toUpperCase()}
        </div>

        <video
          className="poster-video"
          src={video.url}
          preload="metadata"
          muted
          playsInline
          onLoadedMetadata={(e) => {
            try {
              e.currentTarget.currentTime = Math.min(
                1,
                e.currentTarget.duration || 1
              );
            } catch {}
          }}
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />

        <div className="poster-shade" />
        <span className="poster-number">
          {String(index + 1).padStart(2, "0")}
        </span>
        <span className="poster-play">▶</span>
        <span className="poster-caption">{fmt(video.size)}</span>
      </div>

      <div className="card-info">
        <div className="card-text">
          <h3 className="card-title" title={title(video.name)}>
            {title(video.name)}
          </h3>
          <p className="card-subtitle">
            {video.name.split(".").pop()?.toUpperCase()} · {fmt(video.size)}
          </p>
        </div>

        <button
          className={`heart-button ${favorite ? "favorited" : ""}`}
          aria-label="Toggle favourite"
          onClick={(e) => {
            e.stopPropagation();
            onFavorite(video.key);
          }}
        >
          {favorite ? "♥" : "♡"}
        </button>
      </div>
    </article>
  );
}

export default function App() {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("all");
  const [favorites, setFavorites] = useState(readFav);
  const [player, setPlayer] = useState(null);
  const [menu, setMenu] = useState(false);
  const [settings, setSettings] = useState(false);
  const [storage, setStorage] = useState(null);
  const [storageLoading, setStorageLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [notice, setNotice] = useState("");

  const picker = useRef(null);
  const noticeTimer = useRef(null);

  const toast = useCallback((message) => {
    setNotice(message);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(""), 4500);
  }, []);

  const loadVideos = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const data = await request("/api/videos");
      setVideos(
        Array.isArray(data.videos)
          ? data.videos
          : Array.isArray(data)
            ? data
            : []
      );
    } catch (err) {
      setError(`${err.message}. Check Flask and VITE_API_URL.`);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadStorage = useCallback(async () => {
    setStorageLoading(true);

    try {
      setStorage(await request("/api/storage"));
    } catch (err) {
      toast(`Storage details unavailable: ${err.message}`);
    } finally {
      setStorageLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadVideos();
    return () => clearTimeout(noticeTimer.current);
  }, [loadVideos]);

  useEffect(() => {
    localStorage.setItem(FAV_KEY, JSON.stringify(favorites));
  }, [favorites]);

  const filtered = useMemo(() => {
    let list =
      tab === "favorites"
        ? videos.filter((video) => favorites.includes(video.key))
        : videos;

    if (query.trim()) {
      list = list.filter((video) =>
        video.name.toLowerCase().includes(query.trim().toLowerCase())
      );
    }

    return list;
  }, [videos, tab, favorites, query]);

  const toggleFavorite = (key) => {
    setFavorites((old) =>
      old.includes(key) ? old.filter((item) => item !== key) : [...old, key]
    );
  };

  const movePlayer = useCallback(
    (direction) => {
      if (!player || !filtered.length) return;

      const index = filtered.findIndex((video) => video.key === player.key);
      const currentIndex = Math.max(index, 0);
      setPlayer(
        filtered[
          (currentIndex + direction + filtered.length) % filtered.length
        ]
      );
    },
    [player, filtered]
  );

  useEffect(() => {
    const handleKey = (event) => {
      if (event.key === "Escape") {
        setPlayer(null);
        setMenu(false);
        setSettings(false);
        setDeleteTarget(null);
      }

      if (player && event.key === "ArrowRight") movePlayer(1);
      if (player && event.key === "ArrowLeft") movePlayer(-1);
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [player, movePlayer]);

  const upload = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";

    if (!files.length) return;

    setUploading(true);
    let uploaded = 0;
    let skipped = 0;
    let failed = 0;

    try {
      for (const file of files) {
        if (
          !file.type.startsWith("video/") &&
          !/\.(mp4|mkv|avi|mov|webm|m4v|3gp|mpeg|mpg|ts)$/i.test(file.name)
        ) {
          failed++;
          continue;
        }

        const form = new FormData();
        form.append("file", file, file.name);

        try {
          const data = await request("/api/upload", {
            method: "POST",
            body: form,
          });

          data.skipped ? skipped++ : uploaded++;
        } catch (err) {
          failed++;
          console.error(`Upload failed for ${file.name}`, err);
        }
      }

      await loadVideos();
      if (settings) await loadStorage();

      toast(
        `Finished: ${uploaded} uploaded, ${skipped} skipped, ${failed} failed.`
      );
    } finally {
      setUploading(false);
    }
  };

  const deleteVideo = async () => {
    if (!deleteTarget) return;

    const video = deleteTarget;
    setDeleteTarget(null);

    try {
      await request(`/api/videos/${encodeURIComponent(video.key)}`, {
        method: "DELETE",
      });

      setVideos((old) => old.filter((item) => item.key !== video.key));
      setFavorites((old) => old.filter((key) => key !== video.key));

      if (player?.key === video.key) setPlayer(null);

      toast(`Deleted ${video.name}`);
      if (settings) await loadStorage();
    } catch (err) {
      toast(`Delete failed: ${err.message}`);
    }
  };

  const openSettings = async () => {
    setMenu(false);
    setSettings(true);
    await loadStorage();
  };

  const featured = videos[0];
  const playerIndex = player
    ? filtered.findIndex((video) => video.key === player.key)
    : -1;

  return (
    <div className="app-shell">
      <header className="topbar">
        <button
          className="brand brand-button"
          onClick={() => {
            setTab("all");
            setQuery("");
          }}
        >
          <span className="brand-mark">▶</span>
          <span>
            stream<span className="brand-light">box</span>
          </span>
        </button>

        <nav className="main-nav">
          <button
            className={`nav-link ${tab === "all" ? "active" : ""}`}
            onClick={() => setTab("all")}
          >
            Library
          </button>
          <button
            className={`nav-link ${tab === "favorites" ? "active" : ""}`}
            onClick={() => setTab("favorites")}
          >
            My List
          </button>
        </nav>

        <div className="header-actions">
          <label className="search-box">
            <span className="search-icon">⌕</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search..."
              aria-label="Search videos"
            />
            {query && (
              <button
                className="clear-search"
                onClick={() => setQuery("")}
              >
                ×
              </button>
            )}
          </label>

          <button
            className="menu-button"
            onClick={() => setMenu((value) => !value)}
            aria-label="Open menu"
            aria-expanded={menu}
          >
            ☰
          </button>
        </div>
      </header>

      {menu && (
        <>
          <button
            className="menu-backdrop"
            aria-label="Close menu"
            onClick={() => setMenu(false)}
          />
          <aside className="menu-panel">
            <div className="menu-panel-heading">
              STREAMBOX
              <button onClick={() => setMenu(false)}>×</button>
            </div>

            <button
              className="menu-action"
              onClick={() => {
                setMenu(false);
                picker.current?.click();
              }}
            >
              <span>＋</span>
              <span>
                <strong>Upload new video</strong>
                <small>Choose from Android media</small>
              </span>
            </button>

            <button className="menu-action" onClick={openSettings}>
              <span>⚙</span>
              <span>
                <strong>Settings</strong>
                <small>Cloud storage and library</small>
              </span>
            </button>

            <button
              className="menu-action"
              onClick={() => {
                setMenu(false);
                loadVideos();
              }}
            >
              <span>↻</span>
              <span>
                <strong>Refresh library</strong>
                <small>Sync your video list</small>
              </span>
            </button>
          </aside>
        </>
      )}

      <input
        ref={picker}
        className="visually-hidden"
        type="file"
        accept="video/*,.mkv,.avi,.mov,.webm,.m4v,.3gp"
        multiple
        onChange={upload}
      />

      <main>
        <section className="hero">
          <div className="hero-art">
            <div className="hero-orb orb-one" />
            <div className="hero-orb orb-two" />
            <div className="hero-grid" />
          </div>

          <div className="hero-content">
            <div className="eyebrow">
              <span className="live-dot" />
              YOUR PRIVATE STREAMING SPACE
            </div>

            <p className="hero-kicker">YOUR COLLECTION · ON YOUR TERMS</p>
            <h1>
              Your stories.
              <br />
              <span className="brand-light">Your StreamBox.</span>
            </h1>

            <p className="hero-description">
              Your personal video universe, ready whenever you are. Your
              favourites, in one private cloud library.
            </p>

            <div className="hero-meta">
              <span>{videos.length} VIDEOS</span>
              <span>•</span>
              <span>PRIVATE CLOUD LIBRARY</span>
            </div>

            <div className="hero-buttons">
              <button
                className="play-button"
                onClick={() =>
                  featured ? setPlayer(featured) : picker.current?.click()
                }
              >
                <span>▶</span>
                {featured ? "Play now" : "Upload first video"}
              </button>

              <button
                className="secondary-button"
                onClick={() =>
                  document
                    .getElementById("library")
                    ?.scrollIntoView({ behavior: "smooth" })
                }
              >
                Explore library <span>↓</span>
              </button>
            </div>
          </div>

          <div className="hero-bottom">STREAMBOX / YOUR COLLECTION</div>
        </section>

        <section className="library-section" id="library">
          <div className="section-heading">
            <div className="section-title-group">
              <div className="section-overline">
                {tab === "favorites" ? "YOUR PERSONAL PICKS" : "ALL YOUR VIDEOS"}
              </div>
              <h2>
                {tab === "favorites" ? "My List" : "Your Library"}{" "}
                <span className="count-pill">{filtered.length}</span>
              </h2>
            </div>

            <div className="library-actions">
              <button
                className="refresh-button"
                onClick={loadVideos}
                disabled={loading}
              >
                ↻ <span>Refresh</span>
              </button>
              <button
                className="upload-inline"
                onClick={() => picker.current?.click()}
                disabled={uploading}
              >
                {uploading ? "Uploading…" : "+ Upload"}
              </button>
            </div>
          </div>

          {uploading && (
            <div className="upload-progress">
              <span className="loader small-loader" />
              Uploading videos to your cloud library…
            </div>
          )}

          {loading ? (
            <div className="status-panel">
              <span className="loader" />
              <h3>Loading your library</h3>
              <p>Fetching videos from the cloud…</p>
            </div>
          ) : error ? (
            <div className="status-panel">
              <div className="status-symbol">!</div>
              <h3>Couldn't reach StreamBox</h3>
              <p>{error}</p>
              <button className="play-button retry-button" onClick={loadVideos}>
                Try again
              </button>
            </div>
          ) : filtered.length ? (
            <div className="video-grid">
              {filtered.map((video, index) => (
                <VideoCard
                  key={video.key}
                  video={video}
                  index={index}
                  favorite={favorites.includes(video.key)}
                  onPlay={setPlayer}
                  onFavorite={toggleFavorite}
                  onLongPress={setDeleteTarget}
                />
              ))}
            </div>
          ) : (
            <div className="status-panel">
              <div className="empty-icon">▧</div>
              <h3>
                {tab === "favorites"
                  ? "Nothing in My List yet"
                  : query
                    ? "No matching videos"
                    : "Your library is waiting"}
              </h3>
              <p>
                {query
                  ? "Try another title or clear your search."
                  : tab === "favorites"
                    ? "Tap a heart to save a video here."
                    : "Upload a video from the menu to start your private cinema."}
              </p>
              {!query && tab === "all" && (
                <button
                  className="play-button retry-button"
                  onClick={() => picker.current?.click()}
                >
                  ＋ Upload a video
                </button>
              )}
            </div>
          )}
        </section>
      </main>

      <footer className="app-footer">
        <span className="footer-brand">▶ STREAMBOX</span>
        <span>Your personal cinema. Your cloud.</span>
        <span>
          {videos.length} videos ·{" "}
          {fmt(videos.reduce((sum, video) => sum + (Number(video.size) || 0), 0))}
        </span>
      </footer>

      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}

      {settings && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSettings(false);
          }}
        >
          <section
            className="settings-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
          >
            <div className="modal-heading">
              <div>
                <p className="section-overline">YOUR PRIVATE CLOUD</p>
                <h2 id="settings-title">Settings</h2>
              </div>
              <button
                className="close-button"
                onClick={() => setSettings(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="storage-card">
              <div className="storage-card-title">
                <span className="storage-icon">☁</span>
                <div>
                  <strong>Neon object storage</strong>
                  <small>Bucket usage summary</small>
                </div>
              </div>

              {storageLoading ? (
                <div className="storage-loading">
                  <span className="loader small-loader" />
                  Checking storage…
                </div>
              ) : storage ? (
                <>
                  <div className="storage-metrics">
                    <div>
                      <small>Storage used</small>
                      <strong>{fmt(storage.used_bytes)}</strong>
                    </div>
                    <div>
                      <small>Videos</small>
                      <strong>{storage.video_count ?? videos.length}</strong>
                    </div>
                  </div>

                  {storage.quota_bytes ? (
                    <>
                      <div className="storage-bar">
                        <span
                          style={{
                            width: `${Math.min(
                              100,
                              (storage.used_bytes / storage.quota_bytes) * 100
                            )}%`,
                          }}
                        />
                      </div>
                      <div className="storage-foot">
                        <span>
                          {fmt(
                            Math.max(0, storage.quota_bytes - storage.used_bytes)
                          )}{" "}
                          remaining
                        </span>
                        <span>
                          {Math.min(
                            100,
                            (storage.used_bytes / storage.quota_bytes) * 100
                          ).toFixed(1)}
                          % used
                        </span>
                      </div>
                      <p className="storage-note">
                        Quota is configured as an estimate. Confirm your
                        official allowance in your Neon plan.
                      </p>
                    </>
                  ) : (
                    <p className="storage-note">
                      To estimate remaining free-tier capacity, configure
                      S3_FREE_TIER_GB in backend/.env. This is not a live Neon
                      billing meter.
                    </p>
                  )}
                </>
              ) : (
                <p className="storage-note">
                  Storage details are unavailable right now.
                </p>
              )}

              <button
                className="refresh-button storage-refresh"
                onClick={loadStorage}
                disabled={storageLoading}
              >
                ↻ Refresh storage
              </button>
            </div>

            <div className="settings-row">
              <span>
                <strong>Library contents</strong>
                <small>Videos listed in your bucket</small>
              </span>
              <strong>{videos.length} videos</strong>
            </div>

            <div className="settings-row">
              <span>
                <strong>Private library</strong>
                <small>Playback links are temporary signed URLs</small>
              </span>
              <span className="private-tag">PRIVATE</span>
            </div>
          </section>
        </div>
      )}

      {deleteTarget && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDeleteTarget(null);
          }}
        >
          <section
            className="confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-title"
          >
            <div className="delete-icon">⌫</div>
            <h2 id="delete-title">Delete this video?</h2>
            <p>
              <strong>{title(deleteTarget.name)}</strong> will be permanently
              deleted from your S3 bucket.
            </p>
            <div className="confirm-actions">
              <button
                className="secondary-button"
                onClick={() => setDeleteTarget(null)}
              >
                Cancel
              </button>
              <button className="delete-button" onClick={deleteVideo}>
                Delete video
              </button>
            </div>
          </section>
        </div>
      )}

      {player && (
        <div
          className="player-overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPlayer(null);
          }}
        >
          <section
            className="player-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Video player"
          >
            <div className="player-topbar">
              <div className="player-brand">
                <span className="brand-mark">▶</span>
                stream<span className="brand-light">box</span>
              </div>
              <span className="player-top-title">NOW PLAYING</span>
              <button
                className="close-player"
                onClick={() => setPlayer(null)}
                aria-label="Close player"
              >
                ×
              </button>
            </div>

            <div className="player-layout">
              <div className="player-main">
                <video
                  key={player.key}
                  className="video-player"
                  src={player.url}
                  controls
                  autoPlay
                  playsInline
                  onEnded={() => movePlayer(1)}
                />

                <div className="player-controls-row">
                  <div className="player-navigation">
                    <button
                      className="player-nav-button"
                      onClick={() => movePlayer(-1)}
                      disabled={filtered.length < 2}
                    >
                      ‹ Previous
                    </button>
                    <button
                      className="player-nav-button"
                      onClick={() => movePlayer(1)}
                      disabled={filtered.length < 2}
                    >
                      Next ›
                    </button>
                  </div>
                  <span className="player-counter">
                    {playerIndex >= 0 ? playerIndex + 1 : 1} /{" "}
                    {filtered.length || videos.length}
                  </span>
                </div>

                <div className="player-details">
                  <div>
                    <h2>{title(player.name)}</h2>
                    <p>
                      {player.name.split(".").pop()?.toUpperCase()} ·{" "}
                      {fmt(player.size)}
                    </p>
                  </div>
                  <button
                    className={`player-fav ${
                      favorites.includes(player.key) ? "favorited" : ""
                    }`}
                    onClick={() => toggleFavorite(player.key)}
                  >
                    {favorites.includes(player.key) ? "♥ Saved" : "♡ My List"}
                  </button>
                </div>
              </div>

              <aside className="playlist-panel">
                <div className="playlist-heading">
                  <h3>Up next</h3>
                  <span>{filtered.length} videos</span>
                </div>

                <div className="playlist-items">
                  {filtered.map((video, index) => (
                    <button
                      key={video.key}
                      className={`playlist-item ${
                        video.key === player.key ? "active" : ""
                      }`}
                      onClick={() => setPlayer(video)}
                    >
                      <span className="playlist-index">
                        {video.key === player.key
                          ? "▶"
                          : String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="playlist-item-info">
                        <span className="playlist-item-title">
                          {title(video.name)}
                        </span>
                        <span className="playlist-item-size">
                          {fmt(video.size)}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </aside>
            </div>

            <div className="player-bottom-bar">
              <span>STREAMBOX / YOUR COLLECTION</span>
              <span>← → navigate · Esc close</span>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
