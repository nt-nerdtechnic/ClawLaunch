import path from 'node:path';
import fs from 'node:fs/promises';
import { watch as fsWatch, existsSync } from 'node:fs';
import { t } from '../utils/i18n.js';
import { buildId } from '../utils/normalize.js';

// ── ActivityEvent ────────────────────────────────────────────────────────────

export interface ActivityEvent {
  id: string;
  timestamp: number;
  source: 'fs' | 'jsonl' | 'cron' | 'system';
  type:
    | 'skill_created' | 'skill_updated' | 'skill_deleted'
    | 'config_changed' | 'task_updated' | 'script_executed'
    | 'agent_action' | 'file_change'
    | 'scheduled_run' | 'service_state';
  category: 'development' | 'execution' | 'scheduled' | 'task' | 'config' | 'alert' | 'system';
  title: string;
  detail?: string;
  path?: string;
  agent?: string;
  exitCode?: number;
}

export const ACTIVITY_MAX = 500;

let ACTIVITY_STORE_FILE = '';
let _getClawlaunchFile: () => string = () => '';

export function initActivityWatcher(opts: {
  persistentConfigDir: string;
  getClawlaunchFile: () => string;
}): void {
  ACTIVITY_STORE_FILE = path.join(opts.persistentConfigDir, 'activity-store.json');
  _getClawlaunchFile = opts.getClawlaunchFile;
}

// ── In-memory ring buffer ────────────────────────────────────────────────────

export let activityBuffer: ActivityEvent[] = [];
let activityFlushPending = false;

export async function loadActivityStore(): Promise<void> {
  try {
    const raw = await fs.readFile(ACTIVITY_STORE_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) activityBuffer = parsed.slice(-ACTIVITY_MAX);
  } catch { activityBuffer = []; }
}

export async function flushActivityStore(): Promise<void> {
  if (activityFlushPending) return;
  activityFlushPending = true;
  try {
    await fs.writeFile(ACTIVITY_STORE_FILE, JSON.stringify(activityBuffer.slice(-ACTIVITY_MAX)), 'utf-8');
  } catch { /* non-fatal */ }
  finally { activityFlushPending = false; }
}

export function pushActivity(event: Omit<ActivityEvent, 'id'>): ActivityEvent {
  const full: ActivityEvent = { id: buildId('act'), ...event };
  const isDuplicate = activityBuffer.some(
    e => e.title === full.title && e.timestamp === full.timestamp
  );
  if (isDuplicate) return full;
  activityBuffer.push(full);
  if (activityBuffer.length > ACTIVITY_MAX) activityBuffer = activityBuffer.slice(-ACTIVITY_MAX);
  void flushActivityStore();
  return full;
}

// ── Inference Engine ─────────────────────────────────────────────────────────

export function inferFsEvent(
  watchEvent: 'rename' | 'change',
  filePath: string,
  existed: boolean,
): Omit<ActivityEvent, 'id' | 'timestamp'> | null {
  const base = path.basename(filePath);
  const parts = filePath.split(path.sep);

  const skillsIdx = parts.lastIndexOf('skills');
  const isInSkills = skillsIdx >= 0 && parts.length > skillsIdx + 1;
  const skillName = isInSkills ? parts[skillsIdx + 1] : null;
  const isInConfig = parts.includes('config') && !isInSkills;

  if (base === 'SKILL.md' && isInSkills) {
    const type = (watchEvent === 'rename' && !existed) ? 'skill_created' : 'skill_updated';
    return { source: 'fs', type, category: 'development',
      title: `${type === 'skill_created' ? t('main.activity.skills.created') : t('main.activity.skills.updated')}：${skillName}`,
      detail: filePath, path: filePath };
  }
  if ((base.endsWith('.py') || base.endsWith('.ts') || base.endsWith('.js')) && isInSkills) {
    return { source: 'fs', type: 'skill_updated', category: 'development',
      title: `${watchEvent === 'rename' ? t('main.activity.skills.codeAdded') : t('main.activity.skills.codeModified')}：${skillName}/${base}`,
      detail: filePath, path: filePath };
  }
  if (isInConfig && (base.endsWith('.json') || base.endsWith('.yaml') || base.endsWith('.toml'))) {
    return { source: 'fs', type: 'config_changed', category: 'config',
      title: `${t('main.activity.config.changed')}：${base}`, detail: filePath, path: filePath };
  }
  if (base === 'tasks.json') {
    return { source: 'fs', type: 'task_updated', category: 'task',
      title: t('main.activity.tasks.updated'), detail: filePath, path: filePath };
  }
  if (base.endsWith('.py') && !isInSkills) {
    return { source: 'fs', type: 'script_executed', category: 'execution',
      title: `${watchEvent === 'rename' ? t('main.activity.scripts.created') : t('main.activity.scripts.modified')}：${base}`,
      detail: filePath, path: filePath };
  }
  const ext = path.extname(base);
  if (!base.startsWith('.') && ['.md', '.txt', '.json', '.yaml', '.toml', '.sh'].includes(ext)) {
    return { source: 'fs', type: 'file_change', category: 'system',
      title: `${watchEvent === 'rename' ? t('main.activity.files.createdDeleted') : t('main.activity.files.modified')}：${path.basename(path.dirname(filePath))}/${base}`,
      detail: filePath, path: filePath };
  }
  return null;
}

