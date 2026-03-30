import path from 'node:path';
import fs from 'node:fs/promises';
import { app } from 'electron';
import { spawn } from 'node:child_process';
import type { CommandResult } from './types.js';
import type { ShellExecContext } from '../shell-exec-handler.js';
import { resolveOpenClawRuntime } from '../../services/openclaw-runtime.js';
import { shellQuote } from '../../utils/shell-utils.js';

// ── Silent runner (no renderer log) ─────────────────────────────────────────

const runSilent = (cmd: string): Promise<{ stdout: string; stderr: string; code: number }> =>
  new Promise((resolve) => {
    const child = spawn(cmd, { shell: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('close', (code: number | null) => resolve({ stdout, stderr, code: code ?? 1 }));
    child.on('error', () => resolve({ stdout, stderr, code: 1 }));
  });

// ── Handler ──────────────────────────────────────────────────────────────────

export async function handleSystemCommands(_fullCommand: string, _ctx: ShellExecContext): Promise<CommandResult | null> {
  const fullCommand = _fullCommand;

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
    } catch {
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
      return { code: 1, stdout: '', stderr: (e as Error)?.message || 'crontab toggle failed', exitCode: 1 };
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
      if (newLines.length === lines.length) return { code: 1, stdout: '', stderr: 'crontab entry not found', exitCode: 1 };
      const tmpPath = path.join(app.getPath('temp'), `crontab_${Date.now()}`);
      await fs.writeFile(tmpPath, newLines.join('\n'), 'utf-8');
      await runSilent(`crontab "${tmpPath}"`);
      await fs.rm(tmpPath, { force: true }).catch(() => {});
      return { code: 0, stdout: JSON.stringify({ ok: true }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: (e as Error)?.message || 'crontab delete failed', exitCode: 1 };
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
      try { files = await fs.readdir(agentsDir); } catch { /* directory might not exist */ }
      const plistFiles = files.filter(f => f.endsWith('.plist'));
      const launchctlRes = await runSilent('launchctl list');
      const listOutput = launchctlRes.stdout;
      const agents = await Promise.all(plistFiles.map(async (filename) => {
        const label = filename.replace('.plist', '');
        const plistPath = path.join(agentsDir, filename);
        const name = friendlyNames[label] || label;
        let plistExists = false, keepAlive = false, runAtLoad = false, comment = '';
        let scheduleInterval: number | undefined;
        let scheduleCalendar: { Hour?: number; Minute?: number; Weekday?: number; Day?: number; Month?: number }[] | undefined;
        try {
          const raw = await fs.readFile(plistPath, 'utf-8');
          plistExists = true;
          keepAlive = /<key>KeepAlive<\/key>\s*<true\/>/.test(raw) || (raw.includes('<key>KeepAlive</key>') && !/<key>KeepAlive<\/key>\s*<false\/>/.test(raw));
          runAtLoad = /<key>RunAtLoad<\/key>\s*<true\/>/.test(raw);
          const commentMatch = raw.match(/<key>Comment<\/key>\s*<string>([^<]+)<\/string>/);
          if (commentMatch) comment = commentMatch[1];

          // Parse StartInterval (seconds between runs)
          const siMatch = raw.match(/<key>StartInterval<\/key>\s*<integer>(\d+)<\/integer>/);
          if (siMatch) scheduleInterval = parseInt(siMatch[1]);

          // Parse StartCalendarInterval (calendar-based schedule)
          const parseDictKeys = (dictStr: string) => {
            const obj: { Hour?: number; Minute?: number; Weekday?: number; Day?: number; Month?: number } = {};
            const re = /<key>(Hour|Minute|Weekday|Day|Month)<\/key>\s*<integer>(\d+)<\/integer>/g;
            let m: RegExpExecArray | null;
            while ((m = re.exec(dictStr)) !== null) {
              (obj as Record<string, number>)[m[1]] = parseInt(m[2]);
            }
            return obj;
          };
          const arrayMatch = raw.match(/<key>StartCalendarInterval<\/key>\s*<array>([\s\S]*?)<\/array>/);
          if (arrayMatch) {
            const dictRe = /<dict>([\s\S]*?)<\/dict>/g;
            const dicts: { Hour?: number; Minute?: number; Weekday?: number; Day?: number; Month?: number }[] = [];
            let dm: RegExpExecArray | null;
            while ((dm = dictRe.exec(arrayMatch[1])) !== null) dicts.push(parseDictKeys(dm[1]));
            scheduleCalendar = dicts;
          } else {
            const dictMatch = raw.match(/<key>StartCalendarInterval<\/key>\s*<dict>([\s\S]*?)<\/dict>/);
            if (dictMatch) scheduleCalendar = [parseDictKeys(dictMatch[1])];
          }
        } catch { /* plist missing */ }
        const line = listOutput.split('\n').find(l => l.includes(label));
        let running = false, pid: number | null = null, exitCode: number | null = null;
        if (line) {
          const parts = line.trim().split(/\s+/);
          pid = parts[0] && parts[0] !== '-' ? parseInt(parts[0]) : null;
          exitCode = parts[1] ? parseInt(parts[1]) : null;
          running = pid !== null && !isNaN(pid);
        }
        return { label, name, plistExists, keepAlive, runAtLoad, comment, loaded: !!line, running, pid, exitCode, scheduleInterval, scheduleCalendar };
      }));
      return { code: 0, stdout: JSON.stringify({ agents }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: (e as Error)?.message || 'launchagents list failed', exitCode: 1 };
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
      return { code: 1, stdout: '', stderr: (e as Error)?.message || 'launchagents toggle failed', exitCode: 1 };
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
      await fs.rm(plist).catch(() => {});
      return { code: 0, stdout: JSON.stringify({ ok: true }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: (e as Error)?.message || 'launchagents delete failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('cron:trigger ')) {
    try {
      const payload = JSON.parse(fullCommand.replace('cron:trigger ', '').trim() || '{}');
      const jobId = String(payload?.jobId || '').trim();
      if (!jobId) return { code: 1, stdout: '', stderr: 'jobId is required', exitCode: 1 };
      const runtime = await resolveOpenClawRuntime();
      if (!runtime.openclawPrefix) {
        return { code: 1, stdout: '', stderr: 'OpenClaw runtime not configured', exitCode: 1 };
      }

      const fireAndForget = payload?.fireAndForget === true;
      const timeoutMs = Math.max(1000, Number(payload?.timeoutMs || 30000));
      const expectFinal = payload?.expectFinal === true;
      const expectFinalArg = expectFinal ? ' --expect-final' : '';
      const runCmd = `${runtime.openclawPrefix} cron run ${shellQuote(jobId)} --timeout ${timeoutMs}${expectFinalArg}`;

      if (fireAndForget) {
        // Spawn detached so the IPC returns immediately and the job runs in background
        spawn(runCmd, { shell: true, detached: true, stdio: 'ignore' }).unref();
        return { code: 0, stdout: JSON.stringify({ ok: true, jobId, mode: 'fire-and-forget' }), stderr: '', exitCode: 0 };
      }

      const res = await _ctx.runShellCommand(runCmd);
      if ((res.code ?? 1) !== 0) {
        return { code: res.code ?? 1, stdout: res.stdout || '', stderr: res.stderr || 'cron run failed', exitCode: res.code ?? 1 };
      }

      return {
        code: 0,
        stdout: JSON.stringify({ ok: true, jobId, mode: 'openclaw-cli', result: (res.stdout || '').trim() }),
        stderr: (res.stderr || '').trim(),
        exitCode: 0,
      };
    } catch (e) {
      return { code: 1, stdout: '', stderr: (e as Error)?.message || 'cron trigger failed', exitCode: 1 };
    }
  }

  if (fullCommand === 'cron:list' || fullCommand.startsWith('cron:list ')) {
    try {
      const payloadStr = fullCommand.replace('cron:list', '').trim();
      const payload = payloadStr ? JSON.parse(payloadStr) : {};
      const stateDir = String(payload?.stateDir || process.env['OPENCLAW_STATE_DIR'] || path.join(process.env['HOME'] || '', '.openclaw')).trim();
      const cronPath = path.join(stateDir, 'cron', 'jobs.json');
      try {
        const raw = await fs.readFile(cronPath, 'utf-8');
        return { code: 0, stdout: raw, stderr: '', exitCode: 0 };
      } catch {
        return { code: 0, stdout: JSON.stringify({ version: 1, jobs: [] }), stderr: '', exitCode: 0 };
      }
    } catch (e) {
      return { code: 1, stdout: '', stderr: (e as Error)?.message || 'cron list failed', exitCode: 1 };
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
      const data = JSON.parse(raw) as { jobs?: Record<string, unknown>[] };
      let toggled = false;
      data.jobs = (data.jobs || []).map((job) => {
        if (job['id'] === jobId) { toggled = true; return { ...job, enabled: !job['enabled'], updatedAtMs: Date.now() }; }
        return job;
      });
      if (!toggled) return { code: 1, stdout: '', stderr: `job ${jobId} not found`, exitCode: 1 };
      await fs.writeFile(cronPath, JSON.stringify(data, null, 2), 'utf-8');
      return { code: 0, stdout: JSON.stringify({ ok: true }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: (e as Error)?.message || 'cron toggle failed', exitCode: 1 };
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
      const data = JSON.parse(raw) as { jobs?: Record<string, unknown>[] };
      const before = (data.jobs || []).length;
      data.jobs = (data.jobs || []).filter((job) => job['id'] !== jobId);
      if (data.jobs.length === before) return { code: 1, stdout: '', stderr: `job ${jobId} not found`, exitCode: 1 };
      await fs.writeFile(cronPath, JSON.stringify(data, null, 2), 'utf-8');
      return { code: 0, stdout: JSON.stringify({ ok: true }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: (e as Error)?.message || 'cron delete failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('cron:update ')) {
    try {
      const payload = JSON.parse(fullCommand.replace('cron:update ', '').trim() || '{}');
      const jobId = String(payload?.jobId || '').trim();
      const stateDir = String(payload?.stateDir || process.env['OPENCLAW_STATE_DIR'] || path.join(process.env['HOME'] || '', '.openclaw')).trim();
      if (!jobId) return { code: 1, stdout: '', stderr: 'jobId is required', exitCode: 1 };
      const cronPath = path.join(stateDir, 'cron', 'jobs.json');
      const raw = await fs.readFile(cronPath, 'utf-8');
      const data = JSON.parse(raw) as { jobs?: Record<string, unknown>[] };
      let updated = false;
      data.jobs = (data.jobs || []).map((job) => {
        if (job['id'] !== jobId) return job;
        updated = true;
        const next: Record<string, unknown> = { ...job, updatedAtMs: Date.now() };
        if (payload.name !== undefined) next['name'] = String(payload.name).trim();
        if (payload.everyMs !== undefined) {
          const everyMs = Math.max(60000, Number(payload.everyMs));
          next['schedule'] = { ...(job['schedule'] as Record<string, unknown>), everyMs };
        }
        if (payload.timeoutSeconds !== undefined) {
          const timeoutSeconds = Math.max(60, Number(payload.timeoutSeconds));
          next['payload'] = { ...(job['payload'] as Record<string, unknown>), timeoutSeconds };
        }
        return next;
      });
      if (!updated) return { code: 1, stdout: '', stderr: `job ${jobId} not found`, exitCode: 1 };
      await fs.writeFile(cronPath, JSON.stringify(data, null, 2), 'utf-8');
      return { code: 0, stdout: JSON.stringify({ ok: true }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: (e as Error)?.message || 'cron update failed', exitCode: 1 };
    }
  }

  return null;
}
