import express from "express";
import cors from "cors";
import http from "http";
import { Server, Socket } from "socket.io";
import {
  allCards,
  characters,
  firstDoorOfRoom,
  getReachableTileIds,
  rooms,
  secretPassages,
  suspects,
  tileById,
  weapons,
  startTileIds,
  type Card,
  type LocationName,
  type PlayerPublic,
  type PublicRoomState,
  type RoomName,
  type Suggestion,
} from "../../shared/game.js";

type Status = "waiting" | "playing" | "finished";

type StoredBonusKind = "extra-turn" | "extra-suggestion";

type Player = PlayerPublic & {
  socketId: string | null;
  hand: Card[];
  bonusCards: StoredBonusKind[];
  privateLogs: string[];
  failedNoDisproveCount: number;
  leftoverSeen: boolean;
  disconnectTimer?: NodeJS.Timeout;
};

type PendingDisprove = {
  suggesterId: string;
  disproverId: string;
  suggestion: Suggestion;
  matchingCards: Card[];
};

type Room = {
  roomCode: string;
  status: Status;
  players: Player[];
  solution: Suggestion | null;
  leftoverCards: Card[];
  firstRolls: Array<{ playerId: string; nickname: string; total: number }>;
  currentTurnIndex: number;
  turnNumber: number;
  winnerId: string | null;
  lastMessage: string;
  dice: [number, number] | null;
  movesLeft: number;
  reachableTileIds: string[];
  hasRolled: boolean;
  hasSuggested: boolean;
  pendingDisprove: PendingDisprove | null;
  bonusMessage: string | null;
  pendingBonusAction: {
    kind: "reveal-card" | "move-room";
    playerId: string;
  } | null;
  bonusExtraTurn: boolean;
  bonusExtraSuggestion: boolean;
  logs: string[];
};

const app = express();
const allowedOrigin = process.env.CLIENT_URL || "*";
app.use(cors({ origin: allowedOrigin, credentials: true }));
app.get("/", (_req, res) =>
  res.json({ ok: true, name: "clue-remastered-server" }),
);

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: allowedOrigin, methods: ["GET", "POST"], credentials: true },
});

const roomsMap = new Map<string, Room>();
const socketRoomMap = new Map<string, string>();
const socketPlayerMap = new Map<string, string>();

function id(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

function makeRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i += 1)
    code += chars[Math.floor(Math.random() * chars.length)];
  return roomsMap.has(code) ? makeRoomCode() : code;
}

function shuffle<T>(arr: T[]) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function createSolution(): Suggestion {
  return {
    suspect: suspects[Math.floor(Math.random() * suspects.length)],
    weapon: weapons[Math.floor(Math.random() * weapons.length)],
    room: rooms[Math.floor(Math.random() * rooms.length)],
  };
}

function publicRoom(room: Room): PublicRoomState {
  const current =
    room.status === "playing" ? room.players[room.currentTurnIndex] : null;
  return {
    roomCode: room.roomCode,
    status: room.status,
    players: room.players.map(
      ({
        hand,
        socketId,
        disconnectTimer,
        failedNoDisproveCount,
        leftoverSeen,
        bonusCards,
        privateLogs,
        ...p
      }) => p,
    ),
    currentTurnPlayerId: current?.id ?? null,
    turnNumber: room.turnNumber,
    winnerId: room.winnerId,
    lastMessage: room.lastMessage,
    dice: room.dice,
    movesLeft: room.movesLeft,
    reachableTileIds: room.reachableTileIds,
    hasRolled: room.hasRolled,
    hasSuggested: room.hasSuggested,
    pendingDisprove: room.pendingDisprove
      ? {
          suggesterId: room.pendingDisprove.suggesterId,
          disproverId: room.pendingDisprove.disproverId,
          suggestion: room.pendingDisprove.suggestion,
        }
      : null,
    leftoverCardCount: room.leftoverCards.length,
    firstRolls: room.firstRolls,
    bonusMessage: room.bonusMessage,
    pendingBonusAction: room.pendingBonusAction,
    bonusExtraTurn: room.bonusExtraTurn,
    bonusExtraSuggestion: room.bonusExtraSuggestion,
    logs: room.logs,
  };
}

function emitRoom(room: Room) {
  io.to(room.roomCode).emit("room:state", publicRoom(room));
}

function emitHands(room: Room) {
  room.players.forEach((p) => {
    if (p.socketId) {
      io.to(p.socketId).emit("game:your-cards", { cards: p.hand });
      io.to(p.socketId).emit("game:bonus-inventory", {
        bonusCards: p.bonusCards,
      });
      io.to(p.socketId).emit("game:private-logs", { logs: p.privateLogs });
    }
  });
}

function emitPrivatePlayerState(player: Player) {
  if (!player.socketId) return;
  io.to(player.socketId).emit("game:bonus-inventory", {
    bonusCards: player.bonusCards,
  });
  io.to(player.socketId).emit("game:private-logs", {
    logs: player.privateLogs,
  });
}

function addLog(room: Room, message: string) {
  const line = `[${new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}] ${message}`;
  room.logs.push(line);
  if (room.logs.length > 80) room.logs.shift();
}

function addPrivateLog(player: Player, message: string) {
  const line = `[${new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}] ${message}`;
  player.privateLogs.push(line);
  if (player.privateLogs.length > 80) player.privateLogs.shift();
  if (player.socketId)
    io.to(player.socketId).emit("game:private-log", { message: line });
}

