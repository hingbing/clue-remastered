import { Server, Socket } from "socket.io";
import {
  LOST_CITIES_COLORS,
  type LostCitiesCard,
  type LostCitiesColor,
  type LostCitiesRoomState,
  type LostCitiesStatus,
  type LostCitiesTurnPhase,
} from "../../shared/lostCities.js";
import {
  createLostCitiesDeck,
  shuffleLostCitiesDeck,
} from "./lostCitiesRules.js";

type LostCitiesPlayer = {
  id: string;
  socketId: string | null;
  nickname: string;
  isHost: boolean;
  connected: boolean;
  hand: LostCitiesCard[];
  expeditions: Record<LostCitiesColor, LostCitiesCard[]>;
};

type LostCitiesRoom = {
  roomCode: string;
  status: LostCitiesStatus;
  players: LostCitiesPlayer[];
  drawPile: LostCitiesCard[];
  discards: Record<LostCitiesColor, LostCitiesCard[]>;
  currentTurnPlayerId: string | null;
  turnPhase: LostCitiesTurnPhase;
  lastAction: string;
  scores: LostCitiesRoomState["scores"];
  winnerIds: string[];
};

const rooms = new Map<string, LostCitiesRoom>();
const roomCodeBySocket = new Map<string, string>();
const playerIdBySocket = new Map<string, string>();
const ROOM_CODE_CHARACTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PLAYER_COUNT = 2;
const STARTING_HAND_SIZE = 8;

function emptyColorRecord<T>(makeValue: () => T): Record<LostCitiesColor, T> {
  return Object.fromEntries(
    LOST_CITIES_COLORS.map((color) => [color, makeValue()]),
  ) as Record<LostCitiesColor, T>;
}

