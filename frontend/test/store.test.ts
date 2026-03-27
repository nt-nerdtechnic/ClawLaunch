import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../src/store';

// ────────────────────────────────────────────────────────────────
// 每個測試前重置整個 store 為初始狀態
// ────────────────────────────────────────────────────────────────
beforeEach(() => {
  useStore.setState(useStore.getInitialState());
});

// ════════════════════════════════════════════════
//  基本狀態
// ════════════════════════════════════════════════
describe('running / setRunning', () => {
  it('初始狀態為 false', () => {
    expect(useStore.getState().running).toBe(false);
  });

  it('setRunning(true) 後 running = true', () => {
    useStore.getState().setRunning(true);
    expect(useStore.getState().running).toBe(true);
  });

  it('setRunning(false) 後 running = false', () => {
    useStore.getState().setRunning(true);
    useStore.getState().setRunning(false);
    expect(useStore.getState().running).toBe(false);
  });
});

// ════════════════════════════════════════════════
//  Logs
// ════════════════════════════════════════════════
describe('addLog', () => {
  it('初始 logs 為空陣列', () => {
    expect(useStore.getState().logs).toHaveLength(0);
  });

  it('新增一筆 log 後長度為 1', () => {
    useStore.getState().addLog('hello world', 'system');
    expect(useStore.getState().logs).toHaveLength(1);
  });

  it('log 的 source 正確', () => {
    useStore.getState().addLog('error msg', 'stderr');
    expect(useStore.getState().logs[0].source).toBe('stderr');
  });

  it('log 的 text 正確', () => {
    useStore.getState().addLog('my text');
    expect(useStore.getState().logs[0].text).toBe('my text');
  });

  it('超過 100 筆時自動刪除最舊的 log', () => {
    for (let i = 0; i < 105; i++) {
      useStore.getState().addLog(`log ${i}`);
    }
    const logs = useStore.getState().logs;
    expect(logs.length).toBeLessThanOrEqual(100);
    // 最新的 log 應存在
    expect(logs[logs.length - 1].text).toBe('log 104');
  });
});

// ════════════════════════════════════════════════
//  Config
// ════════════════════════════════════════════════
describe('setConfig', () => {
  it('部分更新 config（patch）只改對應欄位', () => {
    useStore.getState().setConfig({ model: 'claude-3-7-sonnet-latest' });
    const config = useStore.getState().config;
    expect(config.model).toBe('claude-3-7-sonnet-latest');
    expect(config.platform).toBe('telegram'); // 未修改的欄位不變
  });

  it('可以多次 patch 累積更新', () => {
    useStore.getState().setConfig({ model: 'gpt-4o' });
    useStore.getState().setConfig({ apiKey: 'sk-test-123' });
    const config = useStore.getState().config;
    expect(config.model).toBe('gpt-4o');
    expect(config.apiKey).toBe('sk-test-123');
  });
});

// ════════════════════════════════════════════════
//  Event Queue — ackEventLocal
// ════════════════════════════════════════════════
describe('ackEventLocal', () => {
  const mockEvent = {
    id: 'evt-001',
    level: 'info' as const,
    title: 'Test Event',
    detail: 'detail',
    source: 'test',
    createdAt: new Date().toISOString(),
    status: 'pending' as const,
  };

  beforeEach(() => {
    useStore.setState({ eventQueue: [mockEvent], ackedEvents: [] });
  });

  it('ack 後 event 從 queue 移除', () => {
    useStore.getState().ackEventLocal('evt-001');
    expect(useStore.getState().eventQueue).toHaveLength(0);
  });

  it('ack 後 event 出現在 ackedEvents', () => {
    useStore.getState().ackEventLocal('evt-001');
    const acked = useStore.getState().ackedEvents;
    expect(acked).toHaveLength(1);
    expect(acked[0].id).toBe('evt-001');
    expect(acked[0].status).toBe('acked');
  });

  it('ack 不存在的 event ID 時不改變任何狀態', () => {
    useStore.getState().ackEventLocal('non-existent-id');
    expect(useStore.getState().eventQueue).toHaveLength(1);
    expect(useStore.getState().ackedEvents).toHaveLength(0);
  });

  it('acked event 包含 ackedAt 與 ackExpiresAt 時間戳', () => {
    useStore.getState().ackEventLocal('evt-001', 60_000);
    const acked = useStore.getState().ackedEvents[0];
    expect(acked.ackedAt).toBeTruthy();
    expect(acked.ackExpiresAt).toBeTruthy();
  });
});

