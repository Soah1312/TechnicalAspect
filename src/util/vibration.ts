export const Vibration = {
  countdownTick(): void {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(40);
      } catch {
        // Ignore devices where vibrate is restricted
      }
    }
  },

  countdownGo(): void {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate([80, 50, 150]);
      } catch {
        // Ignore
      }
    }
  },

  correct(): void {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate([50, 40, 100]);
      } catch {
        // Ignore
      }
    }
  },

  wrong(): void {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate([200, 100, 200]);
      } catch {
        // Ignore
      }
    }
  },

  lap(): void {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate([100, 50, 100]);
      } catch {
        // Ignore
      }
    }
  },
};
