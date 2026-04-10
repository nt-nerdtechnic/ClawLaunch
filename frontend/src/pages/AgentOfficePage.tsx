import { Building2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import PixelOfficePanel from '../components/pixel-office/PixelOfficePanel';

interface AgentOfficePageProps {
  restartGateway?: () => Promise<void>;
}

export function AgentOfficePage({ restartGateway }: AgentOfficePageProps) {
  const { t } = useTranslation();

  return (
    <div className="w-full h-full flex flex-col">
      <div className="shrink-0 flex items-center gap-2 px-6 py-4 border-b border-slate-200 dark:border-slate-800">
        <div className="rounded-lg bg-indigo-500/10 p-1.5 text-indigo-600 dark:text-indigo-300">
          <Building2 size={16} />
        </div>
        <h1 className="text-base font-bold text-slate-800 dark:text-slate-100">{t('pixelOffice.title')}</h1>
      </div>
      <div className="flex-1 min-h-0">
        <PixelOfficePanel restartGateway={restartGateway} />
      </div>
    </div>
  );
}
