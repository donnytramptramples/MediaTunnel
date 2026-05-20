import React, { useState, useEffect } from 'react';
import { X, Sliders, TrendingUp, Rss, Save, RefreshCw, Lock, Trash2, Eye, EyeOff, Cpu, ChevronRight, Home, Zap, Tv, Gamepad2 } from 'lucide-react';

const PLATFORM_CHOICES = [
  { value: '', label: 'Always show home (chooser)', icon: Home },
  { value: 'feed', label: 'YouTube Feed', icon: Rss },
  { value: 'shorts', label: 'Shorts', icon: Zap },
  { value: 'bilibili', label: 'Bilibili', icon: Tv },
  { value: 'twitch', label: 'Twitch', icon: Gamepad2 },
];

function Toggle({ checked, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${checked ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'}`}
    >
      <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}

export default function FeedSettingsModal({ onClose, onSaved, user, onLogout }) {
  const [tab, setTab] = useState('feed');
  const [prefs, setPrefs] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  // Change password state
  const [cpCurrent, setCpCurrent] = useState('');
  const [cpNew, setCpNew] = useState('');
  const [cpConfirm, setCpConfirm] = useState('');
  const [cpShow, setCpShow] = useState(false);
  const [cpMsg, setCpMsg] = useState('');
  const [cpSaving, setCpSaving] = useState(false);

  // Delete account state
  const [delPass, setDelPass] = useState('');
  const [delConfirm, setDelConfirm] = useState(false);
  const [delMsg, setDelMsg] = useState('');
  const [delSaving, setDelSaving] = useState(false);

  useEffect(() => {
    fetch('/api/preferences', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setPrefs({ use_algorithm: true, subscriptions_weight: 1.0, trending_weight: 0.5, show_trending: true, default_platform: '', ...(d.preferences || {}) }))
      .catch(() => setPrefs({ use_algorithm: true, subscriptions_weight: 1.0, trending_weight: 0.5, show_trending: true, default_platform: '' }))
      .finally(() => setLoading(false));
  }, []);

  const handleSaveFeed = async () => {
    setSaving(true); setMsg('');
    try {
      const r = await fetch('/api/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscriptions_weight: prefs.subscriptions_weight,
          trending_weight: prefs.trending_weight,
          show_trending: prefs.show_trending,
          use_algorithm: prefs.use_algorithm,
          default_platform: prefs.default_platform || '',
        }),
        credentials: 'include',
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setMsg('Saved! Reload your feed to see changes.');
      if (onSaved) onSaved(data.preferences);
    } catch (e) {
      setMsg('Error: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (cpNew !== cpConfirm) { setCpMsg('Passwords do not match'); return; }
    setCpSaving(true); setCpMsg('');
    try {
      const r = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: cpCurrent, newPassword: cpNew }),
        credentials: 'include',
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setCpMsg('Password changed successfully!');
      setCpCurrent(''); setCpNew(''); setCpConfirm('');
    } catch (e) {
      setCpMsg('Error: ' + e.message);
    } finally {
      setCpSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!delConfirm) { setDelConfirm(true); return; }
    setDelSaving(true); setDelMsg('');
    try {
      const r = await fetch('/api/auth/delete-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: delPass }),
        credentials: 'include',
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      if (onLogout) onLogout();
    } catch (e) {
      setDelMsg('Error: ' + e.message);
      setDelSaving(false);
    }
  };

  const setWeight = (key, val) => setPrefs(p => ({ ...p, [key]: parseFloat(val) }));

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
        <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-2xl p-8 w-full max-w-lg">
          <div className="flex items-center justify-center">
            <RefreshCw size={24} className="animate-spin text-[var(--accent)]" />
          </div>
        </div>
      </div>
    );
  }

  const tabs = [
    { id: 'feed', label: 'Feed', icon: <Sliders size={14} /> },
    { id: 'account', label: 'Account', icon: <Lock size={14} /> },
  ];

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 pb-0 flex-shrink-0">
          <h2 className="text-lg font-bold text-[var(--text-primary)]">Settings</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--bg-primary)] text-[var(--text-secondary)] transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-6 pt-4 pb-0 flex-shrink-0">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === t.id
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]'
              }`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        <div className="overflow-y-auto flex-1 p-6 pt-5">

          {/* ── Feed tab ─────────────────────────────────────────────────── */}
          {tab === 'feed' && (
            <div className="space-y-5">
              {/* Default platform selector */}
              <div className="p-4 rounded-xl bg-[var(--bg-primary)] border border-[var(--border)]">
                <div className="flex items-center gap-2 mb-1">
                  <Home size={15} className="text-[var(--accent)]" />
                  <p className="font-medium text-[var(--text-primary)]">Default Platform</p>
                </div>
                <p className="text-xs text-[var(--text-secondary)] mb-3">
                  Where MediaTunnel opens after you log in. Pick "Always show home" to keep the platform-chooser landing page.
                </p>
                <div className="grid grid-cols-1 gap-1.5">
                  {PLATFORM_CHOICES.map(opt => {
                    const Icon = opt.icon;
                    const selected = (prefs?.default_platform || '') === opt.value;
                    return (
                      <button
                        key={opt.value || 'home'}
                        type="button"
                        onClick={() => setPrefs(p => ({ ...p, default_platform: opt.value }))}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors text-left ${
                          selected
                            ? 'bg-[var(--accent)]/15 border border-[var(--accent)]/40 text-[var(--text-primary)]'
                            : 'bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)]/40 hover:text-[var(--text-primary)]'
                        }`}
                      >
                        <Icon size={14} className={selected ? 'text-[var(--accent)]' : ''} />
                        <span className="flex-1">{opt.label}</span>
                        {selected && <span className="text-[10px] uppercase tracking-wider text-[var(--accent)]">Selected</span>}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Algorithm toggle */}
              <div className="flex items-center justify-between p-4 rounded-xl bg-[var(--bg-primary)] border border-[var(--border)]">
                <div>
                  <div className="flex items-center gap-2">
                    <Cpu size={15} className="text-[var(--accent)]" />
                    <p className="font-medium text-[var(--text-primary)]">Smart Algorithm</p>
                  </div>
                  <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                    {prefs?.use_algorithm ? 'Scores videos by recency, popularity, and your preferences' : 'Shows subscription videos in chronological order only'}
                  </p>
                </div>
                <Toggle checked={!!prefs?.use_algorithm} onChange={v => setPrefs(p => ({ ...p, use_algorithm: v }))} />
              </div>

              {/* Sliders — only shown when algorithm is on */}
              {prefs?.use_algorithm && (
                <>
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Rss size={15} className="text-[var(--accent)]" />
                      <span className="font-medium text-[var(--text-primary)]">Subscription Weight</span>
                      <span className="ml-auto text-sm font-mono text-[var(--accent)]">
                        {(prefs?.subscriptions_weight ?? 1).toFixed(1)}x
                      </span>
                    </div>
                    <input type="range" min="0" max="2" step="0.1" value={prefs?.subscriptions_weight ?? 1}
                      onChange={e => setWeight('subscriptions_weight', e.target.value)}
                      className="w-full accent-[var(--accent)] cursor-pointer" />
                    <div className="flex justify-between text-xs text-[var(--text-secondary)] mt-1">
                      <span>Off</span><span>Normal</span><span>Max</span>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <TrendingUp size={15} className="text-[var(--accent)]" />
                      <span className="font-medium text-[var(--text-primary)]">Trending Weight</span>
                      <span className="ml-auto text-sm font-mono text-[var(--accent)]">
                        {(prefs?.trending_weight ?? 0.5).toFixed(1)}x
                      </span>
                    </div>
                    <input type="range" min="0" max="2" step="0.1" value={prefs?.trending_weight ?? 0.5}
                      onChange={e => setWeight('trending_weight', e.target.value)}
                      className="w-full accent-[var(--accent)] cursor-pointer" />
                    <div className="flex justify-between text-xs text-[var(--text-secondary)] mt-1">
                      <span>Off</span><span>Normal</span><span>Max</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-4 rounded-xl bg-[var(--bg-primary)] border border-[var(--border)]">
                    <div>
                      <p className="font-medium text-[var(--text-primary)]">Show Trending</p>
                      <p className="text-xs text-[var(--text-secondary)] mt-0.5">Include trending content in your feed</p>
                    </div>
                    <Toggle checked={!!prefs?.show_trending} onChange={v => setPrefs(p => ({ ...p, show_trending: v }))} />
                  </div>
                </>
              )}

              {msg && (
                <p className={`text-sm rounded-lg px-3 py-2 ${msg.startsWith('Error') ? 'text-red-400 bg-red-500/10 border border-red-500/20' : 'text-green-400 bg-green-500/10 border border-green-500/20'}`}>
                  {msg}
                </p>
              )}

              <div className="flex gap-3 pt-1">
                <button onClick={onClose}
                  className="flex-1 py-2.5 rounded-xl bg-[var(--bg-primary)] hover:bg-[var(--border)] text-[var(--text-secondary)] text-sm font-medium transition-colors border border-[var(--border)]">
                  Cancel
                </button>
                <button onClick={handleSaveFeed} disabled={saving}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[var(--accent)] hover:opacity-90 text-white text-sm font-medium transition-opacity disabled:opacity-60">
                  <Save size={15} />
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </div>
          )}

          {/* ── Account tab ──────────────────────────────────────────────── */}
          {tab === 'account' && (
            <div className="space-y-6">
              {/* Change password */}
              <div>
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <Lock size={15} className="text-[var(--accent)]" /> Change Password
                </h3>
                <form onSubmit={handleChangePassword} className="space-y-3">
                  <div className="relative">
                    <input
                      type={cpShow ? 'text' : 'password'}
                      value={cpCurrent}
                      onChange={e => setCpCurrent(e.target.value)}
                      placeholder="Current password"
                      className="w-full breeze-input pr-10"
                      required
                    />
                    <button type="button" onClick={() => setCpShow(s => !s)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]">
                      {cpShow ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  <input type={cpShow ? 'text' : 'password'} value={cpNew}
                    onChange={e => setCpNew(e.target.value)}
                    placeholder="New password (min 6 chars)"
                    className="w-full breeze-input" required />
                  <input type={cpShow ? 'text' : 'password'} value={cpConfirm}
                    onChange={e => setCpConfirm(e.target.value)}
                    placeholder="Confirm new password"
                    className="w-full breeze-input" required />

                  {cpMsg && (
                    <p className={`text-sm rounded-lg px-3 py-2 ${cpMsg.startsWith('Error') || cpMsg.includes('match') ? 'text-red-400 bg-red-500/10 border border-red-500/20' : 'text-green-400 bg-green-500/10 border border-green-500/20'}`}>
                      {cpMsg}
                    </p>
                  )}

                  <button type="submit" disabled={cpSaving}
                    className="w-full py-2.5 rounded-xl bg-[var(--accent)] hover:opacity-90 text-white text-sm font-medium disabled:opacity-60 transition-opacity">
                    {cpSaving ? 'Changing…' : 'Change Password'}
                  </button>
                </form>
              </div>

              <hr className="border-[var(--border)]" />

              {/* Delete account */}
              <div>
                <h3 className="font-semibold mb-1 flex items-center gap-2 text-red-400">
                  <Trash2 size={15} /> Delete Account
                </h3>
                <p className="text-xs text-[var(--text-secondary)] mb-3">
                  Permanently deletes your account, watch history, subscriptions, and all saved data. This cannot be undone.
                </p>

                {!delConfirm ? (
                  <button
                    onClick={() => setDelConfirm(true)}
                    className="w-full py-2.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 text-sm font-medium transition-colors"
                  >
                    Delete My Account
                  </button>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-red-400 font-medium">Confirm by entering your password:</p>
                    <input type="password" value={delPass} onChange={e => setDelPass(e.target.value)}
                      placeholder="Your password"
                      className="w-full breeze-input border-red-500/40 focus:border-red-500" />

                    {delMsg && (
                      <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{delMsg}</p>
                    )}

                    <div className="flex gap-3">
                      <button onClick={() => { setDelConfirm(false); setDelPass(''); setDelMsg(''); }}
                        className="flex-1 py-2.5 rounded-xl bg-[var(--bg-primary)] hover:bg-[var(--border)] text-[var(--text-secondary)] text-sm font-medium border border-[var(--border)] transition-colors">
                        Cancel
                      </button>
                      <button onClick={handleDeleteAccount} disabled={delSaving || !delPass}
                        className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-medium disabled:opacity-60 transition-colors">
                        {delSaving ? 'Deleting…' : 'Confirm Delete'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
