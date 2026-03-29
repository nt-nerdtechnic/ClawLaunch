import { ipcMain } from 'electron';
import path from 'node:path';
import { normalizeString } from '../utils/normalize.js';
import { resolveRuntimeDirFromCandidates, loadEventAcks, saveEventAcks } from '../services/governance.js';

export function registerEventsHandler(): void {
  ipcMain.handle('events:ack', async (_event, payload) => {
    try {
      const eventId = normalizeString(payload?.eventId, '');
      if (!eventId) {
        return { success: false, error: 'Missing eventId' };
      }

      const runtimeCandidates = [
        normalizeString(payload?.runtimeDir, ''),
        normalizeString(payload?.configPath, '') ? path.join(normalizeString(payload?.configPath, ''), 'runtime') : '',
        normalizeString(payload?.workspacePath, '') ? path.join(normalizeString(payload?.workspacePath, ''), 'runtime') : '',
        normalizeString(payload?.corePath, '') ? path.join(normalizeString(payload?.corePath, ''), 'runtime') : '',
      ].filter(Boolean);

      const runtimeDir = (await resolveRuntimeDirFromCandidates(runtimeCandidates)) || runtimeCandidates[0] || '';
      if (!runtimeDir) {
        return { success: false, error: 'No runtimeDir available for ack storage' };
      }

      const ttlMs = Math.max(60_000, Math.min(7 * 24 * 60 * 60 * 1000, Number(payload?.ttlMs || 30 * 60 * 1000)));
      const now = new Date();
      const expiresAt = new Date(now.getTime() + ttlMs);

      const ackMap = await loadEventAcks(runtimeDir);
      ackMap[eventId] = {
        ackedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
      };
      await saveEventAcks(runtimeDir, ackMap);

      return {
        success: true,
        eventId,
        ackedAt: ackMap[eventId].ackedAt,
        expiresAt: ackMap[eventId].expiresAt,
        runtimeDir,
      };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  });

  ipcMain.handle('events:state', async (_event, payload) => {
    try {
      const runtimeCandidates = [
        normalizeString(payload?.runtimeDir, ''),
        normalizeString(payload?.configPath, '') ? path.join(normalizeString(payload?.configPath, ''), 'runtime') : '',
        normalizeString(payload?.workspacePath, '') ? path.join(normalizeString(payload?.workspacePath, ''), 'runtime') : '',
        normalizeString(payload?.corePath, '') ? path.join(normalizeString(payload?.corePath, ''), 'runtime') : '',
      ].filter(Boolean);

      const runtimeDir = (await resolveRuntimeDirFromCandidates(runtimeCandidates)) || runtimeCandidates[0] || '';
      if (!runtimeDir) {
        return { success: false, error: 'No runtimeDir available' };
      }

      const ackMap = await loadEventAcks(runtimeDir);
      return { success: true, runtimeDir, acks: ackMap };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  });
}
