export type CardType = 'suspect' | 'weapon' | 'room';
export type StoredBonusKind = 'extra-turn' | 'extra-suggestion';
export type RoomName = '부엌' | '침실' | '욕실' | '식당' | '게임룸' | '마당' | '거실' | '차고' | '서재';
export type LocationName = RoomName | '현관';

export interface Card {
  id: string;
  type: CardType;
  name: string;
}

export interface Suggestion {
  suspect: string;
  weapon: string;
  room: RoomName;
}

export interface PlayerPublic {
  id: string;
  nickname: string;
  character: string;
  color: string;
  isHost: boolean;
  eliminated: boolean;
  connected: boolean;
  tileId: string;
  room: LocationName | null;
  pulledBySuggestion: boolean;
  finalAccused: boolean;
}

export interface PendingDisprovePublic {
  suggesterId: string;
  disproverId: string;
  suggestion: Suggestion;
}

export interface PublicRoomState {
  roomCode: string;
  status: 'waiting' | 'playing' | 'finished';
  players: PlayerPublic[];
  currentTurnPlayerId: string | null;
  turnNumber: number;
  winnerId: string | null;
  lastMessage: string;
  dice: [number, number] | null;
  movesLeft: number;
  reachableTileIds: string[];
  hasRolled: boolean;
  hasSuggested: boolean;
  pendingDisprove: PendingDisprovePublic | null;
  leftoverCardCount: number;
  firstRolls: Array<{ playerId: string; nickname: string; total: number }>;
  bonusMessage: string | null;
  pendingBonusAction: { kind: 'reveal-card' | 'move-room'; playerId: string } | null;
  bonusExtraTurn: boolean;
  bonusExtraSuggestion: boolean;
  logs: string[];
}


export interface Tile {
  id: string;
  x: number;
  y: number;
  type: 'hallway' | 'door' | 'question';
  room?: LocationName;
}

export interface BoardRoom {
  name: LocationName;
  symbol: string;
  cells: Array<{ x: number; y: number }>;
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
}

export const suspects = ['스칼렛', '화이트', '플럼', '머스터드', '그린', '피콕'];
export const weapons = ['파이프', '렌치', '단검', '권총', '촛대', '밧줄'];
export const rooms: RoomName[] = ['마당', '게임룸', '서재', '식당', '차고', '거실', '부엌', '침실', '욕실'];

export const characters = [
  { name: '스칼렛', color: '#d64545' },
  { name: '화이트', color: '#f1f1e6' },
  { name: '플럼', color: '#7b4bb7' },
  { name: '머스터드', color: '#d6a629' },
  { name: '그린', color: '#2e8b57' },
  { name: '피콕', color: '#2f6fd6' },
];

export const allCards: Card[] = [
  ...suspects.map((name) => ({ id: `suspect-${name}`, type: 'suspect' as const, name })),
  ...weapons.map((name) => ({ id: `weapon-${name}`, type: 'weapon' as const, name })),
  ...rooms.map((name) => ({ id: `room-${name}`, type: 'room' as const, name })),
];

export const BOARD_SYMBOLS = [
  'XXXXXXXXXXXXXXXXXXXXXXXX',
  'XAAAAX..XBBBBBBX..XEEEEX',
  'XAAAAX..XBBBBBBX..XEEEEX',
  'XAAAAX..XBBBBBBX..XEEEEX',
  'XAAAAX..XBBBBBBX..DEEEEX',
  'XAAAAD..DBBBBBBD..XDXXXX',
  'XXXXDX..XBBBBBBX.......X',
  'X.......XDXXXXDX.......X',
  'X......?..........XXDXXX',
  'XXXXD...........?.XPPPPX',
  'XRRRRXXX..DDDDD...DPPPPX',
  'XRRRRRRX..DDDDD...XPPPPX',
  'XRRRRRRD..DDDDD...XXDXXX',
  'XRRRRRRX..DDDDD........X',
  'XRRRRRRX..DDDDD...XXDXXX',
  'XXXXXXDX..DDDDD..XLLLLLX',
  'X.......?.DDDDD..DLLLLLX',
  'X................XLLLLLX',
  'X........XXDDXX.?.XXDXXX',
  'XXXXXDX..XZZZZX........X',
  'XFFFFFD..DZZZZD........X',
  'XFFFFFX..XZZZZX..XDXXXXX',
  'XFFFFFX..XZZZZX..DCCCCCX',
  'XFFFFFX..XZZZZX..XCCCCCX',
  'XFFFFFX..XZZZZX..XCCCCCX',
  'XXXXXXXXXXXXXXXXXXXXXXXX',
] as const;

export const BOARD_ROWS = BOARD_SYMBOLS.length;
export const BOARD_COLS = BOARD_SYMBOLS[0].length;

const roomSymbolMap: Record<string, LocationName> = {
  A: '부엌',
  B: '침실',
  E: '욕실',
  R: '식당',
  P: '게임룸',
  L: '마당',
  F: '거실',
  Z: '차고',
  C: '서재',
  H: '현관',
};

export const roomFillMap: Record<LocationName, string> = {
  부엌: '#d8d1be',
  침실: '#b8cee4',
  욕실: '#c7ddc4',
  식당: '#d9a09a',
  게임룸: '#b995c5',
  마당: '#83c8c6',
  거실: '#e38a43',
  차고: '#8d8d84',
  서재: '#6f94cc',
  현관: '#c6aa76',
};

