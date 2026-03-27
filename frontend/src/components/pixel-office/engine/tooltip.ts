import type { PixelAgent } from './types';

/** Hit-test: find the agent under the given canvas coordinates.  */
export function hitTestAgent(
  canvasX: number,
  canvasY: number,
  agents: PixelAgent[],
  spriteWidth: number,
  spriteHeight: number,
): PixelAgent | null {
  // Test agents from front (highest Y) to back for correct Z-order
  const sorted = [...agents].sort((a, b) => b.y - a.y);

  for (const agent of sorted) {
    const left = agent.x - spriteWidth / 2;
    const top = agent.y - spriteHeight;
    const right = left + spriteWidth;
    const bottom = agent.y;

    if (canvasX >= left && canvasX <= right && canvasY >= top && canvasY <= bottom) {
      return agent;
    }
  }

  return null;
}
