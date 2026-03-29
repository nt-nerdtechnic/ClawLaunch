/** Gateway 參數建構與 OpenClaw Runtime 解析：不深依賴全域狀態。 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { app } from 'electron';
import { shellQuote } from '../utils/shell-utils.js';
import { safeJsonParse, normalizeConfigDir } from '../utils/normalize.js';

// ── Gateway 參數建構 ──────────────────────────────────────────────────────────

export const buildGatewayUrlArg = (gatewayPort?: string) => {
  const raw = String(gatewayPort || '').trim();
  if (!raw || !/^\d+$/.test(raw)) return '';
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return '';
  return ` --url ${shellQuote(`ws://127.0.0.1:${port}`)}`;
};

export const readEnvOverride = (...keys: string[]) => {
  for (const key of keys) {
    const value = String(process.env[key] || '').trim();
    if (value) return value;
  }
  return '';
};

export const resolveGatewayCredentials = (config: unknown) => {
  const c = config as { gateway?: { auth?: { token?: string; password?: string } } };
  const configToken = String(c?.gateway?.auth?.token || '').trim();
  const configPassword = String(c?.gateway?.auth?.password || '').trim();
  const token = readEnvOverride('OPENCLAW_GATEWAY_TOKEN', 'CLAWDBOT_GATEWAY_TOKEN') || configToken;
  const password = readEnvOverride('OPENCLAW_GATEWAY_PASSWORD') || configPassword;
  return { token, password: token ? '' : password };
};

export const buildGatewayAuthArg = (credentials: { token?: string; password?: string }) => {
  if (credentials.token) return ` --token ${shellQuote(credentials.token)}`;
  if (credentials.password) return ` --password ${shellQuote(credentials.password)}`;
  return '';
};

export const isGatewayOnlineFromStatus = (statusRes: { code: number; stdout: string; stderr: string }) => {
  if ((statusRes.code ?? 1) !== 0) return false;
  const raw = `${statusRes.stdout || ''}\n${statusRes.stderr || ''}`.toLowerCase();
  if (raw.includes('"online": true') || raw.includes('"online":true') || raw.includes('online') || raw.includes('running')) {
    return true;
  }
  if (String(statusRes.stdout || '').trim()) return true;
  const parsed = safeJsonParse(statusRes.stdout || '', null);
  if (parsed && typeof parsed === 'object') {
    const p = parsed as Record<string, unknown>;
    if (p.online === true) return true;
    if ((p.gateway as Record<string, unknown>)?.online === true) return true;
    if ((p.probe as Record<string, unknown>)?.online === true || (p.probe as Record<string, unknown>)?.ok === true) return true;
    if (typeof p.status === 'string' && /online|running/i.test(p.status)) return true;
  }
  return false;
};

// ── OpenClaw Runtime 解析 ────────────────────────────────────────────────────

const getClawlaunchFile = () => path.join(app.getPath('home'), '.clawlaunch', 'clawlaunch.json');

export async function resolveOpenClawRuntime() {
  const launcherConfigPath = getClawlaunchFile();
  let launcherConfig: Record<string, unknown> = {};
  try {
    const raw = await fs.readFile(launcherConfigPath, 'utf-8');
    launcherConfig = safeJsonParse(raw, {}) || {};
  } catch (_) {
    launcherConfig = {};
  }

  const corePath = String(launcherConfig.corePath || '').trim();
  const configDir = normalizeConfigDir(launcherConfig.configPath as string | undefined);
  const configFilePath = configDir ? path.join(configDir, 'openclaw.json') : '';
  let openclawConfig: Record<string, unknown> = {};
  if (configFilePath) {
    try {
      const raw = await fs.readFile(configFilePath, 'utf-8');
      openclawConfig = safeJsonParse<Record<string, unknown>>(raw, {}) || {};
    } catch (_) {
      openclawConfig = {};
    }
  }

  const gatewayCredentials = resolveGatewayCredentials(openclawConfig);
  const gatewayUrlArg = buildGatewayUrlArg(String((openclawConfig?.gateway as Record<string, unknown>)?.port ?? ''));
  const gatewayAuthArg = buildGatewayAuthArg(gatewayCredentials);
  const envPrefix = `${configDir ? `OPENCLAW_STATE_DIR=${shellQuote(configDir)} ` : ''}${configFilePath ? `OPENCLAW_CONFIG_PATH=${shellQuote(configFilePath)} ` : ''}`;
  const cdPrefix = corePath ? `cd ${shellQuote(corePath)} && ` : '';
  return {
    corePath,
    configDir,
    configFilePath,
    gatewayUrlArg,
    gatewayAuthArg,
    gatewayPort: String((openclawConfig?.gateway as Record<string, unknown>)?.port ?? '').trim(),
    gatewayToken: gatewayCredentials.token || '',
    openclawPrefix: `${cdPrefix}${envPrefix}pnpm openclaw`,
  };
}