function current(room: Room) {
  return room.players[room.currentTurnIndex] ?? null;
}

function findBySocket(socket: Socket) {
  const roomCode = socketRoomMap.get(socket.id);
  if (!roomCode) return null;
  return roomsMap.get(roomCode) ?? null;
}

function findPlayer(room: Room, socket: Socket) {
  const pid = socketPlayerMap.get(socket.id);
  return room.players.find((p) => p.id === pid) ?? null;
}

function resetTurn(room: Room) {
  room.dice = null;
  room.movesLeft = 0;
  room.reachableTileIds = [];
  room.hasRolled = false;
  room.hasSuggested = false;
  room.pendingDisprove = null;
  room.pendingBonusAction = null;
  room.bonusMessage = null;
  room.bonusExtraSuggestion = false;
}

function nextTurn(room: Room) {
  if (room.status !== "playing") return;
  const active = room.players.filter((p) => !p.eliminated);
  if (active.length <= 1) {
    const winner = active[0] ?? null;
    room.status = "finished";
    room.winnerId = winner?.id ?? null;
    room.lastMessage = winner
      ? `${winner.nickname}님이 마지막 생존자로 승리했습니다.`
      : "게임 종료";
    io.to(room.roomCode).emit("game:win", { winner, solution: room.solution });
    emitRoom(room);
    return;
  }
  const keepSamePlayer = room.bonusExtraTurn && !current(room)?.eliminated;
  const extraPlayerName = current(room)?.nickname;
  if (!keepSamePlayer) {
    do {
      room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
    } while (room.players[room.currentTurnIndex].eliminated);
  }
  room.turnNumber += 1;
  room.bonusExtraTurn = false;
  resetTurn(room);
  room.lastMessage = keepSamePlayer
    ? `${extraPlayerName}님이 보너스 카드 효과로 차례를 한 번 더 진행합니다. 주사위 2개를 굴리세요.`
    : `${current(room)?.nickname}님의 턴입니다. 주사위 2개를 굴리세요.`;
  io.to(room.roomCode).emit("game:turn-start", {
    playerId: current(room)?.id,
    turnNumber: room.turnNumber,
  });
  emitRoom(room);
}

function turnError(socket: Socket, room: Room) {
  const p = findPlayer(room, socket);
  if (!p) return "플레이어 정보를 찾을 수 없습니다.";
  if (room.pendingDisprove)
    return "반증 카드 선택이 끝난 뒤 행동할 수 있습니다.";
  if (room.pendingBonusAction)
    return "보너스 카드 효과를 먼저 처리해야 합니다.";
  if (current(room)?.id !== p.id) return "지금은 내 턴이 아닙니다.";
  if (p.eliminated) return "탈락한 플레이어는 행동할 수 없습니다.";
  return null;
}

function matchingCards(player: Player, suggestion: Suggestion) {
  return player.hand.filter(
    (c) =>
      c.name === suggestion.suspect ||
      c.name === suggestion.weapon ||
      c.name === suggestion.room,
  );
}

function validSuggestion(s: Suggestion) {
  return (
    suspects.includes(s.suspect) &&
    weapons.includes(s.weapon) &&
    rooms.includes(s.room as RoomName)
  );
}

function attachSocket(room: Room, player: Player, socket: Socket) {
  if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
  player.socketId = socket.id;
  player.connected = true;
  socketRoomMap.set(socket.id, room.roomCode);
  socketPlayerMap.set(socket.id, player.id);
  socket.join(room.roomCode);
  emitPrivatePlayerState(player);
}

function createPlayer(
  socket: Socket,
  nickname: string,
  index: number,
  isHost: boolean,
): Player {
  const character = characters[index % characters.length];
  return {
    id: id("player"),
    socketId: socket.id,
    nickname,
    character: character.name,
    color: character.color,
    isHost,
    eliminated: false,
    connected: true,
    tileId: startTileIds[index] ?? startTileIds[0],
    room: "현관",
    pulledBySuggestion: false,
    finalAccused: false,
    finalAccusation: null,
    hand: [],
    bonusCards: [],
    privateLogs: [],
    failedNoDisproveCount: 0,
    leftoverSeen: false,
  };
}

function leavePlayer(socket: Socket) {
  const roomCode = socketRoomMap.get(socket.id);
  const playerId = socketPlayerMap.get(socket.id);
  socketRoomMap.delete(socket.id);
  socketPlayerMap.delete(socket.id);
  if (!roomCode || !playerId) return;

  const room = roomsMap.get(roomCode);
  if (!room) return;

  const leaving = room.players.find((p) => p.id === playerId);
  if (!leaving) return;
  if (leaving.disconnectTimer) clearTimeout(leaving.disconnectTimer);

  const wasHost = leaving.isHost;
  room.players = room.players.filter((p) => p.id !== playerId);
  socket.leave(roomCode);

  if (room.players.length === 0) {
    roomsMap.delete(roomCode);
    socket.emit("room:left");
    return;
  }

  if (wasHost) room.players[0].isHost = true;
  if (room.currentTurnIndex >= room.players.length) room.currentTurnIndex = 0;
  if (
    room.pendingDisprove &&
    (room.pendingDisprove.disproverId === playerId ||
      room.pendingDisprove.suggesterId === playerId)
  ) {
    room.pendingDisprove = null;
  }
  room.lastMessage = `${leaving.nickname}님이 방을 나갔습니다.`;
  socket.emit("room:left");
  emitRoom(room);
}

