import { describe, it, expect } from 'vitest';
import {
  AUTH_CHOICE_PROVIDER_ALIASES,
  PROVIDER_ALIAS_MAP,
  OAUTH_AUTH_CHOICES,
  getProviderGroups,
} from '../src/constants/providers';

// Mock TFunction — 直接回傳 key
const t = (key: string) => key;

describe('AUTH_CHOICE_PROVIDER_ALIASES', () => {
  it('apiKey 對應 anthropic', () => {
    expect(AUTH_CHOICE_PROVIDER_ALIASES['apiKey']).toContain('anthropic');
  });

  it('openai-api-key 對應 openai', () => {
    expect(AUTH_CHOICE_PROVIDER_ALIASES['openai-api-key']).toContain('openai');
  });

  it('gemini-api-key 對應 gemini / google', () => {
    const aliases = AUTH_CHOICE_PROVIDER_ALIASES['gemini-api-key'];
    expect(aliases).toContain('gemini');
    expect(aliases).toContain('google');
  });

  it('所有 key 的值都是非空陣列', () => {
    for (const [key, aliases] of Object.entries(AUTH_CHOICE_PROVIDER_ALIASES)) {
      expect(Array.isArray(aliases), `${key} 應是陣列`).toBe(true);
      expect(aliases.length, `${key} 不應為空陣列`).toBeGreaterThan(0);
    }
  });
});

describe('PROVIDER_ALIAS_MAP', () => {
  it('anthropic 只包含自身', () => {
    expect(PROVIDER_ALIAS_MAP['anthropic']).toEqual(['anthropic']);
  });

  it('google 包含 gemini 別名', () => {
    expect(PROVIDER_ALIAS_MAP['google']).toContain('gemini');
  });

  it('openai 包含 openai-codex 別名', () => {
    expect(PROVIDER_ALIAS_MAP['openai']).toContain('openai-codex');
  });

  it('所有 value 都是非空陣列', () => {
    for (const [key, aliases] of Object.entries(PROVIDER_ALIAS_MAP)) {
      expect(Array.isArray(aliases), `${key} 應是陣列`).toBe(true);
      expect(aliases.length, `${key} 不應為空`).toBeGreaterThan(0);
    }
  });
});

describe('OAUTH_AUTH_CHOICES', () => {
  it('是 Set 型別', () => {
    expect(OAUTH_AUTH_CHOICES).toBeInstanceOf(Set);
  });

  it('包含 openai-codex（OAuth 流程）', () => {
    expect(OAUTH_AUTH_CHOICES.has('openai-codex')).toBe(true);
  });

  it('包含 google-gemini-cli（OAuth 流程）', () => {
    expect(OAUTH_AUTH_CHOICES.has('google-gemini-cli')).toBe(true);
  });

  it('包含 chutes（OAuth 流程）', () => {
    expect(OAUTH_AUTH_CHOICES.has('chutes')).toBe(true);
  });

  it('不包含 apiKey（非 OAuth 流程）', () => {
    expect(OAUTH_AUTH_CHOICES.has('apiKey')).toBe(false);
  });

  it('不包含 openai-api-key（非 OAuth 流程）', () => {
    expect(OAUTH_AUTH_CHOICES.has('openai-api-key')).toBe(false);
  });
});

describe('getProviderGroups', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const groups = getProviderGroups(t as any);

  it('至少包含 anthropic、openai、google 三個 Provider 群組', () => {
    const ids = groups.map((g) => g.id);
    expect(ids).toContain('anthropic');
    expect(ids).toContain('openai');
    expect(ids).toContain('google');
  });

  it('每個 group 都有 id、label、icon、choices', () => {
    for (const group of groups) {
      expect(group.id, '缺少 id').toBeTruthy();
      expect(group.label, '缺少 label').toBeTruthy();
      expect(group.icon, '缺少 icon').toBeDefined();
      expect(Array.isArray(group.choices), '缺少 choices 陣列').toBe(true);
      expect(group.choices.length, 'choices 不得為空').toBeGreaterThan(0);
    }
  });

  it('每個 choice 都有 id、name、reqKey', () => {
    for (const group of groups) {
      for (const choice of group.choices) {
        expect(choice.id, '缺少 choice.id').toBeTruthy();
        expect(choice.name, '缺少 choice.name').toBeTruthy();
        expect(typeof choice.reqKey, 'reqKey 應為 boolean').toBe('boolean');
      }
    }
  });

  it('OAuth 選項的 reqKey 應為 false', () => {
    for (const group of groups) {
      for (const choice of group.choices) {
        if (choice.oauthFlow) {
          expect(choice.reqKey, `${choice.id} 是 OAuth 但 reqKey=true`).toBe(false);
        }
      }
    }
  });
});
