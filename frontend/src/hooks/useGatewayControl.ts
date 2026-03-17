import { useState } from 'react';

/**
 * Gateway 控制 Hook
 * 管理 Gateway 啟動、停止和相關狀態
 */
export function useGatewayControl() {
  const [gatewayConflictModal, setGatewayConflictModal] = useState<{
    message: string;
    detail: string;
    port: number;
  } | null>(null);
  const [killingGatewayPortHolder, setKillingGatewayPortHolder] = useState(false);
  const [gatewayConflictActionMessage, setGatewayConflictActionMessage] = useState('');
  const [stopServiceModalOpen, setStopServiceModalOpen] = useState(false);
  const [stoppingServiceWithCleanup, setStoppingServiceWithCleanup] = useState(false);
  const [stopServiceActionMessage, setStopServiceActionMessage] = useState('');

  const closeGatewayConflictModal = () => {
    setGatewayConflictModal(null);
    setGatewayConflictActionMessage('');
    setKillingGatewayPortHolder(false);
  };

  const closeStopServiceModal = () => {
    setStopServiceModalOpen(false);
    setStoppingServiceWithCleanup(false);
    setStopServiceActionMessage('');
  };

  return {
    gatewayConflictModal,
    setGatewayConflictModal,
    killingGatewayPortHolder,
    setKillingGatewayPortHolder,
    gatewayConflictActionMessage,
    setGatewayConflictActionMessage,
    closeGatewayConflictModal,
    stopServiceModalOpen,
    setStopServiceModalOpen,
    stoppingServiceWithCleanup,
    setStoppingServiceWithCleanup,
    stopServiceActionMessage,
    setStopServiceActionMessage,
    closeStopServiceModal,
  };
}
