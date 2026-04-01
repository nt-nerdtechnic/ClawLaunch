import { useTranslation } from 'react-i18next';
import { Wifi, WifiOff, Users, DollarSign, Plus } from 'lucide-react';

interface OfficeHUDProps {
  running: boolean;
  activeCount: number;
  totalCount: number;
  todayCost: number;
  onAddAgent?: () => void;
}

export default function OfficeHUD({ running, activeCount, totalCount, todayCost, onAddAgent }: OfficeHUDProps) {
  const { t } = useTranslation();

  return (
    <div className="absolute bottom-0 left-0 right-0 h-7 z-10 flex items-center justify-between px-3 bg-slate-900/60 backdrop-blur-sm select-none">
      {/* Gateway status */}
      <div className="flex items-center gap-1">
        {running ? (
          <Wifi size={9} className="text-green-400" />
        ) : (
          <WifiOff size={9} className="text-slate-500" />
        )}
        <span className={`text-[9px] font-black uppercase tracking-wider ${running ? 'text-green-400' : 'text-slate-500'}`}>
          Gateway {running ? t('pixelOffice.hud.gatewayOn', 'ON') : t('pixelOffice.hud.gatewayOff', 'OFF')}
        </span>
      </div>

      {/* Agent count */}
      <div className="flex items-center gap-1">
        <Users size={9} className="text-indigo-400" />
        <span className="text-[9px] font-black uppercase tracking-wider text-indigo-300">
          {activeCount}/{totalCount} {t('pixelOffice.hud.active', 'active')}
        </span>
      </div>

      {/* Today's cost */}
      <div className="flex items-center gap-1">
        <DollarSign size={9} className="text-amber-400" />
        <span className="text-[9px] font-black uppercase tracking-wider text-amber-300">
          ${todayCost.toFixed(4)} {t('pixelOffice.hud.todayCost', 'today')}
        </span>
      </div>

      {/* Add agent */}
      {onAddAgent && (
        <button
          type="button"
          onClick={onAddAgent}
          title={t('pixelOffice.addAgent.title', 'New Agent')}
          className="flex items-center gap-0.5 rounded-lg px-1.5 py-0.5 text-indigo-300 hover:bg-indigo-500/20 hover:text-indigo-200 transition-colors"
        >
          <Plus size={10} />
          <span className="text-[9px] font-black uppercase tracking-wider">
            {t('pixelOffice.hud.addAgent', 'Add')}
          </span>
        </button>
      )}
    </div>
  );
}
