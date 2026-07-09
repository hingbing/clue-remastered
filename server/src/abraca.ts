import { Server, Socket } from "socket.io";

type SpellNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
type AbracaStatus = "waiting" | "playing" | "round-end" | "game-over";
type TurnChainMode = "gte" | "lte";

type Stone = {
  id: string;
  value: SpellNumber;
  origin: "deck" | "secret";
};

type PublicStone = {
  id: string;
  value: SpellNumber | null;
  origin: "deck" | "secret";
};

type BoardSlot = {
  id: string;
  spell: SpellNumber;
  slotIndex: number;
  stone: Stone | null;
  source: "setup" | "used" | null;
};

type SecretSlot = {
  id: string;
  slotIndex: number;
  stone: Stone | null;
};

type Player = {
  id: string;
  socketId: string | null;
  nickname: string;
  color: string;
  isHost: boolean;
  connected: boolean;
  hp: number;
  score: number;
  hand: Stone[];
  secretStones: Stone[];
  eliminated: boolean;
  disconnectTimer?: NodeJS.Timeout;
};

type LastResult = {
  type: "success" | "fail" | "pass" | "round-end" | "info";
  playerId?: string;
  spell?: SpellNumber;
  message: string;
};

type Room = {
  roomCode: string;
  status: AbracaStatus;
  players: Player[];
  drawPile: Stone[];
  boardSlots: BoardSlot[];
  secretSlots: SecretSlot[];
  currentTurnIndex: number;
  round: number;
  logs: string[];
  roundSummary: string[];
  winnerIds: string[];
  lastResult: LastResult | null;
  turnChainMinSpell: SpellNumber | null;
  turnChainMode: TurnChainMode;
  turnSuccessCount: number;
  pendingSecretTakePlayerId: string | null;
};

type RoundEndReason =
  | { type: "empty-hand"; playerId: string }
  | { type: "elimination"; playerId: string }
  | { type: "self-destruct"; playerId: string };

const roomsMap = new Map<string, Room>();
const socketRoomMap = new Map<string, string>();
const socketPlayerMap = new Map<string, string>();

const COLORS = ["#ef4444", "#3b82f6", "#22c55e", "#f59e0b", "#a855f7"];
const STARTING_HP = 6;
const MAX_HP = 6;
const STARTING_HAND = 5;
const TARGET_SCORE = 8;

const spellNames: Record<SpellNumber, string> = {
  1: "용용이의 분노",
  2: "어둠의 방랑자",
  3: "기분 좋은 바람",
  4: "부엉부엉 통신",
  5: "번개 폭풍",
  6: "눈보라 강타",
  7: "불덩이 작렬",
  8: "마법 물약",
};

function makeId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

function makeRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";

  for (let i = 0; i < 6; i += 1) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }

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

function rollDie() {
  return Math.floor(Math.random() * 6) + 1;
}

function rollSmallDie() {
  return Math.floor(Math.random() * 3) + 1;
}

function heal(hp: number, amount: number) {
  return Math.min(MAX_HP, hp + amount);
}

function damage(hp: number, amount: number) {
  return Math.max(0, hp - amount);
}

function createDeck() {
  const deck: Stone[] = [];
  let id = 1;

  for (let value = 1; value <= 8; value += 1) {
    for (let count = 0; count < value; count += 1) {
      deck.push({
        id: `stone_${id++}`,
        value: value as SpellNumber,
        origin: "deck",
      });
    }
  }

  return shuffle(deck);
}

function createBoardSlots(): BoardSlot[] {
  const slots: BoardSlot[] = [];

  for (let value = 1; value <= 8; value += 1) {
    for (let slotIndex = 0; slotIndex < value; slotIndex += 1) {
      slots.push({
        id: `slot_${value}_${slotIndex}`,
        spell: value as SpellNumber,
        slotIndex,
        stone: null,
        source: null,
      });
    }
  }

  return slots;
}

