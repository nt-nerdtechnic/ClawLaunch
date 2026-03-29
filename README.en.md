# NT-ClawLaunch

NT-ClawLaunch is a desktop control plane for managing [OpenClaw](https://openclaw.ai) AI gateway instances. It wraps the OpenClaw CLI in an Electron shell and provides a full-featured UI for onboarding, monitoring, agent observability, and runtime configuration.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-blue.svg)](CONTRIBUTING.en.md)

> Platform: macOS only. Support for Linux and Windows may be considered in future releases.
>
> Web UI: The management interface is available only through the Electron desktop app. Direct browser access (for example `http://localhost:5173`) is intentionally blocked.

## Features

- Setup Wizard (6 steps): welcome, initialize, model auth, messaging, skills, launch
- Monitoring Dashboard: sessions, task activity, pending approvals, and runtime state
- Activity Observation Engine: filesystem watcher + JSONL session scanner + cron monitor
- Analytics: usage breakdown by agent/project/model/provider with charts
- Control Center: queue actions, audit timeline, and operational details
- Skills Management: scan/import/delete workspace and core skills
- Runtime Settings: model/auth/messaging/theme/language controls

## Project Structure

```text
NT-ClawLaunch/
├── frontend/
│   ├── electron/      # Electron main process, IPC services, utilities
│   ├── src/           # React app (pages, components, hooks, stores)
│   ├── test/          # Vitest tests
│   ├── scripts/       # Development helper scripts
│   └── package.json
├── docs/              # Planning and architecture documents
├── package.json       # Workspace scripts (pnpm --filter frontend ...)
├── README.md
├── README.en.md
└── DEVELOPMENT.md
```

## Tech Stack

- Electron 41
- React 19 + TypeScript 5
- Vite 7
- Tailwind CSS 4
- Zustand 5
- Recharts 3
- i18next

## Quick Start

### Prerequisites

- Node.js 18+
- npm or pnpm
- [OpenClaw CLI](https://openclaw.ai) installed and available on `$PATH`

### Environment Variables

There is currently no required `.env` / `.env.example` file in this repository. Runtime settings are persisted by the desktop app in `~/Library/Application Support/NT-ClawLaunch/config.json`.

### Run from Workspace Root

```bash
npm install
npm run dev
```

### Run from Frontend Package

```bash
cd frontend
npm install
npm run dev
```

### Production Build

```bash
cd frontend
npm run build
npm run dist
```

## Development Notes

See [DEVELOPMENT.md](DEVELOPMENT.md) for troubleshooting details (ESM in Electron, `ELECTRON_RUN_AS_NODE`, and build/runtime caveats).

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.en.md](CONTRIBUTING.en.md) before opening a pull request.

## License

This project is licensed under the [MIT License](LICENSE).
