import React from 'react';
import { SkillManager } from '../components/SkillManager';

interface SkillsPageProps {}

export const SkillsPage: React.FC<SkillsPageProps> = () => {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <SkillManager />
    </div>
  );
};
