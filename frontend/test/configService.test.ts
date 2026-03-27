import { describe, it, expect } from 'vitest';
import { ConfigService, ModelService } from '../src/services/configService';
import { PROVIDER_ALIAS_MAP } from '../src/constants/providers';

// ════════════════════════════════════════════════
//  ConfigService
// ════════════════════════════════════════════════
describe('ConfigService', () => {
  describe('normalizeConfigDir', () => {
    it('移除結尾 /openclaw.json（Unix 路徑）', () => {
      expect(ConfigService.normalizeConfigDir('/home/user/.config/openclaw.json'))
        .toBe('/home/user/.config');
    });

    it('移除結尾 \\openclaw.json（Windows 路徑）', () => {
      expect(ConfigService.normalizeConfigDir('C:\\Users\\user\\openclaw.json'))
        .toBe('C:\\Users\\user');
    });

    it('大小寫不敏感（OpenClaw.JSON）', () => {
      expect(ConfigService.normalizeConfigDir('/some/path/OpenClaw.JSON'))
        .toBe('/some/path');
    });

    it('沒有結尾 openclaw.json 時回傳原路徑（已是目錄）', () => {
      expect(ConfigService.normalizeConfigDir('/home/user/.config'))
        .toBe('/home/user/.config');
    });

    it('空字串傳回空字串', () => {
      expect(ConfigService.normalizeConfigDir('')).toBe('');
    });

    it('只有空白的字串傳回空字串', () => {
      expect(ConfigService.normalizeConfigDir('   ')).toBe('');
    });
  });

  describe('buildOpenClawEnvPrefix', () => {
    it('有路徑時包含 OPENCLAW_STATE_DIR 與 OPENCLAW_CONFIG_PATH', () => {
      const result = ConfigService.buildOpenClawEnvPrefix('/home/user/.config/openclaw.json');
      expect(result).toContain('OPENCLAW_STATE_DIR=');
      expect(result).toContain('OPENCLAW_CONFIG_PATH=');
    });

    it('configPath 未提供時傳回空字串', () => {
      expect(ConfigService.buildOpenClawEnvPrefix('')).toBe('');
      expect(ConfigService.buildOpenClawEnvPrefix()).toBe('');
    });

    it('有路徑時 config 路徑包含 openclaw.json', () => {
      const result = ConfigService.buildOpenClawEnvPrefix('/home/user/.config');
      expect(result).toContain('openclaw.json');
    });
  });
});

// ════════════════════════════════════════════════
//  ModelService
// ════════════════════════════════════════════════
describe('ModelService', () => {
  describe('inferProviderFromModel', () => {
    it('claude-* → anthropic', () => {
      expect(ModelService.inferProviderFromModel('claude-3-7-sonnet-latest')).toBe('anthropic');
    });

    it('gpt-* → openai', () => {
      expect(ModelService.inferProviderFromModel('gpt-4o')).toBe('openai');
    });

    it('o1-* → openai', () => {
      expect(ModelService.inferProviderFromModel('o1-mini')).toBe('openai');
    });

    it('o3-* → openai', () => {
      expect(ModelService.inferProviderFromModel('o3-turbo')).toBe('openai');
    });

    it('gemini-* → google', () => {
      expect(ModelService.inferProviderFromModel('gemini-2.0-flash')).toBe('google');
    });

    it('minimax-* → minimax', () => {
      expect(ModelService.inferProviderFromModel('MiniMax-M2.5')).toBe('minimax');
    });

    it('kimi-* → moonshot', () => {
      expect(ModelService.inferProviderFromModel('kimi-k2.5')).toBe('moonshot');
    });

    it('grok-* → xai', () => {
      expect(ModelService.inferProviderFromModel('grok-2')).toBe('xai');
    });

    it('ollama/* 取 / 前的 provider', () => {
      expect(ModelService.inferProviderFromModel('ollama/llama3')).toBe('ollama');
    });

    it('有 / 時取第一段作為 provider', () => {
      expect(ModelService.inferProviderFromModel('openrouter/auto')).toBe('openrouter');
    });

    it('空值傳回空字串', () => {
      expect(ModelService.inferProviderFromModel('')).toBe('');
    });

    it('未知模型傳回空字串', () => {
      expect(ModelService.inferProviderFromModel('unknown-model-xyz')).toBe('');
    });
  });

  describe('getProviderAliases', () => {
    it('已知 provider 傳回別名陣列', () => {
      const aliases = ModelService.getProviderAliases('anthropic', PROVIDER_ALIAS_MAP);
      expect(aliases).toContain('anthropic');
    });

    it('未知 provider 傳回 [providerRef] 自身', () => {
      const aliases = ModelService.getProviderAliases('unknown-provider', PROVIDER_ALIAS_MAP);
      expect(aliases).toEqual(['unknown-provider']);
    });

    it('空字串傳回空陣列', () => {
      expect(ModelService.getProviderAliases('', PROVIDER_ALIAS_MAP)).toEqual([]);
    });

    it('google 別名包含 gemini', () => {
      const aliases = ModelService.getProviderAliases('google', PROVIDER_ALIAS_MAP);
      expect(aliases).toContain('gemini');
    });
  });

  describe('providerMatchesFilters', () => {
    it('filters 為空時永遠通過', () => {
      expect(ModelService.providerMatchesFilters('anthropic', [], PROVIDER_ALIAS_MAP)).toBe(true);
    });

    it('provider 在 filter 內時通過', () => {
      expect(ModelService.providerMatchesFilters('anthropic', ['anthropic'], PROVIDER_ALIAS_MAP)).toBe(true);
    });

    it('provider 不在 filter 內時不通過', () => {
      expect(ModelService.providerMatchesFilters('openai', ['anthropic'], PROVIDER_ALIAS_MAP)).toBe(false);
    });

    it('透過別名匹配 google / gemini', () => {
      expect(ModelService.providerMatchesFilters('gemini', ['google'], PROVIDER_ALIAS_MAP)).toBe(true);
    });
  });

  describe('isModelAuthorizedByProvider', () => {
    it('授權列表空時永遠通過', () => {
      expect(ModelService.isModelAuthorizedByProvider('gpt-4o', [], PROVIDER_ALIAS_MAP)).toBe(true);
    });

    it('模型 provider 在授權列表中時通過', () => {
      expect(ModelService.isModelAuthorizedByProvider('gpt-4o', ['openai'], PROVIDER_ALIAS_MAP)).toBe(true);
    });

    it('模型 provider 不在授權列表中時不通過', () => {
      expect(ModelService.isModelAuthorizedByProvider('gpt-4o', ['anthropic'], PROVIDER_ALIAS_MAP)).toBe(false);
    });

    it('無法推斷 provider 時永遠通過（unknown model）', () => {
      expect(ModelService.isModelAuthorizedByProvider('unknown-x', ['anthropic'], PROVIDER_ALIAS_MAP)).toBe(true);
    });

    it('空 model 時永遠通過', () => {
      expect(ModelService.isModelAuthorizedByProvider('', ['anthropic'], PROVIDER_ALIAS_MAP)).toBe(true);
    });
  });
});