function revealLeftoversIfNeeded(room: Room, player: Player) {
  if (
    player.failedNoDisproveCount >= 3 &&
    !player.leftoverSeen &&
    room.leftoverCards.length > 0
  ) {
    player.leftoverSeen = true;
    if (player.socketId)
      io.to(player.socketId).emit("game:leftover-revealed", {
        cards: room.leftoverCards,
      });
    room.lastMessage = `${player.nickname}님이 증명 없는 추리 3회로 여분 카드를 확인했습니다.`;
  }
}

function moveSuggestedCharacterToRoom(
  room: Room,
  suggestion: Suggestion,
  suggester: Player,
) {
  const target = room.players.find((p) => p.character === suggestion.suspect);

  if (!target) return;

  // 지목된 캐릭터 말은 추리 장소로 이동해야 하지만,
  // 보너스 순간이동/비밀통로/다중 문 위치 때문에 추리자의 tileId로 옮기면 버그가 발생함.
  const targetTile = firstDoorOfRoom(suggestion.room);

  if (!targetTile) return;

  target.tileId = targetTile;
  target.room = suggestion.room;

  // 내가 나 자신을 추리한 경우는 끌려온 상태로 보지 않음
  target.pulledBySuggestion = target.id !== suggester.id;
}

function applyQuestionBonus(room: Room, player: Player) {
  const effects = [
    "extra-turn",
    "extra-suggestion",
    "reveal-card",
    "move-room",
    "blank",
  ] as const;
  const effect = effects[Math.floor(Math.random() * effects.length)];

  if (effect === "extra-turn") {
    player.bonusCards.push("extra-turn");
    emitPrivatePlayerState(player);
    room.bonusMessage =
      "보너스 카드: 차례 한 번 더 카드를 획득했습니다. 추리를 마친 뒤 원할 때 사용하세요.";
  } else if (effect === "extra-suggestion") {
    player.bonusCards.push("extra-suggestion");
    emitPrivatePlayerState(player);
    room.bonusMessage =
      "보너스 카드: 추리 한 번 더 카드를 획득했습니다. 추리를 마친 뒤 원할 때 사용하세요.";
  } else if (effect === "reveal-card") {
    room.pendingBonusAction = { kind: "reveal-card", playerId: player.id };
    room.bonusMessage =
      "보너스 카드: 다른 플레이어를 선택하세요. 선택된 플레이어의 카드 1장이 무작위로 나에게만 공개됩니다.";
  } else if (effect === "move-room") {
    room.pendingBonusAction = { kind: "move-room", playerId: player.id };
    room.bonusMessage =
      "보너스 카드: 원하는 장소로 즉시 이동할 수 있습니다. 이동 후 해당 장소에서 추리할 수 있습니다.";
  } else {
    room.bonusMessage = "보너스 카드: 꽝입니다. 아무 효과도 없습니다.";
  }

  room.lastMessage = `${player.nickname}님이 물음표 칸에 도착했습니다. ${room.bonusMessage}`;
}

