import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { app } from 'electron';
import { shellQuote } from '../../utils/shell-utils.js';
import { writeFileIfMissing } from '../../services/skills.js';
import type { CommandResult } from './types.js';
import type { ShellExecContext } from '../shell-exec-handler.js';

// ── Cross-platform shell helpers ─────────────────────────────────────────────

/**
 * Quote a value for the current platform's shell.
 * POSIX (macOS/Linux): single quotes.
 * Windows cmd.exe: double quotes.
 */
const platformQuote = (value: string): string =>
  process.platform === 'win32'
    ? `"${String(value).replace(/"/g, '\\"')}"`
    : shellQuote(value);

/**
 * Wrap a pnpm command with a login shell on macOS/Linux so NVM / Homebrew paths
 * are available. Tries zsh first (macOS default), then bash (Linux default).
 * On Windows, runs the command directly.
 *
 * @param cmd          The pnpm command to run (no shell quoting needed for the command itself).
 * @param stderrRedir  stderr redirect suffix, e.g. '2>/dev/null' or '2>&1' (Unix only).
 */
const wrapWithZsh = (cmd: string, stderrRedir = '2>&1'): string => {
  if (process.platform === 'win32') return cmd;
  // Escape backslashes and double quotes so the command survives the outer double-quote wrapper.
  const escaped = cmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  if (process.platform === 'linux') {
    // Linux: prefer bash login shell; fall back to direct invocation
    return `bash -ilc "${escaped}" ${stderrRedir} || ${cmd}`;
  }
  // macOS: prefer zsh login shell; fall back to bash then direct
  return `zsh -ilc "${escaped}" ${stderrRedir} || bash -ilc "${escaped}" ${stderrRedir} || ${cmd}`;
};

/**
 * Returns a shell command that downloads a .tar.gz tarball and extracts it into
 * destDir, stripping the top-level archive directory.
 *
 * macOS/Linux: single `curl | tar` pipeline (reliable on POSIX).
 * Windows 10+: download to a temp file first, then extract — avoids binary pipe
 *              issues; requires curl.exe + tar.exe (both built-in since Win 10 1803+).
 */
const buildDownloadExtractCmd = (tarballUrl: string, destDir: string): string => {
  if (process.platform === 'win32') {
    const tmpFile = path.join(destDir, '_dl_tmp.tar.gz');
    const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;
    return [
      `curl.exe -L -o ${q(tmpFile)} ${q(tarballUrl)}`,
      `tar.exe -xzf ${q(tmpFile)} --strip-components=1 -C ${q(destDir)}`,
      `del ${q(tmpFile)}`,
    ].join(' && ');
  }
  return `curl -L ${shellQuote(tarballUrl)} | tar -xz --strip-components=1 -C ${shellQuote(destDir)}`;
};

