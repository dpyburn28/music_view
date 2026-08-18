/**
 * Per-container audio routing for viz / ARTEF4KT panels.
 * Analysis still runs in Music; Display reads each container.audioInput.
 * Node-requireable.
 */
(function (root) {
  'use strict';

  const AUDIO_INPUT_ROLES = ['audio-scope', 'audio-history', 'audio-beat', 'artef4kt'];

  const CHANNELS = [
    { id: 'full', label: 'Full mix', kind: 'wave', hz: null, hint: 'Unfiltered mix (L+R mid)' },
    { id: 'bass', label: 'Bass', kind: 'wave', hz: '20–150 Hz', hint: 'Kick / sub / bass body' },
    { id: 'lowmid', label: 'Low-mid', kind: 'wave', hz: '150–500 Hz', hint: 'Warmth, body' },
    { id: 'mid', label: 'Mid', kind: 'wave', hz: '500 Hz–2 kHz', hint: 'Instruments, lower voice' },
    { id: 'presence', label: 'Presence', kind: 'wave', hz: '2–5 kHz', hint: 'Clarity, consonants' },
    { id: 'treble', label: 'Treble', kind: 'wave', hz: '5 kHz+', hint: 'Hats, air, sibilance' },
    { id: 'center', label: 'Center (M-S)', kind: 'wave', hz: 'stereo mid', hint: 'Stereo center — lead vox often here' },
    { id: 'vocals', label: 'Vocals (center+band)', kind: 'wave', hz: 'center · 200 Hz–4 kHz', hint: 'Mid–side extract + vocal band. Not ML stems.' },
    { id: 'rms', label: 'RMS', kind: 'level', hint: 'Overall loudness' },
    { id: 'peak', label: 'Peak', kind: 'level', hint: 'Instant peak amplitude' },
    { id: 'envelope', label: 'Envelope', kind: 'level', hint: 'Smoothed energy follower' },
    { id: 'onset', label: 'Onset / flux', kind: 'level', hint: 'Transient / spectral flux' },
    { id: 'kick', label: 'Kick onset', kind: 'level', hint: 'Low-band flux (kick hits)' },
    { id: 'beat', label: 'Beat pulse', kind: 'level', hint: 'Peak-picked beat impulse' },
  ];

  const CHANNEL_IDS = CHANNELS.map((c) => c.id);

  function isChannelId(id) {
    return typeof id === 'string' && CHANNEL_IDS.indexOf(id) >= 0;
  }

  function isAudioInputRole(role) {
    return typeof role === 'string' && AUDIO_INPUT_ROLES.indexOf(role) >= 0;
  }

  function clampGain(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 1;
    if (n < 0) return 0;
    if (n > 4) return 4;
    return n;
  }

  function defaultAudioInput(role) {
    switch (role) {
      case 'audio-scope':
        return { source: 'full', gain: 1, continuous: true };
      case 'audio-history':
        return { source: 'envelope', gain: 1, continuous: true };
      case 'audio-beat':
        return { source: 'beat', envelope: 'envelope', bass: 'bass', gain: 1, continuous: true };
      case 'artef4kt':
        return {
          source: 'beat',
          envelope: 'envelope',
          bass: 'bass',
          mid: 'mid',
          high: 'treble',
          gain: 1,
          continuous: true,
        };
      default:
        return null;
    }
  }

  function pickChannel(raw, fallback) {
    return isChannelId(raw) ? raw : fallback;
  }

  /**
   * Normalize a stored/live audioInput for a role. Unknown roles → null.
   * @param {object|null} raw
   * @param {string|null} role
   */
  function sanitizeAudioInput(raw, role) {
    if (!isAudioInputRole(role)) return null;
    const def = defaultAudioInput(role);
    const src = raw && typeof raw === 'object' ? raw : {};
    const out = {
      source: pickChannel(src.source, def.source),
      gain: clampGain(src.gain != null ? src.gain : def.gain),
      continuous: !(src.continuous === false || src.continuous === 0 || src.continuous === 'false'),
    };
    if ('envelope' in def) out.envelope = pickChannel(src.envelope, def.envelope);
    if ('bass' in def) out.bass = pickChannel(src.bass, def.bass);
    if ('mid' in def) out.mid = pickChannel(src.mid, def.mid);
    if ('high' in def) out.high = pickChannel(src.high, def.high);
    return out;
  }

  function sourceLabel(role) {
    if (role === 'audio-scope') return 'Wave / signal';
    if (role === 'audio-history') return 'History channel';
    if (role === 'audio-beat' || role === 'artef4kt') return 'Beat';
    return 'Source';
  }

  const api = {
    AUDIO_INPUT_ROLES,
    CHANNELS,
    CHANNEL_IDS,
    isChannelId,
    isAudioInputRole,
    defaultAudioInput,
    sanitizeAudioInput,
    sourceLabel,
    clampGain,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof root !== 'undefined') {
    root.AudioInput = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
