import type { StateCreator } from 'zustand';
import type { ConfigSlice } from './configSlice';

export interface UiSlice {
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
  language: string;
  setLanguage: (lang: string) => void;
  officeSceneId: string;
  setOfficeSceneId: (id: string) => void;
}

// setLanguage also updates config.language, so the creator needs access to the full
// ConfigSlice state. The 4th generic narrows what this factory actually produces.
export const createUiSlice: StateCreator<UiSlice & ConfigSlice, [], [], UiSlice> = (set) => ({
  theme:
    (localStorage.getItem('theme') as 'light' | 'dark') ||
    (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  setTheme: (theme) => {
    localStorage.setItem('theme', theme);
    set({ theme });
  },
  language: localStorage.getItem('i18nextLng') || 'zh-TW',
  setLanguage: (lang) => {
    localStorage.setItem('i18nextLng', lang);
    set((state) => ({ language: lang, config: { ...state.config, language: lang } }));
  },
  officeSceneId: localStorage.getItem('officeSceneId') || 'default',
  setOfficeSceneId: (id) => {
    localStorage.setItem('officeSceneId', id);
    set({ officeSceneId: id });
  },
});
