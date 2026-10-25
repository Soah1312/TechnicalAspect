import './style.css';
import { activeApi } from './api';
import { renderLeaderboardPage } from './ui/screens/LeaderboardPage';
import { networkMonitor } from './util/network';
import { sounds } from './audio/soundManager';
import { analytics } from './util/analytics';

async function bootstrapLeaderboard() {
  // Initialize Vercel Analytics
  analytics.init();
  analytics.trackLeaderboardView();

  const uiContainer = document.getElementById('ui-container');
  const appContainer = document.getElementById('app') || document.body;

  const targetContainer = uiContainer || appContainer;

  // Viewport Height Guard
  const updateViewportHeight = () => {
    const vh = window.innerHeight;
    document.documentElement.style.setProperty('--app-height', `${vh}px`);
  };
  window.addEventListener('resize', updateViewportHeight, { passive: true });
  window.addEventListener('orientationchange', updateViewportHeight, { passive: true });
  updateViewportHeight();

  // Network Status Banner
  networkMonitor.mountBanner(appContainer);

  // Audio unlock on click
  const unlockAudio = () => {
    sounds.unlock();
    window.removeEventListener('pointerdown', unlockAudio);
    window.removeEventListener('keydown', unlockAudio);
  };
  window.addEventListener('pointerdown', unlockAudio, { passive: true });
  window.addEventListener('keydown', unlockAudio, { passive: true });

  // Render the Dedicated Full Leaderboard Page
  renderLeaderboardPage(targetContainer, activeApi);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrapLeaderboard);
} else {
  bootstrapLeaderboard();
}
