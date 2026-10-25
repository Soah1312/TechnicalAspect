/**
 * High-performance, crisp inline SVG icons for Crescendo Fuel Rush.
 * Replaces system emojis with consistent retro-futuristic arcade vector icons.
 */

export const ICONS = {
  // Trophy icon (for leaderboards and championships)
  trophy: (size = 16, color = 'currentColor') => `
    <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="pixel-icon" aria-hidden="true">
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/>
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/>
      <path d="M4 4h16v6a6 6 0 0 1-6 6h-4a6 6 0 0 1-6-6V4z"/>
      <path d="M12 16v4"/>
      <path d="M8 20h8"/>
    </svg>
  `.trim(),

  // Gamepad / Play icon
  gamepad: (size = 16, color = 'currentColor') => `
    <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="pixel-icon" aria-hidden="true">
      <rect x="2" y="6" width="20" height="12" rx="4"/>
      <path d="M6 12h4"/>
      <path d="M8 10v4"/>
      <circle cx="15.5" cy="12" r="1" fill="${color}"/>
      <circle cx="18" cy="10" r="1" fill="${color}"/>
    </svg>
  `.trim(),

  // Crown icon for 1st place podium champion
  crown: (size = 22, color = '#ffd700') => `
    <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${color}" stroke="#0b0b1e" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="pixel-icon" aria-hidden="true">
      <path d="M2 4l3 12h14l3-12-5 6-5-8-5 8-5-6z"/>
      <path d="M5 16h14v2H5z"/>
    </svg>
  `.trim(),

  // Medal icon for podium positions (1 = gold, 2 = silver, 3 = bronze)
  medal: (rank: 1 | 2 | 3, size = 18) => {
    const colors = {
      1: { ribbon: '#ff2e4d', metal: '#ffd700', stroke: '#c29d00' },
      2: { ribbon: '#00e5ff', metal: '#e2e8f0', stroke: '#94a3b8' },
      3: { ribbon: '#ff9100', metal: '#cd7f32', stroke: '#9c5a1c' },
    }[rank];

    return `
      <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" class="pixel-icon" aria-hidden="true">
        <path d="M8 2l4 6 4-6" stroke="${colors.ribbon}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="12" cy="14" r="6" fill="${colors.metal}" stroke="${colors.stroke}" stroke-width="1.5"/>
        <text x="12" y="16.5" font-family="'Press Start 2P', monospace" font-size="6" font-weight="bold" fill="#0b0b1e" text-anchor="middle">${rank}</text>
      </svg>
    `.trim();
  },

  // Finish / Checkered Flag icon (for laps)
  flag: (size = 14, color = 'currentColor') => `
    <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="pixel-icon" aria-hidden="true">
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
      <line x1="4" y1="22" x2="4" y2="15"/>
    </svg>
  `.trim(),

  // Target / Bullseye icon (for quiz answers)
  target: (size = 14, color = 'currentColor') => `
    <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="pixel-icon" aria-hidden="true">
      <circle cx="12" cy="12" r="9"/>
      <circle cx="12" cy="12" r="5"/>
      <circle cx="12" cy="12" r="1" fill="${color}"/>
    </svg>
  `.trim(),

  // Search magnifying glass
  search: (size = 16, color = 'currentColor') => `
    <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="pixel-icon" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5"/>
      <line x1="15.5" y1="15.5" x2="20" y2="20"/>
    </svg>
  `.trim(),

  // Alert / Warning triangle
  warning: (size = 16, color = '#ff2e4d') => `
    <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="pixel-icon" aria-hidden="true">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/>
      <line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  `.trim(),

  // Lightning bolt / Speed / Power icon
  bolt: (size = 14, color = '#ffd400') => `
    <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${color}" stroke="${color}" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="pixel-icon" aria-hidden="true">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
    </svg>
  `.trim(),

  // Sound / Volume ON icon
  volumeOn: (size = 16, color = 'currentColor') => `
    <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="pixel-icon" aria-hidden="true">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="${color}"/>
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
    </svg>
  `.trim(),

  // Sound / Volume MUTE icon
  volumeMute: (size = 16, color = 'currentColor') => `
    <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="pixel-icon" aria-hidden="true">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="${color}"/>
      <line x1="22" y1="9" x2="16" y2="15"/>
      <line x1="16" y1="9" x2="22" y2="15"/>
    </svg>
  `.trim(),

  // Arrow up (for scroll to top / scroll to me)
  arrowUp: (size = 14, color = 'currentColor') => `
    <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="pixel-icon" aria-hidden="true">
      <line x1="12" y1="19" x2="12" y2="5"/>
      <polyline points="5 12 12 5 19 12"/>
    </svg>
  `.trim(),

  // Close X icon
  close: (size = 14, color = 'currentColor') => `
    <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="pixel-icon" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18"/>
      <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  `.trim(),

  // Checkmark icon
  check: (size = 14, color = '#39ff14') => `
    <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="pixel-icon" aria-hidden="true">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  `.trim(),

  // Racing Car silhouette icon
  car: (size = 18, color = 'currentColor') => `
    <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="pixel-icon" aria-hidden="true">
      <path d="M5 17h14"/>
      <path d="M19 17v-4a2 2 0 0 0-1-1.73l-3-2a2 2 0 0 0-1.07-.27H9.07a2 2 0 0 0-1.07.27l-3 2A2 2 0 0 0 4 13v4"/>
      <circle cx="7.5" cy="17.5" r="2.5" fill="${color}"/>
      <circle cx="16.5" cy="17.5" r="2.5" fill="${color}"/>
    </svg>
  `.trim(),

  // Fuel pump / canister icon
  fuel: (size = 18, color = 'currentColor') => `
    <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="pixel-icon" aria-hidden="true">
      <rect x="3" y="4" width="10" height="16" rx="2"/>
      <line x1="3" y1="10" x2="13" y2="10"/>
      <path d="M13 8h2a2 2 0 0 1 2 2v7a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V9.5L19 7"/>
    </svg>
  `.trim(),

  // Lightbulb / quiz trivia icon
  lightbulb: (size = 18, color = '#ffd400') => `
    <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="pixel-icon" aria-hidden="true">
      <path d="M9 18h6"/>
      <path d="M10 22h4"/>
      <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5.76.76 1.23 1.52 1.41 2.5h6.18z"/>
    </svg>
  `.trim(),

  // Phone Rotate to Portrait icon
  phoneRotate: (size = 40, color = 'var(--accent-yellow)') => `
    <svg width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="pixel-icon" aria-hidden="true">
      <rect x="14" y="6" width="20" height="36" rx="4"/>
      <line x1="22" y1="36" x2="26" y2="36"/>
      <path d="M8 20a16 16 0 0 1 28-8"/>
      <polyline points="36 6 36 12 30 12"/>
    </svg>
  `.trim(),
};
