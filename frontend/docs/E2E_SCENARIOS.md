# NT-ClawLaunch E2E Scenarios

## Scope
This checklist validates three critical flows:
1. No gateway available
2. Missing/dirty snapshot data
3. Cross-section navigation regression
4. Onboarding OAuth provider routing

## Preconditions
- Workspace: `frontend`
- Build command available: `npm run build`
- Local app starts from Electron dev mode

## Scenario A: No Gateway

### Steps
1. Ensure no process is listening on configured gateway port (default 18900).
2. Launch app and go to Monitor.
3. Verify gateway toggle remains in stopped/offline state.
4. Switch tabs in sequence: Monitor -> Analytics -> Skills -> Settings -> Monitor.
5. Open Action Center and verify empty states.

### Expected
- No white screen or runtime crash.
- Health section shows degraded/offline states only.
- Action Center shows empty hints instead of stack traces.
- Live Stream does not force browser/page focus.

## Scenario B: Missing Snapshot / Dirty Data

### Steps
1. Remove or rename runtime snapshot source file.
2. Reload app.
3. Go to Analytics.
4. Verify all sections render fallback state:
   - Usage window cards
   - Subscription window
   - Data connectors
   - Context pressure
   - Cost hotspots
5. Return to Monitor and open Task Operations section.

### Expected
- Analytics remains renderable (no blank page).
- Empty charts show placeholder text.
- Context and cost cards show no-data copy.
- Task board / approvals / evidence / event queue all show safe empty state.

## Scenario C: Regression Navigation

### Steps
1. Start with gateway stopped.
2. Cycle through all tabs 3 times.
3. In Monitor, interact with:
   - Task Operations (all blocks)
   - Staff Grid
   - Live Stream
4. In Analytics, switch period buttons: Today / 7d / 30d repeatedly.

### Expected
- No React error boundary fallback appears.
- No console-level uncaught exception.
- UI remains responsive and no auto-scroll page jumps.

## Scenario D: Onboarding OAuth Smoke Checklist

### Goal
Verify each OAuth option in onboarding triggers `openclaw models auth login` with the expected provider and method.

### Preconditions
- Open onboarding wizard and navigate to the model selection step.
- Enable terminal or command logging so the spawned OpenClaw command is visible.
- Stop after the external auth flow is launched; full login completion is not required for this smoke pass.

### Checklist

| Done | UI option | Expected provider | Expected method | Expected command fragment |
| --- | --- | --- | --- | --- |
| [ ] | OpenAI Codex OAuth | `openai-codex` | `oauth` | `models auth login --provider openai-codex --method oauth` |
| [ ] | Google Gemini CLI OAuth | `google-gemini-cli` | `oauth` | `models auth login --provider google-gemini-cli --method oauth` |
| [ ] | Chutes OAuth | `chutes` | `oauth` | `models auth login --provider chutes --method oauth` |
| [ ] | Qwen Portal OAuth | `qwen-portal` | `device` | `models auth login --provider qwen-portal --method device` |
| [ ] | MiniMax OAuth (Global) | `minimax-portal` | `oauth` | `models auth login --provider minimax-portal --method oauth` |
| [ ] | MiniMax OAuth (CN) | `minimax-portal` | `oauth-cn` | `models auth login --provider minimax-portal --method oauth-cn` |

### Expected
- Every OAuth click routes to `openclaw models auth login`, not `openclaw onboard --auth-choice`.
- Provider and method match the table above.
- Browser/device auth flow opens without immediate CLI argument error.
- MiniMax Global and CN are distinguishable by method value (`oauth` vs `oauth-cn`).

## Final Verification Commands
Run from `frontend`:

```bash
npm run lint
npm run build
```

## Release Gate
Release can proceed only when all scenarios pass and both verification commands exit with code 0.
