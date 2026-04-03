import type { RoomConfig } from './types';
import { createMainHall, createSmallRoom, createOpenPlan } from './room';

export interface OfficeScene {
  id: string;
  /** i18n key for display name */
  labelKey: string;
  /** Factory function that builds the procedural room layout */
  roomFactory: () => RoomConfig;
  /** Whether this scene is available in the picker */
  available: boolean;
}

export const OFFICE_SCENES: OfficeScene[] = [
  {
    id: 'mainHall',
    labelKey: 'pixelOffice.scenes.mainHall',
    roomFactory: createMainHall,
    available: true,
  },
  {
    id: 'smallRoom',
    labelKey: 'pixelOffice.scenes.smallRoom',
    roomFactory: createSmallRoom,
    available: true,
  },
  {
    id: 'openPlan',
    labelKey: 'pixelOffice.scenes.openPlan',
    roomFactory: createOpenPlan,
    available: true,
  },
];

export function getScene(id: string): OfficeScene {
  return OFFICE_SCENES.find(s => s.id === id) ?? OFFICE_SCENES[0];
}
