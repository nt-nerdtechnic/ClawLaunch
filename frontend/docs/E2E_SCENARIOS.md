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

### Expected
- Every OAuth click routes to `openclaw models auth login`, not `openclaw onboard --auth-choice`.
- Provider and method match the table above.
- Browser/device auth flow opens without immediate CLI argument error.

## Scenario E: Existing Onboarding End-to-End Checklist

### Goal
Validate the full `existing` onboarding path from Welcome -> Model -> Messaging -> Launch, including path hydration, auth validation, platform-specific channel validation, and launch readiness behavior.

### Preconditions
- Prepare one existing OpenClaw config directory with a valid `openclaw.json`.
- Ensure app can detect paths through `detect:paths`.
- Open onboarding wizard and choose the `existing` path.
- Keep onboarding logs visible in UI so each step result can be verified.

### Test Data Matrix (recommended)

| Case | Config condition | Expected outcome |
| --- | --- | --- |
| E1 | `openclaw.json` has valid auth profiles and selected platform channel | Full flow passes to completion |
| E2 | `openclaw.json` has channels, but missing currently selected `platform` channel | Fails at Messaging with explicit platform error |
| E3 | Missing/empty `configPath` | Fails at Model/Messaging with missing config path error |
| E4 | Existing flow without explicit `authChoice` in launcher config | Model step is not blocked by unsupported auth choice guard |

### Step-by-step Checklist

#### Step 1: Welcome (Choose Existing)
- [ ] Click `existing` in Welcome.
- [ ] Verify `corePath`, `configPath`, `workspacePath` are prefilled from detected config.
- [ ] Verify `authChoice` is also hydrated from detected config when available.
- [ ] Verify the wizard can continue to Model (no immediate reset or path wipe).

Acceptance points:
- Prefilled paths match detected values from `detect:paths`.
- No unexpected overwrite to empty string for `configPath`/`workspacePath`.

#### Step 2: Model (Existing Validation)
- [ ] Click next on Model step without changing settings.
- [ ] Verify existing-user validation path is used (no forced new-project onboarding command path).
- [ ] For credentialless modes (`ollama` / `vllm`), verify dual-layer credential check is skipped.
- [ ] For credential modes, verify dual-layer auth persistence validation runs.

Acceptance points:
- Existing flow is not blocked by `unsupported auth choice` guard.
- Log shows model validation success path and proceeds to next step.

Failure signals:
- Error: `不支援或不安全的授權類型: unknown` appears for existing flow.

#### Step 3: Messaging (Platform-specific Validation)
- [ ] Keep `platform` as currently selected value (for example: `telegram`).
- [ ] Click next on Messaging step.
- [ ] Verify onboarding checks not only "any channel exists" but the selected platform channel exists.

Acceptance points:
- If selected platform channel exists: step passes.
- If selected platform channel is missing: step fails with clear message `目前選擇的通訊頻道未配置: <platform>`.

#### Step 4: Launch (Existing Final Verification)
- [ ] Continue to Launch step.
- [ ] Test with `installDaemon = true`: verify launch readiness checks execute.
- [ ] Test with `installDaemon = false`: verify only CLI availability check (`openclaw --version`) is required.
- [ ] Verify step finishes and onboarding completes without runtime crash.

Acceptance points:
- Existing flow completes and returns to normal app state.
- No React error boundary, no onboarding dead-end.

### Regression Guard Checklist (Existing Flow)
- [ ] Existing + empty launcher `authChoice` does not block Model step.
- [ ] Existing selection does not clear detected paths unexpectedly.
- [ ] Messaging fails fast when selected platform channel is absent.
- [ ] Launch behavior differs correctly by `installDaemon` setting.

### Optional Evidence to Capture
- [ ] Screenshot: Welcome with prefilled detected paths.
- [ ] Screenshot: Messaging platform mismatch error (negative case E2).
- [ ] Screenshot: Launch success state for both daemon modes.
- [ ] Export/attach onboarding logs for each case (E1~E4).

## Final Verification Commands
Run from `frontend`:

```bash
npm run lint
npm run build
```

## Release Gate
Release can proceed only when all scenarios pass and both verification commands exit with code 0.
