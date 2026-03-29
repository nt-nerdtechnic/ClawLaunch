import React from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store';
import { useTelegramPairing } from '../hooks/useTelegramPairing';
import { ConfigService } from '../services/configService';
import type { TelegramAuthorizedUser } from '../hooks/useTelegramPairing';

/**
 * 自包含的 Telegram 配對管理區塊。
 * 直接從 Zustand 讀取 config / addLog，不需要任何外部 props。
 */
export const TelegramPairingSection: React.FC = () => {
  const { t } = useTranslation();
  const config = useStore((s) => s.config);
  const addLog = useStore((s) => s.addLog);
  const setRuntimeProfile = useStore((s) => s.setRuntimeProfile);

  const resolvedConfigDir = ConfigService.normalizeConfigDir(config.configPath);

  const {
    telegramPairingRequests,
    telegramAuthorizedUsers,
    telegramPairingLoading,
    telegramPairingApprovingCode,
    setTelegramPairingApprovingCode,
    telegramPairingRejectingCode,
    setTelegramPairingRejectingCode,
    telegramPairingClearing,
    setTelegramPairingClearing,
    telegramPairingError,
    setTelegramPairingError,
    loadTelegramPairingRequests,
  } = useTelegramPairing(resolvedConfigDir, 'runtimeSettings', config, addLog);

  // --- 刷新 runtimeProfile（配對操作後呼叫） ---
  const refreshRuntimeProfile = async () => {
    if (!window.electronAPI || !resolvedConfigDir) return;
    const probeRes = await window.electronAPI.exec(
      `config:probe ${ConfigService.shellQuote(resolvedConfigDir)}`
    );
    if (probeRes.code === 0 && probeRes.stdout) {
      setRuntimeProfile(JSON.parse(probeRes.stdout));
    }
  };

  // --- Action handlers ---
  const approveTelegramPairing = async (request: { id: string; code: string }) => {
    if (!window.electronAPI) {
      addLog(t('logs.commFailed', { msg: 'Electron API not available' }), 'stderr');
      return;
    }
    const corePath = String(config.corePath || '').trim();
    if (!corePath) {
      setTelegramPairingError(t('monitor.telegramPairing.missingCorePath'));
      return;
    }

    setTelegramPairingApprovingCode(request.code);
    setTelegramPairingError('');
    try {
      const envPrefix = ConfigService.buildOpenClawEnvPrefix(config.configPath);
      const cmd = `cd ${ConfigService.shellQuote(corePath)} && ${envPrefix}pnpm openclaw pairing approve telegram ${ConfigService.shellQuote(request.code)}`;
      const res = await window.electronAPI.exec(cmd);
      const code = res.code ?? res.exitCode;
      if (code !== 0) {
        throw new Error(res.stderr || res.stdout || `exit ${code}`);
      }
      addLog(t('monitor.telegramPairing.approvedLog', { id: request.id }), 'system');
      await loadTelegramPairingRequests();
      await refreshRuntimeProfile();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : t('monitor.telegramPairing.approveFailed');
      setTelegramPairingError(message);
      addLog(message, 'stderr');
    } finally {
      setTelegramPairingApprovingCode('');
    }
  };

  const rejectTelegramPairing = async (request: { id: string; code: string }) => {
    if (!window.electronAPI || !resolvedConfigDir) {
      setTelegramPairingError(t('monitor.telegramPairing.missingConfig'));
      return;
    }

    setTelegramPairingRejectingCode(request.code);
    setTelegramPairingError('');
    try {
      const pairingFile = `${resolvedConfigDir}/credentials/telegram-pairing.json`;
      const cmd = `PAIRING_FILE=${ConfigService.shellQuote(pairingFile)} TARGET_CODE=${ConfigService.shellQuote(request.code)} node - <<'NODE'\nconst fs = require('fs');\nconst file = process.env.PAIRING_FILE;\nconst targetCode = process.env.TARGET_CODE;\nlet data = { version: 1, requests: [] };\nif (fs.existsSync(file)) {\n  data = JSON.parse(fs.readFileSync(file, 'utf8'));\n}\nconst requests = Array.isArray(data.requests) ? data.requests : [];\ndata.requests = requests.filter((entry) => String(entry?.code || '') !== String(targetCode || ''));\nfs.writeFileSync(file, JSON.stringify(data, null, 2) + '\\n', 'utf8');\nNODE`;
      const res = await window.electronAPI.exec(cmd);
      const code = res.code ?? res.exitCode;
      if (code !== 0) {
        throw new Error(res.stderr || res.stdout || `exit ${code}`);
      }
      addLog(t('monitor.telegramPairing.rejectedLog', { id: request.id }), 'system');
      await loadTelegramPairingRequests();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : t('monitor.telegramPairing.rejectFailed');
      setTelegramPairingError(message);
      addLog(message, 'stderr');
    } finally {
      setTelegramPairingRejectingCode('');
    }
  };

  const clearTelegramPairingRequests = async () => {
    if (!window.electronAPI || !resolvedConfigDir) {
      setTelegramPairingError(t('monitor.telegramPairing.missingConfig'));
      return;
    }

    setTelegramPairingClearing(true);
    setTelegramPairingError('');
    try {
      const pairingFile = `${resolvedConfigDir}/credentials/telegram-pairing.json`;
      const cmd = `PAIRING_FILE=${ConfigService.shellQuote(pairingFile)} node - <<'NODE'\nconst fs = require('fs');\nconst file = process.env.PAIRING_FILE;\nlet data = { version: 1, requests: [] };\nif (fs.existsSync(file)) {\n  data = JSON.parse(fs.readFileSync(file, 'utf8'));\n}\ndata.requests = [];\nfs.writeFileSync(file, JSON.stringify(data, null, 2) + '\\n', 'utf8');\nNODE`;
      const res = await window.electronAPI.exec(cmd);
      const code = res.code ?? res.exitCode;
      if (code !== 0) {
        throw new Error(res.stderr || res.stdout || `exit ${code}`);
      }
      addLog(t('monitor.telegramPairing.clearedLog'), 'system');
      await loadTelegramPairingRequests();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : t('monitor.telegramPairing.clearFailed');
      setTelegramPairingError(message);
      addLog(message, 'stderr');
    } finally {
      setTelegramPairingClearing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            {t('runtime.telegram.management')}
          </div>
          <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
            {t('runtime.telegram.pairingLabel')}
          </span>
        </div>
        <button
          type="button"
          onClick={clearTelegramPairingRequests}
          disabled={
            telegramPairingClearing ||
            telegramPairingLoading ||
            telegramPairingRequests.length === 0
          }
          className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          {telegramPairingClearing
            ? t('common.labels.executing')
            : t('runtime.telegram.clearPairing')}
        </button>
      </div>

      {telegramPairingError && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-700/60 dark:bg-red-950/30 dark:text-red-300">
          {telegramPairingError}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="space-y-3">
          <div className="text-xs font-bold text-slate-700 dark:text-slate-200">
            {t('monitor.telegramPairing.title')}
          </div>
          {telegramPairingLoading ? (
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <Loader2 size={14} className="animate-spin" />
              {t('runtime.telegram.pairingLoading')}
            </div>
          ) : telegramPairingRequests.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 px-3 py-4 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
              {t('runtime.telegram.noPairing')}
            </div>
          ) : (
            <div className="space-y-2">
              {telegramPairingRequests.map((request) => (
                <div
                  key={request.id || request.code}
                  className="rounded-xl border border-slate-200 bg-white/80 p-3 dark:border-slate-700 dark:bg-slate-900/50"
                >
                  <div className="text-xs font-bold text-slate-700 dark:text-slate-200">
                    {request.id || 'unknown-id'}
                  </div>
                  <div className="mt-1 font-mono text-xs text-slate-600 dark:text-slate-300">
                    Code: {request.code || '-'}
                  </div>
                  {request.meta?.accountId && (
                    <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                      User ID: {request.meta.accountId}
                    </div>
                  )}
                  {(request.meta?.username || request.meta?.firstName) && (
                    <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                      {[request.meta.firstName, request.meta.lastName]
                        .filter(Boolean)
                        .join(' ')}
                      {request.meta.username && ` (@${request.meta.username})`}
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => approveTelegramPairing(request)}
                      disabled={
                        telegramPairingApprovingCode === request.code ||
                        telegramPairingRejectingCode === request.code
                      }
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white transition-colors hover:bg-emerald-500 disabled:opacity-60"
                    >
                      {telegramPairingApprovingCode === request.code
                        ? t('runtime.telegram.approving')
                        : t('controlCenter.actions.approve')}
                    </button>
                    <button
                      type="button"
                      onClick={() => rejectTelegramPairing(request)}
                      disabled={
                        telegramPairingApprovingCode === request.code ||
                        telegramPairingRejectingCode === request.code
                      }
                      className="rounded-lg bg-rose-600 px-3 py-1.5 text-[11px] font-bold text-white transition-colors hover:bg-rose-500 disabled:opacity-60"
                    >
                      {telegramPairingRejectingCode === request.code
                        ? t('runtime.telegram.rejecting')
                        : t('controlCenter.actions.reject')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="text-xs font-bold text-slate-700 dark:text-slate-200">
            {t('runtime.telegram.authorizedUsers')}
          </div>
          {telegramAuthorizedUsers.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 px-3 py-4 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
              {t('runtime.telegram.noAuthorizedUsers')}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {telegramAuthorizedUsers.map((user: TelegramAuthorizedUser) => (
                <span
                  key={String(user?.id || '')}
                  className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-mono text-emerald-700 dark:border-emerald-700/60 dark:bg-emerald-950/30 dark:text-emerald-300"
                >
                  {String(user?.id || '')}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
