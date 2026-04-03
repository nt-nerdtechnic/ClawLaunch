import React from 'react';
import { 
  Brain, 
  Cpu, 
  Globe, 
  Zap, 
  Network, 
  Database
} from 'lucide-react';
import type { TFunction } from 'i18next';

/**
 * Mapping from auth choice IDs to internal provider aliases.
 * Used for matching profiles to selected onboarding choices.
 */
export const AUTH_CHOICE_PROVIDER_ALIASES: Record<string, string[]> = {
  apiKey: ['anthropic'],
  token: ['anthropic'],
  'openai-api-key': ['openai'],
  'openai-codex': ['openai-codex', 'openai'],
  'gemini-api-key': ['gemini', 'google'],
  'google-gemini-cli': ['google-gemini-cli', 'google-gemini', 'gemini', 'google'],
  'minimax-api': ['minimax'],
  'minimax-coding-plan-global-token': ['minimax-portal', 'minimax'],
  'minimax-coding-plan-cn-token': ['minimax-portal', 'minimax'],
  'moonshot-api-key': ['moonshot'],
  'openrouter-api-key': ['openrouter'],
  'xai-api-key': ['xai'],
  'ollama': ['ollama'],
  'vllm': ['vllm'],
  'chutes': ['chutes'],
  'qwen-portal': ['qwen-portal', 'qwen']
};

/**
 * Common provider aliases used in App.tsx for filtering and display.
 */
export const PROVIDER_ALIAS_MAP: Record<string, string[]> = {
  anthropic: ['anthropic'],
  openai: ['openai', 'openai-codex'],
  'openai-codex': ['openai-codex', 'openai'],
  google: ['google', 'gemini'],
  gemini: ['gemini', 'google'],
  minimax: ['minimax'],
  moonshot: ['moonshot'],
  openrouter: ['openrouter'],
  xai: ['xai'],
  ollama: ['ollama'],
  vllm: ['vllm'],
  chutes: ['chutes'],
  qwen: ['qwen', 'qwen-portal'],
  'qwen-portal': ['qwen-portal', 'qwen']
};

