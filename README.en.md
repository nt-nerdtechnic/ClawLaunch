# NT-ClawLaunch

**NT-ClawLaunch** is an autonomous collaboration and management platform designed to accelerate the launch of international open-source projects. It is not just a launcher, but a complete ecosystem integrating a modern front-end interface and desktop automation controls.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-blue.svg)](CONTRIBUTING.en.md)

## 🚀 Core Features

*   **Setup Wizard:** An intuitive guided process to help developers quickly configure models, messaging pairings, and skill matrices.
*   **Environment Automation:** Integrated Electron IPC for one-click `git clone` and `pnpm install` implementation logic.
*   **Real-time Monitoring Dashboard:** Sophisticated visualization for tracking project status and data in real-time.
*   **One-Click Update:** Automatically compares local versions with remote ones and executes updates elegantly.

## 📂 Project Structure

*   `frontend/`: Modern UI interface based on React and Electron.
*   `docs/`: Comprehensive development and user documentation.
*   `vault/`: Runtime logs and local data snapshots.

## 🧩 One-Click Update Spec Summary

The following content has been consolidated from the removed `shared/` specification files:

*   **Version Check**: Compare local and remote versions on startup and notify when an update is available.
*   **Update Execution**: Run `git pull` and dependency installation through desktop IPC.
*   **Progress Visibility**: Show update logs and status during execution.
*   **Restart Prompt**: Ask users to restart after a successful update.

Current IPC capability (concept):

*   `check_version`: returns `local`, `remote`, `hasUpdate`.
*   `execute_update`: returns `success` and `logs`.

## 🛠 Quick Start

### Prerequisites
*   Node.js (v18+)
*   pnpm
*   Rust (if compiling the back-end)

### Installation Steps
1.  **Clone the Repository**
    ```bash
    git clone https://github.com/nt-nerdtechnic/NT-ClawLaunch.git
    cd NT-ClawLaunch
    ```
2.  **Install Dependencies**
    ```bash
    pnpm install
    ```
3.  **Start Development Environment**
    ```bash
    npm run dev
    ```

## 🤝 Contributing

We welcome all forms of contribution! Before getting started, please be sure to read [CONTRIBUTING.en.md](CONTRIBUTING.en.md) to understand our development process and code standards.

## 📄 License

This project is licensed under the [MIT License](LICENSE).