function createSecretSlots(stones: Stone[]): SecretSlot[] {
  return [0, 1, 2, 3].map((slotIndex) => {
    const stone = stones[slotIndex];

    return {
      id: `secret_${slotIndex}`,
      slotIndex,
      stone: stone
        ? {
            ...stone,
            origin: "secret",
          }
        : null,
    };
  });
}

function addLog(room: Room, message: string) {
  const line = `[${new Date().toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  })}] ${message}`;

  room.logs.push(line);
  if (room.logs.length > 120) room.logs.shift();
}

function setResult(
  room: Room,
  type: LastResult["type"],
  message: string,
  playerId?: string,
  spell?: SpellNumber,
) {
  room.lastResult = {
    type,
    playerId,
    spell,
    message,
  };

  addLog(room, message);
}

function createPlayer(
  socket: Socket,
  nickname: string,
  index: number,
  isHost: boolean,
): Player {
  return {
    id: makeId("abraca_player"),
    socketId: socket.id,
    nickname,
    color: COLORS[index % COLORS.length],
    isHost,
    connected: true,
    hp: STARTING_HP,
    score: 0,
    hand: [],
    secretStones: [],
    eliminated: false,
  };
}

function publicStone(stone: Stone, visible: boolean): PublicStone {
  return {
    id: stone.id,
    value: visible ? stone.value : null,
    origin: stone.origin,
  };
}

function publicRoom(room: Room, viewerId: string) {
  const current =
    room.status === "playing" ? room.players[room.currentTurnIndex] : null;

  return {
    roomCode: room.roomCode,
    status: room.status,
    players: room.players.map((player) => {
      const isViewer = player.id === viewerId;

      return {
        id: player.id,
        nickname: player.nickname,
        color: player.color,
        hp: player.hp,
        score: player.score,
        connected: player.connected,
        isHost: player.isHost,
        eliminated: player.eliminated,

        // 내 손패는 back.png, 상대 손패는 번호 이미지
        hand: player.hand.map((stone) => publicStone(stone, !isViewer)),

        // 내가 가져온 비밀의 돌만 번호 공개
        secretStones: player.secretStones.map((stone) =>
          publicStone(stone, isViewer),
        ),
      };
    }),
    boardSlots: room.boardSlots.map((slot) => ({
      id: slot.id,
      spell: slot.spell,
      slotIndex: slot.slotIndex,
      source: slot.source,
      stone: slot.stone ? publicStone(slot.stone, true) : null,
    })),
    secretSlots: room.secretSlots.map((slot) => ({
      id: slot.id,
      slotIndex: slot.slotIndex,
      stone: slot.stone ? publicStone(slot.stone, false) : null,
    })),
    currentTurnPlayerId: current?.id ?? null,
    round: room.round,
    drawPileCount: room.drawPile.length,
    secretPileCount: room.secretSlots.filter((slot) => slot.stone).length,
    logs: room.logs,
    roundSummary: room.roundSummary,
    winnerIds: room.winnerIds,
    lastResult: room.lastResult,
    turnChainMinSpell: room.turnChainMinSpell,
    turnChainMode: room.turnChainMode,
    turnSuccessCount: room.turnSuccessCount,
    pendingSecretTakePlayerId: room.pendingSecretTakePlayerId,
  };
}

function emitRoom(io: Server, room: Room) {
  for (const player of room.players) {
    if (!player.socketId) continue;
    io.to(player.socketId).emit(
      "abraca:room:state",
      publicRoom(room, player.id),
    );
  }
}

function attachSocket(room: Room, player: Player, socket: Socket) {
  if (player.disconnectTimer) clearTimeout(player.disconnectTimer);

  player.socketId = socket.id;
  player.connected = true;

  socketRoomMap.set(socket.id, room.roomCode);
  socketPlayerMap.set(socket.id, player.id);

  socket.join(`abraca:${room.roomCode}`);
}

function findRoomBySocket(socket: Socket) {
  const roomCode = socketRoomMap.get(socket.id);
  if (!roomCode) return null;
  return roomsMap.get(roomCode) ?? null;
}

