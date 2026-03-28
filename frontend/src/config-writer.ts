import { useStore } from './store';

/**
 * NT-ClawLaunch: Config Persistence Bridge
 * This module handles saving store state to a real local file via Electron IPC.
 * Part of Phase 600 Task 3.
 */

export const saveConfigToFile = async () => {
  const { config } = useStore.getState();
  
  if (typeof window === 'undefined' || !window.electronAPI) {
    console.warn('[ConfigWriter] Electron API not found, skipping persistence.');
    return;
  }

  try {
    const response = await window.electronAPI.exec(`config:write ${JSON.stringify(config, null, 2)}`);
    if (response.exitCode !== 0) {
      throw new Error(response.stderr || 'Failed to save config');
    }
    console.log('[ConfigWriter] Config saved successfully');
  } catch (error) {
    console.error('[ConfigWriter] Error saving config:', error);
  }
};