// ── Config paths ─────────────────────────────────────────────────────────────

const HOME = process.env['HOME'] || '';

export async function readLauncherConfigPaths(): Promise<{
  corePath: string; workspacePath: string; configPath: string; stateDir: string;
}> {
  const fallback = {
    corePath: '', workspacePath: '', configPath: '',
    stateDir: process.env['OPENCLAW_STATE_DIR'] || path.join(HOME, '.openclaw'),
  };
  try {
    const raw = await fs.readFile(_getClawlaunchFile(), 'utf-8');
    const cfg = JSON.parse(raw);
    return {
      corePath:      String(cfg.corePath      || '').trim(),
      workspacePath: String(cfg.workspacePath || '').trim(),
      configPath:    String(cfg.configPath    || '').trim(),
      stateDir:      String(cfg.stateDir      || process.env['OPENCLAW_STATE_DIR'] || path.join(HOME, '.openclaw')).trim(),
    };
  } catch { return fallback; }
}

export async function buildWatchDirs(): Promise<string[]> {
  const { corePath, workspacePath, stateDir } = await readLauncherConfigPaths();
  const dirs: string[] = [];
  if (corePath) {
    dirs.push(path.join(corePath, 'skills'));
    dirs.push(path.join(corePath, 'config'));
    dirs.push(corePath);
  }
  if (workspacePath) dirs.push(workspacePath);
  if (stateDir)      dirs.push(path.join(stateDir, 'agents'));
  return [...new Set(dirs)];
}

// ── FileSystem Watcher ────────────────────────────────────────────────────────

export const activeWatchers: ReturnType<typeof fsWatch>[] = [];

export async function startActivityWatcher(extraDirs: string[] = []): Promise<void> {
  for (const w of activeWatchers) { try { w.close(); } catch {} }
  activeWatchers.length = 0;

  const configDirs = await buildWatchDirs();
  const dirsToWatch = [...new Set([...configDirs, ...extraDirs])];

  for (const dir of dirsToWatch) {
    if (!existsSync(dir)) continue;
    try {
      const watcher = fsWatch(dir, { recursive: true }, (watchEvent, filename) => {
        if (!filename) return;
        const fullPath = path.join(dir, String(filename));
        const base = path.basename(fullPath);
        if (base.startsWith('.') || fullPath.endsWith('~') || fullPath.endsWith('.lock')) return;
        const existed = existsSync(fullPath);
        const inferred = inferFsEvent(watchEvent as 'rename' | 'change', fullPath, existed);
        if (inferred) pushActivity({ ...inferred, timestamp: Date.now() });
      });
      activeWatchers.push(watcher);
    } catch { /* dir not watchable */ }
  }
}

// ── JSONL Session Scanner ─────────────────────────────────────────────────────

export const jsonlOffsets: Map<string, number> = new Map();

