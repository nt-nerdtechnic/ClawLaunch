/**
 * ModelDiscoveryService: 動態從雲端供應商獲取模型清單的服務。
 */

import { t } from '../utils/i18n.js';

interface RemoteModelGroup {
  provider: string;
  group: string;
  models: string[];
}

interface AuthProfile {
  profileId: string;
  provider: string;
  apiKey?: string;
  api_key?: string;
  token?: string;
  bearer?: string;
}

export class ModelDiscoveryService {
  /**
   * 從 OpenRouter 公開 API 取得所有主流 provider 的最新模型清單。
   * 不需要任何 API key，用於無授權情境下的模型目錄更新。
   */
  async fetchPublicCatalogue(filters: string[] = []): Promise<RemoteModelGroup[]> {
    try {
      const resp = await fetch('https://openrouter.ai/api/v1/models', {
        signal: AbortSignal.timeout(8000),
      });
      if (!resp.ok) return [];

      const data = await resp.json() as { data: Array<{ id: string; name?: string }> };
      if (!Array.isArray(data?.data)) return [];

      // 過濾掉非文字生成模型
      const textModels = data.data
        .map(m => m.id)
        .filter(id => {
          const low = id.toLowerCase();
          return !low.includes('embedding') && !low.includes('dall-e') &&
                 !low.includes('tts') && !low.includes('whisper') &&
                 !low.includes('vision-only') && !low.includes('image');
        });

      // 依 provider 分組（OpenRouter ID 格式：provider/model-name）
      const grouped = new Map<string, Set<string>>();
      for (const modelId of textModels) {
        const slashIdx = modelId.indexOf('/');
        if (slashIdx === -1) continue;
        const provider = modelId.slice(0, slashIdx).toLowerCase();
        if (filters.length > 0 && !filters.some(f => provider.includes(f) || f.includes(provider))) continue;
        if (!grouped.has(provider)) grouped.set(provider, new Set());
        grouped.get(provider)!.add(modelId);
      }

      return Array.from(grouped.entries()).map(([provider, models]) => ({
        provider,
        group: this.getDisplayName(provider),
        models: Array.from(models).sort(),
      }));
    } catch (e) {
      console.warn('[ModelDiscovery] fetchPublicCatalogue failed:', e);
      return [];
    }
  }

  /**
   * 根據多個授權 Profile 獲取所有可用的遠端模型。
   */
  async fetchAllRemoteModels(profiles: AuthProfile[]): Promise<RemoteModelGroup[]> {
    console.log(`[ModelDiscovery] Starting discovery for ${profiles.length} profiles...`);
    // 限制並行數量或確保每個都有硬性超時
    const tasks = profiles.map(profile => {
      return this.withTimeout(
        this.fetchProviderModels(profile),
        3000,
        `Fetch ${profile.provider}`
      );
    });

    const results = await Promise.allSettled(tasks);
    
    const groups: RemoteModelGroup[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        groups.push(result.value);
      }
    }
    console.log(`[ModelDiscovery] Discovery finished. Groups found: ${groups.length}`);
    return groups;
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T | null> {
    let timeoutId: any;
    const timeoutPromise = new Promise<null>((resolve) => {
      timeoutId = setTimeout(() => {
        console.warn(`[ModelDiscovery] ${label} timed out after ${ms}ms`);
        resolve(null);
      }, ms);
    });

    try {
      return await Promise.race([promise, timeoutPromise]) as T | null;
    } catch (e) {
      console.error(`[ModelDiscovery] ${label} failed:`, e);
      return null;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  private async fetchProviderModels(profile: AuthProfile): Promise<RemoteModelGroup | null> {
    const provider = String(profile.provider || '').toLowerCase();
    const key = (profile.apiKey || profile.api_key || profile.token || profile.bearer || '').trim();
    if (!key && !this.isCredentialless(provider)) return null;

    // 統一 provider 別名到標準名稱（對應 OpenClaw auth profile 命名慣例）
    const normalizedProvider = this.normalizeProvider(provider);

    try {
      let models: string[] = [];
      switch (normalizedProvider) {
        case 'openai':
        case 'openai-codex':
          models = await this.fetchOpenAiCompatibleModels('openai', key);
          break;
        case 'deepseek':
        case 'mistral':
        case 'groq':
        case 'xai':
          models = await this.fetchOpenAiCompatibleModels(normalizedProvider, key);
          break;
        case 'anthropic':
          models = await this.fetchAnthropicModels(key);
          break;
        case 'gemini':
        case 'google':
          models = await this.fetchGeminiModels(key);
          break;
        case 'openrouter':
          models = await this.fetchOpenRouterModels(key);
          break;
        case 'minimax':
          models = await this.fetchMiniMaxModels(key);
          break;
        case 'moonshot':
          models = await this.fetchMoonshotModels(key);
          break;
        case 'ollama':
          models = await this.fetchOllamaModels();
          break;
        default:
          return null;
      }

      if (models.length === 0) return null;

      return {
        provider: normalizedProvider,
        group: this.getDisplayName(normalizedProvider),
        models: Array.from(new Set(models)).sort().map(m => m.includes('/') ? m : `${normalizedProvider}/${m}`),
      };
    } catch (e) {
      console.error(`[ModelDiscovery] Failed to fetch models for ${provider}:`, e);
      return null;
    }
  }

  private normalizeProvider(provider: string): string {
    const aliasMap: Record<string, string> = {
      'minimax-portal': 'minimax',
      'google-gemini-cli': 'google',
      'google-gemini': 'google',
      'gemini': 'gemini',
      'openai-codex': 'openai-codex',
      'qwen-portal': 'qwen',
    };
    return aliasMap[provider] || provider;
  }

  private isCredentialless(provider: string): boolean {
    return ['ollama', 'vllm'].includes(provider);
  }

  private getDisplayName(provider: string): string {
    const map: Record<string, string> = {
      openai: 'OpenAI (Cloud)',
      'openai-codex': 'OpenAI (Cloud)',
      anthropic: 'Anthropic (Claude)',
      gemini: 'Google Gemini',
      google: 'Google Gemini',
      deepseek: 'DeepSeek',
      openrouter: 'OpenRouter',
      mistral: 'Mistral AI',
      groq: 'Groq Cloud',
      xai: 'xAI (Grok)',
      minimax: 'MiniMax',
      moonshot: 'Moonshot (Kimi)',
      ollama: 'Ollama (Local)',
    };
    return map[provider] || provider.toUpperCase();
  }

  /**
   * OpenAI 相容接口
   */
  private async fetchOpenAiCompatibleModels(provider: string, key: string): Promise<string[]> {
    const baseUrlMap: Record<string, string> = {
      openai: 'https://api.openai.com/v1',
      deepseek: 'https://api.deepseek.com',
      mistral: 'https://api.mistral.ai/v1',
      groq: 'https://api.groq.com/openai/v1',
      xai: 'https://api.x.ai/v1',
    };
    const baseUrl = baseUrlMap[provider] || 'https://api.openai.com/v1';
    
    try {
      const resp = await fetch(`${baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${key}` },
      });

      if (!resp.ok) return [];
      const data = await resp.json() as { data: Array<{ id: string }> };
      const rawModels = Array.isArray(data?.data) ? data.data.map(m => m.id) : [];

      return rawModels.filter(id => {
        const low = id.toLowerCase();
        if (low.includes('embedding')) return false;
        if (low.includes('dall-e')) return false;
        if (low.includes('tts')) return false;
        if (low.includes('whisper')) return false;
        return true;
      });
    } catch {
      return [];
    }
  }