function findPlayer(room: Room, socket: Socket) {
  const playerId = socketPlayerMap.get(socket.id);
  if (!playerId) return null;
  return room.players.find((p) => p.id === playerId) ?? null;
}

function leftIndex(index: number, total: number) {
  return (index - 1 + total) % total;
}

function rightIndex(index: number, total: number) {
  return (index + 1) % total;
}

function nextLivingIndex(room: Room, fromIndex: number) {
  let index = fromIndex;

  for (let i = 0; i < room.players.length; i += 1) {
    index = (index + 1) % room.players.length;
    if (!room.players[index].eliminated) return index;
  }

  return fromIndex;
}

function placeStoneOnBoard(room: Room, stone: Stone, source: "setup" | "used") {
  const slot = room.boardSlots.find(
    (s) => s.spell === stone.value && s.stone === null,
  );

  if (!slot) return;

  slot.stone = stone;
  slot.source = source;
}

function setupRound(room: Room) {
  const deck = createDeck();

  room.players.forEach((player) => {
    player.hp = STARTING_HP;
    player.hand = [];
    player.secretStones = [];
    player.eliminated = false;

    player.hand = deck.splice(0, STARTING_HAND);
  });

  const secretStones = deck.splice(0, 4).map((stone) => ({
    ...stone,
    origin: "secret" as const,
  }));

  room.boardSlots = createBoardSlots();
  room.secretSlots = createSecretSlots(secretStones);

  const extraCount =
    room.players.length === 2 ? 12 : room.players.length === 3 ? 6 : 0;

  const setupStones = deck.splice(0, extraCount);

  setupStones.forEach((stone) => {
    placeStoneOnBoard(room, stone, "setup");
  });

  room.drawPile = deck;
  room.roundSummary = [];
  room.winnerIds = [];
  room.turnChainMinSpell = null;
  room.turnSuccessCount = 0;
  room.pendingSecretTakePlayerId = null;

  const firstRolls = room.players.map((player) => ({
    playerId: player.id,
    nickname: player.nickname,
    value: rollDie(),
  }));

  const max = Math.max(...firstRolls.map((r) => r.value));
  const first = firstRolls.find((r) => r.value === max)!;

  room.currentTurnIndex = Math.max(
    0,
    room.players.findIndex((p) => p.id === first.playerId),
  );

  room.status = "playing";

  setResult(
    room,
    "info",
    `라운드 ${room.round} 시작. 선공 주사위: ${firstRolls
      .map((r) => `${r.nickname}(${r.value})`)
      .join(", ")} → ${first.nickname} 선공`,
  );
}

function refillHand(room: Room, player: Player) {
  let drawn = 0;

  while (player.hand.length < STARTING_HAND && room.drawPile.length > 0) {
    player.hand.push(room.drawPile.shift()!);
    drawn += 1;
  }

  addLog(
    room,
    `${player.nickname}님이 마법의 돌 ${drawn}개를 보충했습니다. 현재 손패 ${player.hand.length}개.`,
  );
}

function endTurn(room: Room, player: Player, announceResult = true) {
  refillHand(room, player);

  room.turnChainMinSpell = null;
  room.turnSuccessCount = 0;

  room.currentTurnIndex = nextLivingIndex(room, room.currentTurnIndex);
  const nextPlayer = room.players[room.currentTurnIndex];
  const message = `${nextPlayer.nickname}님의 차례입니다.`;

  if (announceResult) {
    setResult(room, "info", message);
  } else {
    addLog(room, message);
  }

  return nextPlayer;
}

