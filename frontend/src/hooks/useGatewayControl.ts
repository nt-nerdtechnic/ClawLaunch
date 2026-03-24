import { useState } from 'react';

/**
 * Gateway control hook
 * Manages Gateway start, stop, and related statuses
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
