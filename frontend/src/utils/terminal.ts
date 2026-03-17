/**
 * Terminal Execution Utility for NT-ClawLaunch
 * Wraps CLI commands in MacOS osascript to launch them in an independent Terminal window.
 */

export interface ExecOptions {
  cwd?: string;
  holdOpen?: boolean;
  title?: string;
}

const NT_CLAW_TERMINAL_MARKER_PREFIX = '__NT_CLAWLAUNCH_MANAGED__';

function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Executes a command in a new MacOS Terminal window.
 * @param command The shell command to execute
 * @param options Execution options (cwd, holdOpen, title)
 */
export async function execInTerminal(command: string, options: ExecOptions = {}) {
  const { cwd, holdOpen = true, title = 'OpenClaw Action' } = options;
  const marker = `${NT_CLAW_TERMINAL_MARKER_PREFIX}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  
  // 1. Prepare the command string
  let finalCmd = `clear; echo '🚀 ${title}...'; echo '${marker}'; `;
  
  if (cwd) {
    finalCmd += `cd "${cwd}"; `;
  }
  
  finalCmd += command;
  
  if (holdOpen) {
    finalCmd += `; printf "\\n程序結束。\\n按 Enter 鍵關閉視窗..."; read -r _`;
  }
  
  // 2. Build osascript with separate -e arguments to avoid parser breakage.
  const line1 = `tell application "Terminal" to do script "${escapeAppleScriptString(finalCmd)}"`;
  const line2 = `tell application "Terminal" to activate`;
  const osascript = `osascript -e ${shellSingleQuote(line1)} -e ${shellSingleQuote(line2)}`;
  
  // 3. Execute via Electron Bridge
  if (window.electronAPI) {
    return await window.electronAPI.exec(osascript);
  } else {
    console.error('Electron API not available');
    return { code: 1, stderr: 'Electron API not available' };
  }
}