function scoreRound(room: Room, reason: RoundEndReason) {
  room.players.forEach((player) => {
    if (player.hp <= 0) {
      player.hp = 0;
      player.eliminated = true;
    }
  });

  const summary: string[] = [];

  room.players.forEach((player) => {
    if (player.eliminated) {
      summary.push(`${player.nickname}: 탈락 → 0점`);
      return;
    }

    let base = 1;

    if (reason.type === "empty-hand") {
      base = player.id === reason.playerId ? 3 : 0;
    }

    if (reason.type === "elimination") {
      base = player.id === reason.playerId ? 3 : 1;
    }

    if (reason.type === "self-destruct") {
      base = player.id === reason.playerId ? 0 : 1;
    }

    const secretBonus = base > 0 ? player.secretStones.length : 0;
    const gained = base + secretBonus;

    player.score += gained;

    summary.push(
      `${player.nickname}: 기본 ${base}점 + 비밀의 돌 ${secretBonus}점 = ${gained}점 / 누적 ${player.score}점`,
    );
  });

  room.roundSummary = summary;

  const reached = room.players.filter((player) => player.score >= TARGET_SCORE);

  if (reached.length > 0) {
    const bestHp = Math.max(...reached.map((player) => player.hp));
    room.winnerIds = reached
      .filter((player) => player.hp === bestHp)
      .map((player) => player.id);
    room.status = "game-over";
  } else {
    room.winnerIds = [];
    room.status = "round-end";
  }

  room.turnChainMinSpell = null;
  room.turnSuccessCount = 0;
  room.pendingSecretTakePlayerId = null;

  setResult(
    room,
    "round-end",
    room.status === "game-over"
      ? "게임 종료! 승자가 결정되었습니다."
      : "라운드가 종료되었습니다. 점수를 계산했습니다.",
  );
}

function turnError(socket: Socket, room: Room) {
  const player = findPlayer(room, socket);

  if (!player) return "플레이어 정보를 찾을 수 없습니다.";
  if (room.status !== "playing") return "진행 중인 라운드가 아닙니다.";
  if (player.eliminated) return "탈락한 플레이어는 행동할 수 없습니다.";
  if (room.players[room.currentTurnIndex]?.id !== player.id)
    return "지금은 내 차례가 아닙니다.";
  if (
    room.pendingSecretTakePlayerId &&
    room.pendingSecretTakePlayerId !== player.id
  ) {
    return "다른 플레이어가 비밀의 돌을 선택 중입니다.";
  }

  return null;
}

function leavePlayer(io: Server, socket: Socket) {
  const roomCode = socketRoomMap.get(socket.id);
  const playerId = socketPlayerMap.get(socket.id);

  socketRoomMap.delete(socket.id);
  socketPlayerMap.delete(socket.id);

  if (!roomCode || !playerId) return;

  const room = roomsMap.get(roomCode);
  if (!room) return;

  const player = room.players.find((p) => p.id === playerId);
  if (!player) return;

  if (player.disconnectTimer) clearTimeout(player.disconnectTimer);

  const wasHost = player.isHost;
  const wasCurrent = room.players[room.currentTurnIndex]?.id === player.id;

  room.players = room.players.filter((p) => p.id !== playerId);
  socket.leave(`abraca:${roomCode}`);
  socket.emit("abraca:room:left");

  if (room.players.length === 0) {
    roomsMap.delete(roomCode);
    return;
  }

  if (wasHost) room.players[0].isHost = true;
  if (room.currentTurnIndex >= room.players.length) room.currentTurnIndex = 0;

  if (wasCurrent && room.status === "playing") {
    room.currentTurnIndex = nextLivingIndex(room, room.currentTurnIndex);
  }

  setResult(room, "info", `${player.nickname}님이 방을 나갔습니다.`);
  emitRoom(io, room);
}

function handleDisconnect(io: Server, socket: Socket) {
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

    if (freshRoom.players.length === 0) {
      roomsMap.delete(roomCode);
      return;
    }

    setResult(
      freshRoom,
      "info",
      `${freshPlayer.nickname}님이 연결 종료로 퇴장했습니다.`,
    );

    emitRoom(io, freshRoom);
  }, 60_000);

  emitRoom(io, room);
}

