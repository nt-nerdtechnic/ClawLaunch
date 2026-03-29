/** shell:exec IPC Handler — 所有 shell 指令的統一路由器。
 *  從 main.ts 提取，透過 ShellExecContext 接收仍需注入的全域狀態。
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import https from 'node:https';
import { spawn } from 'node:child_process';
import { app, ipcMain, dialog } from 'electron';
import { t } from '../utils/i18n.js';
import { safeJsonParse, normalizeConfigDir, normalizeString, normalizeArray, normalizeNumber, pickFirst, buildId } from '../utils/normalize.js';
import { shellQuote, escapeAppleScriptString, uniqueNonEmptyPaths } from '../utils/shell-utils.js';
import { pickTextFromUnknownContent, extractMessageText, deriveSessionDisplayName, isAssistantMessage, extractRunIdFromSendPayload } from '../utils/chat-helpers.js';
import { inferAuthChoiceFromProfile, parseOpenClawConfig, collectAuthProfiles, loadJsonFile, saveJsonFile, getAgentAuthProfilePaths, hasCredential, unwrapCliArg, AUTH_CHOICE_FLAG_MAPPING, AUTH_CHOICE_PROVIDER_ALIASES, SUPPORTED_AUTH_CHOICES, CREDENTIALLESS_AUTH_CHOICES, OAUTH_AUTH_CHOICES, sanitizeSecret, hasCjkCharacters, isLikelyNaturalLanguageSentence, isPlausibleMachineToken, getProfileProviderAliases, getChoiceAliases, providerAliasSets, providerMatchesAny, profileMatchesAliases } from '../services/auth.js';
import { copyDir, writeFileIfMissing, parseSkillMetadata, scanSkillsInDir, scanInstalledSkills } from '../services/skills.js';
import { normalizeReadModelSnapshot, buildReadModelHistoryFromJsonl, fallbackHistoryFromSnapshot, parseSessionJsonlForUsage, type RuntimeUsageEvent } from '../services/snapshot.js';
import { computeTaskGovernance, buildGovernanceEvents, resolveRuntimeDirFromCandidates, loadEventAcks, saveEventAcks, applyAckStateToEvents, buildAuditTimeline, buildDailyDigestMarkdown } from '../services/governance.js';
import { readControlCenterState, writeControlCenterState, appendControlAudit, buildControlOverview, buildControlBudgetStatus, enforceControlMutationTokenGate, pushQueueIfMissing, pushApprovalIfMissing, runControlAutoSync, parseControlPayload, nowIso, type ControlCenterState, type ControlTaskItem, type ControlProjectItem, type ControlQueueItem, type ControlAuditItem, type ControlApprovalItem, type ControlApprovalStatus, type ControlBudgetPolicy } from '../services/control-center.js';
import { buildGatewayUrlArg, readEnvOverride, resolveGatewayCredentials, buildGatewayAuthArg, isGatewayOnlineFromStatus, resolveOpenClawRuntime } from '../services/openclaw-runtime.js';

// ── Local helpers (inline — only used within this handler) ───────────────────

const tryParseJsonObject = (value: string) => {
  const parsed = safeJsonParse(value, null);
  if (parsed && typeof parsed === 'object') return parsed;
  return null;
};

const parseGatewayCallStdoutJson = (rawStdout: string) => {
  const ansiRegex = /[\x1b\x9b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
  const stdout = String(rawStdout || '').replace(ansiRegex, '').trim();
  if (!stdout) return null;
  const fullParsed = tryParseJsonObject(stdout);
  if (fullParsed) return fullParsed;
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const parsedLine = tryParseJsonObject(lines[i]);
    if (parsedLine) return parsedLine;
  }
  const stripped = lines.filter((line) => !line.startsWith('>')).join('\n');
  const firstBrace = stripped.indexOf('{');
  const lastBrace = stripped.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const sliceParsed = tryParseJsonObject(stripped.slice(firstBrace, lastBrace + 1));
    if (sliceParsed) return sliceParsed;
  }
  const firstBraceOrig = stdout.indexOf('{');
  const lastBraceOrig = stdout.lastIndexOf('}');
  if (firstBraceOrig >= 0 && lastBraceOrig > firstBraceOrig) {
    return tryParseJsonObject(stdout.slice(firstBraceOrig, lastBraceOrig + 1));
  }
  return null;
};

// ── Context Interface ────────────────────────────────────────────────────────

export interface ShellExecContext {
  mainWindow: Electron.BrowserWindow | null;
  activeProcesses: Set<ReturnType<typeof spawn>>;
  sendToRenderer: (channel: string, payload: unknown) => void;
  emitShellStdout: (data: string, source?: 'stdout' | 'stderr') => void;
  runShellCommand: (command: string) => Promise<{ code: number; stdout: string; stderr: string }>;
  activateConfigPath: (newConfigPath: string) => Promise<void>;
  spawnWatchedGatewayProcess: (command: string) => ReturnType<typeof spawn>;
  stopGatewayWatchdog: (reason?: string) => void;
  stopGatewayHttpWatchdog: (reason?: string) => void;
  startGatewayHttpWatchdog: (options: Record<string, unknown>) => void;
  gatewayWatchdog: Record<string, unknown>;
  defaultGatewayOptions: Record<string, unknown>;
  killAllSubprocesses: () => void;
  startActivityWatcher: (extraDirs?: string[]) => Promise<void>;
  readLauncherConfigPaths: () => Promise<{ corePath: string; workspacePath: string; configPath: string; stateDir: string }>;
  persistentConfigDir: string;
  getClawlaunchFile: () => string;
  validateVersionRef: (raw: string) => string;
}

// ── Handler Registration ──────────────────────────────────────────────────────

export function registerShellExecHandler(ctx: ShellExecContext): void {
  ipcMain.handle('shell:exec', async (_event, command: string, args: string[] = []) => {
  const fullCommand = args.length > 0 ? `${command} ${args.join(' ')}` : command;

  if (fullCommand === 'app:get-version') {
    return { code: 0, stdout: app.getVersion(), stderr: '', exitCode: 0 };
  }

  if (fullCommand === 'app:check-update') {
    try {
      const current = app.getVersion();
      const releases = await new Promise<unknown[]>((resolve, reject) => {
        const req = https.get(
          'https://api.github.com/repos/nt-nerdtechnic/ClawLaunch/releases?per_page=1',
          { headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'NT-ClawLaunch' } },
          (res) => {
            if ((res.statusCode ?? 0) >= 400) {
              reject(new Error(`GitHub API returned ${res.statusCode}`));
              return;
            }
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
              try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid JSON response')); }
            });
          },
        );
        req.on('error', reject);
        req.setTimeout(10000, () => { req.destroy(); reject(new Error('Request timed out')); });
      });
      if (!releases.length) {
        return { code: 0, stdout: JSON.stringify({ current, latest: '', htmlUrl: '', upToDate: true, noReleases: true }), stderr: '', exitCode: 0 };
      }
      const rel0 = releases[0] as Record<string, unknown>;
      const latest = String(rel0.tag_name || '').replace(/^v/, '');
      const htmlUrl = String(rel0.html_url || '');
      const changelog = String(rel0.body || '');
      const publishedAt = String(rel0.published_at || '');
      const isNewer = !!latest && latest !== current;
      return { code: 0, stdout: JSON.stringify({ current, latest, htmlUrl, changelog, publishedAt, upToDate: !isNewer }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: e?.message || 'update check failed', exitCode: 1 };
    }
  }

  if (fullCommand === 'control:auth:status') {
    try {
      const state = await readControlCenterState();
      return {
        code: 0,
        stdout: JSON.stringify({ tokenRequired: !!String(state.controlToken || '').trim() }),
        stderr: '',
        exitCode: 0,
      };
    } catch (e) {
      return { code: 1, stdout: '', stderr: e?.message || 'control auth status failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('control:auth:set-token ')) {
    try {
      const payload = JSON.parse(fullCommand.replace('control:auth:set-token ', '').trim() || '{}');
      const newToken = String(payload?.newToken || '').trim();
      const currentToken = String(payload?.currentToken || '').trim();
      const state = await readControlCenterState();
      const existing = String(state.controlToken || '').trim();

      if (existing && existing !== currentToken) {
        return { code: 1, stdout: '', stderr: 'current token mismatch', exitCode: 1 };
      }

      const next: ControlCenterState = { ...state, controlToken: newToken };
      const audited = await appendControlAudit(next, 'control.auth.setToken', 'control-token', true, newToken ? 'token enabled' : 'token disabled');
      return { code: 0, stdout: JSON.stringify({ tokenRequired: !!audited.controlToken }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: e?.message || 'set control token failed', exitCode: 1 };
    }
  }

  if (fullCommand === 'control:auto-sync') {
    try {
      const result = await runControlAutoSync();
      return { code: 0, stdout: JSON.stringify(result), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: e?.message || 'control auto sync failed', exitCode: 1 };
    }
  }

  const gate = await enforceControlMutationTokenGate(fullCommand);
  if (!gate.ok) {
    return { code: 1, stdout: '', stderr: gate.message || 'control mutation blocked by token gate', exitCode: 1 };
  }

  if (fullCommand === 'control:overview') {
    try {
      const state = await readControlCenterState();
      return { code: 0, stdout: JSON.stringify(buildControlOverview(state)), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: e?.message || 'control overview failed', exitCode: 1 };
    }
  }

  if (fullCommand === 'control:budget:get') {
    try {
      const state = await readControlCenterState();
      return {
        code: 0,
        stdout: JSON.stringify({ policy: state.budgetPolicy, snapshot: buildControlBudgetStatus(state) }),
        stderr: '',
        exitCode: 0,
      };
    } catch (e) {
      return { code: 1, stdout: '', stderr: e?.message || 'get budget failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('control:budget:set-policy ')) {
    try {
      const payload = JSON.parse(fullCommand.replace('control:budget:set-policy ', '').trim() || '{}');
      const dailyUsdLimit = Number(payload?.dailyUsdLimit);
      const warnRatio = Number(payload?.warnRatio);
      if (!Number.isFinite(dailyUsdLimit) || dailyUsdLimit <= 0) {
        return { code: 1, stdout: '', stderr: 'dailyUsdLimit invalid', exitCode: 1 };
      }
      if (!Number.isFinite(warnRatio) || warnRatio <= 0 || warnRatio >= 1) {
        return { code: 1, stdout: '', stderr: 'warnRatio invalid', exitCode: 1 };
      }
      const state = await readControlCenterState();
      const next: ControlCenterState = {
        ...state,
        budgetPolicy: {
          dailyUsdLimit: Number(dailyUsdLimit.toFixed(2)),
          warnRatio: Number(warnRatio.toFixed(3)),
        },
      };
      const audited = await appendControlAudit(next, 'budget.setPolicy', 'budget-policy', true, `limit=${dailyUsdLimit}, warn=${warnRatio}`);
      return { code: 0, stdout: JSON.stringify({ policy: audited.budgetPolicy, snapshot: buildControlBudgetStatus(audited) }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: e?.message || 'set budget policy failed', exitCode: 1 };
    }
  }

  if (fullCommand === 'control:approvals:list') {
    try {
      const state = await readControlCenterState();
      return { code: 0, stdout: JSON.stringify({ items: state.approvals }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: e?.message || 'list approvals failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('control:approvals:add ')) {
    try {
      const payload = JSON.parse(fullCommand.replace('control:approvals:add ', '').trim() || '{}');
      const title = String(payload?.title || '').trim();
      if (!title) {
        return { code: 1, stdout: '', stderr: 'approval title is required', exitCode: 1 };
      }
      const now = nowIso();
      const item: ControlApprovalItem = {
        id: buildId('approval'),
        title,
        detail: String(payload?.detail || '').trim(),
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      };
      const state = await readControlCenterState();
      const next: ControlCenterState = { ...state, approvals: [item, ...state.approvals] };
      const audited = await appendControlAudit(next, 'approval.add', item.id, true, `approval created: ${item.title}`);
      return { code: 0, stdout: JSON.stringify({ item, total: audited.approvals.length }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: e?.message || 'add approval failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('control:approvals:decide ')) {
    try {
      const payload = JSON.parse(fullCommand.replace('control:approvals:decide ', '').trim() || '{}');
      const approvalId = String(payload?.approvalId || '').trim();
      const decision = String(payload?.decision || '').trim();
      const reason = String(payload?.reason || '').trim();
      const dryRun = payload?.dryRun !== false;

      if (!approvalId || !['approved', 'rejected'].includes(decision)) {
        return { code: 1, stdout: '', stderr: 'approvalId/decision invalid', exitCode: 1 };
      }

      const state = await readControlCenterState();
      const target = state.approvals.find((item) => item.id === approvalId);
      if (!target) {
        return { code: 1, stdout: '', stderr: 'approval not found', exitCode: 1 };
      }

      if (dryRun) {
        const audited = await appendControlAudit(state, 'approval.decide.dryRun', approvalId, true, `dry-run ${decision}`);
        return { code: 0, stdout: JSON.stringify({ dryRun: true, item: target, auditSize: audited.audit.length }), stderr: '', exitCode: 0 };
      }

      const now = nowIso();
      const approvals = state.approvals.map((item) => {
        if (item.id !== approvalId) return item;
        return {
          ...item,
          status: decision as ControlApprovalStatus,
          decisionReason: reason,
          updatedAt: now,
          decidedAt: now,
        };
      });
      const next: ControlCenterState = { ...state, approvals };
      const audited = await appendControlAudit(next, 'approval.decide.live', approvalId, true, `live ${decision}`);
      return { code: 0, stdout: JSON.stringify({ dryRun: false, items: audited.approvals }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: e?.message || 'decide approval failed', exitCode: 1 };
    }
  }

  // ── NT_SKILL tasks.json helpers ──────────────────────────────────────────
  // Path derived from saved workspacePath in config — no hardcoded paths
  const getNTTasksFile = async (): Promise<string> => {
    const { workspacePath } = await ctx.readLauncherConfigPaths();
    if (workspacePath) return path.join(workspacePath, 'tasks.json');
    // No config found — return a non-existent path so reads return [] gracefully
    return path.join(ctx.persistentConfigDir, 'tasks-fallback.json');
  };
  const readNTTasks = async (): Promise<Record<string, unknown>[]> => {
    try {
      const file = await getNTTasksFile();
      const raw = await fs.readFile(file, 'utf-8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  };
  const writeNTTasks = async (tasks: Record<string, unknown>[]): Promise<void> => {
    const file = await getNTTasksFile();
    await fs.writeFile(file, JSON.stringify(tasks, null, 2), 'utf-8');
  };
  // ─────────────────────────────────────────────────────────────────────────

  if (fullCommand === 'control:tasks:list') {
    try {
      const items = await readNTTasks();
      return { code: 0, stdout: JSON.stringify({ items }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: e?.message || 'list tasks failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('control:tasks:add ')) {
    try {
      const payload = JSON.parse(fullCommand.replace('control:tasks:add ', '').trim() || '{}');
      const title = String(payload?.title || '').trim();
      if (!title) {
        return { code: 1, stdout: '', stderr: 'task title is required', exitCode: 1 };
      }
      const now = nowIso();
      const task = {
        id: Math.random().toString(36).slice(2, 10),
        title,
        status: ['todo', 'in_progress', 'blocked', 'done'].includes(String(payload?.status || ''))
          ? payload.status : 'todo',
        priority: String(payload?.priority || 'medium'),
        components: [
          { key: 'initial_purpose', label: t('main.constants.initialPurpose'), content: '', weight: 0.2, progress: 0.0 },
          { key: 'final_goal',      label: t('main.constants.finalGoal'), content: '', weight: 0.3, progress: 0.0 },
          { key: 'description',     label: t('main.constants.description'),     content: String(payload?.description || ''), weight: 0.5, progress: 0.0 },
        ],
        overall_progress: 0.0,
        created_at: now,
        updated_at: now,
        owner: String(payload?.owner || ''),
        tags: [],
        metadata: {},
      };
      const tasks = await readNTTasks();
      tasks.unshift(task);
      await writeNTTasks(tasks);
      return { code: 0, stdout: JSON.stringify({ item: task, total: tasks.length }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: e?.message || 'add task failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('control:tasks:update-status ')) {
    try {
      const payload = JSON.parse(fullCommand.replace('control:tasks:update-status ', '').trim() || '{}');
      const taskId = String(payload?.taskId || '').trim();
      const status = String(payload?.status || '').trim();
      if (!taskId || !['todo', 'in_progress', 'blocked', 'done'].includes(status)) {
        return { code: 1, stdout: '', stderr: 'taskId/status invalid', exitCode: 1 };
      }
      const tasks = await readNTTasks();
      let found = false;
      const updated = tasks.map((t) => {
        if (t.id !== taskId) return t;
        found = true;
        const next: Record<string, unknown> = { ...t, status, updated_at: nowIso() };
        if (status === 'done') {
          next.overall_progress = 100.0;
          next.components = ((t.components as Record<string, unknown>[] | undefined) || []).map((c) => ({ ...c, progress: 1.0 }));
        }
        return next;
      });
      if (!found) return { code: 1, stdout: '', stderr: 'task not found', exitCode: 1 };
      await writeNTTasks(updated);
      return { code: 0, stdout: JSON.stringify({ items: updated }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: e?.message || 'update task status failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('control:tasks:delete ')) {
    try {
      const payload = JSON.parse(fullCommand.replace('control:tasks:delete ', '').trim() || '{}');
      const taskId = String(payload?.taskId || '').trim();
      if (!taskId) return { code: 1, stdout: '', stderr: 'taskId is required', exitCode: 1 };
      const tasks = await readNTTasks();
      await writeNTTasks(tasks.filter((t) => t.id !== taskId));
      return { code: 0, stdout: JSON.stringify({ ok: true }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: e?.message || 'delete task failed', exitCode: 1 };
    }
  }

  // ── Silently execute shell commands (no renderer log) ────────────────────────────
  const runSilent = (cmd: string): Promise<{ stdout: string; stderr: string; code: number }> =>
    new Promise((resolve) => {
      const child = spawn(cmd, { shell: true });
      let stdout = '', stderr = '';
      child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
      child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
      child.on('close', (code: number | null) => resolve({ stdout, stderr, code: code ?? 1 }));
      child.on('error', () => resolve({ stdout, stderr, code: 1 }));
    });

  if (fullCommand === 'system:crontab:list') {
    try {
      const res = await runSilent('crontab -l');
      const lines = res.stdout.split('\n').filter(l => l.trim() && (!l.trim().startsWith('#') || l.trim().startsWith('# [DISABLED]')));
      const entries = lines.map(line => {
        const isPaused = line.trim().startsWith('# [DISABLED]');
        const actualLine = isPaused ? line.trim().replace(/^#\s*\[DISABLED\]\s*/, '') : line.trim();
        const parts = actualLine.split(/\s+/);
        const schedule = parts.slice(0, 5).join(' ');
        const command = parts.slice(5).join(' ');
        const name = command.split('/').pop()?.replace(/\.sh$/, '') || command.slice(0, 40);
        return { schedule, command, name, raw: line.trim(), enabled: !isPaused };
      });
      return { code: 0, stdout: JSON.stringify({ entries }), stderr: '', exitCode: 0 };
    } catch (_e) {
      return { code: 0, stdout: JSON.stringify({ entries: [] }), stderr: '', exitCode: 0 };
    }
  }

  if (fullCommand.startsWith('system:crontab:toggle ')) {
    try {
      const payload = JSON.parse(fullCommand.replace('system:crontab:toggle ', '').trim() || '{}');
      const raw = String(payload?.raw || '');
      if (!raw) return { code: 1, stdout: '', stderr: 'raw is required', exitCode: 1 };
      
      const res = await runSilent('crontab -l');
      const lines = res.stdout.split('\n');
      const newLines = lines.map(l => {
        if (l.trim() === raw.trim()) {
          return l.trim().startsWith('# [DISABLED]') 
            ? l.replace(/^#\s*\[DISABLED\]\s*/, '') 
            : `# [DISABLED] ${l}`;
        }
        return l;
      });
      
      const tmpPath = path.join(app.getPath('temp'), `crontab_${Date.now()}`);
      await fs.writeFile(tmpPath, newLines.join('\n'), 'utf-8');
      await runSilent(`crontab "${tmpPath}"`);
      await fs.rm(tmpPath, { force: true }).catch(() => {});
      
      return { code: 0, stdout: JSON.stringify({ ok: true }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: e?.message || 'crontab toggle failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('system:crontab:delete ')) {
    try {
      const payload = JSON.parse(fullCommand.replace('system:crontab:delete ', '').trim() || '{}');
      const raw = String(payload?.raw || '');
      if (!raw) return { code: 1, stdout: '', stderr: 'raw is required', exitCode: 1 };
      
      const res = await runSilent('crontab -l');
      const lines = res.stdout.split('\n');
      const newLines = lines.filter(l => l.trim() !== raw.trim());
      
      const tmpPath = path.join(app.getPath('temp'), `crontab_${Date.now()}`);
      await fs.writeFile(tmpPath, newLines.join('\n'), 'utf-8');
      await runSilent(`crontab "${tmpPath}"`);
      await fs.rm(tmpPath, { force: true }).catch(() => {});
      
      return { code: 0, stdout: JSON.stringify({ ok: true }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: e?.message || 'crontab delete failed', exitCode: 1 };
    }
  }

  if (fullCommand === 'system:launchagents:list') {
    try {
      const home = process.env['HOME'] || '';
      const agentsDir = path.join(home, 'Library/LaunchAgents');
      
      const friendlyNames: Record<string, string> = {
        'ai.openclaw.gateway': 'OpenClaw Gateway',
        'ai.openclaw.watchdog': 'OpenClaw Watchdog',
      };

      let files: string[] = [];
      try {
        files = await fs.readdir(agentsDir);
      } catch {
        // Directory might not exist
      }

      const plistFiles = files.filter(f => f.endsWith('.plist'));
      const launchctlRes = await runSilent('launchctl list');
      const listOutput = launchctlRes.stdout;

      const agents = await Promise.all(plistFiles.map(async (filename) => {
        const label = filename.replace('.plist', '');
        const plistPath = path.join(agentsDir, filename);
        const name = friendlyNames[label] || label;

        let plistExists = false;
        let keepAlive = false;
        let comment = '';
        try {
          const raw = await fs.readFile(plistPath, 'utf-8');
          plistExists = true;
          keepAlive = raw.includes('<key>KeepAlive</key>');
          const commentMatch = raw.match(/<key>Comment<\/key>\s*<string>([^<]+)<\/string>/);
          if (commentMatch) comment = commentMatch[1];
        } catch { /* plist missing */ }

        const line = listOutput.split('\n').find(l => l.includes(label));
        let running = false;
        let pid: number | null = null;
        let exitCode: number | null = null;
        if (line) {
          const parts = line.trim().split(/\s+/);
          pid = parts[0] && parts[0] !== '-' ? parseInt(parts[0]) : null;
          exitCode = parts[1] ? parseInt(parts[1]) : null;
          running = pid !== null && !isNaN(pid);
        }

        return { label, name, plistExists, keepAlive, comment, loaded: !!line, running, pid, exitCode };
      }));

      return { code: 0, stdout: JSON.stringify({ agents }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: e?.message || 'launchagents list failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('system:launchagents:toggle ')) {
    try {
      const payload = JSON.parse(fullCommand.replace('system:launchagents:toggle ', '').trim() || '{}');
      const agentLabel = String(payload?.label || '');
      if (!agentLabel) return { code: 1, stdout: '', stderr: 'label is required', exitCode: 1 };
      
      const home = process.env['HOME'] || '';
      const plist = path.join(home, `Library/LaunchAgents/${agentLabel}.plist`);
      
      const launchctlRes = await runSilent('launchctl list');
      const isLoaded = launchctlRes.stdout.split('\n').some(l => l.includes(agentLabel));
      
      if (isLoaded) {
        await runSilent(`launchctl unload -w "${plist}"`);
      } else {
        await runSilent(`launchctl load -w "${plist}"`);
      }
      return { code: 0, stdout: JSON.stringify({ ok: true }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: e?.message || 'launchagents toggle failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('system:launchagents:delete ')) {
    try {
      const payload = JSON.parse(fullCommand.replace('system:launchagents:delete ', '').trim() || '{}');
      const agentLabel = String(payload?.label || '');
      if (!agentLabel) return { code: 1, stdout: '', stderr: 'label is required', exitCode: 1 };
      
      const home = process.env['HOME'] || '';
      const plist = path.join(home, `Library/LaunchAgents/${agentLabel}.plist`);
      
      await runSilent(`launchctl unload -w "${plist}"`);
      await fs.rm(plist, { force: true }).catch(() => {});
      
      return { code: 0, stdout: JSON.stringify({ ok: true }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: e?.message || 'launchagents delete failed', exitCode: 1 };
    }
  }

  if (fullCommand === 'cron:list') {
    try {
      const payload = JSON.parse(fullCommand.replace('cron:list', '').trim() || '{}');
      const stateDir = String(payload?.stateDir || process.env['OPENCLAW_STATE_DIR'] || path.join(process.env['HOME'] || '', '.openclaw')).trim();
      const cronPath = path.join(stateDir, 'cron', 'jobs.json');
      try {
        const raw = await fs.readFile(cronPath, 'utf-8');
        return { code: 0, stdout: raw, stderr: '', exitCode: 0 };
      } catch {
        return { code: 0, stdout: JSON.stringify({ version: 1, jobs: [] }), stderr: '', exitCode: 0 };
      }
    } catch (e) {
      return { code: 1, stdout: '', stderr: e?.message || 'cron list failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('cron:list ')) {
    try {
      const payload = JSON.parse(fullCommand.replace('cron:list ', '').trim() || '{}');
      const stateDir = String(payload?.stateDir || process.env['OPENCLAW_STATE_DIR'] || path.join(process.env['HOME'] || '', '.openclaw')).trim();
      const cronPath = path.join(stateDir, 'cron', 'jobs.json');
      try {
        const raw = await fs.readFile(cronPath, 'utf-8');
        return { code: 0, stdout: raw, stderr: '', exitCode: 0 };
      } catch {
        return { code: 0, stdout: JSON.stringify({ version: 1, jobs: [] }), stderr: '', exitCode: 0 };
      }
    } catch (e) {
      return { code: 1, stdout: '', stderr: e?.message || 'cron list failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('cron:toggle ')) {
    try {
      const payload = JSON.parse(fullCommand.replace('cron:toggle ', '').trim() || '{}');
      const jobId = String(payload?.jobId || '').trim();
      const stateDir = String(payload?.stateDir || process.env['OPENCLAW_STATE_DIR'] || path.join(process.env['HOME'] || '', '.openclaw')).trim();
      if (!jobId) return { code: 1, stdout: '', stderr: 'jobId is required', exitCode: 1 };
      const cronPath = path.join(stateDir, 'cron', 'jobs.json');
      const raw = await fs.readFile(cronPath, 'utf-8');
      const data = JSON.parse(raw);
      let toggled = false;
      data.jobs = (data.jobs || []).map((job) => {
        if (job.id === jobId) { toggled = true; return { ...job, enabled: !job.enabled, updatedAtMs: Date.now() }; }
        return job;
      });
      if (!toggled) return { code: 1, stdout: '', stderr: `job ${jobId} not found`, exitCode: 1 };
      await fs.writeFile(cronPath, JSON.stringify(data, null, 2), 'utf-8');
      return { code: 0, stdout: JSON.stringify({ ok: true }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: e?.message || 'cron toggle failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('cron:delete ')) {
    try {
      const payload = JSON.parse(fullCommand.replace('cron:delete ', '').trim() || '{}');
      const jobId = String(payload?.jobId || '').trim();
      const stateDir = String(payload?.stateDir || process.env['OPENCLAW_STATE_DIR'] || path.join(process.env['HOME'] || '', '.openclaw')).trim();
      if (!jobId) return { code: 1, stdout: '', stderr: 'jobId is required', exitCode: 1 };
      const cronPath = path.join(stateDir, 'cron', 'jobs.json');
      const raw = await fs.readFile(cronPath, 'utf-8');
      const data = JSON.parse(raw);
      const before = (data.jobs || []).length;
      data.jobs = (data.jobs || []).filter((job) => job.id !== jobId);
      if (data.jobs.length === before) return { code: 1, stdout: '', stderr: `job ${jobId} not found`, exitCode: 1 };
      await fs.writeFile(cronPath, JSON.stringify(data, null, 2), 'utf-8');
      return { code: 0, stdout: JSON.stringify({ ok: true }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: e?.message || 'cron delete failed', exitCode: 1 };
    }
  }

  if (fullCommand === 'control:projects:list') {
    try {
      const state = await readControlCenterState();
      return { code: 0, stdout: JSON.stringify({ items: state.projects }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: e?.message || 'list projects failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('control:projects:add ')) {
    try {
      const payload = JSON.parse(fullCommand.replace('control:projects:add ', '').trim() || '{}');
      const name = String(payload?.name || '').trim();
      if (!name) {
        return { code: 1, stdout: '', stderr: 'project name is required', exitCode: 1 };
      }
      const now = nowIso();
      const project: ControlProjectItem = {
        id: buildId('project'),
        name,
        status: ['active', 'paused', 'done'].includes(String(payload?.status || '')) ? payload.status : 'active',
        createdAt: now,
        updatedAt: now,
      };
      const state = await readControlCenterState();
      const next = { ...state, projects: [project, ...state.projects] };
      const audited = await appendControlAudit(next, 'project.add', project.id, true, `project created: ${project.name}`);
      return { code: 0, stdout: JSON.stringify({ item: project, total: audited.projects.length }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: e?.message || 'add project failed', exitCode: 1 };
    }
  }

  if (fullCommand === 'control:queue:list') {
    try {
      const state = await readControlCenterState();
      return { code: 0, stdout: JSON.stringify({ items: state.queue }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: e?.message || 'list queue failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('control:queue:add ')) {
    try {
      const payload = JSON.parse(fullCommand.replace('control:queue:add ', '').trim() || '{}');
      const title = String(payload?.title || '').trim();
      if (!title) {
        return { code: 1, stdout: '', stderr: 'queue title is required', exitCode: 1 };
      }
      const queueItem: ControlQueueItem = {
        id: buildId('queue'),
        title,
        detail: String(payload?.detail || '').trim(),
        severity: ['info', 'warn', 'critical'].includes(String(payload?.severity || '')) ? payload.severity : 'warn',
        status: 'pending',
        createdAt: nowIso(),
      };
      const state = await readControlCenterState();
      const next = { ...state, queue: [queueItem, ...state.queue] };
      const audited = await appendControlAudit(next, 'queue.add', queueItem.id, true, `queue item created: ${queueItem.title}`);
      return { code: 0, stdout: JSON.stringify({ item: queueItem, total: audited.queue.length }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: e?.message || 'add queue failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('control:queue:ack ')) {
    try {
      const payload = JSON.parse(fullCommand.replace('control:queue:ack ', '').trim() || '{}');
      const itemId = String(payload?.itemId || '').trim();
      if (!itemId) {
        return { code: 1, stdout: '', stderr: 'itemId is required', exitCode: 1 };
      }
      const state = await readControlCenterState();
      let found = false;
      const queue = state.queue.map((item) => {
        if (item.id !== itemId) return item;
        found = true;
        return { ...item, status: 'acked' as const, ackedAt: nowIso() };
      });
      if (!found) {
        return { code: 1, stdout: '', stderr: 'queue item not found', exitCode: 1 };
      }
      const next = { ...state, queue };
      const audited = await appendControlAudit(next, 'queue.ack', itemId, true, 'queue item acknowledged');
      return { code: 0, stdout: JSON.stringify({ items: audited.queue }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: e?.message || 'ack queue failed', exitCode: 1 };
    }
  }

  if (fullCommand === 'control:audit:list') {
    try {
      const state = await readControlCenterState();
      return { code: 0, stdout: JSON.stringify({ items: state.audit }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: e?.message || 'list audit failed', exitCode: 1 };
    }
  }

  // gateway:http-watchdog-start-json { enabled, healthCheckCommand, restartCommand, intervalMs?, failThreshold?, maxRestarts? }
  if (fullCommand.startsWith('gateway:http-watchdog-start-json ')) {
    try {
      const payloadStr = fullCommand.replace(/^gateway:http-watchdog-start-json\s+/, '').trim();
      const payload = JSON.parse(payloadStr || '{}');
      ctx.startGatewayHttpWatchdog(payload || {});
      return { code: 0, stdout: 'gateway http watchdog configured', exitCode: 0 };
    } catch (e) {
      return { code: 1, stderr: e?.message || 'Invalid gateway:http-watchdog-start-json payload', exitCode: 1 };
    }
  }

  if (fullCommand === 'gateway:http-watchdog-stop') {
    ctx.stopGatewayHttpWatchdog('manual stop command');
    return { code: 0, stdout: 'gateway http watchdog stopped', exitCode: 0 };
  }

  if (fullCommand === 'gateway:watchdogs-stop') {
    ctx.stopGatewayWatchdog('manual stop command');
    ctx.stopGatewayHttpWatchdog('manual stop command');
    return { code: 0, stdout: 'gateway watchdogs stopped', exitCode: 0 };
  }

  // gateway:start-bg-json { command, autoRestart, maxRestarts?, baseBackoffMs? }
  if (fullCommand.startsWith('gateway:start-bg-json ')) {
    try {
      const payloadStr = fullCommand.replace(/^gateway:start-bg-json\s+/, '').trim();
      const payload = JSON.parse(payloadStr || '{}');
      const actualCmd = String(payload?.command || '').trim();
      if (!actualCmd) {
        return { code: 1, stderr: 'Missing command for gateway:start-bg-json', exitCode: 1 };
      }

      ctx.stopGatewayWatchdog('replace previous gateway process');
      ctx.stopGatewayHttpWatchdog('switch to process watchdog mode');
      ctx.gatewayWatchdog.command = actualCmd;
      ctx.gatewayWatchdog.stopRequested = false;
      ctx.gatewayWatchdog.restartAttempts = 0;
      ctx.gatewayWatchdog.options = {
        autoRestart: Boolean(payload?.autoRestart),
        maxRestarts: Number.isInteger(payload?.maxRestarts) ? Math.max(1, Number(payload.maxRestarts)) : 5,
        baseBackoffMs: Number.isInteger(payload?.baseBackoffMs) ? Math.max(200, Number(payload.baseBackoffMs)) : 1000,
      };

      const child = ctx.spawnWatchedGatewayProcess(actualCmd);
      return { code: 0, stdout: String(child.pid ?? ''), exitCode: 0 };
    } catch (e) {
      return { code: 1, stderr: e?.message || 'Invalid gateway:start-bg-json payload', exitCode: 1 };
    }
  }

  // gateway:start-bg <cmd> — spawn the command in background and return immediately.
  // Used for `gateway run` which is a long-running foreground process.
  if (fullCommand.startsWith('gateway:start-bg ')) {
    const actualCmd = fullCommand.replace(/^gateway:start-bg\s+/, '').trim();
    if (!actualCmd) {
      return { code: 1, stderr: 'Missing command for gateway:start-bg', exitCode: 1 };
    }
    ctx.stopGatewayWatchdog('replace previous gateway process');
    ctx.stopGatewayHttpWatchdog('switch to process watchdog mode');
    ctx.gatewayWatchdog.command = actualCmd;
    ctx.gatewayWatchdog.stopRequested = false;
    ctx.gatewayWatchdog.restartAttempts = 0;
    ctx.gatewayWatchdog.options = { ...ctx.defaultGatewayOptions };
    const child = ctx.spawnWatchedGatewayProcess(actualCmd);
    return { code: 0, stdout: String(child.pid ?? ''), exitCode: 0 };
  }

  if (fullCommand.startsWith('snapshot:read-model')) {
    try {
      const payloadStr = fullCommand.replace('snapshot:read-model', '').trim();
      const payload = payloadStr ? JSON.parse(payloadStr) : {};
      const historyCandidatePaths: string[] = Array.isArray(payload?.historyCandidatePaths)
        ? payload.historyCandidatePaths.map((item) => String(item || '').trim()).filter(Boolean)
        : [];
      const historyDays = Math.max(1, Math.min(30, Number(payload?.historyDays || 7)));
      const taskHeartbeatTimeoutMs = Math.max(60_000, Math.min(24 * 60 * 60 * 1000, Number(payload?.taskHeartbeatTimeoutMs || 10 * 60 * 1000)));
      const candidatePaths: string[] = Array.isArray(payload?.candidatePaths)
        ? payload.candidatePaths.map((item) => String(item || '').trim()).filter(Boolean)
        : [];

      for (const snapshotPath of candidatePaths) {
        try {
          await fs.access(snapshotPath);
          const content = await fs.readFile(snapshotPath, 'utf-8');
          const rawSnapshot = JSON.parse(content);
          const readModel = normalizeReadModelSnapshot(rawSnapshot);
          const nowIso = new Date().toISOString();
          const taskGovernance = computeTaskGovernance(readModel, taskHeartbeatTimeoutMs, nowIso);
          readModel.tasks = taskGovernance.tasks as typeof readModel.tasks;

          const runtimeDir = path.dirname(snapshotPath);
          const ackMap = await loadEventAcks(runtimeDir);
          const governanceEvents = [
            ...taskGovernance.events,
            ...buildGovernanceEvents(readModel, nowIso),
          ];
          const { activeEvents, ackedEvents } = applyAckStateToEvents(governanceEvents, ackMap, nowIso);

          const auditTimeline = await buildAuditTimeline(runtimeDir, governanceEvents);
          const dailyDigest = buildDailyDigestMarkdown(auditTimeline);
          let history: unknown[] = [];
          let historySourcePath = '';

          for (const historyPath of historyCandidatePaths) {
            try {
              await fs.access(historyPath);
              const historyRaw = await fs.readFile(historyPath, 'utf-8');
              const parsedHistory = buildReadModelHistoryFromJsonl(historyRaw, historyDays);
              if (parsedHistory.length > 0) {
                history = parsedHistory;
                historySourcePath = historyPath;
                break;
              }
            } catch {
              continue;
            }
          }

          if (history.length === 0) {
            history = fallbackHistoryFromSnapshot(readModel, historyDays);
          }

          return {
            code: 0,
            stdout: JSON.stringify({
              sourcePath: snapshotPath,
              historySourcePath,
              snapshot: rawSnapshot,
              readModel,
              history,
              eventQueue: activeEvents,
              ackedEvents,
              auditTimeline,
              dailyDigest,
            }),
            stderr: '',
            exitCode: 0,
          };
        } catch {
          continue;
        }
      }

      return { code: 1, stdout: '', stderr: 'No readable snapshot found', exitCode: 1 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: e.message, exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('config:write')) {
    try {
      const configStr = fullCommand.replace('config:write ', '');
      const config = JSON.parse(configStr);
      
      const dir = path.join(app.getPath('home'), '.clawlaunch');
      await fs.mkdir(dir, { recursive: true }).catch(() => {});
      const configFilePath = path.join(dir, 'clawlaunch.json');
      
      await fs.writeFile(configFilePath, JSON.stringify(config, null, 2));
      if (config?.configPath) {
        ctx.activateConfigPath(String(config.configPath)).catch(() => {});
      }
      // Restart file watchers so new corePath/workspacePath are watched
      void ctx.startActivityWatcher();
      return { code: 0, stdout: `Config saved to ${configFilePath}`, stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: e.message, exitCode: 1 };
    }
  }

  if (fullCommand === 'config:read') {
    try {
      const dir = path.join(app.getPath('home'), '.clawlaunch');
      const configFilePath = path.join(dir, 'clawlaunch.json');
      let content = '{}';
      
      try {
        content = await fs.readFile(configFilePath, 'utf-8');
      } catch {
        // If file is missing, we return empty. 
        // DO NOT attempt to migrate from old paths or auto-create.
      }

      try {
        const parsed = JSON.parse(content);
        if (parsed?.configPath) {
          ctx.activateConfigPath(String(parsed.configPath)).catch(() => {});
        }
        // Always inject current app version into the result
        return { code: 0, stdout: JSON.stringify({ ...parsed, appVersion: app.getVersion() }), stderr: '', exitCode: 0 };
      } catch {
        return { code: 0, stdout: content, stderr: '', exitCode: 0 };
      }
    } catch (_e) {
      return { code: 1, stdout: '{}', stderr: 'No config file found', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('config:migrate-openclaw')) {
    try {
      const payloadStr = fullCommand.replace('config:migrate-openclaw ', '').trim();
      const payload = JSON.parse(payloadStr || '{}');
      const configFilePath = payload?.configPath ? path.join(payload.configPath, 'openclaw.json') : '';
      const workspacePath = payload?.workspacePath || '';
      if (!configFilePath) {
        return { code: 1, stderr: 'Missing config path', exitCode: 1 };
      }

      const raw = await fs.readFile(configFilePath, 'utf-8');
      const parsed = JSON.parse(raw);
      let changed = false;

      if (parsed && typeof parsed === 'object') {
        if ('version' in parsed) {
          delete parsed.version;
          changed = true;
        }
        if ('corePath' in parsed) {
          delete parsed.corePath;
          changed = true;
        }

        if (!parsed.agents || typeof parsed.agents !== 'object') {
          parsed.agents = {};
          changed = true;
        }
        if (!parsed.agents.defaults || typeof parsed.agents.defaults !== 'object') {
          parsed.agents.defaults = {};
          changed = true;
        }
        if (workspacePath && !parsed.agents.defaults.workspace) {
          parsed.agents.defaults.workspace = workspacePath;
          changed = true;
        }

        // Fix missing models array in each provider (OpenClaw >=2026.3.x requires this field)
        if (parsed.models && typeof parsed.models.providers === 'object' && parsed.models.providers !== null) {
          for (const [providerKey, providerVal] of Object.entries(parsed.models.providers)) {
            if (providerVal && typeof providerVal === 'object' && !Array.isArray((providerVal as Record<string, unknown>).models)) {
              (providerVal as Record<string, unknown>).models = [];
              changed = true;
            }
          }
        }
      }

      if (changed) {
        await fs.writeFile(configFilePath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf-8');
      }

      return { code: 0, stdout: JSON.stringify({ changed }), exitCode: 0 };
    } catch (e) {
      return { code: 1, stderr: e.message, exitCode: 1 };
    }
  }

  if (fullCommand === 'detect:paths' || fullCommand.startsWith('detect:paths ')) {
    const dir = path.join(app.getPath('home'), '.clawlaunch');
    const newConfigPath = path.join(dir, 'clawlaunch.json');

    let corePath = '';
    let configPath = '';
    let workspacePath = '';
    let existingConfig: Record<string, unknown> = {};

    // If explicit paths are passed as JSON argument, use them directly and skip reading the global file.
    // This prevents stale paths from a previous project polluting a new-project onboarding scan.
    const detectArg = fullCommand.slice('detect:paths'.length).trim();
    if (detectArg) {
      try {
        const explicit = JSON.parse(detectArg);
        if (explicit.corePath) corePath = String(explicit.corePath);
        if (explicit.configPath) configPath = String(explicit.configPath);
        if (explicit.workspacePath) workspacePath = String(explicit.workspacePath);
      } catch {}
    } else {
      // Strictly read ONLY from NEW config file. No more "guessing" or legacy fallback.
      try {
        const raw = await fs.readFile(newConfigPath, 'utf-8');
        const cfg = JSON.parse(raw);
        if (cfg.corePath) corePath = cfg.corePath;
        if (cfg.configPath) configPath = cfg.configPath;
        if (cfg.workspacePath) workspacePath = cfg.workspacePath;

        if (configPath) {
          const openclawFile = path.join(configPath, 'openclaw.json');
          try {
            const content = await fs.readFile(openclawFile, 'utf-8');
            existingConfig = parseOpenClawConfig(content);
            // Only fall back to openclaw.json workspace when clawlaunch.json has no workspacePath,
            // to prevent a stale workspace from a previous project overriding the current one.
            if (existingConfig.workspace && !workspacePath) workspacePath = existingConfig.workspace as string;
          } catch {}
        }
      } catch {}
    }

    // Scan for skills using the resolved (or explicitly provided) paths
    const coreSkills = corePath ? await scanSkillsInDir(path.join(corePath, 'skills')) : [];
    const workspaceSkills = workspacePath ? await scanInstalledSkills(workspacePath) : [];

    return { 
        code: 0, 
        stdout: JSON.stringify({ corePath, configPath, workspacePath, existingConfig: { ...existingConfig, workspaceSkills }, coreSkills }),
        exitCode: 0
    };
  }

  if (fullCommand === 'skill:import') {
    try {
      const result = await dialog.showOpenDialog(ctx.mainWindow!, {
        properties: ['openDirectory'],
        title: t('main.titles.selectSkillFolder'),
      });
      if (result.canceled) return { code: 0, stdout: 'Canceled', exitCode: 0 };
      
      const sourcePath = result.filePaths[0];
      const skillName = path.basename(sourcePath);
      
      // Verify if it is a valid skill
      try {
        await fs.access(path.join(sourcePath, 'SKILL.md'));
      } catch (_e) {
        return { code: 1, stderr: t('main.ipc.errors.skillMissingMd'), exitCode: 1 };
      }

      // Get target path
      const configPath = ctx.getClawlaunchFile();
      let targetBaseDir = '';
      try {
        const content = await fs.readFile(configPath, 'utf-8');
        const config = JSON.parse(content);
        targetBaseDir = config.workspacePath || config.configPath;
      } catch (_e) {}
      
      if (!targetBaseDir) {
        return { code: 1, stderr: t('main.ipc.errors.missingPath'), exitCode: 1 };
      }

      const targetPath = path.join(targetBaseDir, 'skills', skillName);
      
      // Execute copy (fs.cp supported in Node 16+)
      await fs.mkdir(path.join(targetBaseDir, 'skills'), { recursive: true });
      await fs.cp(sourcePath, targetPath, { recursive: true });
      
      return { code: 0, stdout: t('main.ipc.success.skillImported', { name: skillName }), exitCode: 0 };
    } catch (e) {
      return { code: 1, stderr: e.message, exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('skill:delete')) {
    try {
      const skillPath = fullCommand.replace('skill:delete ', '').trim();
      if (!skillPath) throw new Error(t('main.ipc.errors.missingPath'));

      const launcherConfigPath = ctx.getClawlaunchFile();
      let configuredWorkspacePath = '';
      let configuredConfigPath = '';
      try {
        const launcherRaw = await fs.readFile(launcherConfigPath, 'utf-8');
        const launcherCfg = JSON.parse(launcherRaw || '{}');
        configuredWorkspacePath = typeof launcherCfg.workspacePath === 'string' ? launcherCfg.workspacePath.trim() : '';
        configuredConfigPath = typeof launcherCfg.configPath === 'string' ? launcherCfg.configPath.trim() : '';
      } catch {
        // Fallback handled by default paths below.
      }

      const allowedBases = [
        configuredWorkspacePath ? path.resolve(configuredWorkspacePath, 'skills') : '',
        configuredConfigPath ? path.resolve(configuredConfigPath, 'skills') : ''
      ].filter(Boolean);

      const resolvedTarget = path.resolve(skillPath);
      const isInsideAllowedBase = allowedBases.some((base) => resolvedTarget === base || resolvedTarget.startsWith(`${base}${path.sep}`));
      if (!isInsideAllowedBase) {
        throw new Error(t('main.ipc.errors.securityDenied'));
      }

      await fs.rm(resolvedTarget, { recursive: true, force: true });
      return { code: 0, stdout: t('main.ipc.success.skillRemoved'), exitCode: 0 };
    } catch (e) {
      return { code: 1, stderr: e.message, exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('config:probe')) {
    const probePath = unwrapCliArg(fullCommand.replace('config:probe ', '').trim());
    try {
        const stats = await fs.stat(probePath);
        let finalConfigFilePath = '';
        let finalConfigDirPath = '';
        
        if (stats.isDirectory()) {
            const possible = path.join(probePath, 'openclaw.json');
            try {
                await fs.access(possible);
                finalConfigFilePath = possible;
                finalConfigDirPath = probePath;
            } catch(_e) {
                const possibleClaw = path.join(probePath, 'clawdbot.json');
                try {
                    await fs.access(possibleClaw);
                    finalConfigFilePath = possibleClaw;
                    finalConfigDirPath = probePath;
                } catch(_e2) {}
            }
        } else if (probePath.endsWith('.json')) {
            finalConfigFilePath = probePath;
            finalConfigDirPath = path.dirname(probePath);
        }

        if (finalConfigFilePath) {
            const content = await fs.readFile(finalConfigFilePath, 'utf-8');
            const configData = parseOpenClawConfig(content);

            // Supplementary scan of agent auth-profiles to fill meta-only entries in global profiles
            const agentAuth = await collectAuthProfiles(finalConfigDirPath);
            const healthyAgentProfiles = agentAuth.profiles.filter((p) => p.credentialHealthy);
            if (healthyAgentProfiles.length > 0) {
              // Merge providers (including agent-only providers like openai-codex)
              const agentProviders = healthyAgentProfiles.map((p) => String(p.provider || '').toLowerCase()).filter(Boolean);
              configData.providers = Array.from(new Set([...configData.providers, ...agentProviders]));
              // If authChoice is undetected, infer from the highest priority healthy agent profile
              if (!configData.authChoice) {
                const first = healthyAgentProfiles[0];
                configData.authChoice = inferAuthChoiceFromProfile(first);
              }
            }

            // Core skills = only scan corePath/skills/, ignore extensions/
            const coreSkills = configData.corePath ? await scanSkillsInDir(path.join(configData.corePath, 'skills')) : [];
            // Workspace skills = only scan user-configured workspacePath
            const workspaceSkills = configData.workspace ? await scanInstalledSkills(configData.workspace) : [];
            const existingConfig = {
                ...configData,
                workspaceSkills,
            };
            return {
                code: 0,
                stdout: JSON.stringify({ 
                    ...configData,
                    corePath: configData.corePath,
                    configPath: finalConfigDirPath, 
                    workspacePath: configData.workspace,
                    coreSkills, 
                    existingConfig,
                }),
                exitCode: 0
            };
        }
        return { code: 1, stdout: '', stderr: 'No config found at path', exitCode: 1 };
    } catch(e) {
        return { code: 1, stdout: '', stderr: e.message, exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('auth:list-profiles')) {
    try {
      const payloadStr = fullCommand.replace('auth:list-profiles', '').trim();
      const payload = payloadStr ? JSON.parse(payloadStr) : {};
      const configDir = normalizeConfigDir(String(payload?.configPath || ''));
      if (!configDir) {
        return { code: 1, stdout: '', stderr: 'Missing configPath', exitCode: 1 };
      }
      const data = await collectAuthProfiles(configDir);
      return { code: 0, stdout: JSON.stringify({ profiles: data.profiles, summary: data.summary }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: e.message, exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('auth:remove-profile')) {
    try {
      const payloadStr = fullCommand.replace('auth:remove-profile', '').trim();
      const payload = payloadStr ? JSON.parse(payloadStr) : {};
      const configDir = normalizeConfigDir(String(payload?.configPath || ''));
      const profileId = String(payload?.profileId || '').trim();
      if (!configDir || !profileId) {
        return { code: 1, stdout: '', stderr: 'Missing configPath or profileId', exitCode: 1 };
      }
      if (!/^[A-Za-z0-9._:-]+$/.test(profileId)) {
        return { code: 1, stdout: '', stderr: 'Invalid profileId', exitCode: 1 };
      }

      const configFilePath = path.join(configDir, 'openclaw.json');
      const configJson = (await loadJsonFile(configFilePath)) || {};
      let removedGlobal = false;
      const configAuth = configJson.auth as Record<string, unknown> | undefined;
      const configProfiles = configAuth?.profiles as Record<string, unknown> | undefined;
      if (configProfiles && Object.prototype.hasOwnProperty.call(configProfiles, profileId)) {
        delete configProfiles[profileId];
        removedGlobal = true;
      }
      if (removedGlobal) {
        await saveJsonFile(configFilePath, configJson);
      }

      const agentFiles = await getAgentAuthProfilePaths(configDir);
      let removedAgentFiles = 0;
      for (const authPath of agentFiles) {
        const parsed = (await loadJsonFile(authPath)) || {};
        const parsedProfiles = parsed.profiles as Record<string, unknown> | undefined;
        if (parsedProfiles && Object.prototype.hasOwnProperty.call(parsedProfiles, profileId)) {
          delete parsedProfiles[profileId];
          await saveJsonFile(authPath, parsed);
          removedAgentFiles += 1;
        }
      }

      return {
        code: 0,
        stdout: JSON.stringify({ removedGlobal, removedAgentFiles }),
        stderr: '',
        exitCode: 0,
      };
    } catch (e) {
      return { code: 1, stdout: '', stderr: e.message, exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('auth:add-profile')) {
    try {
      const payloadStr = fullCommand.replace('auth:add-profile', '').trim();
      const payload = payloadStr ? JSON.parse(payloadStr) : {};
      const corePath = String(payload?.corePath || '').trim();
      const configDir = normalizeConfigDir(String(payload?.configPath || ''));
      const authChoice = String(payload?.authChoice || '').trim();
      const rawSecret = String(payload?.secret || '');
      const secret = sanitizeSecret(rawSecret);

      if (!corePath || !configDir || !authChoice) {
        return { code: 1, stdout: '', stderr: 'Missing corePath/configPath/authChoice', exitCode: 1 };
      }
      if (!SUPPORTED_AUTH_CHOICES.has(authChoice)) {
        return { code: 1, stdout: '', stderr: `Unsupported authChoice: ${authChoice}`, exitCode: 1 };
      }
      if (OAUTH_AUTH_CHOICES.has(authChoice)) {
        return { code: 1, stdout: '', stderr: 'OAuth requires full onboarding flow in terminal', exitCode: 1 };
      }
      if (!CREDENTIALLESS_AUTH_CHOICES.has(authChoice) && !secret) {
        return { code: 1, stdout: '', stderr: 'Credential is required for this authChoice', exitCode: 1 };
      }

      if (authChoice === 'minimax-coding-plan-global-token' || authChoice === 'minimax-coding-plan-cn-token') {
        if (!isPlausibleMachineToken(secret) || isLikelyNaturalLanguageSentence(rawSecret)) {
          return {
            code: 1,
            stdout: '',
            stderr: t('main.ipc.errors.minimaxFormat'),
            exitCode: 1,
          };
        }
      }

      const configFilePath = path.join(configDir, 'openclaw.json');

      // MiniMax Coding Plan Token uses Provider-level authentication (different from standard auth.profiles):
      // Core runtime accesses through models.providers.minimax-portal.apiKey directly,
      // no need to create auth.profiles or agent/auth-profiles.json.
      // Verification logic is handled by verifyMiniMaxPortalTokenConfig, no dual-layer profile check.
      // Note: As it's not written to auth.profiles, inferAuthChoiceFromProfile cannot auto-detect this authChoice;
      //       authChoice must be persisted via Launcher settings (config:write) to ensure it's available after restart.
      if (authChoice === 'minimax-coding-plan-global-token' || authChoice === 'minimax-coding-plan-cn-token') {
        const configJson = (await loadJsonFile(configFilePath)) || {};
        const configModels = (configJson.models as Record<string, unknown>) || {};
        const configProviders = (configModels.providers as Record<string, unknown>) || {};
        const providers: Record<string, unknown> = configProviders && typeof configProviders === 'object'
          ? configProviders
          : {};
        const portalProvider: Record<string, unknown> = providers['minimax-portal'] && typeof providers['minimax-portal'] === 'object'
          ? (providers['minimax-portal'] as Record<string, unknown>)
          : {};
        const baseUrl = authChoice === 'minimax-coding-plan-cn-token'
          ? 'https://api.minimaxi.com/anthropic'
          : 'https://api.minimax.io/anthropic';

        const nextJson = {
          ...configJson,
          models: {
            ...configModels,
            providers: {
              ...configProviders,
              'minimax-portal': {
                ...portalProvider,
                baseUrl,
                apiKey: secret,
                models: Array.isArray(portalProvider.models) ? portalProvider.models : [],
              },
            },
          },
        };

        await saveJsonFile(configFilePath, nextJson);
        return {
          code: 0,
          stdout: JSON.stringify({ authChoice, provider: 'minimax-portal', mode: 'token', baseUrl }),
          stderr: '',
          exitCode: 0,
        };
      }

      const mainAgentDir = path.join(configDir, 'agents', 'main', 'agent');
      const envPrefix = `OPENCLAW_STATE_DIR=${shellQuote(configDir)} OPENCLAW_CONFIG_PATH=${shellQuote(configFilePath)} OPENCLAW_AGENT_DIR=${shellQuote(mainAgentDir)} `;
      const workspaceFlag = String(payload?.workspacePath || '').trim() ? ` --workspace ${shellQuote(String(payload.workspacePath).trim())}` : '';

      let authFlags = '';
      if (authChoice === 'token') {
        authFlags = ` --token-provider anthropic --token ${shellQuote(secret)}`;
      } else if (!CREDENTIALLESS_AUTH_CHOICES.has(authChoice)) {
        const flag = AUTH_CHOICE_FLAG_MAPPING[authChoice];
        if (!flag) {
          return { code: 1, stdout: '', stderr: `No auth flag mapping for ${authChoice}`, exitCode: 1 };
        }
        authFlags = ` ${flag} ${shellQuote(secret)}`;
      }

      const onboardCmd = `cd ${shellQuote(corePath)} && ${envPrefix}pnpm openclaw onboard --auth-choice ${shellQuote(authChoice)}${authFlags}${workspaceFlag} --no-install-daemon --skip-daemon --skip-health --non-interactive --accept-risk`;
      const onboardRes = await ctx.runShellCommand(onboardCmd);
      if ((onboardRes.code ?? 0) !== 0) {
        return { code: onboardRes.code ?? 1, stdout: onboardRes.stdout || '', stderr: onboardRes.stderr || 'onboard failed', exitCode: onboardRes.code ?? 1 };
      }

      // New version of OpenClaw has removed `openclaw auth set`.
      // Authorization writing is handled by onboarding, followed by dual-layer profile check to confirm.

      const aliases = getChoiceAliases(authChoice);
      const listed = await collectAuthProfiles(configDir);
      const hasMatched = listed.profiles.some((profile) => profileMatchesAliases(String(profile.profileId || ''), { provider: profile.provider }, aliases) && (CREDENTIALLESS_AUTH_CHOICES.has(authChoice) || profile.agentPresent));
      if (!hasMatched) {
        return { code: 1, stdout: '', stderr: 'Auth write finished but no matched profile found in dual layers', exitCode: 1 };
      }

      return { code: 0, stdout: JSON.stringify({ authChoice, aliases, secretSanitized: secret !== rawSecret }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: e.message, exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('config:model-options')) {
    try {
      const payloadStr = fullCommand.replace('config:model-options', '').trim();
      const payload = payloadStr ? JSON.parse(payloadStr) : {};
      const corePath = String(payload?.corePath || '').trim();
      const configDir = normalizeConfigDir(String(payload?.configPath || ''));
      if (!configDir) {
        return { code: 1, stdout: '', stderr: 'Missing configPath', exitCode: 1 };
      }

      const filters = Array.isArray(payload?.providers)
        ? payload.providers.map((item) => String(item || '').toLowerCase()).filter(Boolean)
        : [];

      const authOverview = await collectAuthProfiles(configDir);
      const healthyProviders = Array.from(new Set(
        authOverview.profiles
          .filter((profile) => profile.agentPresent && profile.credentialHealthy)
          .flatMap((profile) => getProfileProviderAliases(String(profile.profileId || ''), { provider: profile.provider }))
      ));
      const effectiveFilters = healthyProviders.length > 0 ? healthyProviders : filters;

      const configFilePath = path.join(configDir, 'openclaw.json');
      const envPrefix = `OPENCLAW_STATE_DIR=${shellQuote(configDir)} OPENCLAW_CONFIG_PATH=${shellQuote(configFilePath)} `;

      if (corePath) {
        const listCmd = `cd ${shellQuote(corePath)} && ${envPrefix}pnpm openclaw models list --all --json`;
        const listRes = await ctx.runShellCommand(listCmd);
        if ((listRes.code ?? 0) === 0 && String(listRes.stdout || '').trim()) {
          const parsedList = JSON.parse(listRes.stdout);
          const rows = Array.isArray(parsedList?.models) ? parsedList.models : [];
          const grouped = new Map<string, Set<string>>();

          for (const row of rows) {
            const key = String(row?.key || '').trim();
            if (!key || row?.available === false) continue;
            const provider = key.includes('/') ? key.split('/')[0].toLowerCase() : '';
            if (!provider) continue;
            if (!providerMatchesAny(provider, effectiveFilters)) continue;
            if (!grouped.has(provider)) {
              grouped.set(provider, new Set<string>());
            }
            grouped.get(provider)?.add(key);
          }

          const groups = Array.from(grouped.entries())
            .map(([provider, models]) => ({
              provider,
              group: provider,
              models: Array.from(models).sort((a, b) => a.localeCompare(b)),
            }))
            .filter((group) => group.models.length > 0)
            .sort((a, b) => a.group.localeCompare(b.group));

          if (groups.length > 0) {
            return {
              code: 0,
              stdout: JSON.stringify({ groups, source: 'openclaw models list --all --json' }),
              stderr: '',
              exitCode: 0,
            };
          }
        }
      }

      const agentsRoot = path.join(configDir, 'agents');
      let entries: import('node:fs').Dirent[] = [];
      try {
        entries = await fs.readdir(agentsRoot, { withFileTypes: true });
      } catch {
        return { code: 0, stdout: JSON.stringify({ groups: [], source: '' }), stderr: '', exitCode: 0 };
      }

      const modelFiles: string[] = [];
      const mainFirst = entries
        .filter((entry) => entry.isDirectory())
        .sort((a, b) => {
          if (a.name === 'main') return -1;
          if (b.name === 'main') return 1;
          return a.name.localeCompare(b.name);
        });

      for (const entry of mainFirst) {
        const candidate = path.join(agentsRoot, entry.name, 'agent', 'models.json');
        try {
          await fs.access(candidate);
          modelFiles.push(candidate);
        } catch {
          // Ignore agents without model file.
        }
      }

      if (!modelFiles.length) {
        return { code: 0, stdout: JSON.stringify({ groups: [], source: '' }), stderr: '', exitCode: 0 };
      }

      const grouped = new Map<string, Set<string>>();
      for (const modelFile of modelFiles) {
        const parsed = (await loadJsonFile(modelFile)) || {};
        const providers = parsed?.providers || {};
        for (const [providerKey, providerConfig] of Object.entries(providers)) {
          const provider = String(providerKey || '').toLowerCase();
          if (!providerMatchesAny(provider, effectiveFilters)) continue;

          const rawModels = Array.isArray((providerConfig as Record<string, unknown>)?.models) ? (providerConfig as Record<string, unknown>).models as unknown[] : [];
          const resolvedModels: string[] = rawModels
            .map((item) => String((item as Record<string, unknown>)?.id || (item as Record<string, unknown>)?.name || '').trim())
            .filter(Boolean);

          if (!grouped.has(provider)) {
            grouped.set(provider, new Set<string>());
          }
          for (const model of resolvedModels) {
            grouped.get(provider)?.add(model);
          }
        }
      }

      const groups = Array.from(grouped.entries())
        .map(([provider, models]) => ({
          provider,
          group: provider,
          models: Array.from(models).sort((a, b) => a.localeCompare(b)),
        }))
        .filter((group) => group.models.length > 0)
        .sort((a, b) => a.group.localeCompare(b.group));

      return {
        code: 0,
        stdout: JSON.stringify({ groups, source: modelFiles[0] }),
        stderr: '',
        exitCode: 0,
      };
    } catch (e) {
      return { code: 1, stdout: '', stderr: e.message, exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('project:check-empty')) {
    const targetPath = fullCommand.replace('project:check-empty ', '').trim();
    try {
        const stats = await fs.stat(targetPath);
        if (!stats.isDirectory()) return { code: 1, stderr: 'Not a directory', exitCode: 1 };
        const files = await fs.readdir(targetPath);
        const isEmpty = files.filter(f => !f.startsWith('.')).length === 0;
        return { code: 0, stdout: JSON.stringify({ isEmpty }), exitCode: 0 };
    } catch (e) {
        if (e.code === 'ENOENT') {
            return { code: 0, stdout: JSON.stringify({ isEmpty: true, notExist: true }), exitCode: 0 };
        }
        return { code: 1, stderr: e.message, exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('project:get-versions')) {
    try {
        const repoUrl = 'https://github.com/openclaw/openclaw.git';
        return new Promise((resolve) => {
            const gitProcess = spawn(`git ls-remote --tags ${repoUrl}`, { shell: true });
            let stdout = '';
            gitProcess.stdout.on('data', (data) => stdout += data.toString());
            gitProcess.on('close', (code) => {
                if (code !== 0) {
                    resolve({ code: 0, stdout: JSON.stringify(['main']), exitCode: 0 }); // Fallback
                    return;
                }
                const tags = stdout
                    .split('\n')
                    .filter(line => line.includes('refs/tags/'))
                    .map(line => line.split('refs/tags/')[1].replace('^{}', ''))
                    .filter((v, i, a) => a.indexOf(v) === i) // Deduplicate
                    .reverse(); // Keep latest versions at the front
                resolve({ code: 0, stdout: JSON.stringify(['main', ...tags]), exitCode: 0 });
            });
        });
    } catch (e) {
        return { code: 1, stderr: e.message, exitCode: 1 };
    }
  }

  if (fullCommand === 'process:kill-all') {
    ctx.stopGatewayWatchdog('process:kill-all');
    ctx.stopGatewayHttpWatchdog('process:kill-all');
    ctx.killAllSubprocesses();
    return { code: 0, stdout: 'All tracked subprocesses killed', exitCode: 0 };
  }

  if (fullCommand.startsWith('project:initialize')) {
    try {
        const payloadStr = fullCommand.replace('project:initialize ', '').trim();
        const { corePath, configPath, workspacePath, version, method } = JSON.parse(payloadStr);

        const targetVersion = ctx.validateVersionRef(version || 'main');
        const downloadMethod = method || 'git'; // 'git' or 'zip'

        const checkAndWrap = async (dirPath: string, subName: string) => {
            try {
                await fs.mkdir(dirPath, { recursive: true });
                const files = await fs.readdir(dirPath);
                const isEmpty = files.filter(f => !f.startsWith('.')).length === 0;
                return isEmpty ? dirPath : path.join(dirPath, subName);
            } catch (_e) {
                return path.join(dirPath, subName);
            }
        };

        // Pre-check paths in three zones
        const finalCorePath = await checkAndWrap(corePath, 'openclaw');
        const finalConfigPath = await checkAndWrap(configPath, '.openclaw');
        const finalWorkspacePath = await checkAndWrap(workspacePath, 'openclaw-workspace');

        // 1. Download core source code
        const repoUrl = 'https://github.com/openclaw/openclaw.git';
        const tarballUrl = `https://github.com/openclaw/openclaw/tarball/${encodeURIComponent(targetVersion)}`;
        
        ctx.emitShellStdout(`>>> Initializing paths for version ${targetVersion} via ${downloadMethod}...\n`, 'stdout');
        
        await fs.mkdir(finalCorePath, { recursive: true });

        return new Promise((resolve) => {
            let childProcess: ReturnType<typeof spawn>;
          const runCommandWithStreaming = (cmd: string, title: string) => {
            return new Promise<{ code: number; stdout: string; stderr: string }>((resolveStep) => {
              ctx.emitShellStdout(`>>> ${title}\n`, 'stdout');
              const proc = spawn(cmd, { shell: true, cwd: finalCorePath });
              ctx.activeProcesses.add(proc);
              let stdout = '';
              let stderr = '';

              proc.stdout.on('data', (data) => {
                const chunk = data.toString();
                stdout += chunk;
                ctx.emitShellStdout(chunk, 'stdout');
              });

              proc.stderr.on('data', (data) => {
                const chunk = data.toString();
                stderr += chunk;
                ctx.emitShellStdout(chunk, 'stderr');
              });

              proc.on('error', (err) => {
                ctx.activeProcesses.delete(proc);
                resolveStep({ code: 1, stdout, stderr: stderr || err.message || 'Unknown error' });
              });

              proc.on('close', (code: number) => {
                ctx.activeProcesses.delete(proc);
                resolveStep({ code: code ?? 0, stdout, stderr });
              });
            });
          };

            if (downloadMethod === 'zip') {
              const actualCmd = `curl -L ${shellQuote(tarballUrl)} | tar -xz --strip-components=1 -C ${shellQuote(finalCorePath)}`;
                // Executed directly without osascript to stream logs to the UI "mini view"
                childProcess = spawn(actualCmd, { shell: true });
            } else {
              const versionArgs = `--branch ${shellQuote(targetVersion)} --depth 1 --single-branch`;
                const isSubDir = finalCorePath !== corePath;
                const gitCmd = isSubDir 
                ? `git clone ${shellQuote(repoUrl)} ${versionArgs} ${shellQuote(path.basename(finalCorePath))}` 
                    : `git clone ${repoUrl} ${versionArgs} .`;
                const workingDir = isSubDir ? corePath : finalCorePath;

              const actualCmd = `cd ${shellQuote(workingDir)} && ${gitCmd}`;
                childProcess = spawn(actualCmd, { shell: true });
            }

            ctx.activeProcesses.add(childProcess);

            childProcess.stdout.on('data', (data) => {
                ctx.emitShellStdout(data.toString(), 'stdout');
            });

            childProcess.stderr.on('data', (data) => {
                ctx.emitShellStdout(data.toString(), 'stderr');
            });

            childProcess.on('error', (err) => {
              ctx.activeProcesses.delete(childProcess);
                resolve({ code: 1, stderr: `Spawn error: ${err.message}`, exitCode: 1 });
            });

            childProcess.on('close', async (code: number) => {
                if (code !== 0) {
                ctx.activeProcesses.delete(childProcess);
                    const errorMsg = downloadMethod === 'zip' 
                        ? `Download failed (code ${code}). Check your network connection.`
                        : `Git clone failed (code ${code}). Try switching to "ZIP" method or check your git/network.`;
                    resolve({ code: 1, stderr: errorMsg, exitCode: 1 });
                    return;
                }

                // [NEW] Automatically clean up Git traces (keep pure core code only)
                if (downloadMethod === 'git') {
                    const gitDirPath = path.join(finalCorePath, '.git');
                    try {
                        ctx.emitShellStdout('>>> Detaching from Git (Cleaning up .git directory)...\n', 'stdout');
                        await fs.rm(gitDirPath, { recursive: true, force: true });
                    } catch (_e) {
                        ctx.emitShellStdout('>>> Note: Could not remove .git folder, skipping...\n', 'stdout');
                    }
                }

                try {
                  const createdItems: string[] = [];
                  const existingItems: string[] = [];
                  const preExistingItems = new Set<string>();

                  const trackPreExisting = async (targetPath: string) => {
                    try {
                      await fs.stat(targetPath);
                      preExistingItems.add(targetPath);
                    } catch {
                      // Path did not exist before initialization started.
                    }
                  };

                  const trackOutcome = (targetPath: string) => {
                    if (preExistingItems.has(targetPath)) {
                      existingItems.push(targetPath);
                    } else {
                      createdItems.push(targetPath);
                    }
                  };

                  const configFilePath = path.join(finalConfigPath, 'openclaw.json');
                  const skillsDir = path.join(finalWorkspacePath, 'skills');
                  const extensionsDir = path.join(finalWorkspacePath, 'extensions');

                  const ensureDirWithTracking = async (dirPath: string) => {
                    await fs.mkdir(dirPath, { recursive: true });
                    trackOutcome(dirPath);
                  };

                  // Take snapshots of all target paths (including bootstrap files) before any CLI execution;
                  // openclaw setup will create some of these files; if snapshots are taken after, they will be
                  // misidentified as "already existed before initialization", causing incorrect Already Existed display.
                  await trackPreExisting(finalConfigPath);
                  await trackPreExisting(configFilePath);
                  await trackPreExisting(finalWorkspacePath);
                  await trackPreExisting(skillsDir);
                  await trackPreExisting(extensionsDir);

                  // Snapshots of bootstrap files must also be completed before openclaw setup
                  const bootstrapFileNames = [
                    'AGENTS.md', 'SOUL.md', 'TOOLS.md', 'IDENTITY.md',
                    'USER.md', 'HEARTBEAT.md', 'BOOTSTRAP.md', 'MEMORY.md',
                  ];
                  for (const name of bootstrapFileNames) {
                    await trackPreExisting(path.join(finalWorkspacePath, name));
                  }

                  // 2. Install dependencies (required for CLI availability for subsequent openclaw setup)
                  // Use zsh -ilc so that GUI environment can read .zshrc / nvm / volta PATH
                  const pnpmCheckRes = await runCommandWithStreaming('zsh -ilc "pnpm --version" 2>/dev/null || pnpm --version', 'Checking pnpm availability...');
                  if (pnpmCheckRes.code !== 0) {
                    const detail = [
                      String(pnpmCheckRes.stderr || '').trim(),
                      String(pnpmCheckRes.stdout || '').trim(),
                    ].filter(Boolean).join('\n');
                    resolve({
                      code: 1,
                      stderr: detail || 'pnpm is unavailable. Please install pnpm (https://pnpm.io/) and ensure it is in your PATH.',
                      exitCode: 1,
                    });
                    return;
                  }

                  const installRes = await runCommandWithStreaming('zsh -ilc "pnpm install --no-frozen-lockfile" 2>&1 || pnpm install --no-frozen-lockfile', 'Installing OpenClaw dependencies...');
                  if (installRes.code !== 0) {
                    const detail = [
                      String(installRes.stderr || '').trim(),
                      String(installRes.stdout || '').trim(),
                    ].filter(Boolean).join('\n');
                    resolve({
                      code: 1,
                      stderr: detail || `Dependency installation failed (exit code ${installRes.code}).`,
                      exitCode: 1,
                    });
                    return;
                  }

                  // 3. Warm up CLI execution environment (auto-builds TypeScript if dist is outdated)
                  const warmupRes = await runCommandWithStreaming('zsh -ilc "pnpm openclaw --version" 2>&1 || pnpm openclaw --version', 'Prebuilding OpenClaw runtime...');
                  if (warmupRes.code !== 0) {
                    resolve({ code: 1, stderr: warmupRes.stderr || 'OpenClaw runtime warm-up failed.', exitCode: 1 });
                    return;
                  }

                  // 4. Use openclaw setup to create/update config (handles workspace / gateway fields)
                  //    CLI is now ready; call native commands directly without relying on Launcher manual templates
                  ctx.emitShellStdout(`>>> Initializing config at ${finalConfigPath}...\n`, 'stdout');
                  await ensureDirWithTracking(finalConfigPath);

                  const setupEnv = `OPENCLAW_CONFIG_PATH=${shellQuote(configFilePath)} OPENCLAW_STATE_DIR=${shellQuote(finalConfigPath)}`;
                  const setupRes = await runCommandWithStreaming(
                    `zsh -ilc "${setupEnv} pnpm openclaw setup --workspace ${shellQuote(finalWorkspacePath)}" 2>&1 || ${setupEnv} pnpm openclaw setup --workspace ${shellQuote(finalWorkspacePath)}`,
                    'Initializing OpenClaw config...'
                  );

                  if (setupRes.code !== 0) {
                    resolve({ code: 1, stderr: setupRes.stderr || 'openclaw setup failed.', exitCode: 1 });
                    return;
                  }
                  trackOutcome(configFilePath);

                  // Clean up legacy keys possibly written by older Launcher versions (no impact on openclaw schema)
                  try {
                    const raw = await fs.readFile(configFilePath, 'utf-8');
                    const parsed = JSON.parse(raw);
                    let changed = false;
                    if ('version' in parsed) { delete parsed.version; changed = true; }
                    if ('corePath' in parsed) { delete parsed.corePath; changed = true; }
                    if (changed) {
                      await fs.writeFile(configFilePath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf-8');
                    }
                  } catch {
                    // Legacy cleanup failure does not block the flow
                  }

                  // 6. Initialize additional Workspace folders and Launcher-specific bootstrap files
                  // (openclaw setup has created workspace base dir and AGENTS.md; additional Launcher content added here)
                  ctx.emitShellStdout(`>>> Setting up workspace at ${finalWorkspacePath}...\n`, 'stdout');
                  await ensureDirWithTracking(finalWorkspacePath);
                  await ensureDirWithTracking(skillsDir);
                  await ensureDirWithTracking(extensionsDir);

                  const bootstrapTemplates: Record<string, string> = {
                    'AGENTS.md': '# AGENTS\n\nList project-specific agents and responsibilities.\n',
                    'SOUL.md': '# SOUL\n\nDefine mission, product values, and non-negotiable principles.\n',
                    'TOOLS.md': '# TOOLS\n\nDocument approved tools, runtime constraints, and workflows.\n',
                    'IDENTITY.md': '# IDENTITY\n\nDescribe team identity, tone, and guardrails.\n',
                    'USER.md': '# USER\n\nCapture user context, personas, and preference assumptions.\n',
                    'HEARTBEAT.md': '# HEARTBEAT\n\nTrack operating rhythm, rituals, and handoff cadence.\n',
                    'BOOTSTRAP.md': '# BOOTSTRAP\n\nOutline startup checklist and first-run expectations.\n',
                    'MEMORY.md': '# MEMORY\n\nPersistent project memory and verify decisions.\n',
                  };

                  // trackPreExisting completed before openclaw setup execution (see above); write directly here
                  for (const [name, content] of Object.entries(bootstrapTemplates)) {
                    const targetPath = path.join(finalWorkspacePath, name);
                    const wrote = await writeFileIfMissing(targetPath, content);
                    if (!wrote) {
                      trackOutcome(targetPath);
                    } else {
                      createdItems.push(targetPath);
                    }
                  }

                  const uniqueCreatedItems = Array.from(new Set(createdItems));
                  const uniqueExistingItems = Array.from(new Set(existingItems));

                    ctx.emitShellStdout('>>> Initialization complete!\n', 'stdout');
                    resolve({ 
                        code: 0, 
                        stdout: JSON.stringify({ 
                            corePath: finalCorePath, 
                            configPath: finalConfigPath, 
                            workspacePath: finalWorkspacePath,
                            createdItems: uniqueCreatedItems,
                            existingItems: uniqueExistingItems
                        }), 
                        exitCode: 0 
                    });
                } catch (e) {
                    resolve({ code: 1, stderr: e.message, exitCode: 1 });
                }
                ctx.activeProcesses.delete(childProcess);
            });
        });
    } catch (e) {
        return { code: 1, stderr: e.message, exitCode: 1 };
    }
  }

  return new Promise((resolve) => {
    // Output commands to UI logs for easier debugging
    ctx.sendToRenderer('shell:stdout', { data: `[Exec] ${fullCommand}\n`, source: 'system' });
    
    const child = spawn(fullCommand, { shell: true });
    ctx.activeProcesses.add(child);
    let stdout = '';
    let stderr = '';
    let settled = false;
    child.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      ctx.emitShellStdout(chunk, 'stdout');
    });
    child.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      ctx.emitShellStdout(chunk, 'stderr');
    });
    child.on('error', (error) => {
      ctx.activeProcesses.delete(child);
      if (settled) return;
      settled = true;
      resolve({ code: 1, stdout, stderr: stderr || String(error?.message || error), exitCode: 1 });
    });
    child.on('close', (code) => {
      ctx.activeProcesses.delete(child);
      if (settled) return;
      settled = true;
      resolve({ code: code ?? 0, stdout, stderr, exitCode: code ?? 0 });
    });
  });
  });
}