export const PROVIDER_MODEL_CATALOGUE: Record<string, { label: string; models: string[] }> = {
  anthropic: { label: 'Anthropic (Claude)', models: ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-opus-4', 'claude-3-7-sonnet-latest', 'claude-haiku-3-5', 'anthropic/claude-3-5-haiku-latest'] },
  openai: { label: 'OpenAI (GPT)', models: ['openai/gpt-4.1', 'openai/gpt-4.1-mini', 'openai/gpt-4.1-nano', 'openai/gpt-4o', 'openai/o3', 'openai/o4-mini', 'openai/o3-mini'] },
  google: { label: 'Google (Gemini)', models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash', 'google/gemini-2.0-flash-lite', 'google/gemini-1.5-pro'] },
  minimax: { label: 'MiniMax', models: ['MiniMax-M2.7', 'MiniMax-M2.7-highspeed', 'MiniMax-M2.5', 'MiniMax-M2.5-highspeed', 'MiniMax-Text-01'] },
  moonshot: { label: 'Moonshot (Kimi)', models: ['moonshot-v1-128k', 'moonshot-v1-32k', 'moonshot-v1-8k', 'kimi-latest'] },
  openrouter: { label: 'OpenRouter', models: ['openrouter/auto', 'openrouter/anthropic/claude-opus-4-5', 'openrouter/openai/gpt-4.1', 'openrouter/google/gemini-2.5-pro'] },
  ollama: { label: 'Ollama (Local)', models: ['ollama/llama3', 'ollama/qwen2.5:14b', 'ollama/deepseek-r1:7b'] },
  chutes: { label: 'Chutes', models: ['chutes/deepseek-ai/DeepSeek-R2'] },
  xai: { label: 'xAI (Grok)', models: ['xai/grok-3', 'xai/grok-2-vision'] },
};

export interface AuthChoiceItem {
  id: string;
  name: string;
  desc: string;
  reqKey: boolean;
  defaultModel?: string;
  link?: string | null;
  oauthFlow?: boolean;
  helpText?: string;
  placeholder?: string;
  isTokenFlow?: boolean;
}

export interface ProviderGroupItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  desc?: string;
  choices: AuthChoiceItem[];
}

/**
 * Returns the unified list of provider groups.
 * This integrates definitions from App.tsx and SetupStepModel.tsx.
 */
export const getProviderGroups = (t: TFunction): ProviderGroupItem[] => [
  {
    id: 'anthropic',
    label: 'Anthropic',
    icon: <Brain size={16} />,
    desc: 'Claude 3.7 / 3.5 Sonnet',
    choices: [
      { 
        id: 'apiKey', 
        name: 'Anthropic API Key', 
        desc: String(t('modelSetup.modelSelect.choiceDesc.anthropicApiKey')), 
        reqKey: true, 
        defaultModel: 'claude-3-7-sonnet-latest', 
        link: 'https://console.anthropic.com/' 
      },
      { 
        id: 'token', 
        name: 'Setup Token (CLI)', 
        desc: String(t('modelSetup.modelSelect.choiceDesc.setupTokenCli')), 
        reqKey: true, 
        defaultModel: 'claude-3-7-sonnet-latest', 
        link: null, 
        helpText: String(t('modelSetup.modelSelect.choiceHelp.setupTokenCli'))
      }
    ]
  },
  {
    id: 'openai',
    label: 'OpenAI',
    icon: <Cpu size={16} />,
    desc: 'GPT-4o / Codex',
    choices: [
      { 
        id: 'openai-api-key', 
        name: 'OpenAI API Key', 
        desc: String(t('modelSetup.modelSelect.choiceDesc.openaiApiKey')), 
        reqKey: true, 
        defaultModel: 'gpt-4o', 
        link: 'https://platform.openai.com/' 
      },
      { 
        id: 'openai-codex', 
        name: 'OpenAI Codex (OAuth)', 
        desc: String(t('modelSetup.modelSelect.choiceDesc.openaiCodexOauth')), 
        reqKey: false, 
        defaultModel: 'gpt-4o', 
        link: null,
        oauthFlow: true
      }
    ]
  },
  {
    id: 'google',
    label: 'Google',
    icon: <Globe size={16} />,
    desc: 'Gemini 2.0 Flash / Pro',
    choices: [
      { 
        id: 'gemini-api-key', 
        name: 'Gemini API Key', 
        desc: String(t('modelSetup.modelSelect.choiceDesc.geminiApiKey')), 
        reqKey: true, 
        defaultModel: 'gemini-2.0-flash', 
        link: 'https://aistudio.google.com/app/apikey' 
      },
      { 
        id: 'google-gemini-cli', 
        name: 'Gemini CLI (OAuth)', 
        desc: String(t('modelSetup.modelSelect.choiceDesc.googleGeminiCliOauth')), 
        reqKey: false, 
        defaultModel: 'gemini-2.0-flash', 
        link: null,
        oauthFlow: true
      }
    ]
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    icon: <Zap size={16} />,
    desc: 'MiniMax M2.5',
    choices: [
      { 
        id: 'minimax-api', 
        name: 'MiniMax M2.5 (API Key)', 
        desc: String(t('modelSetup.modelSelect.choiceDesc.minimaxApiKey')), 
        reqKey: true, 
        defaultModel: 'MiniMax-M2.5', 
        link: 'https://platform.minimaxi.com/' 
      },
      { 
        id: 'minimax-coding-plan-global-token', 
        name: 'MiniMax Coding Plan Token (Global)', 
        desc: String(t('modelSetup.modelSelect.choiceDesc.minimaxCodingPlanTokenGlobal')), 
        reqKey: true, 
        defaultModel: 'MiniMax-M2.5', 
        link: 'https://platform.minimax.io/' 
      },
      { 
        id: 'minimax-coding-plan-cn-token', 
        name: 'MiniMax Coding Plan Token (CN)', 
        desc: String(t('modelSetup.modelSelect.choiceDesc.minimaxCodingPlanTokenCn')), 
        reqKey: true, 
        defaultModel: 'MiniMax-M2.5', 
        link: 'https://platform.minimaxi.com/' 
      }
    ]
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    icon: <Globe size={16} />,
    desc: String(t('modelSetup.modelSelect.providerDesc.openrouter', { defaultValue: 'Unified API for 100s of models' })),
    choices: [
      { 
        id: 'openrouter-api-key', 
        name: 'OpenRouter', 
        desc: String(t('modelSetup.modelSelect.choiceDesc.openrouterApiKey')), 
        reqKey: true, 
        defaultModel: 'openrouter/auto', 
        link: 'https://openrouter.ai/keys' 
      }
    ]
  },
  {
    id: 'moonshot',
    label: 'Moonshot',
    icon: <Zap size={16} />,
    desc: String(t('modelSetup.modelSelect.providerDesc.moonshot', { defaultValue: 'Kimi K2.5' })),
    choices: [
      { 
        id: 'moonshot-api-key', 
        name: 'Moonshot (Kimi K2.5)', 
        desc: String(t('modelSetup.modelSelect.choiceDesc.moonshotApiKey')), 
        reqKey: true, 
        defaultModel: 'kimi-k2.5', 
        link: 'https://platform.moonshot.cn/console/api-keys' 
      }
    ]
  },
  {
    id: 'xai',
    label: 'xAI',
    icon: <Cpu size={16} />,
    desc: 'Grok-1 / Grok-2',
    choices: [
      { 
        id: 'xai-api-key', 
        name: 'xAI (Grok)', 
        desc: String(t('modelSetup.modelSelect.choiceDesc.xaiApiKey')), 
        reqKey: true, 
        defaultModel: 'grok-2', 
        link: 'https://console.x.ai/' 
      }
    ]
  },
  {
    id: 'qwen',
    label: 'Qwen',
    icon: <Globe size={16} />,
    desc: String(t('modelSetup.modelSelect.providerDesc.qwen', { defaultValue: 'Alibaba Cloud Qwen Models' })),
    choices: [
      { 
        id: 'qwen-portal', 
        name: 'Qwen Portal (Device Code)', 
        desc: String(t('modelSetup.modelSelect.choiceDesc.qwenPortalDevice')), 
        reqKey: false, 
        defaultModel: 'qwen-max', 
        link: null,
        oauthFlow: true
      }
    ]
  },
  {
    id: 'chutes',
    label: 'Chutes',
    icon: <Network size={16} />,
    desc: 'Decentralized AI platform',
    choices: [
      { 
        id: 'chutes', 
        name: 'Chutes (OAuth)', 
        desc: String(t('modelSetup.modelSelect.choiceDesc.chutesOauth')), 
        reqKey: false, 
        defaultModel: 'chutes', 
        link: null,
        oauthFlow: true
      }
    ]
  },
  {
    id: 'local',
    label: 'Local / Custom',
    icon: <Database size={16} />,
    desc: 'Ollama, vLLM, DeepSeek Local',
    choices: [
      { 
        id: 'ollama', 
        name: 'Ollama', 
        desc: String(t('modelSetup.modelSelect.choiceDesc.ollamaLocal')), 
        reqKey: false, 
        defaultModel: 'ollama/llama3', 
        link: null 
      },
      { 
        id: 'vllm', 
        name: 'vLLM', 
        desc: String(t('modelSetup.modelSelect.choiceDesc.vllmLocal')), 
        reqKey: false, 
        defaultModel: 'vllm/mistral-7b', 
        link: null 
      }
    ]
  }
];

/**
 * List of auth choices that use OAuth flow.
 */
export const OAUTH_AUTH_CHOICES = new Set(
  getProviderGroups(((key: string) => key) as unknown as TFunction) // Workaround to get IDs without actual TFunction
    .flatMap(g => g.choices)
    .filter(c => c.oauthFlow)
    .map(c => c.id)
);