export const secretPassages: Partial<Record<RoomName, RoomName>> = {
  부엌: '서재',
  서재: '부엌',
  욕실: '거실',
  거실: '욕실',
};

function symbolAt(x: number, y: number) {
  return BOARD_SYMBOLS[y]?.[x] ?? 'X';
}

function isRoomSymbol(s: string) {
  return !!roomSymbolMap[s];
}

function isCentralHallDoor(x: number, y: number) {
  return x >= 10 && x <= 14 && y >= 10 && y <= 16;
}

function getAdjacentRoomName(x: number, y: number): LocationName | undefined {
  if (isCentralHallDoor(x, y)) return '현관';
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [dx, dy] of dirs) {
    const name = roomSymbolMap[symbolAt(x + dx, y + dy)];
    if (name) return name;
  }
  return undefined;
}

export const tiles: Tile[] = [];
for (let y = 0; y < BOARD_ROWS; y += 1) {
  for (let x = 0; x < BOARD_COLS; x += 1) {
    const s = symbolAt(x, y);
    if (s === '.' || s === 'D' || s === '?') {
      tiles.push({
        id: `t-${x}-${y}`,
        x,
        y,
        type: s === 'D' ? 'door' : s === '?' ? 'question' : 'hallway',
        room: s === 'D' ? getAdjacentRoomName(x, y) : undefined,
      });
    }
  }
}

function buildRoomComponents(): BoardRoom[] {
  const seen = new Set<string>();
  const components: BoardRoom[] = [];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  for (let y = 0; y < BOARD_ROWS; y += 1) {
    for (let x = 0; x < BOARD_COLS; x += 1) {
      const symbol = symbolAt(x, y);
      if (!isRoomSymbol(symbol) || seen.has(`${x},${y}`)) continue;

      const queue = [{ x, y }];
      const cells: Array<{ x: number; y: number }> = [];
      seen.add(`${x},${y}`);

      while (queue.length) {
        const cur = queue.shift()!;
        cells.push(cur);
        for (const [dx, dy] of dirs) {
          const nx = cur.x + dx;
          const ny = cur.y + dy;
          const key = `${nx},${ny}`;
          if (!seen.has(key) && symbolAt(nx, ny) === symbol) {
            seen.add(key);
            queue.push({ x: nx, y: ny });
          }
        }
      }

      const xs = cells.map((c) => c.x);
      const ys = cells.map((c) => c.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const name = roomSymbolMap[symbol];
      components.push({ name, symbol, cells, x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, fill: roomFillMap[name] });
    }
  }

  const hallCells: Array<{ x: number; y: number }> = [];
  for (let y = 10; y <= 16; y += 1) {
    for (let x = 10; x <= 14; x += 1) {
      if (symbolAt(x, y) === 'D') hallCells.push({ x, y });
    }
  }
  components.push({
    name: '현관',
    symbol: 'H',
    cells: hallCells,
    x: 10,
    y: 10,
    w: 5,
    h: 7,
    fill: roomFillMap['현관'],
  });

  return components;
}

export const boardRooms: BoardRoom[] = buildRoomComponents();
export const tileById = Object.fromEntries(tiles.map((t) => [t.id, t])) as Record<string, Tile>;

export const roomDoorTileIds: Partial<Record<LocationName, string[]>> = {};
for (const tile of tiles) {
  if (tile.type === 'door' && tile.room) {
    roomDoorTileIds[tile.room] ??= [];
    roomDoorTileIds[tile.room]!.push(tile.id);
  }
}

export const startTileIds = ['t-12-13', 't-12-13', 't-12-13', 't-12-13', 't-12-13', 't-12-13'];

export function getTileId(x: number, y: number) {
  return `t-${x}-${y}`;
}

export function tileCenter(tile: Tile, cell = 32) {
  return { x: tile.x * cell + cell / 2, y: tile.y * cell + cell / 2 };
}

export function getNeighbors(tileId: string): string[] {
  const tile = tileById[tileId];
  if (!tile) return [];
  const candidates = [
    [tile.x + 1, tile.y],
    [tile.x - 1, tile.y],
    [tile.x, tile.y + 1],
    [tile.x, tile.y - 1],
  ];
  return candidates.map(([x, y]) => getTileId(x, y)).filter((id) => !!tileById[id]);
}

export function getReachableTileIds(startTileId: string, steps: number): string[] {
  const visited = new Map<string, number>();
  const queue: Array<{ id: string; dist: number }> = [{ id: startTileId, dist: 0 }];
  visited.set(startTileId, 0);

  while (queue.length) {
    const current = queue.shift()!;
    if (current.dist >= steps) continue;
    for (const n of getNeighbors(current.id)) {
      const nextDist = current.dist + 1;
      const old = visited.get(n);
      if (old === undefined || nextDist < old) {
        visited.set(n, nextDist);
        queue.push({ id: n, dist: nextDist });
      }
    }
  }

  return Array.from(visited.entries())
    .filter(([id, dist]) => id !== startTileId && dist <= steps)
    .map(([id]) => id);
}

export function firstDoorOfRoom(room: LocationName): string | null {
  return roomDoorTileIds[room]?.[0] ?? null;
}
