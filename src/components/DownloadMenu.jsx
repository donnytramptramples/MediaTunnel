import React, { useState, useRef, useEffect } from 'react';
import { Download, Video, Music, Disc3, Headphones, FileAudio } from 'lucide-react';
import { useDownload } from '../DownloadContext';

function DownloadMenu({ videoId, quality, title }) {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef(null);
  const btnRef = useRef(null);
  const { startDownload } = useDownload();

  const formats = [
    { value: 'mp4', label: 'MP4 (Video)', Icon: Video },
    { value: 'mp3', label: 'MP3 (320kbps)', Icon: Music },
    { value: 'flac', label: 'FLAC (Lossless)', Icon: Disc3 },
    { value: 'opus', label: 'Opus', Icon: Headphones },
    { value: 'ogg', label: 'Ogg Vorbis', Icon: FileAudio },
  ];

  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target) &&
          btnRef.current && !btnRef.current.contains(e.target)) {
        setShowMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleDownload = (format) => {
    setShowMenu(false);
    startDownload({ videoId, format, quality: quality || '720', title: title || 'video' });
  };

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={() => setShowMenu(!showMenu)}
        className="breeze-btn flex items-center gap-2"
      >
        <Download size={16} />
        Download
      </button>

      {showMenu && (
        <div
          ref={menuRef}
          className="absolute bottom-full mb-2 left-0 breeze-card p-2 min-w-[200px] z-50"
          style={{ boxShadow: '0 -4px 20px rgba(0,0,0,0.4)' }}
        >
          {formats.map(({ value, label, Icon }) => (
            <button
              key={value}
              onClick={() => handleDownload(value)}
              className="w-full flex items-center gap-3 px-3 py-2 hover:bg-[var(--bg-primary)] rounded transition-colors text-left"
            >
              <Icon size={16} className="text-[var(--accent)] flex-shrink-0" />
              <span className="text-sm">{label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default DownloadMenu;
