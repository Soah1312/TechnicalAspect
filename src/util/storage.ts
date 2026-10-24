import { DEBUG_CONFIG } from '../config/constants';

const KEYS = {
  PLAYER_ID: 'cfr_player_id',
  PLAYER_NAME: 'cfr_player_name',
  PLAYER_YEAR: 'cfr_player_year',
  PLAYER_BRANCH: 'cfr_player_branch',
  TUTORIAL_SEEN: 'cfr_tutorial_seen',
  AUDIO_MUTED: 'cfr_audio_muted',
};

// Handle force reset query
if (typeof window !== 'undefined' && DEBUG_CONFIG.forceReset) {
  try {
    localStorage.removeItem(KEYS.PLAYER_ID);
    localStorage.removeItem(KEYS.PLAYER_NAME);
    localStorage.removeItem(KEYS.PLAYER_YEAR);
    localStorage.removeItem(KEYS.PLAYER_BRANCH);
    localStorage.removeItem(KEYS.AUDIO_MUTED);
    sessionStorage.removeItem(KEYS.TUTORIAL_SEEN);
  } catch (err) {
    console.error('Failed to reset storage:', err);
  }
}

export const Storage = {
  getPlayer(): { playerId: string; name: string; year?: string; branch?: string } | null {
    try {
      if (typeof localStorage === 'undefined') return null;
      const id = localStorage.getItem(KEYS.PLAYER_ID);
      const name = localStorage.getItem(KEYS.PLAYER_NAME);
      const year = localStorage.getItem(KEYS.PLAYER_YEAR) || undefined;
      const branch = localStorage.getItem(KEYS.PLAYER_BRANCH) || undefined;
      if (id && name) {
        return { playerId: id, name, year, branch };
      }
    } catch {
      // Ignore storage access errors
    }
    return null;
  },

  setPlayer(playerId: string, name: string, year?: string, branch?: string): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(KEYS.PLAYER_ID, playerId);
      localStorage.setItem(KEYS.PLAYER_NAME, name);
      if (year) {
        localStorage.setItem(KEYS.PLAYER_YEAR, year);
      }
      if (branch) {
        localStorage.setItem(KEYS.PLAYER_BRANCH, branch);
      }
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
      localStorage.removeItem(KEYS.PLAYER_YEAR);
      localStorage.removeItem(KEYS.PLAYER_BRANCH);
    } catch {
      // Ignore
    }
  },
};
