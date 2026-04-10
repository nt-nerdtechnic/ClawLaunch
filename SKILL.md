# NT-ClawLaunch — Agent Skill Sheet

This document tells an AI agent everything it needs to operate NT-ClawLaunch
from the command line without guessing.

---

## What is NT-ClawLaunch?

NT-ClawLaunch is an Electron desktop app that manages the **OpenClaw AI
Gateway** — a local proxy/router for AI models. The app exposes a local HTTP
server (port 19827) that the `clawlaunch` CLI talks to.

---

## CLI Binary

```
clawlaunch <command> [--json]
```

Located at `scripts/clawlaunch.mjs`.  
Install / symlink it so it is on PATH before use.

### Self-discovery commands (start here)

| Command | Purpose |
|---------|---------|
| `clawlaunch --help` | Human-readable usage, exit-code table, workflow steps |
| `clawlaunch commands` | Human-readable list of all commands with hints |
| `clawlaunch commands --json` | **Machine-readable** full command catalogue (JSON) |

---

## Command Reference

### `health`
Confirm the app is open and the CLI server is responsive.

```sh
clawlaunch health
```

Success response (JSON on stdout):
```json
{ "ok": true, "version": "1.x.x", "uptime": 42, "serverUptime": 30, "port": 19827 }
```

**Always run this first.** Exit 69 means the app is not running — open it before proceeding.

---

### `gateway:start`
Start OpenClaw Gateway in the background with automatic watchdog restarts.

```sh
clawlaunch gateway:start
```

Success response:
```json
{ "pid": 12345, "command": "...", "status": "started" }
```

Returns immediately; the gateway process continues in the background.  
**Prerequisite:** Onboarding must be complete (`corePath` configured). Exit 78 if not.

---

### `gateway:stop`
Stop the gateway and all watchdog processes.

```sh
clawlaunch gateway:stop
```

Success response:
```json
{ "stopped": true }
```

---

### `gateway:restart`
Stop then restart the gateway. Waits up to 8 s for the port to free.

```sh
clawlaunch gateway:restart
```

Use this after configuration changes or when the gateway is unresponsive.  
Same success shape as `gateway:start`.

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0`  | Success |
| `1`  | Execution error (see stderr) |
| `2`  | Usage error / unknown command |
| `69` | NT-ClawLaunch app is **not running** — open the app first |
| `78` | Configuration error — onboarding not complete |

---

## Recommended Agent Workflow

```
1. clawlaunch health
   → exit 0: app is open, proceed
   → exit 69: tell the user to open NT-ClawLaunch, then retry

2. clawlaunch gateway:start
   → exit 0: gateway is starting in background
   → exit 78: user needs to complete onboarding in the app UI

3. (optional) clawlaunch gateway:stop   ← clean shutdown
   (optional) clawlaunch gateway:restart ← reload after config change
```

---

## Machine-Readable Discovery

To get the full command catalogue at runtime (useful for dynamic tool registration):

```sh
clawlaunch commands --json
```

Returns a JSON object with:
- `version` — app version string
- `commands[]` — each entry has `command`, `description`, `when`, `successShape`, `notes`
- `workflow[]` — ordered list of workflow hints
- `exitCodes` — map of code → meaning

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Exit 69 | App not open | Launch NT-ClawLaunch desktop app |
| Exit 78 | No corePath | Complete onboarding in the app |
| Exit 1 + stderr message | Runtime error | Read stderr for details |
| Gateway starts then dies | Watchdog cycling | Check API key / model config |

---

## IPC Commands (in-app only)

The following namespaces are available via Electron IPC (not via `clawlaunch` CLI).  
They are only callable from within the Electron renderer / preload context.

- `auth:*` — manage auth profiles and API keys
- `control:*` — control centre: budget, approvals, tasks, projects, queue, audit
- `cron:*` — scheduled job management
- `system:*` — crontab and LaunchAgents management
- `app:get-version`, `app:check-update`, `app:quit`, `app:relaunch`

For agent use, stick to the `clawlaunch` CLI commands above.
