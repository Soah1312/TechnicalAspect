import { escapeHtml } from '../../util/html';
import type { GameApi, LeaderboardRow, Branch, Year } from '../../api/types';
import { Storage } from '../../util/storage';
import { sounds } from '../../audio/soundManager';

const BRANCHES: Branch[] = ['COMPS', 'CSE', 'ECS', 'MECH', 'AIDS'];
const YEARS: Year[] = [1, 2, 3, 4];

export function calculateScore(laps: number, correct: number): number {
  return Math.max(0, laps * 1000 + correct * 100);
}

export function formatYear(year?: number | Year): string {
  if (!year) return '1st';
  if (year === 1) return '1st (FE)';
  if (year === 2) return '2nd (SE)';
  if (year === 3) return '3rd (TE)';
  if (year === 4) return '4th (BE)';
  return `${year}th`;
}

export function formatYearShort(year?: number | Year): string {
  if (!year) return 'FE';
  if (year === 1) return 'FE';
  if (year === 2) return 'SE';
  if (year === 3) return 'TE';
  if (year === 4) return 'BE';
  return `Y${year}`;
}

export function renderLeaderboardPage(
  container: HTMLElement,
  api: GameApi
): () => void {
  document.body.classList.add('leaderboard-page-mode');

  let disposed = false;
  let allRows: LeaderboardRow[] = [];
  let meRow: LeaderboardRow | null = null;
  let totalPlayersCount = 0;
  let isStaleData = false;
  let isFetching = false;

  let selectedBranch: Branch | 'ALL' = 'ALL';
  let selectedYear: Year | 'ALL' = 'ALL';
  let searchQuery = '';
  let sortBy: 'SCORE' | 'LAPS' | 'CORRECT' = 'SCORE';

  const REFRESH_INTERVAL_SEC = 10;
  let countdownSec = REFRESH_INTERVAL_SEC;
  let countdownInterval: number | null = null;
  let pollInterval: number | null = null;

  const storedPlayer = Storage.getPlayer();

  // Root shell
  container.innerHTML = `
    <div class="lb-page-wrapper">
      <!-- Header -->
      <header class="lb-page-header">
        <div class="lb-title-group">
          <h1 class="lb-page-title">
            🏆 CRESCENDO FUEL RUSH
          </h1>
          <div class="lb-page-subtitle">
            <span>OFFICIAL FLASHMOB STANDINGS</span>
            <div id="lb-live-indicator" class="lb-live-pulse-badge">
              <span class="lb-live-dot"></span>
              <span>LIVE TELEMETRY</span>
              <span id="lb-countdown-display" style="opacity: 0.8; font-weight: normal;">(${REFRESH_INTERVAL_SEC}s)</span>
            </div>
          </div>
        </div>

        <div class="lb-header-actions">
          <button id="lb-manual-refresh-btn" class="lb-action-btn lb-btn-refresh" aria-label="Refresh Leaderboard">
            <svg id="lb-refresh-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
            </svg>
            <span>REFRESH</span>
          </button>
          <a href="/" id="lb-play-btn" class="lb-action-btn lb-btn-play">
            <span>🎮 PLAY / RACE</span>
          </a>
        </div>
      </header>

      <!-- Event Summary Metrics -->
      <section class="lb-metrics-grid" id="lb-metrics-container">
        <div class="lb-metric-card">
          <span class="lb-metric-label">TOTAL DRIVERS</span>
          <span class="lb-metric-val cyan" id="metric-total-drivers">--</span>
        </div>
        <div class="lb-metric-card">
          <span class="lb-metric-label">TOP SCORE</span>
          <span class="lb-metric-val gold" id="metric-top-score">-- PTS</span>
        </div>
        <div class="lb-metric-card">
          <span class="lb-metric-label">MAX LAPS COMPLETED</span>
          <span class="lb-metric-val green" id="metric-max-laps">--</span>
        </div>
        <div class="lb-metric-card">
          <span class="lb-metric-label">LEADING BRANCH</span>
          <span class="lb-metric-val" id="metric-leading-branch">--</span>
        </div>
      </section>

      <!-- Score Formula Explainer -->
      <div class="lb-formula-box">
        <div class="lb-formula-text">
          <span style="font-weight:bold; color:var(--accent-yellow);">SCORING SYSTEM:</span>
          <span>1 LAP = <span class="lb-formula-chip">1,000 PTS</span></span>
          <span>+</span>
          <span>1 QUIZ CORRECT = <span class="lb-formula-chip">100 PTS</span></span>
        </div>
        <span style="color:#9ea5c6; font-size:11px;">Ranked by Score, then Laps, then Speed</span>
      </div>

      <!-- Top 3 Podium -->
      <section id="lb-podium-container" class="lb-podium-section" style="display:none;"></section>

      <!-- Search & Filters Toolbar -->
      <div class="lb-controls-panel">
        <div class="lb-search-row">
          <div class="lb-search-input-wrap">
            <span class="lb-search-icon">🔍</span>
            <input
              type="text"
              id="lb-search-input"
              class="lb-search-input"
              placeholder="Search driver name..."
              autocomplete="off"
              spellcheck="false"
            />
          </div>
        </div>

        <div class="lb-filter-groups">
          <!-- Branch Filters -->
          <div class="lb-filter-row">
            <span class="lb-filter-label">BRANCH:</span>
            <button class="lb-pill-btn lb-branch-pill active" data-branch="ALL">ALL</button>
            ${BRANCHES.map(
              (b) => `<button class="lb-pill-btn lb-branch-pill" data-branch="${b}">${b}</button>`
            ).join('')}
          </div>

          <!-- Year Filters -->
          <div class="lb-filter-row">
            <span class="lb-filter-label">YEAR:</span>
            <button class="lb-pill-btn lb-year-pill active" data-year="ALL">ALL</button>
            ${YEARS.map(
              (y) => `<button class="lb-pill-btn lb-year-pill" data-year="${y}">${formatYear(y)}</button>`
            ).join('')}
          </div>

          <!-- Sort Selector -->
          <div class="lb-filter-row">
            <span class="lb-filter-label">SORT BY:</span>
            <button class="lb-pill-btn lb-sort-pill active" data-sort="SCORE">HIGHEST SCORE</button>
            <button class="lb-pill-btn lb-sort-pill" data-sort="LAPS">MOST LAPS</button>
            <button class="lb-pill-btn lb-sort-pill" data-sort="CORRECT">QUIZ ANSWERS</button>
          </div>
        </div>
      </div>

      <!-- Full Standings Table -->
      <div class="lb-standings-card">
        <div class="lb-standings-header">
          <span class="lb-count-tag" id="lb-standings-count">SHOWING 0 DRIVERS</span>
          <span id="lb-status-text" style="font-size: 11px; color: #9ea5c6;">FETCHING DATA...</span>
        </div>

        <div class="lb-table-wrapper">
          <table class="lb-full-table">
            <thead>
              <tr>
                <th style="width: 70px;">RANK</th>
                <th>DRIVER NAME</th>
                <th style="width: 100px;">BRANCH</th>
                <th style="width: 90px;">YEAR</th>
                <th style="width: 130px;">SCORE</th>
                <th style="width: 150px;">DRIVING STATS</th>
              </tr>
            </thead>
            <tbody id="lb-standings-tbody">
              <tr>
                <td colspan="6">
                  <div class="lb-empty-notice">
                    <span>CONNECTING TO LIVE TELEMETRY...</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Sticky Current User Bar (Fixed at bottom if player registered) -->
      <div id="lb-user-sticky-bar" class="lb-sticky-user-bar" style="display:none;"></div>
    </div>
  `;

  // DOM Elements
  const refreshBtn = container.querySelector('#lb-manual-refresh-btn') as HTMLButtonElement | null;
  const refreshIcon = container.querySelector('#lb-refresh-icon') as SVGElement | null;
  const countdownDisplay = container.querySelector('#lb-countdown-display') as HTMLElement | null;
  const liveIndicator = container.querySelector('#lb-live-indicator') as HTMLElement | null;
  const searchInput = container.querySelector('#lb-search-input') as HTMLInputElement | null;
  const branchPills = container.querySelectorAll('.lb-branch-pill');
  const yearPills = container.querySelectorAll('.lb-year-pill');
  const sortPills = container.querySelectorAll('.lb-sort-pill');
  const standingsTbody = container.querySelector('#lb-standings-tbody') as HTMLElement | null;
  const standingsCount = container.querySelector('#lb-standings-count') as HTMLElement | null;
  const statusText = container.querySelector('#lb-status-text') as HTMLElement | null;
  const podiumContainer = container.querySelector('#lb-podium-container') as HTMLElement | null;
  const userStickyBar = container.querySelector('#lb-user-sticky-bar') as HTMLElement | null;

  const metricTotalDrivers = container.querySelector('#metric-total-drivers') as HTMLElement | null;
  const metricTopScore = container.querySelector('#metric-top-score') as HTMLElement | null;
  const metricMaxLaps = container.querySelector('#metric-max-laps') as HTMLElement | null;
  const metricLeadingBranch = container.querySelector('#metric-leading-branch') as HTMLElement | null;

  // Filter & Render logic
  const getFilteredAndSortedRows = (): LeaderboardRow[] => {
    let result = [...allRows];

    // Filter by branch
    if (selectedBranch !== 'ALL') {
      result = result.filter((r) => r.branch === selectedBranch);
    }

    // Filter by year
    if (selectedYear !== 'ALL') {
      result = result.filter((r) => Number(r.year) === Number(selectedYear));
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter((r) => r.name.toLowerCase().includes(q));
    }

    // Sort
    result.sort((a, b) => {
      const scoreA = calculateScore(a.laps, a.correct);
      const scoreB = calculateScore(b.laps, b.correct);

      if (sortBy === 'SCORE') {
        if (scoreB !== scoreA) return scoreB - scoreA;
        if (b.laps !== a.laps) return b.laps - a.laps;
        return b.correct - a.correct;
      } else if (sortBy === 'LAPS') {
        if (b.laps !== a.laps) return b.laps - a.laps;
        if (scoreB !== scoreA) return scoreB - scoreA;
        return b.correct - a.correct;
      } else {
        if (b.correct !== a.correct) return b.correct - a.correct;
        if (scoreB !== scoreA) return scoreB - scoreA;
        return b.laps - a.laps;
      }
    });

    return result;
  };

  const updateMetrics = () => {
    if (!metricTotalDrivers || !metricTopScore || !metricMaxLaps || !metricLeadingBranch) return;

    metricTotalDrivers.textContent = String(totalPlayersCount || allRows.length || 0);

    if (allRows.length === 0) {
      metricTopScore.textContent = '0 PTS';
      metricMaxLaps.textContent = '0';
      metricLeadingBranch.textContent = '--';
      return;
    }

    let topScore = 0;
    let maxLaps = 0;
    const branchCounts: Record<string, number> = {};

    allRows.forEach((r) => {
      const s = calculateScore(r.laps, r.correct);
      if (s > topScore) topScore = s;
      if (r.laps > maxLaps) maxLaps = r.laps;

      if (r.branch) {
        branchCounts[r.branch] = (branchCounts[r.branch] || 0) + 1;
      }
    });

    let topBranch = '--';
    let maxBranchCount = 0;
    Object.entries(branchCounts).forEach(([b, c]) => {
      if (c > maxBranchCount) {
        maxBranchCount = c;
        topBranch = b;
      }
    });

    metricTopScore.textContent = `${topScore.toLocaleString()} PTS`;
    metricMaxLaps.textContent = String(maxLaps);
    metricLeadingBranch.textContent = topBranch;
  };

  const renderPodium = (rows: LeaderboardRow[]) => {
    if (!podiumContainer) return;

    // Only show podium if no search filter active and at least 3 players
    if (searchQuery.trim() || rows.length < 3) {
      podiumContainer.style.display = 'none';
      return;
    }

    const first = rows[0];
    const second = rows[1];
    const third = rows[2];

    podiumContainer.style.display = 'grid';
    podiumContainer.innerHTML = `
      <!-- 2nd Place -->
      <div class="lb-podium-card lb-podium-second">
        <span class="lb-podium-badge">🥈</span>
        <span class="lb-podium-rank">#2 RANK</span>
        <span class="lb-podium-name">${escapeHtml(second.name)}</span>
        <div class="lb-podium-tags">
          <span class="branch-pill branch-${escapeHtml((second.branch || 'comps').toLowerCase())}">
            ${escapeHtml(second.branch || 'COMPS')}
          </span>
          <span class="year-pill">${formatYearShort(second.year)}</span>
        </div>
        <span class="lb-podium-score">${calculateScore(second.laps, second.correct).toLocaleString()} PTS</span>
        <span class="lb-podium-breakdown">🏁 ${second.laps} Laps · 🎯 ${second.correct} Correct</span>
      </div>

      <!-- 1st Place (Winner) -->
      <div class="lb-podium-card lb-podium-first">
        <span class="lb-podium-badge">👑</span>
        <span class="lb-podium-rank">#1 CHAMPION</span>
        <span class="lb-podium-name" style="font-size: 15px; color: var(--accent-yellow);">${escapeHtml(first.name)}</span>
        <div class="lb-podium-tags">
          <span class="branch-pill branch-${escapeHtml((first.branch || 'comps').toLowerCase())}">
            ${escapeHtml(first.branch || 'COMPS')}
          </span>
          <span class="year-pill">${formatYearShort(first.year)}</span>
        </div>
        <span class="lb-podium-score" style="font-size: 20px;">${calculateScore(first.laps, first.correct).toLocaleString()} PTS</span>
        <span class="lb-podium-breakdown">🏁 ${first.laps} Laps · 🎯 ${first.correct} Correct</span>
      </div>

      <!-- 3rd Place -->
      <div class="lb-podium-card lb-podium-third">
        <span class="lb-podium-badge">🥉</span>
        <span class="lb-podium-rank">#3 RANK</span>
        <span class="lb-podium-name">${escapeHtml(third.name)}</span>
        <div class="lb-podium-tags">
          <span class="branch-pill branch-${escapeHtml((third.branch || 'comps').toLowerCase())}">
            ${escapeHtml(third.branch || 'COMPS')}
          </span>
          <span class="year-pill">${formatYearShort(third.year)}</span>
        </div>
        <span class="lb-podium-score">${calculateScore(third.laps, third.correct).toLocaleString()} PTS</span>
        <span class="lb-podium-breakdown">🏁 ${third.laps} Laps · 🎯 ${third.correct} Correct</span>
      </div>
    `;
  };

  const renderTableRows = () => {
    if (!standingsTbody || !standingsCount) return;

    const filtered = getFilteredAndSortedRows();
    standingsCount.textContent = `SHOWING ${filtered.length} OF ${allRows.length} DRIVERS`;

    renderPodium(filtered);

    if (filtered.length === 0) {
      standingsTbody.innerHTML = `
        <tr>
          <td colspan="6">
            <div class="lb-empty-notice">
              <span>NO RACERS MATCH THIS CRITERIA</span>
              <span style="font-size: 11px; color: var(--cyan);">Try clearing search or changing branch/year filters</span>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    standingsTbody.innerHTML = filtered
      .map((entry, index) => {
        const displayRank = index + 1;
        const score = calculateScore(entry.laps, entry.correct);
        const isCurrent = Boolean(
          entry.isMe ||
          (storedPlayer && storedPlayer.name.toLowerCase() === entry.name.toLowerCase())
        );

        let rankBadgeClass = 'lb-rank-other';
        let medalIcon = '';
        if (displayRank === 1) {
          rankBadgeClass = 'lb-rank-1';
          medalIcon = '🥇 ';
        } else if (displayRank === 2) {
          rankBadgeClass = 'lb-rank-2';
          medalIcon = '🥈 ';
        } else if (displayRank === 3) {
          rankBadgeClass = 'lb-rank-3';
          medalIcon = '🥉 ';
        }

        const branch = entry.branch || 'COMPS';
        const branchClass = `branch-${branch.toLowerCase()}`;
        const yearText = formatYearShort(entry.year);

        return `
          <tr class="lb-table-row ${isCurrent ? 'is-current-user' : ''}" id="driver-row-${displayRank}">
            <td class="lb-rank-cell ${rankBadgeClass}">
              ${medalIcon}#${displayRank}
            </td>
            <td>
              <div class="lb-driver-name">
                <span>${escapeHtml(entry.name)}</span>
                ${isCurrent ? '<span class="lb-you-badge">YOU</span>' : ''}
              </div>
            </td>
            <td>
              <span class="branch-pill ${branchClass}">${escapeHtml(branch)}</span>
            </td>
            <td>
              <span class="year-pill">${yearText}</span>
            </td>
            <td class="lb-score-cell">
              ${score.toLocaleString()} PTS
            </td>
            <td class="lb-stats-cell">
              <span class="lb-laps-stat">🏁 ${entry.laps} Laps</span> · 
              <span class="lb-correct-stat">🎯 ${entry.correct} Correct</span>
            </td>
          </tr>
        `;
      })
      .join('');

    renderStickyUserBar(filtered);
  };

  const renderStickyUserBar = (visibleRows: LeaderboardRow[]) => {
    if (!userStickyBar) return;

    if (!storedPlayer) {
      userStickyBar.style.display = 'none';
      return;
    }

    const myEntry = meRow || allRows.find(
      (r) => r.isMe || r.name.toLowerCase() === storedPlayer.name.toLowerCase()
    );

    if (!myEntry) {
      userStickyBar.style.display = 'none';
      return;
    }

    const overallRank = myEntry.rank || (allRows.findIndex(
      (r) => r.name.toLowerCase() === storedPlayer.name.toLowerCase()
    ) + 1);

    const isVisibleInTable = visibleRows.some(
      (r) => r.name.toLowerCase() === storedPlayer.name.toLowerCase()
    );

    // If already in top of current visible list, no need to obstruct screen
    if (isVisibleInTable && visibleRows.length <= 10) {
      userStickyBar.style.display = 'none';
      return;
    }

    const score = calculateScore(myEntry.laps, myEntry.correct);

    userStickyBar.style.display = 'flex';
    userStickyBar.innerHTML = `
      <div class="lb-sticky-content">
        <span style="font-family: var(--font-retro); color: var(--cyan); font-size: 12px;">
          YOUR RANK: #${overallRank || '--'}
        </span>
        <span style="font-weight: bold; color: #fff;">${escapeHtml(myEntry.name)}</span>
        <span class="branch-pill branch-${escapeHtml((myEntry.branch || 'comps').toLowerCase())}">
          ${escapeHtml(myEntry.branch || 'COMPS')}
        </span>
        <span class="year-pill">${formatYearShort(myEntry.year)}</span>
        <span style="font-family: var(--font-retro); color: var(--accent-yellow); font-size: 13px;">
          ${score.toLocaleString()} PTS
        </span>
        <span style="color: #9ea5c6; font-size: 11px;">
          (🏁 ${myEntry.laps} Laps · 🎯 ${myEntry.correct} Quiz)
        </span>
      </div>
      <button id="lb-scroll-to-me-btn" class="lb-pill-btn active" style="font-size: 8px; padding: 6px 12px;">
        SCROLL TO ME ⬆
      </button>
    `;

    const scrollBtn = userStickyBar.querySelector('#lb-scroll-to-me-btn');
    scrollBtn?.addEventListener('click', () => {
      sounds.playClick();
      const row = container.querySelector(`.is-current-user`);
      if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  };

  const fetchData = async () => {
    if (disposed || isFetching) return;
    isFetching = true;

    if (refreshIcon) refreshIcon.classList.add('spinning');
    if (statusText) statusText.textContent = 'UPDATING RANKINGS...';

    try {
      // Fetch up to 100 rows for the full leaderboard page
      const snapshot = await api.getLeaderboard('ALL', 100);

      if (disposed) return;

      allRows = snapshot.top || [];
      meRow = snapshot.me || null;
      totalPlayersCount = snapshot.totalPlayers || allRows.length;
      isStaleData = Boolean(snapshot.isStale);

      if (statusText) {
        if (isStaleData) {
          statusText.innerHTML = `⚠️ <span style="color:var(--wrong-red);">OFFLINE (CACHED DATA)</span>`;
          if (liveIndicator) {
            liveIndicator.className = 'lb-live-pulse-badge';
            liveIndicator.style.borderColor = 'var(--wrong-red)';
            liveIndicator.style.color = 'var(--wrong-red)';
          }
        } else {
          statusText.textContent = `LAST UPDATED: ${new Date().toLocaleTimeString()}`;
          if (liveIndicator) {
            liveIndicator.className = 'lb-live-pulse-badge';
            liveIndicator.style.borderColor = 'var(--correct-green)';
            liveIndicator.style.color = 'var(--correct-green)';
          }
        }
      }

      updateMetrics();
      renderTableRows();
    } catch (err) {
      console.warn('[LeaderboardPage] Failed to fetch leaderboard:', err);
      if (statusText) {
        statusText.innerHTML = `⚠️ <span style="color:var(--wrong-red);">ERROR CONNECTING</span>`;
      }
    } finally {
      isFetching = false;
      if (refreshIcon) refreshIcon.classList.remove('spinning');
      countdownSec = REFRESH_INTERVAL_SEC;
      if (countdownDisplay) countdownDisplay.textContent = `(${countdownSec}s)`;
    }
  };

  // Wire Event Listeners
  refreshBtn?.addEventListener('click', () => {
    sounds.unlock();
    sounds.playClick();
    countdownSec = REFRESH_INTERVAL_SEC;
    void fetchData();
  });

  searchInput?.addEventListener('input', () => {
    searchQuery = searchInput.value;
    renderTableRows();
  });

  branchPills.forEach((btn) => {
    btn.addEventListener('click', () => {
      sounds.unlock();
      sounds.playClick();
      branchPills.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      selectedBranch = (btn.getAttribute('data-branch') || 'ALL') as Branch | 'ALL';
      renderTableRows();
    });
  });

  yearPills.forEach((btn) => {
    btn.addEventListener('click', () => {
      sounds.unlock();
      sounds.playClick();
      yearPills.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const val = btn.getAttribute('data-year');
      selectedYear = val === 'ALL' ? 'ALL' : (Number(val) as Year);
      renderTableRows();
    });
  });

  sortPills.forEach((btn) => {
    btn.addEventListener('click', () => {
      sounds.unlock();
      sounds.playClick();
      sortPills.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      sortBy = (btn.getAttribute('data-sort') || 'SCORE') as 'SCORE' | 'LAPS' | 'CORRECT';
      renderTableRows();
    });
  });

  // Countdown timer (ticks every second)
  countdownInterval = window.setInterval(() => {
    if (disposed) return;
    countdownSec--;
    if (countdownSec <= 0) {
      countdownSec = REFRESH_INTERVAL_SEC;
      void fetchData();
    }
    if (countdownDisplay) {
      countdownDisplay.textContent = `(${countdownSec}s)`;
    }
  }, 1000);

  // Initial fetch
  void fetchData();

  return () => {
    disposed = true;
    document.body.classList.remove('leaderboard-page-mode');
    if (countdownInterval !== null) {
      window.clearInterval(countdownInterval);
      countdownInterval = null;
    }
    if (pollInterval !== null) {
      window.clearInterval(pollInterval);
      pollInterval = null;
    }
  };
}
