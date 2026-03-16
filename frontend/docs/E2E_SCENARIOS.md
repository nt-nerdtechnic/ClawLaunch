# NT-ClawLaunch E2E Scenarios

## Scope
This checklist validates three critical flows:
1. No gateway available
2. Missing/dirty snapshot data
3. Cross-section navigation regression

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

## Final Verification Commands
Run from `frontend`:

```bash
npm run lint
npm run build
```

## Release Gate
Release can proceed only when all scenarios pass and both verification commands exit with code 0.
