import React from 'react';
import { Analytics } from '../components/Analytics';

interface AnalyticsPageProps {}

export const AnalyticsPage: React.FC<AnalyticsPageProps> = () => {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <Analytics />
    </div>
  );
};
