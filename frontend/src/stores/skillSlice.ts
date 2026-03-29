import type { StateCreator } from 'zustand';

export interface SkillItem {
  id: string;
  name: string;
  desc: string;
  category: string;
  details: string;
}

export interface SkillSlice {
  coreSkills: SkillItem[];
  workspaceSkills: SkillItem[];
  setCoreSkills: (skills: SkillItem[]) => void;
  setWorkspaceSkills: (skills: SkillItem[]) => void;
  toggleSkill: (skillId: string) => void;
}

export const createSkillSlice: StateCreator<SkillSlice> = (set) => ({
  coreSkills: [],
  workspaceSkills: [],
  setCoreSkills: (skills) => set({ coreSkills: skills }),
  setWorkspaceSkills: (skills) => set({ workspaceSkills: skills }),
  toggleSkill: (skillId) => {
    // Skills are now handled by filesystem actions, not by this config toggle.
    console.log(`Toggle skill requested for ${skillId}, but enabledSkills has been removed from config.`);
  },
});