// ════════════════════════════════════════════════
//  Chat — 訊息管理
// ════════════════════════════════════════════════
describe('chat 狀態管理', () => {
  describe('addChatMessage', () => {
    it('新增 user 訊息後 messages 長度 +1', () => {
      useStore.getState().addChatMessage({
        id: 'msg-1',
        role: 'user',
        content: 'Hello',
        sessionKey: 'sess-1',
        agentId: 'agent-1',
        createdAt: Date.now(),
        status: 'done',
      });
      expect(useStore.getState().chat.messages).toHaveLength(1);
    });

    it('assistant 訊息在 chat 關閉時累積 unreadCount', () => {
      useStore.setState((s) => ({ chat: { ...s.chat, isOpen: false, unreadCount: 0 } }));
      useStore.getState().addChatMessage({
        id: 'msg-2',
        role: 'assistant',
        content: 'Hi there!',
        sessionKey: 'sess-1',
        agentId: 'agent-1',
        createdAt: Date.now(),
        status: 'done',
      });
      expect(useStore.getState().chat.unreadCount).toBe(1);
    });

    it('chat 開啟時 assistant 訊息不增加 unreadCount', () => {
      useStore.setState((s) => ({ chat: { ...s.chat, isOpen: true, unreadCount: 0 } }));
      useStore.getState().addChatMessage({
        id: 'msg-3',
        role: 'assistant',
        content: 'Hello!',
        sessionKey: 'sess-1',
        agentId: 'agent-1',
        createdAt: Date.now(),
        status: 'done',
      });
      expect(useStore.getState().chat.unreadCount).toBe(0);
    });
  });

  describe('appendChatChunk', () => {
    it('已存在的 id → 附加 chunk 到 content', () => {
      useStore.getState().addChatMessage({
        id: 'stream-1',
        role: 'assistant',
        content: 'Hello',
        sessionKey: 'sess-1',
        agentId: 'agent-1',
        createdAt: Date.now(),
        status: 'streaming',
      });
      useStore.getState().appendChatChunk('stream-1', ' World', 'sess-1', 'agent-1');
      const msg = useStore.getState().chat.messages.find((m) => m.id === 'stream-1');
      expect(msg?.content).toBe('Hello World');
    });

    it('不存在的 id → 自動新增訊息', () => {
      useStore.getState().appendChatChunk('new-stream', 'First chunk', 'sess-1', 'agent-1');
      const msg = useStore.getState().chat.messages.find((m) => m.id === 'new-stream');
      expect(msg).toBeDefined();
      expect(msg?.content).toBe('First chunk');
      expect(msg?.role).toBe('assistant');
    });

    it('appendChatChunk 後 isStreaming = true', () => {
      useStore.getState().appendChatChunk('s1', 'data', 'sess', 'agent');
      expect(useStore.getState().chat.isStreaming).toBe(true);
    });
  });

  describe('completeChatMessage', () => {
    it('訊息狀態改為 done，isStreaming = false', () => {
      useStore.getState().addChatMessage({
        id: 'done-1',
        role: 'assistant',
        content: 'partial',
        sessionKey: 'sess',
        agentId: 'agent',
        createdAt: Date.now(),
        status: 'streaming',
      });
      useStore.getState().completeChatMessage('done-1');
      const msg = useStore.getState().chat.messages.find((m) => m.id === 'done-1');
      expect(msg?.status).toBe('done');
      expect(useStore.getState().chat.isStreaming).toBe(false);
    });

    it('可以帶 patch 更新額外欄位', () => {
      useStore.getState().addChatMessage({
        id: 'done-2',
        role: 'assistant',
        content: 'hello',
        sessionKey: 'sess',
        agentId: 'agent',
        createdAt: Date.now(),
        status: 'streaming',
      });
      useStore.getState().completeChatMessage('done-2', { content: 'final content' });
      const msg = useStore.getState().chat.messages.find((m) => m.id === 'done-2');
      expect(msg?.content).toBe('final content');
    });
  });

  describe('resetChatMessages', () => {
    it('清空 messages 並重置 isStreaming 與 unreadCount', () => {
      useStore.getState().addChatMessage({
        id: 'r1',
        role: 'user',
        content: 'hi',
        sessionKey: 's',
        agentId: 'a',
        createdAt: Date.now(),
        status: 'done',
      });

      useStore.getState().resetChatMessages();
      const chat = useStore.getState().chat;
      expect(chat.messages).toHaveLength(0);
      expect(chat.isStreaming).toBe(false);
      expect(chat.unreadCount).toBe(0);
    });
  });

  describe('markChatMessageError', () => {
    it('訊息狀態改為 error 並記錄錯誤字串', () => {
      useStore.getState().addChatMessage({
        id: 'err-1',
        role: 'assistant',
        content: 'partial',
        sessionKey: 'sess',
        agentId: 'agent',
        createdAt: Date.now(),
        status: 'streaming',
      });
      useStore.getState().markChatMessageError('err-1', 'Connection timeout');
      const msg = useStore.getState().chat.messages.find((m) => m.id === 'err-1');
      expect(msg?.status).toBe('error');
      expect(msg?.error).toBe('Connection timeout');
      expect(useStore.getState().chat.isStreaming).toBe(false);
    });
  });
});