export async function scanJsonlFile(filePath: string): Promise<void> {
  try {
    const fh = await fs.open(filePath, 'r');
    const stat = await fh.stat();
    const offset = jsonlOffsets.get(filePath) ?? 0;
    if (stat.size <= offset) { await fh.close(); return; }
    const len = stat.size - offset;
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, offset);
    await fh.close();
    jsonlOffsets.set(filePath, stat.size);
    const lines = buf.toString('utf-8').split('\n').filter(Boolean);
    const agentMatch = filePath.match(/agents\/([^/]+)\/sessions\//);
    const agentId = agentMatch ? agentMatch[1] : 'unknown';

    for (const line of lines) {
      try {
        const evt = JSON.parse(line);
        if (evt?.type !== 'message') continue;
        const ts = evt.timestamp ? new Date(evt.timestamp).getTime() : Date.now();
        const msg = evt.message || {};
        const role = msg.role || '';
        const contentArr: unknown[] = Array.isArray(msg.content) ? msg.content as unknown[] : [];

        if (role === 'assistant') {
          for (const c of contentArr) {
            const cv = c as Record<string, unknown>;
            if (!cv || cv.type !== 'toolCall') continue;
            const toolName = String(cv.name || '');
            const args = (cv.arguments as Record<string, unknown>) || {};

            if (toolName === 'exec') {
              const cmd = String(args.command || '').trim().slice(0, 100);
              if (!cmd) continue;
              pushActivity({
                timestamp: ts, source: 'jsonl', type: 'script_executed', category: 'execution',
                title: `${t('main.activity.agent.exec')} [${agentId}]：${cmd}`,
                detail: cmd, agent: agentId,
              });
            } else if (toolName === 'write') {
              const fp = String(args.path || '');
              const base = path.basename(fp);
              if (!fp) continue;
              const fpParts = fp.split(path.sep);
              const isSkill = fpParts.includes('skills');
              const isConfig = fpParts.includes('config') && !isSkill;
              pushActivity({
                timestamp: ts, source: 'jsonl',
                type: isSkill ? 'skill_created' : 'file_change',
                category: isSkill ? 'development' : isConfig ? 'config' : 'execution',
                title: (isSkill
                  ? `${t('main.activity.agent.createSkillFile')} [${agentId}]`
                  : `${t('main.activity.agent.writeFile')} [${agentId}]`) + `：${base}`,
                detail: fp, agent: agentId, path: fp,
              });
            } else if (toolName === 'edit') {
              const fp = String(args.path || '');
              const base = path.basename(fp);
              if (!fp) continue;
              const fpParts = fp.split(path.sep);
              const isSkill = fpParts.includes('skills');
              pushActivity({
                timestamp: ts, source: 'jsonl',
                type: isSkill ? 'skill_updated' : 'file_change',
                category: isSkill ? 'development' : 'execution',
                title: (isSkill
                  ? `${t('main.activity.agent.modifySkill')} [${agentId}]`
                  : `${t('main.activity.agent.editFile')} [${agentId}]`) + `：${base}`,
                detail: fp, agent: agentId, path: fp,
              });
            } else if (toolName === 'web_fetch' || toolName === 'web_search') {
              const query = String(args.url || args.query || '').slice(0, 80);
              pushActivity({
                timestamp: ts, source: 'jsonl', type: 'agent_action', category: 'execution',
                title: `${toolName === 'web_search' ? t('main.activity.agent.webSearch') : t('main.activity.agent.webScrape')} [${agentId}]：${query}`,
                detail: query, agent: agentId,
              });
            }
          }
        }
      } catch { /* malformed line */ }
    }
  } catch { /* file not readable */ }
}

export async function scanAllSessions(stateDir?: string): Promise<void> {
  const resolved = stateDir || (await readLauncherConfigPaths()).stateDir;
  const base = resolved || path.join(HOME, '.openclaw');
  const agentsDir = path.join(base, 'agents');
  try {
    const agents = await fs.readdir(agentsDir);
    for (const agent of agents) {
      const sessionsDir = path.join(agentsDir, agent, 'sessions');
      try {
        const files = await fs.readdir(sessionsDir);
        const jsonlFiles = files.filter(f => f.endsWith('.jsonl')).map(f => path.join(sessionsDir, f));
        const recent = jsonlFiles.sort().slice(-10);
        for (const f of recent) { await scanJsonlFile(f); }
      } catch { /* no sessions dir */ }
    }
  } catch { /* no agents dir */ }
}

// ── Cron State Scanner ────────────────────────────────────────────────────────

export const cronLastSeen: Map<string, number> = new Map();

export async function scanCronJobs(stateDir?: string): Promise<void> {
  const resolved = stateDir || (await readLauncherConfigPaths()).stateDir;
  const base = resolved || path.join(HOME, '.openclaw');
  const cronPath = path.join(base, 'cron', 'jobs.json');
  try {
    const raw = await fs.readFile(cronPath, 'utf-8');
    const data = JSON.parse(raw);
    for (const job of (data.jobs || [])) {
      const lastRun = job.state?.lastRunAtMs;
      if (!lastRun) continue;
      const prev = cronLastSeen.get(job.id);
      if (prev === lastRun) continue;
      cronLastSeen.set(job.id, lastRun);
      if (prev !== undefined) {
        const isOk = job.state?.lastStatus === 'ok';
        pushActivity({
          timestamp: lastRun,
          source: 'cron', type: 'scheduled_run',
          category: isOk ? 'scheduled' : 'alert',
          title: `${isOk ? t('main.activity.cron.success') : t('main.activity.cron.failure')}：${job.name}`,
          detail: job.state?.lastError,
          agent: job.agentId,
          exitCode: isOk ? 0 : 1,
        });
      }
    }
  } catch { /* no jobs.json */ }
}
