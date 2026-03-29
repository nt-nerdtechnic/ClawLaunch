import { ipcMain } from 'electron';
import { activityBuffer, ACTIVITY_MAX, scanAllSessions, scanCronJobs, startActivityWatcher, buildWatchDirs } from '../services/activity-watcher.js';

export function registerActivityHandler(): void {
  ipcMain.handle('activity:events:list', async (_event, payload?: string) => {
    const opts = payload ? (() => { try { return JSON.parse(payload); } catch { return {}; } })() : {};
    const limit = Number(opts?.limit ?? 200);
    const categoryFilter = opts?.category as string | undefined;
    const sourceFilter = opts?.source as string | undefined;
    const since = Number(opts?.since ?? 0);

    let events = activityBuffer.slice(-ACTIVITY_MAX);
    if (since) events = events.filter(e => e.timestamp > since);
    if (categoryFilter) events = events.filter(e => e.category === categoryFilter);
    if (sourceFilter) events = events.filter(e => e.source === sourceFilter);
    events = events.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
    return { code: 0, stdout: JSON.stringify({ events, total: events.length }), stderr: '', exitCode: 0 };
  });

  ipcMain.handle('activity:scan:now', async (_event, payload?: string) => {
    const opts = payload ? (() => { try { return JSON.parse(payload); } catch { return {}; } })() : {};
    const stateDir = opts?.stateDir as string | undefined;
    await Promise.all([
      scanAllSessions(stateDir),
      scanCronJobs(stateDir),
    ]);
    return { code: 0, stdout: JSON.stringify({ scanned: true, total: activityBuffer.length }), stderr: '', exitCode: 0 };
  });

  ipcMain.handle('activity:watch:restart', async (_event, payload?: string) => {
    const opts = payload ? (() => { try { return JSON.parse(payload); } catch { return {}; } })() : {};
    const extraDirs: string[] = Array.isArray(opts?.extraDirs) ? opts.extraDirs : [];
    await startActivityWatcher(extraDirs);
    const dirs = await buildWatchDirs();
    return { code: 0, stdout: JSON.stringify({ ok: true, watching: dirs.length + extraDirs.length }), stderr: '', exitCode: 0 };
  });
}
