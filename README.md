# 🏎️ Crescendo Fuel Rush

**Crescendo Fuel Rush** is a high-octane retro-arcade top-down racing game where speed meets knowledge. Players navigate dynamic racetracks, manage a tight 10-second fuel tank, and recharge on empty by answering technical trivia questions tailored to their engineering branch and year.

Built with **Phaser 3**, **TypeScript**, **Vite**, and backed by **Supabase** (PostgreSQL with server-authoritative anti-cheat logic).

---

## 🎮 Core Gameplay & Mechanics

1. **Top-Down Arcade Driving**:
   - Touch/keyboard responsive steering with momentum, grass friction drag, and dynamic cornering.
   - **Centered Camera**: Exact zero-lag, zero-deadzone camera follow keeping the car perfectly centered horizontally and vertically at all speeds and mobile viewports.

2. **10-Second Fuel Tank & Quiz Recharge**:
   - The car starts with 10 seconds of fuel (`initial_fuel_ms: 10000`).
   - When the fuel runs dry, the car coasts to a halt and opens the retro **"OUT OF FUEL!"** question overlay.
   - Each correct answer immediately grants **exactly +10.000 seconds of fuel** to get back in the race.
   - Fuel drain is completely paused while the question overlay is open, during network requests, or while stationary.

3. **Procedural Per-Lap Tracks (Part 4)**:
   - Config-driven via `feature_lap_tracks` (defaults to `true`).
   - Powered by a deterministic, seeded Catmull-Rom procedural generator (`mulberry32`).
   - **Escalating Difficulty**: Every completed lap loads a new, harder track with more corners, tighter radii, chicanes, and hairpins (scaling up to Level 12).
   - **Seamless Swap**: Pre-renders the next track's texture in the background while driving. On crossing the finish line, a 150 ms camera flash swaps the road, gates, and minimap with zero car hitching or speed loss.

4. **Decluttered Retro HUD**:
   - Compact top strip (height $\le 40\text{ px}$, $\le 6\%$ screen height) displaying:
     - **Fuel Bar** with remaining seconds inside (pulses red when $\le 25\%$ or $\le 3\text{ s}$).
     - **Laps completed** (`L0`).
     - **Correct answers** (`✓0`).
     - **Leaderboard rank** (`#--` / `#8`).
   - Transient single-slot toasts (FIFO queue) for speed milestones and track changes.
   - Semi-transparent minimap positioned in the bottom-right corner.

5. **Server-Authoritative Anti-Cheat & Leaderboard**:
   - SQL RPC functions (`join_race`, `request_question`, `answer_question`, `submit_lap`, `get_leaderboard`).
   - Enforces sequential lap progression, physical driving speed limits, minimum lap duration, and fuel balance verification.
   - Server-side anti-farming rule: prevents requesting questions faster than physical fuel burn rate after correct answers.
   - Filter leaderboard by **ALL**, **BRANCH** (`COMPS`, `CSE`, `ECS`, `MECH`, `AIDS`), and **YEAR** (`1`, `2`, `3`, `4`).

---

## 🛠️ Tech Stack

- **Client**: [Phaser 3](https://phaser.io/), [TypeScript](https://www.typescriptlang.org/), [Vite](https://vitejs.dev/)
- **UI & Styling**: Vanilla CSS, Retro Arcade Neon aesthetic, HTML5 Canvas
- **Backend & Database**: [Supabase](https://supabase.com/) (PostgreSQL 15+, PL/pgSQL RPCs, Row Level Security, Anonymous Auth)
- **Audio**: Web Audio API retro synth sound effects (engine pitch, tire squeal, checkpoint chimes, fuel alerts)
- **Testing**: [Vitest](https://vitest.dev/)

---

## 🚀 Getting Started

### 1. Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- A [Supabase](https://supabase.com/) project

### 2. Installation
Clone the repository and install dependencies:
```bash
git clone https://github.com/Soah1312/TechnicalAspect.git
cd TechnicalAspect
npm install
```

### 3. Environment Setup
Create a `.env` file in the project root (based on `.env.example`):
```env
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

### 4. Database Setup
1. Open your **Supabase Dashboard** $\rightarrow$ **SQL Editor**.
2. Run the idempotent setup file: [`supabase/apply_v3.sql`](./supabase/apply_v3.sql).
3. *(Optional)* Seed questions from the question bank: [`supabase/seed_questions_from_csv.sql`](./supabase/seed_questions_from_csv.sql).

> [!IMPORTANT]
> **Venue Wi-Fi Rate Limit Setting**: In Supabase Dashboard $\rightarrow$ **Project Settings** $\rightarrow$ **Authentication** $\rightarrow$ **Rate Limits**, ensure *Anonymous sign-ins per hour* is set to **`1000`** or higher so multiple devices on the same Wi-Fi network can join simultaneously.

### 5. Running Locally
Start the development server:
```bash
npm run dev
```
Open `http://localhost:5173` (or the port indicated in terminal) in your browser.

---

## 🧪 Testing & Validation

Run the automated Vitest test suite:
```bash
npm test
```
The suite validates:
- Exact 10 s fuel additions and unclamped scale bounds.
- Anti-farming `TOO_SOON` rate limiting.
- Synchronous camera centering ($\le 0.695\text{ px}$ max deviation across 600 frames).
- FIFO lap queue and offline stale leaderboard resilience.

Run track generator calibration:
```bash
npx tsx scripts/calibrate_tracks.ts
```

Build for production:
```bash
npm run build
```

---

## 🕹️ Debug Query Parameters

Append these query parameters to the URL for testing:
- `?debug=1`: Logs exact fuel before/after answers and delta (`+10.000 s`).
- `?debugLayout=1`: Overlays screen center crosshairs, car deviation metrics, and HUD top strip percentage.
- `?reset=1`: Clears player session and local storage on startup.

---

## 📁 Project Structure

```
├── public/                 # Static assets and question CSVs
├── scripts/                # Calibration & testing scripts
│   └── calibrate_tracks.ts # Generator calibration for Laps 1-20
├── src/
│   ├── api/                # Supabase & Mock API client implementations
│   ├── audio/              # Sound effects and engine audio manager
│   ├── config/             # Constants, palette, and default game configs
│   ├── game/               # Phaser 3 scene, car physics, fuel, and laps
│   │   ├── scenes/         # RaceScene, BootScene
│   │   ├── tracks/         # Procedural generator & centerline validator
│   │   ├── car.ts          # Arcade car physics & steering
│   │   ├── fuel.ts         # Unclamped fuel state manager
│   │   └── track.ts        # Racetrack geometry & canvas renderer
│   ├── ui/                 # Racing HUD, quiz overlay, and leaderboards
│   └── util/               # Network monitor, storage, vibration
├── supabase/               # SQL migrations & idempotent scripts
│   ├── apply_v3.sql        # Latest consolidated database schema & RPCs
│   └── seed_questions_from_csv.sql
└── vite.config.ts
```

---

## 📜 License
This project is proprietary and intended for event and academic use.
