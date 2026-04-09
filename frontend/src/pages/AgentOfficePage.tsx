import PixelOfficePanel from '../components/pixel-office/PixelOfficePanel';

interface AgentOfficePageProps {
  restartGateway?: () => Promise<void>;
}

export function AgentOfficePage({ restartGateway }: AgentOfficePageProps) {
  return (
    <div className="w-full h-full">
      <PixelOfficePanel restartGateway={restartGateway} />
    </div>
  );
}
