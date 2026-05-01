import React, { useState, useRef, useEffect } from 'react';
import { Settings } from 'lucide-react';

function PlayerControls({ quality, speed, audioOnly, onQualityChange, onSpeedChange, onAudioToggle }) {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef(null);
  const btnRef = useRef(null);

  const qualities = ['144', '240', '360', '480', '720', '1080', '1440', '2160'];
  const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

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

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={() => setShowMenu(!showMenu)}
        className="breeze-btn flex items-center gap-2"
      >
        <Settings size={16} />
        Settings
      </button>

      {showMenu && (
        <div
          ref={menuRef}
          className="absolute bottom-full mb-2 left-0 breeze-card p-3 min-w-[200px] z-50"
          style={{ boxShadow: '0 -4px 20px rgba(0,0,0,0.4)' }}
        >
          <div className="mb-3">
            <label className="block text-sm font-medium mb-1.5">Quality</label>
            <select
              value={quality}
              onChange={(e) => { onQualityChange(e.target.value); setShowMenu(false); }}
              className="breeze-input w-full text-sm"
            >
              {qualities.map(q => (
                <option key={q} value={q}>{q}p</option>
              ))}
            </select>
          </div>

          <div className="mb-3">
            <label className="block text-sm font-medium mb-1.5">Speed</label>
            <select
              value={speed}
              onChange={(e) => onSpeedChange(parseFloat(e.target.value))}
              className="breeze-input w-full text-sm"
            >
              {speeds.map(s => (
                <option key={s} value={s}>{s}x</option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={audioOnly}
              onChange={(e) => { onAudioToggle(e.target.checked); setShowMenu(false); }}
              className="w-4 h-4 accent-[var(--accent)]"
            />
            <span className="text-sm">Audio Only</span>
          </label>
        </div>
      )}
    </div>
  );
}

export default PlayerControls;
