import { describe, it, expect } from 'vitest';
import { shellQuote } from '../src/utils/shell';

describe('shellQuote', () => {
  // ── Happy Path ──────────────────────────────────────────────────────────
  describe('Happy Path', () => {
    it('一般英數字串不加引號', () => {
      expect(shellQuote('hello')).toBe('hello');
      expect(shellQuote('hello123')).toBe('hello123');
      expect(shellQuote('my-file')).toBe('my-file');
    });

    it('包含常見安全字元（@, %, +, =, :, ,, ., /）不加引號', () => {
      expect(shellQuote('/usr/local/bin')).toBe('/usr/local/bin');
      expect(shellQuote('user@host.com')).toBe('user@host.com');
      expect(shellQuote('key=value')).toBe('key=value');
    });

    it('包含空白的字串加上單引號', () => {
      expect(shellQuote('hello world')).toBe("'hello world'");
    });

    it('包含特殊字元（$, ;, !）時加引號', () => {
      expect(shellQuote('$HOME')).toBe("'$HOME'");
      expect(shellQuote('cmd; rm -rf /')).toBe("'cmd; rm -rf /'");
      expect(shellQuote('echo !')).toBe("'echo !'");
    });

    it('包含反引號（`）時加引號', () => {
      expect(shellQuote('`whoami`')).toBe("'`whoami`'");
    });
  });

  // ── Edge Case ───────────────────────────────────────────────────────────
  describe('Edge Case', () => {
    it("空字串傳回 ''", () => {
      expect(shellQuote('')).toBe("''");
    });

    it("字串內含單引號時正確 escape", () => {
      // 輸入：it's    →    期望：'it'"'"'s'
      const result = shellQuote("it's");
      expect(result).toBe("'it'\\''s'");
    });

    it('只有底線、連字號等安全字元不加引號', () => {
      expect(shellQuote('my_variable-name')).toBe('my_variable-name');
    });

    it('數字字串不加引號', () => {
      expect(shellQuote('42')).toBe('42');
    });
  });

  // ── Sad Path ────────────────────────────────────────────────────────────
  describe('Sad Path', () => {
    it('非字串型別直接傳回原值（非字串不應 crash）', () => {
      // shellQuote 的型別保護：typeof s !== 'string' → 直接回傳
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(shellQuote(null as any)).toBe(null);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(shellQuote(undefined as any)).toBe(undefined);
    });
  });
});
