import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execInTerminal } from '../src/utils/terminal';

// 輔助函式：從執行結果中提取 osascript 呼叫的字串
function extractFinalCmd(execMock: ReturnType<typeof vi.fn>): string {
  const calledWith: string = execMock.mock.calls[0][0];
  return calledWith;
}

describe('execInTerminal', () => {
  const mockExec = vi.fn().mockResolvedValue({ code: 0, stdout: '', stderr: '' });

  beforeEach(() => {
    // 設置 window.electronAPI mock
    Object.defineProperty(window, 'electronAPI', {
      value: { exec: mockExec },
      writable: true,
      configurable: true,
    });
    mockExec.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Happy Path ────────────────────────────────────────────────────────
  describe('Happy Path', () => {
    it('正常呼叫時透過 Electron API 回傳結果', async () => {
      const result = await execInTerminal('echo hello');
      expect(mockExec).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ code: 0, stdout: '', stderr: '' });
    });

    it('生成的 osascript 包含 osascript -e 指令', async () => {
      await execInTerminal('echo hello');
      const cmd = extractFinalCmd(mockExec);
      expect(cmd).toContain('osascript -e');
      expect(cmd).toContain('tell application "Terminal"');
    });

    it('cwd 選項正確插入 cd 命令', async () => {
      await execInTerminal('npm install', { cwd: '/home/user/project' });
      const cmd = extractFinalCmd(mockExec);
      expect(cmd).toContain('cd \\"/home/user/project\\"');
    });

    it('自訂 title 會顯示在 Terminal 標題中', async () => {
      await execInTerminal('ls', { title: 'My Custom Title' });
      const cmd = extractFinalCmd(mockExec);
      expect(cmd).toContain('My Custom Title');
    });

    it('holdOpen=false 時不插入 read -r _ 等待指令', async () => {
      await execInTerminal('ls', { holdOpen: false });
      const cmd = extractFinalCmd(mockExec);
      expect(cmd).not.toContain('read -r _');
    });

    it('holdOpen=true（預設）時插入 read -r _ 等待指令', async () => {
      await execInTerminal('ls');
      const cmd = extractFinalCmd(mockExec);
      expect(cmd).toContain('read -r _');
    });

    it('沒有 cwd 選項時不含 cd 命令', async () => {
      await execInTerminal('ls');
      const cmd = extractFinalCmd(mockExec);
      expect(cmd).not.toContain('cd ');
    });
  });

  // ── Sad Path ────────────────────────────────────────────────────────
  describe('Sad Path', () => {
    it('electronAPI 不存在時回傳錯誤物件', async () => {
      Object.defineProperty(window, 'electronAPI', {
        value: undefined,
        writable: true,
        configurable: true,
      });

      const result = await execInTerminal('ls');
      expect(result).toEqual({ code: 1, stderr: 'Electron API not available' });
    });
  });
});
