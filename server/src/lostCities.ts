import { randomBytes } from "node:crypto";
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
  canPlayToExpedition,
  createLostCitiesDeck,
  scorePlayer,
  shuffleLostCitiesDeck,
} from "./lostCitiesRules.js";

type LostCitiesPlayer = {
  id: string;
  resumeToken: string;
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
  discardedCardIdThisTurn: string | null;
  lastAction: string;
  scores: LostCitiesRoomState["scores"];
  winnerIds: string[];
};

type PlayPayload = {
  cardId: string;
  destination: "expedition" | "discard";
};

type DrawPayload =
  | { source: "deck" }
  | { source: "discard"; color: LostCitiesColor };

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

function makeResumeToken(): string {
  return randomBytes(32).toString("hex");
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

function payloadRecord(payload: unknown): Record<string, unknown> {
  return typeof payload === "object" && payload !== null
    ? (payload as Record<string, unknown>)
    : {};
}

function createPlayer(
  socket: Socket,
  nickname: string,
  isHost: boolean,
): LostCitiesPlayer {
  return {
    id: makeId(),
    resumeToken: makeResumeToken(),
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

function activeTurn(
  socket: Socket,
  phase: LostCitiesTurnPhase,
): { room: LostCitiesRoom; player: LostCitiesPlayer } | null {
  const room = findRoom(socket);
  if (!room) {
    error(socket, "방에 먼저 입장해주세요.");
    return null;
  }

  const player = findPlayer(room, socket);
  if (!player) {
    error(socket, "플레이어 정보를 찾을 수 없습니다.");
    return null;
  }
  if (room.status !== "playing") {
    error(socket, "진행 중인 게임에서만 행동할 수 있습니다.");
    return null;
  }
  if (room.currentTurnPlayerId !== player.id) {
    error(socket, "현재 차례가 아닙니다.");
    return null;
  }
  if (room.turnPhase !== phase) {
    error(
      socket,
      phase === "play"
        ? "카드를 낼 차례가 아닙니다."
        : "카드를 받을 차례가 아닙니다.",
    );
    return null;
  }

  return { room, player };
}

function finishGame(room: LostCitiesRoom): void {
  const results = room.players.map((player) => ({
    playerId: player.id,
    ...scorePlayer(player.expeditions),
  }));
  const highestTotal = Math.max(...results.map((result) => result.total));

  room.status = "finished";
  room.scores = Object.fromEntries(
    results.map((result) => [result.playerId, result.lines]),
  );
  room.winnerIds = results
    .filter((result) => result.total === highestTotal)
    .map((result) => result.playerId);
  room.lastAction = "중앙 덱이 비어 게임이 종료되었습니다.";
}

function leaveRoom(io: Server, socket: Socket): void {
  const room = findRoom(socket);
  const player = room ? findPlayer(room, socket) : null;
  if (!room || !player) {
    error(socket, "참가 중인 방이 없습니다.");
    return;
  }

  roomCodeBySocket.delete(socket.id);
  playerIdBySocket.delete(socket.id);
  room.players = room.players.filter((candidate) => candidate.id !== player.id);
  socket.leave(`lost-cities:${room.roomCode}`);
  socket.emit("lost-cities:room:left");

  if (room.players.length === 0) {
    rooms.delete(room.roomCode);
    return;
  }

  if (room.status === "playing") {
    room.status = "abandoned";
  }
  if (player.isHost) {
    room.players[0].isHost = true;
  }
  if (room.currentTurnPlayerId === player.id) {
    room.currentTurnPlayerId = null;
  }
  room.lastAction = `${player.nickname}님이 방을 나갔습니다.`;
  emitRoom(io, room);
}

function reset(): void {
  rooms.clear();
  roomCodeBySocket.clear();
  playerIdBySocket.clear();
}

function getRoom(roomCode: string): LostCitiesRoom | undefined {
  return rooms.get(roomCode);
}

function seedRoom(room: LostCitiesRoom): void {
  rooms.set(room.roomCode, room);
  for (const player of room.players) {
    if (!player.socketId) continue;
    roomCodeBySocket.set(player.socketId, room.roomCode);
    playerIdBySocket.set(player.socketId, player.id);
  }
}

export const lostCitiesTestApi = {
  reset,
  getRoom,
  seedRoom,
};

export function registerLostCities(io: Server): void {
  io.on("connection", (socket) => {
    socket.on(
      "lost-cities:room:create",
      (payload: unknown) => {
        if (roomCodeBySocket.has(socket.id))
          return error(socket, "이미 다른 방에 입장했습니다.");

        const { nickname } = payloadRecord(payload);
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
          discardedCardIdThisTurn: null,
          lastAction: "방이 생성되었습니다.",
          scores: null,
          winnerIds: [],
        };

        rooms.set(roomCode, room);
        attachSocket(room, player, socket);
        socket.emit("lost-cities:room:created", {
          roomCode,
          playerId: player.id,
          resumeToken: player.resumeToken,
          roomState: publicRoom(room, player.id),
        });
        emitRoom(io, room);
      },
    );

    socket.on(
      "lost-cities:room:join",
      (payload: unknown) => {
        if (roomCodeBySocket.has(socket.id))
          return error(socket, "이미 다른 방에 입장했습니다.");

        const { roomCode, nickname } = payloadRecord(payload);
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
          resumeToken: player.resumeToken,
          roomState: publicRoom(room, player.id),
        });
        emitRoom(io, room);
      },
    );

    socket.on(
      "lost-cities:room:rejoin",
      (payload: unknown) => {
        if (roomCodeBySocket.has(socket.id)) {
          return error(socket, "이미 다른 방에 입장했습니다.");
        }

        const { roomCode, playerId, resumeToken } = payloadRecord(payload);
        const code = String(roomCode ?? "").trim().toUpperCase();
        const savedPlayerId = String(playerId ?? "");
        const savedResumeToken = String(resumeToken ?? "");
        const room = rooms.get(code);
        const player = room?.players.find(
          (candidate) => candidate.id === savedPlayerId,
        );
        if (
          !room ||
          !player ||
          !savedResumeToken ||
          player.resumeToken !== savedResumeToken
        ) {
          return error(socket, "이전 로스트 시티 방으로 재접속하지 못했습니다.");
        }

        if (player.socketId && player.socketId !== socket.id) {
          roomCodeBySocket.delete(player.socketId);
          playerIdBySocket.delete(player.socketId);
          io.sockets.sockets
            .get(player.socketId)
            ?.leave(`lost-cities:${room.roomCode}`);
        }
        attachSocket(room, player, socket);
        room.lastAction = `${player.nickname}님이 재접속했습니다.`;
        socket.emit("lost-cities:room:joined", {
          roomCode: room.roomCode,
          playerId: player.id,
          resumeToken: player.resumeToken,
          roomState: publicRoom(room, player.id),
        });
        emitRoom(io, room);
      },
    );

    socket.on("lost-cities:room:leave", () => {
      leaveRoom(io, socket);
    });

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

    socket.on("lost-cities:card:play", (payload: unknown) => {
      const turn = activeTurn(socket, "play");
      if (!turn) return;

      const { cardId, destination } = payloadRecord(payload);
      if (
        typeof cardId !== "string" ||
        (destination !== "expedition" && destination !== "discard")
      ) {
        return error(socket, "올바른 카드와 목적지를 선택해주세요.");
      }

      const cardIndex = turn.player.hand.findIndex(
        (card) => card.id === cardId,
      );
      if (cardIndex < 0) {
        return error(socket, "손에 없는 카드입니다.");
      }

      const card = turn.player.hand[cardIndex];
      if (
        destination === "expedition" &&
        !canPlayToExpedition(turn.player.expeditions[card.color], card)
      ) {
        return error(socket, "이 카드는 해당 탐험에 놓을 수 없습니다.");
      }

      turn.player.hand.splice(cardIndex, 1);
      if (destination === "expedition") {
        turn.player.expeditions[card.color].push(card);
        turn.room.discardedCardIdThisTurn = null;
        turn.room.lastAction = `${turn.player.nickname}님이 ${card.color} 탐험에 카드를 놓았습니다.`;
      } else {
        turn.room.discards[card.color].push(card);
        turn.room.discardedCardIdThisTurn = card.id;
        turn.room.lastAction = `${turn.player.nickname}님이 카드를 버렸습니다.`;
      }
      turn.room.turnPhase = "draw";
      emitRoom(io, turn.room);
    });

    socket.on("lost-cities:card:draw", (payload: unknown) => {
      const turn = activeTurn(socket, "draw");
      if (!turn) return;

      const draw = payloadRecord(payload) as Partial<DrawPayload>;
      let source: LostCitiesCard[];
      let drewFromDeck = false;
      if (draw.source === "deck") {
        if (turn.room.drawPile.length === 0) {
          return error(socket, "중앙 덱에 카드가 없습니다.");
        }
        source = turn.room.drawPile;
        drewFromDeck = true;
      } else if (
        draw.source === "discard" &&
        LOST_CITIES_COLORS.includes(draw.color as LostCitiesColor)
      ) {
        source = turn.room.discards[draw.color as LostCitiesColor];
        const topCard = source.at(-1);
        if (!topCard) {
          return error(socket, "선택한 버림 더미가 비어 있습니다.");
        }
        if (topCard.id === turn.room.discardedCardIdThisTurn) {
          return error(socket, "이번 턴에 버린 카드는 다시 받을 수 없습니다.");
        }
      } else {
        return error(socket, "올바른 카드 더미를 선택해주세요.");
      }

      const card = source.pop()!;
      turn.player.hand.push(card);
      turn.room.discardedCardIdThisTurn = null;
      if (drewFromDeck && turn.room.drawPile.length === 0) {
        finishGame(turn.room);
        emitRoom(io, turn.room);
        return;
      }

      const nextPlayer = turn.room.players.find(
        (candidate) => candidate.id !== turn.player.id,
      )!;
      turn.room.currentTurnPlayerId = nextPlayer.id;
      turn.room.turnPhase = "play";
      turn.room.lastAction = `${nextPlayer.nickname}님의 차례입니다.`;
      emitRoom(io, turn.room);
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