export async function handleProjectCommands(fullCommand: string, ctx: ShellExecContext): Promise<CommandResult | null> {
  if (fullCommand.startsWith('project:check-empty')) {
    const targetPath = fullCommand.replace('project:check-empty ', '').trim();
    try {
      const stats = await fs.stat(targetPath);
      if (!stats.isDirectory()) return { code: 1, stderr: 'Not a directory', exitCode: 1 };
      const files = await fs.readdir(targetPath);
      const isEmpty = files.filter(f => !f.startsWith('.')).length === 0;
      return { code: 0, stdout: JSON.stringify({ isEmpty }), exitCode: 0 };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        return { code: 0, stdout: JSON.stringify({ isEmpty: true, notExist: true }), exitCode: 0 };
      }
      return { code: 1, stderr: (e as Error)?.message || 'project check-empty failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('project:get-versions')) {
    try {
      const repoUrl = 'https://github.com/openclaw/openclaw.git';
      return new Promise<CommandResult>((resolve) => {
        const gitProcess = spawn(`git ls-remote --tags ${repoUrl}`, { shell: true, timeout: 30000 });
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        
        const timeoutHandle = setTimeout(() => {
          timedOut = true;
          gitProcess.kill();
        }, 30000);
        
        gitProcess.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
        gitProcess.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });
        
        gitProcess.on('close', (code) => {
          clearTimeout(timeoutHandle);
          
          if (timedOut) {
            resolve({ code: 0, stdout: JSON.stringify(['main']), exitCode: 0 });
            return;
          }
          
          if (code !== 0) {
            resolve({ code: 0, stdout: JSON.stringify(['main']), exitCode: 0 });
            return;
          }
          
          const compareVersions = (a: string, b: string) => {
            const pa = a.split('.').map(n => parseInt(n, 10) || 0);
            const pb = b.split('.').map(n => parseInt(n, 10) || 0);
            const len = Math.max(pa.length, pb.length);
            for (let i = 0; i < len; i++) {
              const diff = (pb[i] ?? 0) - (pa[i] ?? 0);
              if (diff !== 0) return diff;
            }
            return b.localeCompare(a);
          };
          const tags = stdout
            .split('\n')
            .filter(line => line.includes('refs/tags/'))
            .map(line => line.split('refs/tags/')[1].replace('^{}', ''))
            .filter((v, i, a) => a.indexOf(v) === i)
            .sort(compareVersions);
          resolve({ code: 0, stdout: JSON.stringify(['main', ...tags]), exitCode: 0 });
        });
      });
    } catch (e) {
      return { code: 1, stderr: (e as Error)?.message || 'get versions failed', exitCode: 1 };
    }
  }

  if (fullCommand === 'process:kill-all') {
    ctx.stopGatewayWatchdog('process:kill-all');
    ctx.stopGatewayHttpWatchdog('process:kill-all');
    ctx.killAllSubprocesses();
    return { code: 0, stdout: 'All tracked subprocesses killed', exitCode: 0 };
  }

  if (fullCommand === 'process:force-release') {
    // Kill all orphan openclaw-related processes except openclaw-gateway
    let killCmd: string;
    let countCmd: string;
    if (process.platform === 'win32') {
      // PowerShell: kill matching processes, skip openclaw-gateway
      killCmd = `powershell -NoProfile -Command "Get-Process | Where-Object { $_.Name -match 'openclaw|models.list' -and $_.Name -notmatch 'openclaw-gateway' } | Stop-Process -Force -ErrorAction SilentlyContinue; Write-Output done"`;
      countCmd = `powershell -NoProfile -Command "(Get-Process | Where-Object { $_.Name -match 'openclaw' }).Count"`;
    } else {
      killCmd = [
        `ps -eo pid,command`,
        `grep -E 'openclaw|models.list'`,
        `grep -v 'openclaw-gateway'`,
        `grep -v grep`,
        `awk '{print $1}'`,
        `xargs kill -9 2>/dev/null || true`,
      ].join(' | ') + '; echo done';
      countCmd = `pgrep -c openclaw 2>/dev/null || echo 0`;
    }
    const res = await ctx.runShellCommand(killCmd);
    const countRes = await ctx.runShellCommand(countCmd);
    const remaining = parseInt(String(countRes.stdout || '0').trim(), 10);
    return {
      code: 0,
      stdout: JSON.stringify({ ok: true, remaining }),
      exitCode: 0,
      stderr: res.stderr || '',
    };
  }

  if (fullCommand.startsWith('project:initialize')) {
    try {
      const payloadStr = fullCommand.replace('project:initialize ', '').trim();
      const { corePath, configPath, workspacePath, version, method } = JSON.parse(payloadStr);
      const targetVersion = ctx.validateVersionRef(version || 'main');
      const downloadMethod = method || 'git';

      const checkAndWrap = async (dirPath: string, subName: string) => {
        try {
          await fs.mkdir(dirPath, { recursive: true });
          const files = await fs.readdir(dirPath);
          const isEmpty = files.filter(f => !f.startsWith('.')).length === 0;
          return isEmpty ? dirPath : path.join(dirPath, subName);
        } catch {
          return path.join(dirPath, subName);
        }
      };

      const finalCorePath = await checkAndWrap(corePath, 'openclaw');
      const finalConfigPath = await checkAndWrap(configPath, '.openclaw');
      const finalWorkspacePath = await checkAndWrap(workspacePath, 'openclaw-workspace');

      const repoUrl = 'https://github.com/openclaw/openclaw.git';
      const tarballUrl = `https://github.com/openclaw/openclaw/tarball/${encodeURIComponent(targetVersion)}`;

      ctx.emitShellStdout(`>>> Initializing paths for version ${targetVersion} via ${downloadMethod}...\n`, 'stdout');
      await fs.mkdir(finalCorePath, { recursive: true });

      return new Promise<CommandResult>((resolve) => {
        let childProcess: ReturnType<typeof spawn>;

        const runCommandWithStreaming = (cmd: string, title: string) =>
          new Promise<{ code: number; stdout: string; stderr: string }>((resolveStep) => {
            ctx.emitShellStdout(`>>> ${title}\n`, 'stdout');
            const proc = spawn(cmd, { shell: true, cwd: finalCorePath });
            ctx.activeProcesses.add(proc);
            let stdout = '', stderr = '';
            proc.stdout.on('data', (data: Buffer) => { const chunk = data.toString(); stdout += chunk; ctx.emitShellStdout(chunk, 'stdout'); });
            proc.stderr.on('data', (data: Buffer) => { const chunk = data.toString(); stderr += chunk; ctx.emitShellStdout(chunk, 'stderr'); });
            proc.on('error', (err) => { ctx.activeProcesses.delete(proc); resolveStep({ code: 1, stdout, stderr: stderr || err.message }); });
            proc.on('close', (code: number) => { ctx.activeProcesses.delete(proc); resolveStep({ code: code ?? 0, stdout, stderr }); });
          });

        if (downloadMethod === 'zip') {
          const actualCmd = buildDownloadExtractCmd(tarballUrl, finalCorePath);
          childProcess = spawn(actualCmd, { shell: true });
        } else {
          const versionArgs = `--branch ${shellQuote(targetVersion)} --depth 1 --single-branch`;
          const isSubDir = finalCorePath !== corePath;
          const gitCmd = isSubDir
            ? `git clone ${shellQuote(repoUrl)} ${versionArgs} ${shellQuote(path.basename(finalCorePath))}`
            : `git clone ${repoUrl} ${versionArgs} .`;
          const workingDir = isSubDir ? corePath : finalCorePath;
          childProcess = spawn(`cd ${shellQuote(workingDir)} && ${gitCmd}`, { shell: true });
        }

        ctx.activeProcesses.add(childProcess);
        childProcess.stdout?.on('data', (data: Buffer) => { ctx.emitShellStdout(data.toString(), 'stdout'); });
        childProcess.stderr?.on('data', (data: Buffer) => { ctx.emitShellStdout(data.toString(), 'stderr'); });
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

          if (downloadMethod === 'git') {
            const gitDirPath = path.join(finalCorePath, '.git');
            try {
              ctx.emitShellStdout('>>> Detaching from Git (Cleaning up .git directory)...\n', 'stdout');
              await fs.rm(gitDirPath, { recursive: true, force: true });
            } catch {
              ctx.emitShellStdout('>>> Note: Could not remove .git folder, skipping...\n', 'stdout');
            }
          }

          try {
            const createdItems: string[] = [];
            const existingItems: string[] = [];
            const preExistingItems = new Set<string>();

            const trackPreExisting = async (targetPath: string) => {
              try { await fs.stat(targetPath); preExistingItems.add(targetPath); } catch { /* not pre-existing */ }
            };
            const trackOutcome = (targetPath: string) => {
              if (preExistingItems.has(targetPath)) existingItems.push(targetPath);
              else createdItems.push(targetPath);
            };
            const ensureDirWithTracking = async (dirPath: string) => {
              await fs.mkdir(dirPath, { recursive: true });
              trackOutcome(dirPath);
            };

            const configFilePath = path.join(finalConfigPath, 'openclaw.json');
            const skillsDir = path.join(finalWorkspacePath, 'skills');
            const extensionsDir = path.join(finalWorkspacePath, 'extensions');
            const bootstrapFileNames = ['AGENTS.md', 'SOUL.md', 'TOOLS.md', 'IDENTITY.md', 'USER.md', 'HEARTBEAT.md', 'BOOTSTRAP.md', 'MEMORY.md'];

            await trackPreExisting(finalConfigPath);
            await trackPreExisting(configFilePath);
            await trackPreExisting(finalWorkspacePath);
            await trackPreExisting(skillsDir);
            await trackPreExisting(extensionsDir);
            for (const name of bootstrapFileNames) await trackPreExisting(path.join(finalWorkspacePath, name));

            const pnpmCheckRes = await runCommandWithStreaming(wrapWithZsh('pnpm --version', '2>/dev/null'), 'Checking pnpm availability...');
            if (pnpmCheckRes.code !== 0) {
              const detail = [String(pnpmCheckRes.stderr || '').trim(), String(pnpmCheckRes.stdout || '').trim()].filter(Boolean).join('\n');
              resolve({ code: 1, stderr: detail || 'pnpm is unavailable. Please install pnpm (https://pnpm.io/) and ensure it is in your PATH.', exitCode: 1 });
              return;
            }

            const installRes = await runCommandWithStreaming(wrapWithZsh('pnpm install --no-frozen-lockfile'), 'Installing OpenClaw dependencies...');
            if (installRes.code !== 0) {
              const detail = [String(installRes.stderr || '').trim(), String(installRes.stdout || '').trim()].filter(Boolean).join('\n');
              resolve({ code: 1, stderr: detail || `Dependency installation failed (exit code ${installRes.code}).`, exitCode: 1 });
              return;
            }

            const warmupRes = await runCommandWithStreaming(wrapWithZsh('pnpm openclaw --version'), 'Prebuilding OpenClaw runtime...');
            if (warmupRes.code !== 0) {
              resolve({ code: 1, stderr: warmupRes.stderr || 'OpenClaw runtime warm-up failed.', exitCode: 1 });
              return;
            }

            ctx.emitShellStdout(`>>> Initializing config at ${finalConfigPath}...\n`, 'stdout');
            await ensureDirWithTracking(finalConfigPath);

            const pnpmSetupArgs = `pnpm openclaw setup --workspace ${platformQuote(finalWorkspacePath)}`;
            const setupCmd = process.platform === 'win32'
              ? `set "OPENCLAW_CONFIG_PATH=${configFilePath}" && set "OPENCLAW_STATE_DIR=${finalConfigPath}" && ${pnpmSetupArgs}`
              : wrapWithZsh(`OPENCLAW_CONFIG_PATH=${shellQuote(configFilePath)} OPENCLAW_STATE_DIR=${shellQuote(finalConfigPath)} ${pnpmSetupArgs}`);
            const setupRes = await runCommandWithStreaming(setupCmd, 'Initializing OpenClaw config...');
            if (setupRes.code !== 0) {
              resolve({ code: 1, stderr: setupRes.stderr || 'openclaw setup failed.', exitCode: 1 });
              return;
            }
            trackOutcome(configFilePath);

            try {
              const raw = await fs.readFile(configFilePath, 'utf-8');
              const parsed = JSON.parse(raw);
              let changed = false;
              if ('version' in parsed) { delete parsed['version']; changed = true; }
              if ('corePath' in parsed) { delete parsed['corePath']; changed = true; }
              if (changed) await fs.writeFile(configFilePath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf-8');
            } catch { /* legacy cleanup failure does not block */ }

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

            for (const [name, content] of Object.entries(bootstrapTemplates)) {
              const targetPath = path.join(finalWorkspacePath, name);
              const wrote = await writeFileIfMissing(targetPath, content);
              if (!wrote) trackOutcome(targetPath);
              else createdItems.push(targetPath);
            }

            ctx.emitShellStdout('>>> Initialization complete!\n', 'stdout');
            resolve({
              code: 0,
              stdout: JSON.stringify({
                corePath: finalCorePath,
                configPath: finalConfigPath,
                workspacePath: finalWorkspacePath,
                createdItems: Array.from(new Set(createdItems)),
                existingItems: Array.from(new Set(existingItems)),
              }),
              exitCode: 0,
            });
          } catch (e) {
            resolve({ code: 1, stderr: (e as Error)?.message || 'project initialize failed', exitCode: 1 });
          }
          ctx.activeProcesses.delete(childProcess);
        });
      });
    } catch (e) {
      return { code: 1, stderr: (e as Error)?.message || 'project initialize failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('project:list-backups')) {
    try {
      const payloadStr = fullCommand.replace('project:list-backups', '').trim();
      const { corePath } = JSON.parse(payloadStr || '{}');
      if (!corePath) return { code: 1, stderr: 'corePath required', exitCode: 1 };
      const backupsRoot = path.join(corePath, '.openclaw-backups');
      let entries: { name: string; path: string; mtime: number }[] = [];
      try {
        const dirs = await fs.readdir(backupsRoot);
        const stats = await Promise.all(
          dirs.map(async (name) => {
            const fullPath = path.join(backupsRoot, name);
            try {
              const s = await fs.stat(fullPath);
              return s.isDirectory() ? { name, path: fullPath, mtime: s.mtimeMs } : null;
            } catch { return null; }
          })
        );
        entries = (stats.filter(Boolean) as { name: string; path: string; mtime: number }[])
          .sort((a, b) => b.mtime - a.mtime);
      } catch { /* backupsRoot doesn't exist yet */ }
      return { code: 0, stdout: JSON.stringify(entries), exitCode: 0 };
    } catch (e) {
      return { code: 1, stderr: (e as Error)?.message || 'list-backups failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('project:rollback')) {
    let rollbackTmpPath = '';
    try {
      const payloadStr = fullCommand.replace('project:rollback ', '').trim();
      const { corePath, backupPath } = JSON.parse(payloadStr);
      if (!corePath || !backupPath) return { code: 1, stderr: 'corePath and backupPath required', exitCode: 1 };

      // Security: allow rollback source only from {corePath}/.openclaw-backups
      const coreRealPath = await fs.realpath(corePath);
      const backupsRoot = path.join(coreRealPath, '.openclaw-backups');
      const [backupsRootRealPath, backupRealPath] = await Promise.all([
        fs.realpath(backupsRoot),
        fs.realpath(backupPath),
      ]);
      const backupRel = path.relative(backupsRootRealPath, backupRealPath);
      if (!backupRel || backupRel.startsWith('..') || path.isAbsolute(backupRel)) {
        return {
          code: 1,
          stderr: `Invalid backup path. Must be under ${backupsRootRealPath}`,
          exitCode: 1,
        };
      }

      // Verify backup exists
      try { await fs.stat(backupRealPath); } catch {
        return { code: 1, stderr: `Backup not found: ${backupPath}`, exitCode: 1 };
      }

      // Safety: snapshot current state before rollback
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      rollbackTmpPath = path.join(backupsRootRealPath, `${timestamp}_pre-rollback`);
      await fs.mkdir(rollbackTmpPath, { recursive: true });
      ctx.emitShellStdout(`>>> Saving pre-rollback snapshot to ${rollbackTmpPath}...\n`, 'stdout');
      await fs.cp(coreRealPath, rollbackTmpPath, {
        recursive: true, force: true,
        filter: (src) => {
          const rel = path.relative(coreRealPath, src);
          return !rel.startsWith('node_modules') && !rel.startsWith('.update-tmp') && !rel.startsWith('.openclaw-backups');
        },
      });

      // Restore backup → corePath
      ctx.emitShellStdout(`>>> Restoring from ${backupRealPath}...\n`, 'stdout');
      await fs.cp(backupRealPath, coreRealPath, { recursive: true, force: true });

      // Re-install dependencies
      ctx.emitShellStdout('>>> Reinstalling dependencies...\n', 'stdout');
      const runCmd = (cmd: string) =>
        new Promise<{ code: number; stdout: string; stderr: string }>((resolveStep) => {
          const proc = spawn(cmd, { shell: true, cwd: coreRealPath });
          ctx.activeProcesses.add(proc);
          let stdout = '', stderr = '';
          proc.stdout.on('data', (data: Buffer) => { const chunk = data.toString(); stdout += chunk; ctx.emitShellStdout(chunk, 'stdout'); });
          proc.stderr.on('data', (data: Buffer) => { const chunk = data.toString(); stderr += chunk; ctx.emitShellStdout(chunk, 'stderr'); });
          proc.on('error', (err) => { ctx.activeProcesses.delete(proc); resolveStep({ code: 1, stdout, stderr: err.message }); });
          proc.on('close', (code: number) => { ctx.activeProcesses.delete(proc); resolveStep({ code: code ?? 0, stdout, stderr }); });
        });

      const installRes = await runCmd(wrapWithZsh('pnpm install --no-frozen-lockfile'));
      if (installRes.code !== 0) {
        const detail = [String(installRes.stderr || '').trim(), String(installRes.stdout || '').trim()].filter(Boolean).join('\n');
        return { code: 1, stderr: detail || 'Dependency reinstall failed during rollback.', exitCode: 1 };
      }

      ctx.emitShellStdout('>>> Rollback complete!\n', 'stdout');
      return { code: 0, stdout: JSON.stringify({ restoredFrom: backupRealPath }), exitCode: 0 };
    } catch (e) {
      return { code: 1, stderr: (e as Error)?.message || 'rollback failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('project:update')) {
    let updateTmpPath = '';
    try {
      const payloadStr = fullCommand.replace('project:update ', '').trim();
      const { corePath, version } = JSON.parse(payloadStr);
      const targetVersion = ctx.validateVersionRef(version || 'main');
      const tarballUrl = `https://github.com/openclaw/openclaw/tarball/${encodeURIComponent(targetVersion)}`;
      updateTmpPath = path.join(corePath, '.update-tmp');

      const runCmd = (cmd: string, title: string) =>
        new Promise<{ code: number; stdout: string; stderr: string }>((resolveStep) => {
          ctx.emitShellStdout(`>>> ${title}\n`, 'stdout');
          const proc = spawn(cmd, { shell: true, cwd: corePath });
          ctx.activeProcesses.add(proc);
          let stdout = '', stderr = '';
          proc.stdout.on('data', (data: Buffer) => { const chunk = data.toString(); stdout += chunk; ctx.emitShellStdout(chunk, 'stdout'); });
          proc.stderr.on('data', (data: Buffer) => { const chunk = data.toString(); stderr += chunk; ctx.emitShellStdout(chunk, 'stderr'); });
          proc.on('error', (err) => { ctx.activeProcesses.delete(proc); resolveStep({ code: 1, stdout, stderr: stderr || err.message }); });
          proc.on('close', (code: number) => { ctx.activeProcesses.delete(proc); resolveStep({ code: code ?? 0, stdout, stderr }); });
        });

      // ── Step 0: verify corePath exists ───────────────────────────────────
      try { await fs.stat(corePath); } catch {
        return { code: 1, stderr: `corePath does not exist: ${corePath}`, exitCode: 1 };
      }

      // ── Step 1: check pnpm availability ──────────────────────────────────
      const pnpmCheck = await runCmd(wrapWithZsh('pnpm --version', '2>/dev/null'), 'Checking pnpm availability...');
      if (pnpmCheck.code !== 0) {
        const detail = [String(pnpmCheck.stderr || '').trim(), String(pnpmCheck.stdout || '').trim()].filter(Boolean).join('\n');
        return { code: 1, stderr: detail || 'pnpm is unavailable. Please install pnpm (https://pnpm.io/) and ensure it is in your PATH.', exitCode: 1 };
      }

      // ── Step 2: snapshot current version label (best-effort) ─────────────
      let currentVersionLabel = 'unknown';
      try {
        const verRes = await runCmd(wrapWithZsh('pnpm openclaw --version', '2>/dev/null'), 'Detecting current version...');
        const match = (verRes.stdout || '').match(/\d{4}\.\d+\.\d+/);
        if (match) currentVersionLabel = match[0];
      } catch { /* non-fatal */ }

      // ── Step 3: backup entire corePath → {corePath}/.openclaw-backups/{ts}-{ver} ─
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const backupLabel = `${timestamp}_v${currentVersionLabel}`;
      const backupsRoot = path.join(corePath, '.openclaw-backups');
      const backupPath = path.join(backupsRoot, backupLabel);
      await fs.mkdir(backupPath, { recursive: true });
      ctx.emitShellStdout(`>>> Backing up current installation to ${backupPath}...\n`, 'stdout');
      await fs.cp(corePath, backupPath, {
        recursive: true,
        force: true,
        filter: (src) => {
          const rel = path.relative(corePath, src);
          // Skip node_modules, hidden update dirs, and backups dir to keep backup lean
          return !rel.startsWith('node_modules') && !rel.startsWith('.update-tmp') && !rel.startsWith('.update-backup') && !rel.startsWith('.openclaw-backups');
        },
      });
      ctx.emitShellStdout(`>>> Backup complete. To rollback: replace ${corePath} with ${backupPath}\n`, 'stdout');

      // ── Step 4: download tarball to temp dir ─────────────────────────────
      await fs.rm(updateTmpPath, { recursive: true, force: true });
      await fs.mkdir(updateTmpPath, { recursive: true });

      const dlRes = await runCmd(
        buildDownloadExtractCmd(tarballUrl, updateTmpPath),
        `Downloading ${targetVersion}...`
      );
      if (dlRes.code !== 0) {
        return { code: 1, stderr: dlRes.stderr || `Download failed (code ${dlRes.code}). Check your network connection.`, exitCode: 1 };
      }

      // Verify tarball has content
      try { await fs.stat(path.join(updateTmpPath, 'package.json')); } catch {
        return { code: 1, stderr: 'Downloaded tarball appears invalid (package.json not found).', exitCode: 1 };
      }

      // ── Step 5: overlay temp dir onto corePath ───────────────────────────
      ctx.emitShellStdout('>>> Applying update files...\n', 'stdout');
      await fs.cp(updateTmpPath, corePath, { recursive: true, force: true });
      await fs.rm(updateTmpPath, { recursive: true, force: true });
      updateTmpPath = '';

      // ── Auto-rollback helper (used by steps 6 & 7) ───────────────────────
      // Returns true if rollback succeeded and was verified, false otherwise.
      const autoRollback = async (reason: string): Promise<boolean> => {
        ctx.emitShellStdout(`>>> ${reason} — auto-rolling back to pre-update state...\n`, 'stderr');
        try {
          await fs.cp(backupPath, corePath, { recursive: true, force: true });

          // Verify: package.json must exist and version must match backup
          const readPkg = async (dir: string) => {
            const raw = await fs.readFile(path.join(dir, 'package.json'), 'utf-8').catch(() => null);
            if (!raw) return null;
            try { return JSON.parse(raw) as { version?: string }; } catch { return null; }
          };
          const [restoredPkg, backupPkg] = await Promise.all([readPkg(corePath), readPkg(backupPath)]);

          if (!restoredPkg) {
            ctx.emitShellStdout(
              `>>> Rollback verification failed: package.json missing after restore.\nManually restore from: ${backupPath}\n`,
              'stderr'
            );
            return false;
          }
          if (backupPkg?.version && restoredPkg.version !== backupPkg.version) {
            ctx.emitShellStdout(
              `>>> Rollback verification failed: version mismatch (expected ${backupPkg.version}, got ${restoredPkg.version ?? 'unknown'}).\nManually restore from: ${backupPath}\n`,
              'stderr'
            );
            return false;
          }

          ctx.emitShellStdout(`>>> Rolled back to v${restoredPkg.version ?? 'unknown'} ✓\n`, 'stdout');
          return true;
        } catch (rbErr) {
          ctx.emitShellStdout(
            `>>> Auto-rollback failed: ${(rbErr as Error).message}\nManually restore from: ${backupPath}\n`,
            'stderr'
          );
          return false;
        }
      };

      // ── Step 6: install dependencies ─────────────────────────────────────
      const installRes = await runCmd(
        wrapWithZsh('pnpm install --no-frozen-lockfile'),
        'Installing OpenClaw dependencies...'
      );
      if (installRes.code !== 0) {
        const detail = [String(installRes.stderr || '').trim(), String(installRes.stdout || '').trim()].filter(Boolean).join('\n');
        const rolledBack = await autoRollback('Dependency installation failed');
        const suffix = rolledBack ? '' : ` Rollback also failed — manually restore from: ${backupPath}`;
        return { code: 1, stderr: (detail || `Dependency installation failed (exit code ${installRes.code}).`) + suffix, exitCode: 1 };
      }

      // ── Step 7: warmup to verify runtime is operational ──────────────────
      const warmupRes = await runCmd(
        wrapWithZsh('pnpm openclaw --version'),
        'Prebuilding OpenClaw runtime...'
      );
      if (warmupRes.code !== 0) {
        const rolledBack = await autoRollback('Runtime warm-up failed');
        if (rolledBack) {
          // node_modules was updated by the successful pnpm install; reinstall against restored source
          await runCmd(
            wrapWithZsh('pnpm install --no-frozen-lockfile'),
            'Reinstalling dependencies after rollback...'
          ).catch(() => {});
        }
        const suffix = rolledBack ? '' : ` Rollback also failed — manually restore from: ${backupPath}`;
        return { code: 1, stderr: (warmupRes.stderr || 'OpenClaw runtime warm-up failed.') + suffix, exitCode: 1 };
      }

      ctx.emitShellStdout(`>>> Update to ${targetVersion} complete!\n`, 'stdout');
      return { code: 0, stdout: JSON.stringify({ version: targetVersion, backupPath }), exitCode: 0 };
    } catch (e) {
      return { code: 1, stderr: (e as Error)?.message || 'project update failed', exitCode: 1 };
    } finally {
      if (updateTmpPath) fs.rm(updateTmpPath, { recursive: true, force: true }).catch(() => {});
    }
  }

  if (fullCommand.startsWith('project:uninstall')) {
    try {
      const payloadStr = fullCommand.replace('project:uninstall ', '').trim();
      const { corePath, configPath, workspacePath } = JSON.parse(payloadStr);

      const results: { step: string; ok: boolean; error?: string }[] = [];

      // Safety: refuse to remove paths with fewer than 2 non-root segments
      const isSafePath = (p: string) => {
        if (!p?.trim()) return false;
        const parts = p.split(path.sep).filter(Boolean);
        return parts.length >= 2;
      };

      const safeRm = async (dirPath: string, label: string) => {
        if (!dirPath?.trim()) {
          results.push({ step: label, ok: false, error: 'path is empty' });
          return;
        }
        if (!isSafePath(dirPath)) {
          results.push({ step: label, ok: false, error: `refusing to remove shallow path: ${dirPath}` });
          return;
        }
        try {
          await fs.rm(dirPath, { recursive: true, force: true });
          ctx.emitShellStdout(`>>> Removed ${dirPath}\n`, 'stdout');
          results.push({ step: label, ok: true });
        } catch (e) {
          results.push({ step: label, ok: false, error: (e as Error).message });
        }
      };

      // Step 1: kill all running processes
      ctx.stopGatewayWatchdog('project:uninstall');
      ctx.stopGatewayHttpWatchdog('project:uninstall');
      ctx.killAllSubprocesses();
      ctx.emitShellStdout('>>> Stopped all running processes\n', 'stdout');
      results.push({ step: 'kill-processes', ok: true });

      // Step 2: remove OpenClaw core
      if (corePath) await safeRm(corePath, 'remove-core');

      // Step 3: remove OpenClaw config directory
      if (configPath) await safeRm(configPath, 'remove-config');

      // Step 4: remove workspace directory
      if (workspacePath) await safeRm(workspacePath, 'remove-workspace');

      // Step 5: unload & remove LaunchAgent daemons (macOS only)
      if (process.platform === 'darwin') {
        const daemonLabels = ['ai.openclaw.gateway', 'ai.openclaw.watchdog'];
        const home = app.getPath('home');
        const launchAgentsDir = path.join(home, 'Library', 'LaunchAgents');
        let daemonOk = true;
        const daemonErrors: string[] = [];
        for (const label of daemonLabels) {
          const plistPath = path.join(launchAgentsDir, `${label}.plist`);
          try {
            await fs.stat(plistPath); // only proceed if plist exists
            const uid = process.getuid?.() ?? 501;
            await ctx.runShellCommand(`launchctl bootout gui/${uid}/${label} 2>/dev/null || true`);
            await fs.rm(plistPath, { force: true });
            ctx.emitShellStdout(`>>> Removed daemon ${label}\n`, 'stdout');
          } catch (e) {
            const msg = (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'not installed' : (e as Error).message;
            if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
              daemonOk = false;
              daemonErrors.push(`${label}: ${msg}`);
            }
          }
        }
        results.push({ step: 'remove-daemons', ok: daemonOk, error: daemonErrors.join('; ') || undefined });
      }

      // Step 6: clear OpenClaw path fields from ClawLaunch config (do NOT delete the config file)
      try {
        const launcherConfigPath = path.join(app.getPath('home'), '.clawlaunch', 'clawlaunch.json');
        let existing: Record<string, unknown> = {};
        try {
          const raw = await fs.readFile(launcherConfigPath, 'utf-8');
          existing = JSON.parse(raw);
        } catch { /* file may not exist */ }
        const cleared = { ...existing, corePath: '', configPath: '', workspacePath: '' };
        await fs.writeFile(launcherConfigPath, JSON.stringify(cleared, null, 2), 'utf-8');
        ctx.emitShellStdout('>>> Cleared OpenClaw paths from launcher config\n', 'stdout');
        results.push({ step: 'clear-launcher-paths', ok: true });
      } catch (e) {
        results.push({ step: 'clear-launcher-paths', ok: false, error: (e as Error).message });
      }

      ctx.emitShellStdout('>>> Uninstall complete\n', 'stdout');
      return { code: 0, stdout: JSON.stringify({ results }), exitCode: 0 };
    } catch (e) {
      return { code: 1, stderr: (e as Error)?.message || 'project uninstall failed', exitCode: 1 };
    }
  }

  return null;
}
