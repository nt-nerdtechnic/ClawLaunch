/**
 * Terminal Execution Utility for NT-ClawLaunch
 * Wraps CLI commands in MacOS osascript to launch them in an independent Terminal window.
 */

export interface ExecOptions {
  cwd?: string;
  holdOpen?: boolean;
  title?: string;
}

/**
 * Executes a command in a new MacOS Terminal window.
 * @param command The shell command to execute
 * @param options Execution options (cwd, holdOpen, title)
 */
export async function execInTerminal(command: string, options: ExecOptions = {}) {
  const { cwd, holdOpen = true, title = 'OpenClaw Action' } = options;
  
  // 1. Prepare the command string
  let finalCmd = `clear; echo '🚀 ${title}...'; `;
  
  if (cwd) {
    // Escape backslashes for AppleScript string
    const escapedCwd = cwd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    finalCmd += `cd \"${escapedCwd}\"; `;
  }
  
  // Escape the main command for AppleScript
  const escapedMainCmd = command.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  finalCmd += escapedMainCmd;
  
  if (holdOpen) {
    finalCmd += `; echo '\n程序結束。'; read -p '按 Enter 鍵關閉視窗...'`;
  }
  
  // 2. Wrap in osascript
  // Use double quotes for the AppleScript command string inside do script "..."
  // And escape double quotes for AppleScript syntax
  const appleScriptCmd = finalCmd.replace(/"/g, '\\"');
  
  // Construct the AppleScript statements
  const appleScript = `tell application "Terminal" to do script "${appleScriptCmd}"\ntell application "Terminal" to activate`;
  
  // Wrap the whole thing for the shell
  // We use single quotes for shell -e '...', so we must escape any single quotes in the script as '\''
  const escapedAppleScript = appleScript.replace(/'/g, "'\\''");
  const osascript = `osascript -e '${escapedAppleScript}'`;
  
  // 3. Execute via Electron Bridge
  if (window.electronAPI) {
    return await window.electronAPI.exec(osascript);
  } else {
    console.error('Electron API not available');
    return { code: 1, stderr: 'Electron API not available' };
  }
}