io.on("connection", (socket) => {
  socket.emit("meta:init", { suspects, weapons, rooms, characters });

  socket.on("room:create", ({ nickname }: { nickname: string }) => {
    const clean = String(nickname ?? "")
      .trim()
      .slice(0, 16);
    if (!clean)
      return socket.emit("game:error", { message: "닉네임을 입력해주세요." });
    const roomCode = makeRoomCode();
    const player = createPlayer(socket, clean, 0, true);
    const room: Room = {
      roomCode,
      status: "waiting",
      players: [player],
      solution: null,
      leftoverCards: [],
      firstRolls: [],
      currentTurnIndex: 0,
      turnNumber: 0,
      winnerId: null,
      lastMessage: "방이 생성되었습니다.",
      dice: null,
      movesLeft: 0,
      reachableTileIds: [],
      hasRolled: false,
      hasSuggested: false,
      pendingDisprove: null,
      bonusMessage: null,
      pendingBonusAction: null,
      bonusExtraTurn: false,
      bonusExtraSuggestion: false,
      logs: [],
    };
    roomsMap.set(roomCode, room);
    attachSocket(room, player, socket);
    socket.emit("room:created", {
      roomCode,
      playerId: player.id,
      roomState: publicRoom(room),
    });
    emitRoom(room);
  });

  socket.on(
    "room:join",
    ({ roomCode, nickname }: { roomCode: string; nickname: string }) => {
      const code = String(roomCode ?? "")
        .trim()
        .toUpperCase();
      const clean = String(nickname ?? "")
        .trim()
        .slice(0, 16);
      const room = roomsMap.get(code);
      if (!room)
        return socket.emit("game:error", {
          message: "존재하지 않는 방 코드입니다.",
        });
      if (!clean)
        return socket.emit("game:error", { message: "닉네임을 입력해주세요." });
      if (room.status !== "waiting")
        return socket.emit("game:error", { message: "이미 시작된 방입니다." });
      if (room.players.length >= 6)
        return socket.emit("game:error", {
          message: "최대 6명까지 참가할 수 있습니다.",
        });
      const player = createPlayer(socket, clean, room.players.length, false);
      room.players.push(player);
      attachSocket(room, player, socket);
      room.lastMessage = `${clean}님이 참가했습니다.`;
      socket.emit("room:joined", {
        playerId: player.id,
        roomState: publicRoom(room),
      });
      emitRoom(room);
    },
  );

  socket.on(
    "room:rejoin",
    ({ roomCode, playerId }: { roomCode: string; playerId: string }) => {
      const room = roomsMap.get(String(roomCode ?? "").toUpperCase());
      const player = room?.players.find((p) => p.id === playerId);
      if (!room || !player) return socket.emit("room:rejoin-failed");
      attachSocket(room, player, socket);
      socket.emit("room:rejoined", {
        playerId: player.id,
        roomState: publicRoom(room),
      });
      socket.emit("game:your-cards", { cards: player.hand });
      room.lastMessage = `${player.nickname}님이 재접속했습니다.`;
      emitRoom(room);
      if (room.pendingDisprove?.disproverId === player.id) {
        socket.emit("game:disprove-request", {
          matchingCards: room.pendingDisprove.matchingCards,
          suggestion: room.pendingDisprove.suggestion,
        });
      }
    },
  );

  socket.on("room:leave", () => leavePlayer(socket));

  socket.on("game:start", () => {
    const room = findBySocket(socket);
    if (!room)
      return socket.emit("game:error", { message: "방에 먼저 입장해주세요." });
    const p = findPlayer(room, socket);
    if (!p?.isHost)
      return socket.emit("game:error", {
        message: "방장만 시작할 수 있습니다.",
      });
    if (room.players.length < 2)
      return socket.emit("game:error", {
        message: "2명 이상이어야 시작할 수 있습니다.",
      });

    room.solution = createSolution();
    room.players.forEach((player, index) => {
      player.hand = [];
      player.eliminated = false;
      player.finalAccused = false;
      player.finalAccusation = null;
      player.failedNoDisproveCount = 0;
      player.leftoverSeen = false;
      player.pulledBySuggestion = false;
      player.tileId = startTileIds[index] ?? startTileIds[0];
      player.room = "현관";
    });

    const rest = shuffle(
      allCards.filter(
        (c) =>
          c.name !== room.solution?.suspect &&
          c.name !== room.solution?.weapon &&
          c.name !== room.solution?.room,
      ),
    );
    if (room.players.length === 2) {
      for (const player of room.players) {
        player.hand = rest.splice(0, 7);
      }

      room.leftoverCards = rest.splice(0, 4);
    } else {
      const perPlayer = Math.floor(rest.length / room.players.length);

      for (const player of room.players) {
        player.hand = rest.splice(0, perPlayer);
      }

      room.leftoverCards = rest;
    }

    room.firstRolls = room.players.map((player) => {
      const total =
        Math.floor(Math.random() * 6) + 1 + Math.floor(Math.random() * 6) + 1;
      return { playerId: player.id, nickname: player.nickname, total };
    });
    const max = Math.max(...room.firstRolls.map((r) => r.total));
    const first = room.firstRolls.find((r) => r.total === max)!;
    room.currentTurnIndex = Math.max(
      0,
      room.players.findIndex((player) => player.id === first.playerId),
    );

    room.status = "playing";
    room.turnNumber = 1;
    room.winnerId = null;
    resetTurn(room);
    room.lastMessage = `선공 주사위 결과 ${first.nickname}님이 ${max}로 첫 번째 턴입니다. 주사위 2개를 굴리세요.`;
    emitHands(room);
    io.to(room.roomCode).emit("game:started", { gameState: publicRoom(room) });
    emitRoom(room);
  });

  socket.on("game:roll", () => {
    const room = findBySocket(socket);
    if (!room)
      return socket.emit("game:error", { message: "방에 먼저 입장해주세요." });
    const err = turnError(socket, room);
    if (err) return socket.emit("game:error", { message: err });
    if (room.hasRolled)
      return socket.emit("game:error", {
        message: "주사위는 한 턴에 한 번만 굴릴 수 있습니다.",
      });
    const p = current(room)!;
    const d1 = Math.floor(Math.random() * 6) + 1;
    const d2 = Math.floor(Math.random() * 6) + 1;
    p.pulledBySuggestion = false;
    room.dice = [d1, d2];
    room.movesLeft = d1 + d2;
    room.hasRolled = true;
    room.reachableTileIds = getReachableTileIds(p.tileId, room.movesLeft);
    room.lastMessage = `${p.nickname}님이 ${d1}+${d2}=${room.movesLeft}칸 이동할 수 있습니다.`;
    io.to(room.roomCode).emit("game:rolled", {
      playerId: p.id,
      dice: room.dice,
      reachableTileIds: room.reachableTileIds,
    });
    emitRoom(room);
  });

  socket.on("game:secret-passage", () => {
    const room = findBySocket(socket);
    if (!room)
      return socket.emit("game:error", { message: "방에 먼저 입장해주세요." });
    const err = turnError(socket, room);
    if (err) return socket.emit("game:error", { message: err });
    const p = current(room)!;
    if (!p.room || p.room === "현관")
      return socket.emit("game:error", {
        message: "비밀통로가 있는 방에서만 사용할 수 있습니다.",
      });
    const target = secretPassages[p.room as RoomName];
    if (!target)
      return socket.emit("game:error", {
        message: "이 방에는 비밀통로가 없습니다.",
      });
    const targetTile = firstDoorOfRoom(target);
    if (!targetTile)
      return socket.emit("game:error", {
        message: "비밀통로 도착 지점을 찾을 수 없습니다.",
      });
    p.tileId = targetTile;
    p.room = target;
    p.pulledBySuggestion = false;
    room.dice = null;
    room.movesLeft = 0;
    room.reachableTileIds = [];
    room.hasRolled = true;
    room.lastMessage = `${p.nickname}님이 비밀통로를 이용해 ${target}(으)로 이동했습니다. 이 차례에는 더 이동할 수 없습니다.`;
    io.to(room.roomCode).emit("game:moved", {
      playerId: p.id,
      tileId: targetTile,
      room: p.room,
    });
    emitRoom(room);
  });

  socket.on("game:move", ({ tileId }: { tileId: string }) => {
    const room = findBySocket(socket);
    if (!room)
      return socket.emit("game:error", { message: "방에 먼저 입장해주세요." });
    const err = turnError(socket, room);
    if (err) return socket.emit("game:error", { message: err });
    if (!room.hasRolled)
      return socket.emit("game:error", {
        message: "먼저 주사위를 굴려주세요.",
      });
    if (!room.reachableTileIds.includes(tileId))
      return socket.emit("game:error", {
        message: "이동 가능한 칸만 선택할 수 있습니다.",
      });
    const tile = tileById[tileId];
    const p = current(room)!;
    p.tileId = tileId;
    p.room = tile?.type === "door" && tile.room ? tile.room : null;
    p.pulledBySuggestion = false;
    room.reachableTileIds = [];
    room.movesLeft = 0;
    room.lastMessage = p.room
      ? `${p.nickname}님이 ${p.room}에 도착했습니다.${p.room === "현관" ? " 최종 추리를 할 수 있습니다." : " 추리할 수 있습니다."}`
      : `${p.nickname}님이 이동했습니다. 방에 도착하지 않아 추리할 수 없습니다.`;
    if (tile?.type === "question") {
      applyQuestionBonus(room, p);
    }
    io.to(room.roomCode).emit("game:moved", {
      playerId: p.id,
      tileId,
      room: p.room,
    });
    emitRoom(room);
  });

  socket.on("game:suggest", (suggestion: Suggestion) => {
    const room = findBySocket(socket);
    if (!room)
      return socket.emit("game:error", { message: "방에 먼저 입장해주세요." });
    const err = turnError(socket, room);
    if (err) return socket.emit("game:error", { message: err });
    const p = current(room)!;
    if (!p.room || p.room === "현관")
      return socket.emit("game:error", {
        message: "범행 장소에 도착해야 추리할 수 있습니다.",
      });
    if (p.pulledBySuggestion)
      return socket.emit("game:error", {
        message:
          "다른 플레이어의 추리로 이동한 장소에서는 즉시 추리할 수 없습니다. 이동 후 추리하세요.",
      });
    if (room.hasSuggested && !room.bonusExtraSuggestion)
      return socket.emit("game:error", {
        message: "추리는 한 턴에 한 번만 가능합니다.",
      });
    if (!validSuggestion(suggestion) || suggestion.room !== p.room)
      return socket.emit("game:error", {
        message: "현재 방에 맞는 추리만 가능합니다.",
      });
    if (room.hasSuggested && room.bonusExtraSuggestion) {
      room.bonusExtraSuggestion = false;
      room.bonusMessage = "보너스 추리 기회를 사용했습니다.";
    } else {
      room.hasSuggested = true;
    }
    // 추리 후 더 이상 이동할 수 없도록 reachableTileIds 초기화
    room.reachableTileIds = [];
    room.movesLeft = 0;
    //moveSuggestedCharacterToRoom(room, suggestion, p);
    room.lastMessage = `${p.nickname}님의 추리: ${suggestion.suspect}, ${suggestion.weapon}, ${suggestion.room}`;
    addLog(
      room,
      `${p.nickname}님의 추리: ${suggestion.suspect}, ${suggestion.weapon}, ${suggestion.room}`,
    );
    io.to(room.roomCode).emit("game:suggested", { playerId: p.id, suggestion });
    const ordered = [
      ...room.players.slice(room.currentTurnIndex + 1),
      ...room.players.slice(0, room.currentTurnIndex),
    ].filter((x) => x.id !== p.id && !x.eliminated);
    const disprover = ordered.find(
      (x) => matchingCards(x, suggestion).length > 0,
    );
    if (!disprover) {
      p.failedNoDisproveCount += 1;

      if (
        room.players.length === 2 &&
        room.leftoverCards.length > 0 &&
        p.socketId
      ) {
        io.to(p.socketId).emit("game:leftover-choice-needed", {
          count: room.leftoverCards.length,
        });
      }

      room.lastMessage =
        "아무도 증명하지 못했습니다. 숨김 카드 1장을 선택할 수 있습니다.";

      io.to(room.roomCode).emit("game:no-disprove", { suggestion });

      emitRoom(room);
      return;
    }
    const matches = matchingCards(disprover, suggestion);
    room.pendingDisprove = {
      suggesterId: p.id,
      disproverId: disprover.id,
      suggestion,
      matchingCards: matches,
    };
    if (disprover.socketId)
      io.to(disprover.socketId).emit("game:disprove-request", {
        matchingCards: matches,
        suggestion,
      });
    room.lastMessage = `${disprover.nickname}님이 증명할 카드를 선택해야 합니다.`;
    emitRoom(room);
  });

  socket.on("game:choose-leftover-card", ({ index }: { index: number }) => {
    const room = findBySocket(socket);

    if (!room) {
      return;
    }

    const player = findPlayer(room, socket);

    if (!player) {
      return;
    }

    const card = room.leftoverCards[index];

    if (!card) {
      return;
    }

    io.to(socket.id).emit("game:leftover-card-revealed-once", { card });
  });

  socket.on("game:disprove", ({ cardId }: { cardId: string }) => {
    const room = findBySocket(socket);
    const player = room ? findPlayer(room, socket) : null;
    if (!room?.pendingDisprove || !player)
      return socket.emit("game:error", { message: "증명할 추리가 없습니다." });
    if (room.pendingDisprove.disproverId !== player.id)
      return socket.emit("game:error", {
        message: "증명자로 지정된 플레이어만 선택할 수 있습니다.",
      });
    const selected = room.pendingDisprove.matchingCards.find(
      (c) => c.id === cardId,
    );
    if (!selected)
      return socket.emit("game:error", {
        message: "선택할 수 없는 카드입니다.",
      });
    const suggester = room.players.find(
      (p) => p.id === room.pendingDisprove?.suggesterId,
    );
    if (suggester?.socketId)
      io.to(suggester.socketId).emit("game:card-revealed", {
        card: selected,
        disproverId: player.id,
      });
    if (suggester)
      addPrivateLog(
        suggester,
        `${player.nickname}님이 공개한 카드: ${selected.name}`,
      );
    room.pendingDisprove = null;
    room.lastMessage = `${player.nickname}님이 카드 1장을 공개해 추리를 증명했습니다. 고발하거나 턴을 넘기세요.`;
    io.to(room.roomCode).emit("game:disproved", { disproverId: player.id });
    emitRoom(room);
  });

  socket.on("game:accuse", (accusation: Suggestion) => {
    const room = findBySocket(socket);
    if (!room?.solution)
      return socket.emit("game:error", {
        message: "진행 중인 게임이 없습니다.",
      });

    // winnerId가 없으면 (첫 정답) 턴 체크, 있으면 (나머지 플레이어) 플레이어만 확인
    let p: Player;
    if (!room.winnerId) {
      const err = turnError(socket, room);
      if (err) return socket.emit("game:error", { message: err });
      p = current(room)!;
    } else {
      const player = findPlayer(room, socket);
      if (!player)
        return socket.emit("game:error", {
          message: "플레이어 정보를 찾을 수 없습니다.",
        });
      p = player;
    }

    if (!validSuggestion(accusation))
      return socket.emit("game:error", { message: "잘못된 최종 추리입니다." });
    if (p.finalAccused)
      return socket.emit("game:error", {
        message: "최종 추리는 한 번만 가능합니다.",
      });

    // winnerId가 없으면 (첫 정답) 현관에서만 가능, 있으면 (나머지 플레이어) 위치 무관
    if (!room.winnerId && p.room !== "현관")
      return socket.emit("game:error", {
        message: "최종 추리는 게임판 중앙 현관에서만 가능합니다.",
      });

    p.finalAccused = true;
    p.finalAccusation = accusation;
    const correct =
      room.solution.suspect === accusation.suspect &&
      room.solution.weapon === accusation.weapon &&
      room.solution.room === accusation.room;
    io.to(room.roomCode).emit("game:accused", { playerId: p.id, accusation });

    // 첫 번째 정답인 경우
    if (correct && !room.winnerId) {
      room.winnerId = p.id;
      room.lastMessage = `${p.nickname}님이 최종 추리에 성공했습니다! 나머지 플레이어들은 순서대로 최종 추리를 진행합니다.`;

      // 나머지 플레이어들에게 최종 추리 기회 제공
      const remaining = room.players.filter((pl) => pl.id !== p.id);
      if (remaining.length > 0) {
        // 다음 플레이어로 턴 변경
        let nextIndex = (room.currentTurnIndex + 1) % room.players.length;
        while (room.players[nextIndex].id === p.id) {
          nextIndex = (nextIndex + 1) % room.players.length;
        }
        room.currentTurnIndex = nextIndex;
        const nextPlayer = room.players[nextIndex];
        room.lastMessage = `${nextPlayer.nickname}님의 최종 추리 차례입니다. 현재 위치와 상관없이 추리할 수 있습니다.`;
        io.to(room.roomCode).emit("game:turn-start", {
          playerId: nextPlayer.id,
          turnNumber: room.turnNumber,
        });
      } else {
        // 유일한 플레이어인 경우 바로 게임 종료
        room.status = "finished";
        io.to(room.roomCode).emit("game:win", {
          winner: p,
          solution: room.solution,
          playerAccusations: room.players.map((pl) => ({
            id: pl.id,
            nickname: pl.nickname,
            finalAccusation: pl.finalAccusation,
            correct: pl.finalAccusation
              ? pl.finalAccusation.suspect === room.solution!.suspect &&
                pl.finalAccusation.weapon === room.solution!.weapon &&
                pl.finalAccusation.room === room.solution!.room
              : false,
          })),
        });
      }
      emitRoom(room);
      return;
    }

    // winnerId가 있으면 (나머지 플레이어) 추리 완료 확인
    if (room.winnerId) {
      const allDone = room.players.every((pl) => pl.finalAccused);
      if (allDone) {
        // 모든 플레이어가 추리 완료
        room.status = "finished";
        const winner = room.players.find((pl) => pl.id === room.winnerId);
        io.to(room.roomCode).emit("game:win", {
          winner,
          solution: room.solution,
          playerAccusations: room.players.map((pl) => ({
            id: pl.id,
            nickname: pl.nickname,
            finalAccusation: pl.finalAccusation,
            correct: pl.finalAccusation
              ? pl.finalAccusation.suspect === room.solution!.suspect &&
                pl.finalAccusation.weapon === room.solution!.weapon &&
                pl.finalAccusation.room === room.solution!.room
              : false,
          })),
        });
      } else {
        // 다음 플레이어로 턴 변경 (아직 최종 추리를 하지 않은 플레이어)
        let nextIndex = (room.currentTurnIndex + 1) % room.players.length;
        while (room.players[nextIndex].finalAccused) {
          nextIndex = (nextIndex + 1) % room.players.length;
        }
        room.currentTurnIndex = nextIndex;
        const nextPlayer = room.players[nextIndex];
        room.lastMessage = `${nextPlayer.nickname}님의 최종 추리 차례입니다.`;
        io.to(room.roomCode).emit("game:turn-start", {
          playerId: nextPlayer.id,
          turnNumber: room.turnNumber,
        });
      }
      emitRoom(room);
      return;
    }

    // winnerId가 없고 정답이 아닌 경우 (이전 코드처럼 탈락)
    p.eliminated = true;
    room.lastMessage = `${p.nickname}님이 최종 추리에 실패하여 탈락했습니다.`;
    io.to(room.roomCode).emit("game:eliminated", { playerId: p.id });

    // 다음 활성 플레이어 찾기
    const active = room.players.filter((pl) => !pl.eliminated);
    if (active.length === 1) {
      // 마지막 활성 플레이어만 남음
      const lastPlayer = active[0];
      room.winnerId = lastPlayer.id;
      lastPlayer.finalAccusation = null;
      room.status = "finished";
      io.to(room.roomCode).emit("game:win", {
        winner: lastPlayer,
        solution: room.solution,
        playerAccusations: room.players.map((pl) => ({
          id: pl.id,
          nickname: pl.nickname,
          finalAccusation: pl.finalAccusation,
          correct: pl.finalAccusation
            ? pl.finalAccusation.suspect === room.solution!.suspect &&
              pl.finalAccusation.weapon === room.solution!.weapon &&
              pl.finalAccusation.room === room.solution!.room
            : false,
        })),
      });
      emitRoom(room);
      return;
    }

    // 다음 활성 플레이어로 턴 변경 - nextTurn 함수 호출로 정상 턴 진행
    let nextIndex = (room.currentTurnIndex + 1) % room.players.length;
    while (room.players[nextIndex].eliminated) {
      nextIndex = (nextIndex + 1) % room.players.length;
    }
    room.currentTurnIndex = nextIndex;
    room.turnNumber += 1;
    resetTurn(room);
    const nextPlayer = room.players[nextIndex];
    room.lastMessage = `${nextPlayer.nickname}님의 턴입니다. 주사위 2개를 굴리세요.`;
    io.to(room.roomCode).emit("game:turn-start", {
      playerId: nextPlayer.id,
      turnNumber: room.turnNumber,
    });
    emitRoom(room);
  });

  socket.on("game:use-bonus-extra-turn", () => {
    const room = findBySocket(socket);
    if (!room)
      return socket.emit("game:error", { message: "방에 먼저 입장해주세요." });
    const err = turnError(socket, room);
    if (err) return socket.emit("game:error", { message: err });
    const p = current(room)!;
    if (!room.hasSuggested)
      return socket.emit("game:error", {
        message: "추리를 마친 뒤 사용할 수 있습니다.",
      });
    const idx = p.bonusCards.indexOf("extra-turn");
    if (idx < 0)
      return socket.emit("game:error", {
        message: "보관 중인 차례 한 번 더 카드가 없습니다.",
      });
    p.bonusCards.splice(idx, 1);
    room.bonusExtraTurn = true;
    room.bonusMessage =
      "차례 한 번 더 카드를 사용했습니다. 턴을 넘기면 같은 플레이어가 한 번 더 진행합니다.";
    room.lastMessage = `${p.nickname}님이 차례 한 번 더 카드를 사용했습니다.`;
    emitPrivatePlayerState(p);
    emitRoom(room);
  });

  socket.on("game:use-bonus-extra-suggestion", () => {
    const room = findBySocket(socket);
    if (!room)
      return socket.emit("game:error", { message: "방에 먼저 입장해주세요." });
    const err = turnError(socket, room);
    if (err) return socket.emit("game:error", { message: err });
    const p = current(room)!;
    if (!room.hasSuggested)
      return socket.emit("game:error", {
        message: "추리를 마친 뒤 사용할 수 있습니다.",
      });
    if (!p.room || p.room === "현관")
      return socket.emit("game:error", {
        message: "범행 장소에서만 사용할 수 있습니다.",
      });
    const idx = p.bonusCards.indexOf("extra-suggestion");
    if (idx < 0)
      return socket.emit("game:error", {
        message: "보관 중인 추리 한 번 더 카드가 없습니다.",
      });
    p.bonusCards.splice(idx, 1);
    room.bonusExtraSuggestion = true;
    room.bonusMessage =
      "추리 한 번 더 카드를 사용했습니다. 같은 장소에서 추리를 한 번 더 할 수 있습니다.";
    room.lastMessage = `${p.nickname}님이 추리 한 번 더 카드를 사용했습니다.`;
    emitPrivatePlayerState(p);
    emitRoom(room);
  });

  socket.on(
    "game:bonus-reveal-player",
    ({ targetPlayerId }: { targetPlayerId: string }) => {
      const room = findBySocket(socket);
      if (!room)
        return socket.emit("game:error", {
          message: "방에 먼저 입장해주세요.",
        });
      const p = findPlayer(room, socket);
      if (
        !p ||
        room.pendingBonusAction?.kind !== "reveal-card" ||
        room.pendingBonusAction.playerId !== p.id
      ) {
        return socket.emit("game:error", {
          message: "처리할 카드 공개 보너스가 없습니다.",
        });
      }
      const target = room.players.find(
        (x) => x.id === targetPlayerId && x.id !== p.id,
      );
      if (!target)
        return socket.emit("game:error", {
          message: "선택할 수 없는 플레이어입니다.",
        });
      if (target.hand.length === 0)
        return socket.emit("game:error", {
          message: "상대가 공개할 카드를 가지고 있지 않습니다.",
        });
      const card = target.hand[Math.floor(Math.random() * target.hand.length)];
      if (p.socketId)
        io.to(p.socketId).emit("game:card-revealed", {
          card,
          disproverId: target.id,
        });
      addPrivateLog(
        p,
        `보너스 카드로 ${target.nickname}님의 카드 확인: ${card.name}`,
      );
      room.pendingBonusAction = null;
      room.bonusMessage = `${target.nickname}님의 카드 1장이 무작위로 공개되었습니다.`;
      room.lastMessage = `${p.nickname}님이 보너스 카드로 ${target.nickname}님의 카드 1장을 확인했습니다.`;
      emitRoom(room);
    },
  );

  socket.on("game:bonus-move-room", ({ roomName }: { roomName: RoomName }) => {
    const room = findBySocket(socket);
    if (!room)
      return socket.emit("game:error", { message: "방에 먼저 입장해주세요." });
    const p = findPlayer(room, socket);
    if (
      !p ||
      room.pendingBonusAction?.kind !== "move-room" ||
      room.pendingBonusAction.playerId !== p.id
    ) {
      return socket.emit("game:error", {
        message: "처리할 장소 이동 보너스가 없습니다.",
      });
    }
    if (!rooms.includes(roomName))
      return socket.emit("game:error", {
        message: "존재하지 않는 장소입니다.",
      });
    const targetTile = firstDoorOfRoom(roomName);
    if (!targetTile)
      return socket.emit("game:error", {
        message: "이동할 장소 입구를 찾을 수 없습니다.",
      });
    p.tileId = targetTile;
    p.room = roomName;
    p.pulledBySuggestion = false;
    room.pendingBonusAction = null;
    room.hasRolled = true;
    room.movesLeft = 0;
    room.reachableTileIds = [];
    room.bonusMessage = `${roomName}(으)로 이동했습니다. 이 장소에서 추리할 수 있습니다.`;
    room.lastMessage = `${p.nickname}님이 보너스 카드로 ${roomName}(으)로 이동했습니다.`;
    io.to(room.roomCode).emit("game:moved", {
      playerId: p.id,
      tileId: targetTile,
      room: p.room,
    });
    emitRoom(room);
  });

  socket.on("game:pass", () => {
    const room = findBySocket(socket);
    if (!room)
      return socket.emit("game:error", { message: "방에 먼저 입장해주세요." });
    const err = turnError(socket, room);
    if (err) return socket.emit("game:error", { message: err });
    nextTurn(room);
  });

  socket.on("disconnect", () => {
    const roomCode = socketRoomMap.get(socket.id);
    const playerId = socketPlayerMap.get(socket.id);
    socketRoomMap.delete(socket.id);
    socketPlayerMap.delete(socket.id);
    if (!roomCode || !playerId) return;
    const room = roomsMap.get(roomCode);
    const player = room?.players.find((p) => p.id === playerId);
    if (!room || !player) return;
    player.connected = false;
    player.socketId = null;
    player.disconnectTimer = setTimeout(() => {
      const freshRoom = roomsMap.get(roomCode);
      const freshPlayer = freshRoom?.players.find((p) => p.id === playerId);
      if (!freshRoom || !freshPlayer || freshPlayer.connected) return;
      freshRoom.players = freshRoom.players.filter((p) => p.id !== playerId);
      freshRoom.lastMessage = `${freshPlayer.nickname}님이 연결 종료로 퇴장했습니다.`;
      if (freshRoom.players.length === 0) roomsMap.delete(roomCode);
      else emitRoom(freshRoom);
    }, 60_000);
    emitRoom(room);
  });
});

const port = Number(process.env.PORT) || 4000;
httpServer.listen(port, () =>
  console.log(`Clue Remastered server listening on ${port}`),
);
