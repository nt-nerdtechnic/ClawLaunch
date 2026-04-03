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

    try {
      let models: string[] = [];
      switch (provider) {
        case 'openai':
        case 'deepseek':
        case 'mistral':
        case 'groq':
        case 'xai':
          models = await this.fetchOpenAiCompatibleModels(provider, key);
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
          // MiniMax 端點通常不支援 list models，在此提供靜態補齊
          models = await this.fetchMiniMaxModels(key);
          break;
        default:
          return null;
      }

      if (models.length === 0) return null;

      return {
        provider,
        group: this.getDisplayName(provider),
        models: Array.from(new Set(models)).sort().map(m => m.includes('/') ? m : `${provider}/${m}`),
      };
    } catch (e) {
      console.error(`[ModelDiscovery] Failed to fetch models for ${provider}:`, e);
      return null;
    }
  }

  private isCredentialless(provider: string): boolean {
    return ['ollama', 'vllm'].includes(provider);
  }

  private getDisplayName(provider: string): string {
    const map: Record<string, string> = {
      openai: 'OpenAI (Cloud)',
      anthropic: 'Anthropic (Claude)',
      gemini: 'Google Gemini',
      google: 'Google Gemini',
      deepseek: 'DeepSeek',
      openrouter: 'OpenRouter',
      mistral: 'Mistral AI',
      groq: 'Groq Cloud',
      xai: 'xAI (Grok)',
      minimax: 'MiniMax',
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
    const staticModels = [
      'MiniMax-M2.7',
      'MiniMax-M2.7-highspeed',
      'MiniMax-M2.5',
      'MiniMax-M2.5-highspeed',
      'MiniMax-Text-01'
    ];
    return staticModels;
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
}
