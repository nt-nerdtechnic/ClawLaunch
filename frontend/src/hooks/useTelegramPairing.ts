import { useState, useEffect, useCallback } from 'react';

export type TelegramPairingRequest = {
  id: string;
  code: string;
  createdAt?: string;
  lastSeenAt?: string;
  meta?: {
    username?: string;
    firstName?: string;
    lastName?: string;
    accountId?: string;
  };
};

export type TelegramAuthorizedUser = {
  id: string;
};

/**
 * Telegram pairing management hook
 * Manages Telegram pairing requests and authorized users
 */
export function useTelegramPairing(
  resolvedConfigDir: string,
  activeTab: string,
  _config: any,
  _onLog?: (msg: string, source: 'system' | 'stderr' | 'stdout') => void
) {
  const [telegramPairingRequests, setTelegramPairingRequests] = useState<TelegramPairingRequest[]>([]);
  const [telegramAuthorizedUsers, setTelegramAuthorizedUsers] = useState<TelegramAuthorizedUser[]>([]);
  const [telegramPairingLoading, setTelegramPairingLoading] = useState(false);
  const [telegramPairingApprovingCode, setTelegramPairingApprovingCode] = useState('');
  const [telegramPairingRejectingCode, setTelegramPairingRejectingCode] = useState('');
  const [telegramPairingClearing, setTelegramPairingClearing] = useState(false);
  const [telegramPairingError, setTelegramPairingError] = useState('');

  const shellQuote = (value: string) => `'${String(value).replace(/'/g, `'\\''`)}'`;

  // Load Telegram pairing requests
  const loadTelegramPairingRequests = useCallback(async () => {
    if (!window.electronAPI || !resolvedConfigDir) {
      setTelegramPairingRequests([]);
      setTelegramAuthorizedUsers([]);
      setTelegramPairingError('');
      return;
    }

    setTelegramPairingLoading(true);
    setTelegramPairingError('');
    try {
      const pairingFile = `${resolvedConfigDir}/credentials/telegram-pairing.json`;
      const allowFromFile = `${resolvedConfigDir}/credentials/telegram-default-allowFrom.json`;
      const [pairingRes, allowFromRes] = await Promise.all([
        window.electronAPI.exec(`test -f ${shellQuote(pairingFile)} && cat ${shellQuote(pairingFile)}`),
        window.electronAPI.exec(`test -f ${shellQuote(allowFromFile)} && cat ${shellQuote(allowFromFile)}`),
      ]);

      const pairingCode = pairingRes.code ?? pairingRes.exitCode;
      const pairingStdout = String(pairingRes.stdout || '').trim();
      const parsedPairing = pairingCode === 0 && pairingStdout ? JSON.parse(pairingRes.stdout) : { requests: [] };
      const requests = Array.isArray(parsedPairing?.requests) ? parsedPairing.requests : [];
      setTelegramPairingRequests(
        requests.map((request: any) => ({
          id: String(request?.id || ''),
          code: String(request?.code || ''),
          createdAt: request?.createdAt,
          lastSeenAt: request?.lastSeenAt,
          meta: request?.meta || {},
        }))
      );

      const allowFromCode = allowFromRes.code ?? allowFromRes.exitCode;
      const allowFromStdout = String(allowFromRes.stdout || '').trim();
      const parsedAllowFrom = allowFromCode === 0 && allowFromStdout ? JSON.parse(allowFromRes.stdout) : { allowFrom: [] };
      const allowFrom = Array.isArray(parsedAllowFrom?.allowFrom) ? parsedAllowFrom.allowFrom : [];
      setTelegramAuthorizedUsers(
        allowFrom
          .map((entry: any) => ({
            id: String(entry || '').replace(/^(telegram:|tg:)/i, ''),
          }))
          .filter((entry: TelegramAuthorizedUser) => entry.id)
      );
    } catch (e: any) {
      setTelegramPairingRequests([]);
      setTelegramAuthorizedUsers([]);
      setTelegramPairingError(e?.message || 'Failed to load pairing requests');
    } finally {
      setTelegramPairingLoading(false);
    }
  }, [resolvedConfigDir]);

  // Periodic reload
  useEffect(() => {
    if (activeTab !== 'runtimeSettings') return;
    loadTelegramPairingRequests();
    const interval = window.setInterval(() => {
      loadTelegramPairingRequests();
    }, 15000);
    return () => window.clearInterval(interval);
  }, [activeTab, resolvedConfigDir]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    telegramPairingRequests,
    setTelegramPairingRequests,
    telegramAuthorizedUsers,
    setTelegramAuthorizedUsers,
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
  };
}