function makeId(): string {
  return `lost_cities_player_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

function makeRoomCode(): string {
  let roomCode = "";
  for (let index = 0; index < 6; index += 1) {
    roomCode +=
      ROOM_CODE_CHARACTERS[
        Math.floor(Math.random() * ROOM_CODE_CHARACTERS.length)
      ];
  }
  return rooms.has(roomCode) ? makeRoomCode() : roomCode;
}

function cleanNickname(nickname: unknown): string {
  return String(nickname ?? "").trim().slice(0, 20);
}

function createPlayer(
  socket: Socket,
  nickname: string,
  isHost: boolean,
): LostCitiesPlayer {
  return {
    id: makeId(),
    socketId: socket.id,
    nickname,
    isHost,
    connected: true,
    hand: [],
    expeditions: emptyColorRecord(() => []),
  };
}

function attachSocket(
  room: LostCitiesRoom,
  player: LostCitiesPlayer,
  socket: Socket,
): void {
  player.socketId = socket.id;
  player.connected = true;
  roomCodeBySocket.set(socket.id, room.roomCode);
  playerIdBySocket.set(socket.id, player.id);
  socket.join(`lost-cities:${room.roomCode}`);
}

function findRoom(socket: Socket): LostCitiesRoom | null {
  const roomCode = roomCodeBySocket.get(socket.id);
  return roomCode ? rooms.get(roomCode) ?? null : null;
}

function findPlayer(
  room: LostCitiesRoom,
  socket: Socket,
): LostCitiesPlayer | null {
  const playerId = playerIdBySocket.get(socket.id);
  return room.players.find((player) => player.id === playerId) ?? null;
}

function publicRoom(
  room: LostCitiesRoom,
  viewerId: string,
): LostCitiesRoomState {
  const viewer = room.players.find((player) => player.id === viewerId);

  return {
    roomCode: room.roomCode,
    status: room.status,
    players: room.players.map((player) => ({
      id: player.id,
      nickname: player.nickname,
      isHost: player.isHost,
      connected: player.connected,
      handCount: player.hand.length,
      expeditions: player.expeditions,
    })),
    viewerPlayerId: viewerId,
    viewerHand: viewer?.hand ?? [],
    currentTurnPlayerId: room.currentTurnPlayerId,
    turnPhase: room.turnPhase,
    drawPileCount: room.drawPile.length,
    discardTops: Object.fromEntries(
      LOST_CITIES_COLORS.map((color) => [
        color,
        room.discards[color].at(-1) ?? null,
      ]),
    ) as Record<LostCitiesColor, LostCitiesCard | null>,
    discardCounts: Object.fromEntries(
      LOST_CITIES_COLORS.map((color) => [color, room.discards[color].length]),
    ) as Record<LostCitiesColor, number>,
    lastAction: room.lastAction,
    scores: room.scores,
    winnerIds: room.winnerIds,
  };
}

function emitRoom(io: Server, room: LostCitiesRoom): void {
  for (const player of room.players) {
    if (!player.socketId) continue;
    io.to(player.socketId).emit(
      "lost-cities:room:state",
      publicRoom(room, player.id),
    );
  }
}

function error(socket: Socket, message: string) {
  socket.emit("lost-cities:error", { message });
}

export function registerLostCities(io: Server): void {
  io.on("connection", (socket) => {
    socket.on(
      "lost-cities:room:create",
      ({ nickname }: { nickname?: unknown } = {}) => {
        const clean = cleanNickname(nickname);
        if (!clean) return error(socket, "닉네임을 입력해주세요.");

        const roomCode = makeRoomCode();
        const player = createPlayer(socket, clean, true);
        const room: LostCitiesRoom = {
          roomCode,
          status: "waiting",
          players: [player],
          drawPile: [],
          discards: emptyColorRecord(() => []),
          currentTurnPlayerId: null,
          turnPhase: "play",
          lastAction: "방이 생성되었습니다.",
          scores: null,
          winnerIds: [],
        };

        rooms.set(roomCode, room);
        attachSocket(room, player, socket);
        socket.emit("lost-cities:room:created", {
          roomCode,
          playerId: player.id,
          roomState: publicRoom(room, player.id),
        });
        emitRoom(io, room);
      },
    );

    socket.on(
      "lost-cities:room:join",
      (
        {
          roomCode,
          nickname,
        }: { roomCode?: unknown; nickname?: unknown } = {},
      ) => {
        const code = String(roomCode ?? "").trim().toUpperCase();
        const clean = cleanNickname(nickname);
        const room = rooms.get(code);

        if (!room) return error(socket, "존재하지 않는 방 코드입니다.");
        if (!clean) return error(socket, "닉네임을 입력해주세요.");
        if (room.status !== "waiting")
          return error(socket, "이미 시작된 방입니다.");
        if (room.players.length >= PLAYER_COUNT)
          return error(socket, "로스트 시티는 두 명만 참가할 수 있습니다.");

        const player = createPlayer(socket, clean, false);
        room.players.push(player);
        room.lastAction = `${clean}님이 참가했습니다.`;
        attachSocket(room, player, socket);
        socket.emit("lost-cities:room:joined", {
          roomCode: room.roomCode,
          playerId: player.id,
          roomState: publicRoom(room, player.id),
        });
        emitRoom(io, room);
      },
    );

    socket.on("lost-cities:game:start", () => {
      const room = findRoom(socket);
      if (!room) return error(socket, "방에 먼저 입장해주세요.");

      const player = findPlayer(room, socket);
      if (!player?.isHost)
        return error(socket, "방장만 게임을 시작할 수 있습니다.");
      if (
        room.players.length !== PLAYER_COUNT ||
        room.players.some((candidate) => !candidate.connected)
      ) {
        return error(socket, "두 명이 모두 연결되어야 시작할 수 있습니다.");
      }
      if (room.status !== "waiting")
        return error(socket, "대기 중인 방에서만 시작할 수 있습니다.");

      const deck = shuffleLostCitiesDeck(createLostCitiesDeck());
      for (const candidate of room.players) {
        candidate.hand = deck.splice(0, STARTING_HAND_SIZE);
      }
      room.drawPile = deck;
      room.status = "playing";
      room.currentTurnPlayerId = room.players[0].id;
      room.turnPhase = "play";
      room.lastAction = `${room.players[0].nickname}님의 차례입니다.`;
      emitRoom(io, room);
    });

    socket.on("disconnect", () => {
      const room = findRoom(socket);
      const player = room ? findPlayer(room, socket) : null;
      roomCodeBySocket.delete(socket.id);
      playerIdBySocket.delete(socket.id);

      if (!room || !player) return;
      player.socketId = null;
      player.connected = false;
      room.lastAction = `${player.nickname}님의 연결이 끊겼습니다.`;
      emitRoom(io, room);
    });
  });
}
