import { ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { parseSessionJsonlForUsage, type RuntimeUsageEvent } from '../services/snapshot.js';

export function registerUsageHandler(): void {
  ipcMain.handle('usage:scan-sessions', async (_event, payload?: string) => {
    try {
      const homeDir = process.env.HOME || process.env.USERPROFILE || '';
      const parsed = payload ? (() => { try { return JSON.parse(payload); } catch { return {}; } })() : {};
      const agentsDir: string = parsed.agentsDir || path.join(homeDir, '.openclaw', 'agents');

      const events: RuntimeUsageEvent[] = [];

      let agentIds: string[] = [];
      try { agentIds = await fs.readdir(agentsDir); } catch { /* dir not found */ }

      for (const agentId of agentIds) {
        const sessionsDir = path.join(agentsDir, agentId, 'sessions');
        let files: string[] = [];
        try {
          const entries = await fs.readdir(sessionsDir, { withFileTypes: true });
          files = entries.filter((e) => e.isFile() && e.name.endsWith('.jsonl')).map((e) => e.name);
        } catch { continue; }

        for (const file of files) {
          let content = '';
          try { content = await fs.readFile(path.join(sessionsDir, file), 'utf-8'); } catch { continue; }
          const sessionParsed = parseSessionJsonlForUsage(content, agentId);
          for (const ev of sessionParsed) events.push(ev);
        }
      }

      return { code: 0, stdout: JSON.stringify(events), stderr: '' };
    } catch (e) {
      return { code: 1, stdout: '[]', stderr: String((e as Error)?.message || 'scan failed') };
    }
  });
}
