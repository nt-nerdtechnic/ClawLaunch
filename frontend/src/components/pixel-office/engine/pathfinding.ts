import type { Vec2 } from './types';

interface AStarNode {
  x: number;
  y: number;
  g: number;
  h: number;
  f: number;
  parent: AStarNode | null;
}

const MAX_SEARCH = 500;

/** A* pathfinding on tile grid. Returns pixel-coordinate path (tile centers). */
export function findPath(
  startTile: Vec2,
  endTile: Vec2,
  walkable: boolean[][],
  tileSize: number,
): Vec2[] {
  const rows = walkable.length;
  const cols = rows > 0 ? walkable[0].length : 0;

  // Bounds check
  if (
    startTile.x < 0 || startTile.x >= cols ||
    startTile.y < 0 || startTile.y >= rows ||
    endTile.x < 0 || endTile.x >= cols ||
    endTile.y < 0 || endTile.y >= rows
  ) {
    return [];
  }

  // If end is not walkable, find nearest walkable neighbor
  if (!walkable[endTile.y][endTile.x]) {
    const neighbors = getNeighbors(endTile.x, endTile.y, walkable, cols, rows);
    if (neighbors.length === 0) return [];
    // Pick the neighbor closest to start
    let best = neighbors[0];
    let bestDist = manhattan(neighbors[0], startTile);
    for (let i = 1; i < neighbors.length; i++) {
      const d = manhattan(neighbors[i], startTile);
      if (d < bestDist) { best = neighbors[i]; bestDist = d; }
    }
    endTile = best;
  }

  if (startTile.x === endTile.x && startTile.y === endTile.y) return [];

  const open: AStarNode[] = [];
  const closed = new Set<string>();

  const startNode: AStarNode = {
    x: startTile.x,
    y: startTile.y,
    g: 0,
    h: manhattan(startTile, endTile),
    f: manhattan(startTile, endTile),
    parent: null,
  };
  open.push(startNode);

  let iterations = 0;

  while (open.length > 0 && iterations < MAX_SEARCH) {
    iterations++;

    // Find node with lowest f
    let lowestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[lowestIdx].f) lowestIdx = i;
    }
    const current = open[lowestIdx];
    open.splice(lowestIdx, 1);

    if (current.x === endTile.x && current.y === endTile.y) {
      return reconstructPath(current, tileSize);
    }

    const key = `${current.x},${current.y}`;
    if (closed.has(key)) continue;
    closed.add(key);

    const neighbors = getNeighbors(current.x, current.y, walkable, cols, rows);
    for (const n of neighbors) {
      const nKey = `${n.x},${n.y}`;
      if (closed.has(nKey)) continue;

      const g = current.g + 1;
      const h = manhattan(n, endTile);
      const existing = open.find(o => o.x === n.x && o.y === n.y);
      if (existing) {
        if (g < existing.g) {
          existing.g = g;
          existing.f = g + existing.h;
          existing.parent = current;
        }
      } else {
        open.push({ x: n.x, y: n.y, g, h, f: g + h, parent: current });
      }
    }
  }

  // No path found — return empty
  return [];
}

function getNeighbors(x: number, y: number, walkable: boolean[][], cols: number, rows: number): Vec2[] {
  const result: Vec2[] = [];
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (const [dx, dy] of dirs) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx >= 0 && nx < cols && ny >= 0 && ny < rows && walkable[ny][nx]) {
      result.push({ x: nx, y: ny });
    }
  }
  return result;
}

function manhattan(a: Vec2, b: Vec2): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function reconstructPath(node: AStarNode, tileSize: number): Vec2[] {
  const path: Vec2[] = [];
  let current: AStarNode | null = node;
  while (current) {
    path.unshift({
      x: current.x * tileSize + tileSize / 2,
      y: current.y * tileSize + tileSize / 2,
    });
    current = current.parent;
  }
  // Remove the start position (agent is already there)
  if (path.length > 0) path.shift();
  return path;
}
