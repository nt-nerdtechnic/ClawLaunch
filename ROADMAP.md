# NT-ClawLaunch Autonomous Roadmap

## Phase 500: Setup Wizard & UX Foundation [COMPLETED]
- [x] Create `SetupWizard` orchestrator.
- [x] Implement Step 1: Model Selection.
- [x] Implement Step 2: Messaging Pairing (with Nanny-guide).
- [x] Implement Step 3: Skill Matrix (Jargon-free).
- [x] Implement Step 4: Launching Animation & Loading.
- [x] Integrate Wizard into `App.tsx` with persistence.

## Phase 600: Real Logic & Backend Bridge [COMPLETED]
- [x] **Task 1: Real Install Logic** - Connect the "Install" button to actual `git clone` and `pnpm install` commands via Electron IPC.
- [x] **Task 2: Env Status Polling** - Implement real-time environment status checking during Step 1.
- [x] **Task 3: Config Persistence** - Save API Keys and Tokens to a local `.env` or `config.json` that OpenClaw can read.

## Phase 700: Mini-View & Dashboard Polish [COMPLETED]
- [x] **Task 1: Mini-Widget Layout** - Refine the 320px view for persistent desktop monitoring.
- [x] **Task 2: Analytics Visualization** - Improved Recharts integration with AreaChart and LineChart.
- [x] **Task 3: Skill Toggling** - Connect the Skill Matrix UI to actual skill enable/disable commands via IPC.

## Phase 800: 一鍵更新機制 (One-Click Update) [COMPLETED]
- [x] **Task 1: Version Checking** - Compare local git hash with remote origin/main via IPC.
- [x] **Task 2: Update Banner UI** - Elegant notification banner for new versions.
- [x] **Task 3: Execution Logic** - Electron IPC to run `git pull` and `pnpm install`.
