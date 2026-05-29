import React from 'react';
import { SkillManager } from '../components/SkillManager';

export const SkillsPage: React.FC = () => {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <SkillManager />
    </div>
  );
};