export function registerAbraca(io: Server) {
  io.on("connection", (socket) => {
    socket.on("abraca:room:create", ({ nickname }: { nickname: string }) => {
      const clean = String(nickname ?? "")
        .trim()
        .slice(0, 16);

      if (!clean) {
        return socket.emit("abraca:error", {
          message: "닉네임을 입력해주세요.",
        });
      }

      const roomCode = makeRoomCode();
      const player = createPlayer(socket, clean, 0, true);

      const room: Room = {
        roomCode,
        status: "waiting",
        players: [player],
        drawPile: [],
        boardSlots: createBoardSlots(),
        secretSlots: createSecretSlots([]),
        currentTurnIndex: 0,
        round: 1,
        logs: [],
        roundSummary: [],
        winnerIds: [],
        lastResult: null,
        turnChainMinSpell: null,
        turnChainMode: "gte",
        turnSuccessCount: 0,
        pendingSecretTakePlayerId: null,
      };

      roomsMap.set(roomCode, room);
      attachSocket(room, player, socket);
      setResult(room, "info", "아브라카왓 방이 생성되었습니다.");

      socket.emit("abraca:room:created", {
        roomCode,
        playerId: player.id,
        roomState: publicRoom(room, player.id),
      });

      emitRoom(io, room);
    });

    socket.on(
      "abraca:room:join",
      ({ roomCode, nickname }: { roomCode: string; nickname: string }) => {
        const code = String(roomCode ?? "")
          .trim()
          .toUpperCase();
        const clean = String(nickname ?? "")
          .trim()
          .slice(0, 16);

        const room = roomsMap.get(code);

        if (!room) {
          return socket.emit("abraca:error", {
            message: "존재하지 않는 방 코드입니다.",
          });
        }

        if (!clean) {
          return socket.emit("abraca:error", {
            message: "닉네임을 입력해주세요.",
          });
        }

        if (room.status !== "waiting") {
          return socket.emit("abraca:error", {
            message: "이미 시작된 방입니다.",
          });
        }

        if (room.players.length >= 5) {
          return socket.emit("abraca:error", {
            message: "아브라카왓은 최대 5명까지 참가할 수 있습니다.",
          });
        }

        const player = createPlayer(socket, clean, room.players.length, false);
        room.players.push(player);

        attachSocket(room, player, socket);
        setResult(room, "info", `${clean}님이 참가했습니다.`);

        socket.emit("abraca:room:joined", {
          roomCode: room.roomCode,
          playerId: player.id,
          roomState: publicRoom(room, player.id),
        });

        emitRoom(io, room);
      },
    );

    socket.on(
      "abraca:room:rejoin",
      ({ roomCode, playerId }: { roomCode: string; playerId: string }) => {
        const room = roomsMap.get(
          String(roomCode ?? "")
            .trim()
            .toUpperCase(),
        );
        const player = room?.players.find((p) => p.id === playerId);

        if (!room || !player) {
          return socket.emit("abraca:error", {
            message: "이전 아브라카왓 방으로 재접속하지 못했습니다.",
          });
        }

        attachSocket(room, player, socket);
        setResult(room, "info", `${player.nickname}님이 재접속했습니다.`);

        socket.emit("abraca:room:joined", {
          roomCode: room.roomCode,
          playerId: player.id,
          roomState: publicRoom(room, player.id),
        });

        emitRoom(io, room);
      },
    );

    socket.on("abraca:room:leave", () => {
      leavePlayer(io, socket);
    });

    socket.on(
      "abraca:chain-mode:set",
      ({ mode }: { mode: TurnChainMode }) => {
        const room = findRoomBySocket(socket);

        if (!room) {
          return socket.emit("abraca:error", {
            message: "방에 먼저 입장해주세요.",
          });
        }

        const player = findPlayer(room, socket);

        if (!player?.isHost) {
          return socket.emit("abraca:error", {
            message: "방장만 추가주문 규칙을 바꿀 수 있습니다.",
          });
        }

        if (mode !== "gte" && mode !== "lte") {
          return socket.emit("abraca:error", {
            message: "존재하지 않는 추가주문 규칙입니다.",
          });
        }

        room.turnChainMode = mode;
        setResult(
          room,
          "info",
          `추가주문 규칙이 ${mode === "gte" ? "이상" : "이하"}으로 변경되었습니다.`,
        );
        emitRoom(io, room);
      },
    );

    socket.on("abraca:game:start", () => {
      const room = findRoomBySocket(socket);

      if (!room) {
        return socket.emit("abraca:error", {
          message: "방에 먼저 입장해주세요.",
        });
      }

      const player = findPlayer(room, socket);

      if (!player?.isHost) {
        return socket.emit("abraca:error", {
          message: "방장만 게임을 시작할 수 있습니다.",
        });
      }

      if (room.players.length < 2) {
        return socket.emit("abraca:error", {
          message: "2명 이상이어야 시작할 수 있습니다.",
        });
      }

      room.round = 1;
      room.logs = [];
      room.players.forEach((p) => {
        p.score = 0;
      });

      setupRound(room);
      emitRoom(io, room);
    });

    socket.on("abraca:game:next-round", () => {
      const room = findRoomBySocket(socket);

      if (!room) {
        return socket.emit("abraca:error", {
          message: "방에 먼저 입장해주세요.",
        });
      }

      const player = findPlayer(room, socket);

      if (!player?.isHost) {
        return socket.emit("abraca:error", {
          message: "방장만 다음 라운드를 시작할 수 있습니다.",
        });
      }

      if (room.status !== "round-end") {
        return socket.emit("abraca:error", {
          message: "라운드 종료 상태에서만 다음 라운드를 시작할 수 있습니다.",
        });
      }

      room.round += 1;
      setupRound(room);
      emitRoom(io, room);
    });

    socket.on("abraca:turn:pass", () => {
      const room = findRoomBySocket(socket);

      if (!room) {
        return socket.emit("abraca:error", {
          message: "방에 먼저 입장해주세요.",
        });
      }

      const err = turnError(socket, room);
      if (err) return socket.emit("abraca:error", { message: err });

      const player = findPlayer(room, socket)!;

      if (room.pendingSecretTakePlayerId) {
        return socket.emit("abraca:error", {
          message: "비밀의 돌을 먼저 선택해야 합니다.",
        });
      }

      if (room.turnSuccessCount <= 0) {
        return socket.emit("abraca:error", {
          message: "주문을 성공한 뒤에 턴을 넘길 수 있습니다.",
        });
      }

      setResult(room, "pass", `${player.nickname}님이 턴을 넘겼습니다.`);
      endTurn(room, player);
      emitRoom(io, room);
    });

    socket.on("abraca:secret:take", ({ slotIndex }: { slotIndex: number }) => {
      const room = findRoomBySocket(socket);

      if (!room) {
        return socket.emit("abraca:error", {
          message: "방에 먼저 입장해주세요.",
        });
      }

      const player = findPlayer(room, socket);

      if (!player) {
        return socket.emit("abraca:error", {
          message: "플레이어 정보를 찾을 수 없습니다.",
        });
      }

      if (room.pendingSecretTakePlayerId !== player.id) {
        return socket.emit("abraca:error", {
          message: "지금은 비밀의 돌을 선택할 수 없습니다.",
        });
      }

      const slot = room.secretSlots.find((s) => s.slotIndex === slotIndex);

      if (!slot || !slot.stone) {
        return socket.emit("abraca:error", {
          message: "선택할 수 없는 비밀의 돌입니다.",
        });
      }

      player.secretStones.push(slot.stone);
      slot.stone = null;
      room.pendingSecretTakePlayerId = null;

      setResult(
        room,
        "success",
        `${player.nickname}님이 비밀의 돌 b${slotIndex + 1}을 가져왔습니다.`,
        player.id,
        4,
      );

      emitRoom(io, room);
    });

    socket.on("abraca:spell:cast", ({ spell }: { spell: SpellNumber }) => {
      const room = findRoomBySocket(socket);

      if (!room) {
        return socket.emit("abraca:error", {
          message: "방에 먼저 입장해주세요.",
        });
      }

      const err = turnError(socket, room);
      if (err) return socket.emit("abraca:error", { message: err });

      if (![1, 2, 3, 4, 5, 6, 7, 8].includes(Number(spell))) {
        return socket.emit("abraca:error", {
          message: "존재하지 않는 주문입니다.",
        });
      }
      if (room.pendingSecretTakePlayerId) {
        return socket.emit("abraca:error", {
          message: "비밀의 돌을 먼저 선택해야 합니다.",
        });
      }
      if (
        room.turnChainMinSpell !== null &&
        ((room.turnChainMode === "gte" && spell < room.turnChainMinSpell) ||
          (room.turnChainMode === "lte" && spell > room.turnChainMinSpell))
      ) {
        return socket.emit("abraca:error", {
          message: `${room.turnChainMinSpell}번 ${room.turnChainMode === "gte" ? "이상" : "이하"} 주문만 추가로 외울 수 있습니다.`,
        });
      }

      const active = room.players[room.currentTurnIndex];
      const handIndex = active.hand.findIndex((stone) => stone.value === spell);

      let roundEndReason: RoundEndReason | null = null;

      if (handIndex === -1) {
        if (spell === 1) {
          const die = rollSmallDie();
          active.hp = damage(active.hp, die);

          setResult(
            room,
            "fail",
            `실패! ${active.nickname}님 앞에 1번 돌이 없습니다. 주사위 ${die} → 생명력 ${die} 감소. 현재 생명력 ${active.hp}`,
            active.id,
            spell,
          );
        } else {
          active.hp = damage(active.hp, 1);

          setResult(
            room,
            "fail",
            `실패! ${active.nickname}님 앞에 ${spell}번 돌이 없습니다. 생명력 1 감소. 현재 생명력 ${active.hp}`,
            active.id,
            spell,
          );
        }

        if (active.hp <= 0) {
          active.hp = 0;
          active.eliminated = true;
          roundEndReason = { type: "self-destruct", playerId: active.id };
        }
      } else {
        const usedStone = active.hand.splice(handIndex, 1)[0];
        placeStoneOnBoard(room, usedStone, "used");

        if (spell === 1) {
          const die = rollSmallDie();

          room.players.forEach((p) => {
            if (p.id !== active.id && !p.eliminated) {
              p.hp = damage(p.hp, die);
            }
          });

          setResult(
            room,
            "success",
            `성공! ${active.nickname}님의 1번 ${spellNames[1]}. 주사위 ${die} → 다른 모든 플레이어 생명력 ${die} 감소.`,
            active.id,
            spell,
          );
        }

        if (spell === 2) {
          room.players.forEach((p) => {
            if (p.id !== active.id && !p.eliminated) {
              p.hp = damage(p.hp, 1);
            }
          });

          active.hp = heal(active.hp, 1);

          setResult(
            room,
            "success",
            `성공! ${active.nickname}님의 2번 ${spellNames[2]}. 다른 모든 플레이어 생명력 1 감소, 자신은 1 회복.`,
            active.id,
            spell,
          );
        }

        if (spell === 3) {
          const die = rollSmallDie();
          active.hp = heal(active.hp, die);

          setResult(
            room,
            "success",
            `성공! ${active.nickname}님의 3번 ${spellNames[3]}. 주사위 ${die} → 생명력 회복. 현재 생명력 ${active.hp}`,
            active.id,
            spell,
          );
        }

        if (spell === 4) {
          const hasSecretStone = room.secretSlots.some((slot) => slot.stone);

          if (hasSecretStone) {
            room.pendingSecretTakePlayerId = active.id;

            setResult(
              room,
              "success",
              `성공! ${active.nickname}님의 4번 ${spellNames[4]}. 게임판의 비밀의 돌 b1~b4 중 하나를 선택하세요.`,
              active.id,
              spell,
            );
          } else {
            setResult(
              room,
              "success",
              `성공! ${active.nickname}님의 4번 ${spellNames[4]}. 하지만 남은 비밀의 돌이 없습니다.`,
              active.id,
              spell,
            );
          }
        }

        if (spell === 5) {
          const targets = Array.from(
            new Set([
              leftIndex(room.currentTurnIndex, room.players.length),
              rightIndex(room.currentTurnIndex, room.players.length),
            ]),
          );

          targets.forEach((idx) => {
            const target = room.players[idx];

            if (target.id !== active.id && !target.eliminated) {
              target.hp = damage(target.hp, 1);
            }
          });

          setResult(
            room,
            "success",
            `성공! ${active.nickname}님의 5번 ${spellNames[5]}. 좌우 플레이어 생명력 1 감소.`,
            active.id,
            spell,
          );
        }

        if (spell === 6) {
          const target =
            room.players[leftIndex(room.currentTurnIndex, room.players.length)];

          if (target.id !== active.id && !target.eliminated) {
            target.hp = damage(target.hp, 1);
          }

          setResult(
            room,
            "success",
            `성공! ${active.nickname}님의 6번 ${spellNames[6]}. 왼쪽 플레이어 생명력 1 감소.`,
            active.id,
            spell,
          );
        }

        if (spell === 7) {
          const target =
            room.players[
              rightIndex(room.currentTurnIndex, room.players.length)
            ];

          if (target.id !== active.id && !target.eliminated) {
            target.hp = damage(target.hp, 1);
          }

          setResult(
            room,
            "success",
            `성공! ${active.nickname}님의 7번 ${spellNames[7]}. 오른쪽 플레이어 생명력 1 감소.`,
            active.id,
            spell,
          );
        }

        if (spell === 8) {
          active.hp = heal(active.hp, 1);

          setResult(
            room,
            "success",
            `성공! ${active.nickname}님의 8번 ${spellNames[8]}. 생명력 1 회복. 현재 생명력 ${active.hp}`,
            active.id,
            spell,
          );
        }

        room.players.forEach((p) => {
          if (p.hp <= 0) {
            p.hp = 0;
            p.eliminated = true;
          }
        });

        if (active.hand.length === 0) {
          room.players.forEach((p) => {
            if (p.id !== active.id) {
              p.hp = 0;
              p.eliminated = true;
            }
          });

          roundEndReason = { type: "empty-hand", playerId: active.id };

          addLog(
            room,
            `${active.nickname}님이 마법의 돌 5개를 연속으로 모두 사용했습니다.`,
          );
        } else {
          const someoneElseEliminated = room.players.some(
            (p) => p.id !== active.id && p.eliminated,
          );

          if (someoneElseEliminated) {
            roundEndReason = { type: "elimination", playerId: active.id };
          } else if (active.eliminated) {
            roundEndReason = { type: "self-destruct", playerId: active.id };
          }
        }

        room.turnChainMinSpell = spell;
        room.turnSuccessCount += 1;
      }

      if (roundEndReason) {
        scoreRound(room, roundEndReason);
        emitRoom(io, room);
        return;
      }

      if (handIndex === -1) {
        const failMessage = room.lastResult?.message ?? "";
        const nextPlayer = endTurn(room, active, false);

        room.lastResult = {
          type: "fail",
          playerId: active.id,
          spell,
          message: `${failMessage}\n${nextPlayer.nickname}님의 차례입니다.`,
        };
        emitRoom(io, room);
        return;
      }

      addLog(
        room,
        `${active.nickname}님은 ${spell}번 ${room.turnChainMode === "gte" ? "이상" : "이하"} 주문을 추가로 외우거나 턴을 넘길 수 있습니다.`,
      );

      emitRoom(io, room);
    });

    socket.on("disconnect", () => {
      handleDisconnect(io, socket);
    });
  });
}