  /**
   * Anthropic 接口
   */
  private async fetchAnthropicModels(key: string): Promise<string[]> {
    try {
      const resp = await fetch('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
      });

      if (!resp.ok) return [];
      const data = await resp.json() as { data: Array<{ id: string }> };
      return Array.isArray(data?.data) ? data.data.map(m => m.id) : [];
    } catch {
      return [];
    }
  }

  /**
   * MiniMax 靜態策略
   */
  private async fetchMiniMaxModels(key: string): Promise<string[]> {
    // MiniMax 目前不穩定支援 list models，因此採靜態補齊與動態組合
    return [
      'MiniMax-M2.7',
      'MiniMax-M2.7-highspeed',
      'MiniMax-M2.5',
      'MiniMax-M2.5-highspeed',
      'MiniMax-Text-01',
    ];
  }

  /**
   * Google Gemini 接口
   */
  private async fetchGeminiModels(key: string): Promise<string[]> {
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!resp.ok) return [];
    const data = await resp.json() as { models: Array<{ name: string }> };
    const rawModels = Array.isArray(data?.models) ? data.models.map(m => m.name.replace('models/', '')) : [];
    
    // 只保留支援生成內容的模型
    return rawModels.filter(m => !m.includes('embedding') && !m.includes('aqa') && !m.includes('semantic'));
  }

  /**
   * OpenRouter 接口
   */
  private async fetchOpenRouterModels(key: string): Promise<string[]> {
    const resp = await fetch('https://openrouter.ai/api/v1/models', {
      headers: key ? { 'Authorization': `Bearer ${key}` } : {},
      signal: AbortSignal.timeout(5000),
    });

    if (!resp.ok) return [];
    const data = await resp.json() as { data: Array<{ id: string }> };
    return Array.isArray(data?.data) ? data.data.map(m => m.id) : [];
  }

  /**
   * Moonshot (Kimi) 接口
   */
  private async fetchMoonshotModels(key: string): Promise<string[]> {
    try {
      const resp = await fetch('https://api.moonshot.cn/v1/models', {
        headers: { 'Authorization': `Bearer ${key}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) return ['kimi-k2.5', 'moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'];
      const data = await resp.json() as { data: Array<{ id: string }> };
      const models = Array.isArray(data?.data) ? data.data.map(m => m.id) : [];
      return models.length > 0 ? models : ['kimi-k2.5', 'moonshot-v1-8k', 'moonshot-v1-32k'];
    } catch {
      return ['kimi-k2.5', 'moonshot-v1-8k', 'moonshot-v1-32k'];
    }
  }

  /**
   * Ollama 本地接口
   */
  private async fetchOllamaModels(): Promise<string[]> {
    try {
      const resp = await fetch('http://localhost:11434/api/tags', {
        signal: AbortSignal.timeout(3000),
      });
      if (!resp.ok) return [];
      const data = await resp.json() as { models: Array<{ name: string }> };
      return Array.isArray(data?.models) ? data.models.map(m => m.name) : [];
    } catch {
      return [];
    }
  }
}
