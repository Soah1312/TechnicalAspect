import { DEBUG_CONFIG } from '../config/constants';

const KEYS = {
  PLAYER_ID: 'cfr_player_id',
  PLAYER_NAME: 'cfr_player_name',
  TUTORIAL_SEEN: 'cfr_tutorial_seen',
  AUDIO_MUTED: 'cfr_audio_muted',
};

// Handle force reset query
if (typeof window !== 'undefined' && DEBUG_CONFIG.forceReset) {
  try {
    localStorage.removeItem(KEYS.PLAYER_ID);
    localStorage.removeItem(KEYS.PLAYER_NAME);
    localStorage.removeItem(KEYS.AUDIO_MUTED);
    sessionStorage.removeItem(KEYS.TUTORIAL_SEEN);
  } catch (err) {
    console.error('Failed to reset storage:', err);
  }
}

export const Storage = {
  getPlayer(): { playerId: string; name: string } | null {
    try {
      if (typeof localStorage === 'undefined') return null;
      const id = localStorage.getItem(KEYS.PLAYER_ID);
      const name = localStorage.getItem(KEYS.PLAYER_NAME);
      if (id && name) {
        return { playerId: id, name };
      }
    } catch {
      // Ignore storage access errors
    }
    return null;
  },

  setPlayer(playerId: string, name: string): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(KEYS.PLAYER_ID, playerId);
      localStorage.setItem(KEYS.PLAYER_NAME, name);
    } catch {
      // Ignore
    }
  },

  isTutorialSeen(): boolean {
    try {
      if (typeof sessionStorage === 'undefined') return false;
      return sessionStorage.getItem(KEYS.TUTORIAL_SEEN) === 'true';
    } catch {
      return false;
    }
  },

  setTutorialSeen(): void {
    try {
      if (typeof sessionStorage === 'undefined') return;
      sessionStorage.setItem(KEYS.TUTORIAL_SEEN, 'true');
    } catch {
      // Ignore
    }
  },

  isMuted(): boolean {
    try {
      return localStorage.getItem(KEYS.AUDIO_MUTED) === 'true';
    } catch {
      return false;
    }
  },

  setMuted(muted: boolean): void {
    try {
      localStorage.setItem(KEYS.AUDIO_MUTED, muted ? 'true' : 'false');
    } catch (err) {
      console.warn('Could not persist mute setting:', err);
    }
  },

  clearPlayer(): void {
    try {
      localStorage.removeItem(KEYS.PLAYER_ID);
      localStorage.removeItem(KEYS.PLAYER_NAME);
    } catch {
      // Ignore
    }
  },
};
