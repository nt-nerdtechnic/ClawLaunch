export interface OfficeScene {
  id: string;
  /** i18n key for display name */
  labelKey: string;
  /** Path to background image (relative to /public/). null = procedural tile renderer. */
  bg: string | null;
  /** Path to nav-mask PNG. null = use default walkable grid from room.ts. */
  navmask: string | null;
  /** Path to deskslots JSON. null = use positions calculated by room.ts. */
  deskslots: string | null;
  /** Whether this scene has all required assets ready. */
  available: boolean;
}

export const OFFICE_SCENES: OfficeScene[] = [
  {
    id: 'default',
    labelKey: 'pixelOffice.scenes.default',
    bg: '/pixel_office_bg.png',
    navmask: '/pixel_office_navmask.png',
    deskslots: '/pixel_office_deskslots.json',
    available: true,
  },
  {
    id: 'procedural',
    labelKey: 'pixelOffice.scenes.procedural',
    bg: null,
    navmask: null,
    deskslots: null,
    available: true,
  },
  {
    id: 'night',
    labelKey: 'pixelOffice.scenes.night',
    bg: '/scenes/night_office_bg.png',
    navmask: '/scenes/night_office_navmask.png',
    deskslots: '/scenes/night_office_deskslots.json',
    available: false,
  },
  {
    id: 'cafe',
    labelKey: 'pixelOffice.scenes.cafe',
    bg: '/scenes/cafe_bg.png',
    navmask: '/scenes/cafe_navmask.png',
    deskslots: '/scenes/cafe_deskslots.json',
    available: false,
  },
];

export function getScene(id: string): OfficeScene {
  return OFFICE_SCENES.find(s => s.id === id) ?? OFFICE_SCENES[0];
}
