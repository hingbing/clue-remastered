import assert from "node:assert/strict";
import http from "node:http";
import { afterEach, beforeEach, test } from "node:test";
import { AddressInfo } from "node:net";
import { Server } from "socket.io";
import { io as createClient, type Socket as ClientSocket } from "socket.io-client";
import {
  LOST_CITIES_COLORS,
  type LostCitiesCard,
  type LostCitiesColor,
  type LostCitiesRoomState,
} from "../../shared/lostCities.js";
import { lostCitiesTestApi, registerLostCities } from "./lostCities.js";

type RoomResponse = {
  roomCode: string;
  playerId: string;
  resumeToken: string;
  roomState: LostCitiesRoomState;
};

let httpServer: http.Server;
let io: Server;
let serverUrl: string;
const clients: ClientSocket[] = [];

function numberCard(
  color: LostCitiesColor,
  value: number,
): LostCitiesCard {
  return {
    id: `${color}-number-${value}`,
    color,
    kind: "number",
    value,
  };
}

function emptyExpeditions(): Record<LostCitiesColor, LostCitiesCard[]> {
  return {
    yellow: [],
    white: [],
    blue: [],
    green: [],
    red: [],
    purple: [],
  };
}

function waitFor<T>(
  socket: ClientSocket,
  event: string,
  matches: (payload: T) => boolean = () => true,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const onEvent = (payload: T) => {
      if (!matches(payload)) return;
      clearTimeout(timeout);
      socket.off(event, onEvent);
      resolve(payload);
    };
    const timeout = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`Timed out waiting for ${event}`));
    }, 2_000);

    socket.on(event, onEvent);
  });
}

async function emitAndWait<T>(
  socket: ClientSocket,
  emitEvent: string,
  payload: unknown,
  responseEvent: string,
): Promise<T> {
  const response = waitFor<T>(socket, responseEvent);
  socket.emit(emitEvent, payload);
  return response;
}

async function connectClient(): Promise<ClientSocket> {
  const socket = createClient(serverUrl, {
    transports: ["websocket"],
    forceNew: true,
  });
  clients.push(socket);
  await waitFor(socket, "connect");
  return socket;
}

beforeEach(async () => {
  lostCitiesTestApi.reset();
  httpServer = http.createServer();
  io = new Server(httpServer);
  registerLostCities(io);
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address() as AddressInfo;
  serverUrl = `http://127.0.0.1:${address.port}`;
});

async function seedTurnRoom(options: {
  currentHand?: LostCitiesCard[];
  opponentHand?: LostCitiesCard[];
  currentExpeditions?: Record<LostCitiesColor, LostCitiesCard[]>;
  drawPile?: LostCitiesCard[];
  discards?: Record<LostCitiesColor, LostCitiesCard[]>;
  turnPhase?: "play" | "draw";
  discardedCardIdThisTurn?: string | null;
} = {}) {
  const current = await connectClient();
  const opponent = await connectClient();
  const currentHand =
    options.currentHand ??
    [
      numberCard("yellow", 2),
      numberCard("white", 2),
      numberCard("blue", 2),
      numberCard("green", 2),
      numberCard("red", 2),
      numberCard("purple", 2),
      numberCard("yellow", 3),
      numberCard("white", 3),
    ];
  const opponentHand =
    options.opponentHand ??
    [
      numberCard("blue", 3),
      numberCard("green", 3),
      numberCard("red", 3),
      numberCard("purple", 3),
      numberCard("yellow", 4),
      numberCard("white", 4),
      numberCard("blue", 4),
      numberCard("green", 4),
    ];

  lostCitiesTestApi.seedRoom({
    roomCode: "TURN01",
    status: "playing",
    players: [
      {
        id: "player-a",
        resumeToken: "resume-token-a",
        socketId: current.id!,
        nickname: "A",
        isHost: true,
        connected: true,
        hand: currentHand,
        expeditions: options.currentExpeditions ?? emptyExpeditions(),
      },
      {
        id: "player-b",
        resumeToken: "resume-token-b",
        socketId: opponent.id!,
        nickname: "B",
        isHost: false,
        connected: true,
        hand: opponentHand,
        expeditions: emptyExpeditions(),
      },
    ],
    drawPile: options.drawPile ?? [numberCard("red", 10)],
    discards: options.discards ?? emptyExpeditions(),
    currentTurnPlayerId: "player-a",
    turnPhase: options.turnPhase ?? "play",
    discardedCardIdThisTurn: options.discardedCardIdThisTurn ?? null,
    lastAction: "A님의 차례입니다.",
    scores: null,
    winnerIds: [],
  });

  return { current, opponent, currentHand, opponentHand };
}

afterEach(async () => {
  for (const socket of clients.splice(0)) socket.disconnect();
  await new Promise<void>((resolve) => io.close(() => resolve()));
});

test("host creates a room and second player joins by code", async () => {
  const host = await connectClient();
  const guest = await connectClient();

  const created = await emitAndWait<RoomResponse>(
    host,
    "lost-cities:room:create",
    { nickname: "  A  " },
    "lost-cities:room:created",
  );
  const joined = await emitAndWait<RoomResponse>(
    guest,
    "lost-cities:room:join",
    { nickname: "B", roomCode: created.roomCode.toLowerCase() },
    "lost-cities:room:joined",
  );

  assert.match(created.roomCode, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  assert.match(created.resumeToken, /^[0-9a-f]{64}$/);
  assert.match(joined.resumeToken, /^[0-9a-f]{64}$/);
  assert.notEqual(created.resumeToken, joined.resumeToken);
  assert.equal(JSON.stringify(created.roomState).includes(created.resumeToken), false);
  assert.equal(JSON.stringify(joined.roomState).includes(joined.resumeToken), false);
  assert.equal(created.roomState.players[0].nickname, "A");
  assert.equal(joined.roomState.players.length, 2);
});

test("nicknames are trimmed and limited to twenty characters", async () => {
  const host = await connectClient();
  const created = await emitAndWait<RoomResponse>(
    host,
    "lost-cities:room:create",
    { nickname: "  12345678901234567890extra  " },
    "lost-cities:room:created",
  );

  assert.equal(created.roomState.players[0].nickname, "12345678901234567890");
});

test("a socket already in a room cannot create another room", async () => {
  const host = await connectClient();
  await emitAndWait<RoomResponse>(
    host,
    "lost-cities:room:create",
    { nickname: "A" },
    "lost-cities:room:created",
  );

  const error = await emitAndWait<{ message: string }>(
    host,
    "lost-cities:room:create",
    { nickname: "A2" },
    "lost-cities:error",
  );

  assert.ok(error.message);
});

test("a socket already in a room cannot join a room again", async () => {
  const host = await connectClient();
  const created = await emitAndWait<RoomResponse>(
    host,
    "lost-cities:room:create",
    { nickname: "A" },
    "lost-cities:room:created",
  );

  const error = await emitAndWait<{ message: string }>(
    host,
    "lost-cities:room:join",
    { nickname: "A2", roomCode: created.roomCode },
    "lost-cities:error",
  );

  assert.ok(error.message);
});

test("null create and join payloads return protocol errors", async () => {
  const createClientSocket = await connectClient();
  const joinClientSocket = await connectClient();

  const createError = await emitAndWait<{ message: string }>(
    createClientSocket,
    "lost-cities:room:create",
    null,
    "lost-cities:error",
  );
  const joinError = await emitAndWait<{ message: string }>(
    joinClientSocket,
    "lost-cities:room:join",
    null,
    "lost-cities:error",
  );

  assert.ok(createError.message);
  assert.ok(joinError.message);
});

test("a third player cannot join a two-player room", async () => {
  const host = await connectClient();
  const guest = await connectClient();
  const third = await connectClient();
  const created = await emitAndWait<RoomResponse>(
    host,
    "lost-cities:room:create",
    { nickname: "A" },
    "lost-cities:room:created",
  );
  await emitAndWait<RoomResponse>(
    guest,
    "lost-cities:room:join",
    { nickname: "B", roomCode: created.roomCode },
    "lost-cities:room:joined",
  );

  const error = await emitAndWait<{ message: string }>(
    third,
    "lost-cities:room:join",
    { nickname: "C", roomCode: created.roomCode },
    "lost-cities:error",
  );

  assert.ok(error.message);
});

test("only the host can start the game", async () => {
  const host = await connectClient();
  const guest = await connectClient();
  const created = await emitAndWait<RoomResponse>(
    host,
    "lost-cities:room:create",
    { nickname: "A" },
    "lost-cities:room:created",
  );
  await emitAndWait<RoomResponse>(
    guest,
    "lost-cities:room:join",
    { nickname: "B", roomCode: created.roomCode },
    "lost-cities:room:joined",
  );

  const error = await emitAndWait<{ message: string }>(
    guest,
    "lost-cities:game:start",
    undefined,
    "lost-cities:error",
  );

  assert.ok(error.message);
});

test("starting deals private eight-card hands without revealing the opponent hand", async () => {
  const host = await connectClient();
  const guest = await connectClient();
  const created = await emitAndWait<RoomResponse>(
    host,
    "lost-cities:room:create",
    { nickname: "A" },
    "lost-cities:room:created",
  );
  const joined = await emitAndWait<RoomResponse>(
    guest,
    "lost-cities:room:join",
    { nickname: "B", roomCode: created.roomCode },
    "lost-cities:room:joined",
  );

  const hostStatePromise = waitFor<LostCitiesRoomState>(
    host,
    "lost-cities:room:state",
    (state) => state.status === "playing",
  );
  const guestStatePromise = waitFor<LostCitiesRoomState>(
    guest,
    "lost-cities:room:state",
    (state) => state.status === "playing",
  );
  host.emit("lost-cities:game:start");
  const [hostState, guestState] = await Promise.all([
    hostStatePromise,
    guestStatePromise,
  ]);

  assert.equal(hostState.status, "playing");
  assert.equal(hostState.viewerPlayerId, created.playerId);
  assert.equal(guestState.viewerPlayerId, joined.playerId);
  assert.equal(hostState.viewerHand.length, 8);
  assert.equal(guestState.viewerHand.length, 8);
  assert.deepEqual(
    hostState.players.map((player) => player.handCount),
    [8, 8],
  );
  assert.equal(
    hostState.players.some((player) => "hand" in player),
    false,
  );
  assert.equal(
    guestState.viewerHand.some((card) =>
      hostState.viewerHand.some((hostCard) => hostCard.id === card.id),
    ),
    false,
  );
  for (const opponentCard of guestState.viewerHand) {
    assert.equal(JSON.stringify(hostState).includes(opponentCard.id), false);
  }
});

test("a player cannot draw during the play phase", async () => {
  const { current } = await seedTurnRoom();
  const before = structuredClone(lostCitiesTestApi.getRoom("TURN01"));

  const response = await emitAndWait<{ message: string }>(
    current,
    "lost-cities:card:draw",
    { source: "deck" },
    "lost-cities:error",
  );

  assert.ok(response.message);
  assert.deepEqual(lostCitiesTestApi.getRoom("TURN01"), before);
});

test("a player cannot play twice in one turn", async () => {
  const { current, currentHand } = await seedTurnRoom();
  const drawState = waitFor<LostCitiesRoomState>(
    current,
    "lost-cities:room:state",
    (state) => state.turnPhase === "draw",
  );
  current.emit("lost-cities:card:play", {
    cardId: currentHand[0].id,
    destination: "expedition",
  });
  await drawState;
  const afterFirstPlay = structuredClone(lostCitiesTestApi.getRoom("TURN01"));

  const response = await emitAndWait<{ message: string }>(
    current,
    "lost-cities:card:play",
    { cardId: currentHand[1].id, destination: "discard" },
    "lost-cities:error",
  );

  assert.ok(response.message);
  assert.deepEqual(lostCitiesTestApi.getRoom("TURN01"), afterFirstPlay);
});

test("an illegal expedition play leaves room state unchanged", async () => {
  const expeditions = emptyExpeditions();
  expeditions.yellow = [numberCard("yellow", 5)];
  const illegalCard = numberCard("yellow", 4);
  const { current } = await seedTurnRoom({
    currentHand: [
      illegalCard,
      numberCard("white", 2),
      numberCard("blue", 2),
      numberCard("green", 2),
      numberCard("red", 2),
      numberCard("purple", 2),
      numberCard("yellow", 6),
      numberCard("white", 3),
    ],
    currentExpeditions: expeditions,
  });
  const before = structuredClone(lostCitiesTestApi.getRoom("TURN01"));

  const response = await emitAndWait<{ message: string }>(
    current,
    "lost-cities:card:play",
    { cardId: illegalCard.id, destination: "expedition" },
    "lost-cities:error",
  );

  assert.ok(response.message);
  assert.deepEqual(lostCitiesTestApi.getRoom("TURN01"), before);
});

test("a legal play removes the card and changes the phase to draw", async () => {
  const { current, currentHand } = await seedTurnRoom();
  const playedCard = currentHand[0];

  const state = await emitAndWait<LostCitiesRoomState>(
    current,
    "lost-cities:card:play",
    { cardId: playedCard.id, destination: "expedition" },
    "lost-cities:room:state",
  );

  assert.equal(state.turnPhase, "draw");
  assert.equal(state.viewerHand.length, 7);
  assert.deepEqual(state.players[0].expeditions.yellow, [playedCard]);
});

test("a legal draw restores eight cards and passes the turn", async () => {
  const hand = [
    numberCard("yellow", 2),
    numberCard("white", 2),
    numberCard("blue", 2),
    numberCard("green", 2),
    numberCard("red", 2),
    numberCard("purple", 2),
    numberCard("yellow", 3),
  ];
  const drawnCard = numberCard("red", 10);
  const { current } = await seedTurnRoom({
    currentHand: hand,
    drawPile: [numberCard("blue", 10), drawnCard],
    turnPhase: "draw",
  });

  const state = await emitAndWait<LostCitiesRoomState>(
    current,
    "lost-cities:card:draw",
    { source: "deck" },
    "lost-cities:room:state",
  );

  assert.equal(state.viewerHand.length, 8);
  assert.equal(state.viewerHand.at(-1)?.id, drawnCard.id);
  assert.equal(state.currentTurnPlayerId, "player-b");
  assert.equal(state.turnPhase, "play");
});

test("a player cannot draw the exact card discarded this turn", async () => {
  const discarded = numberCard("yellow", 2);
  const discards = Object.fromEntries(
    LOST_CITIES_COLORS.map((color) => [
      color,
      color === "yellow" ? [discarded] : [],
    ]),
  ) as Record<LostCitiesColor, LostCitiesCard[]>;
  const { current } = await seedTurnRoom({
    currentHand: [
      numberCard("white", 2),
      numberCard("blue", 2),
      numberCard("green", 2),
      numberCard("red", 2),
      numberCard("purple", 2),
      numberCard("yellow", 3),
      numberCard("white", 3),
    ],
    discards,
    turnPhase: "draw",
    discardedCardIdThisTurn: discarded.id,
  });
  const before = structuredClone(lostCitiesTestApi.getRoom("TURN01"));

  const response = await emitAndWait<{ message: string }>(
    current,
    "lost-cities:card:draw",
    { source: "discard", color: "yellow" },
    "lost-cities:error",
  );

  assert.ok(response.message);
  assert.deepEqual(lostCitiesTestApi.getRoom("TURN01"), before);
});

test("drawing from an empty discard pile is rejected", async () => {
  const { current } = await seedTurnRoom({ turnPhase: "draw" });
  const before = structuredClone(lostCitiesTestApi.getRoom("TURN01"));

  const response = await emitAndWait<{ message: string }>(
    current,
    "lost-cities:card:draw",
    { source: "discard", color: "blue" },
    "lost-cities:error",
  );

  assert.ok(response.message);
  assert.deepEqual(lostCitiesTestApi.getRoom("TURN01"), before);
});

test("drawing the last deck card finishes the game and preserves tied winners", async () => {
  const finalCard = numberCard("red", 10);
  const { current } = await seedTurnRoom({
    currentHand: [
      numberCard("yellow", 2),
      numberCard("white", 2),
      numberCard("blue", 2),
      numberCard("green", 2),
      numberCard("red", 2),
      numberCard("purple", 2),
      numberCard("yellow", 3),
    ],
    drawPile: [finalCard],
    turnPhase: "draw",
  });

  const state = await emitAndWait<LostCitiesRoomState>(
    current,
    "lost-cities:card:draw",
    { source: "deck" },
    "lost-cities:room:state",
  );

  assert.equal(state.status, "finished");
  assert.equal(state.drawPileCount, 0);
  assert.ok(state.scores);
  assert.deepEqual(state.winnerIds.sort(), ["player-a", "player-b"]);
});

test("disconnect marks a player disconnected without deleting the room", async () => {
  const { current, opponent } = await seedTurnRoom();
  const disconnectedState = waitFor<LostCitiesRoomState>(
    opponent,
    "lost-cities:room:state",
    (state) =>
      state.players.some(
        (player) => player.id === "player-a" && !player.connected,
      ),
  );

  current.disconnect();
  await disconnectedState;

  const room = lostCitiesTestApi.getRoom("TURN01");
  assert.ok(room);
  assert.equal(room.players[0].connected, false);
  assert.equal(room.players[0].socketId, null);
});

test("rejoin replaces the socket and returns the saved private hand", async () => {
  const { current, opponent, currentHand } = await seedTurnRoom();
  const disconnectedState = waitFor<LostCitiesRoomState>(
    opponent,
    "lost-cities:room:state",
    (state) =>
      state.players.some(
        (player) => player.id === "player-a" && !player.connected,
      ),
  );
  current.disconnect();
  await disconnectedState;
  const replacement = await connectClient();

  const state = await emitAndWait<LostCitiesRoomState>(
    replacement,
    "lost-cities:room:rejoin",
    {
      roomCode: "turn01",
      playerId: "player-a",
      resumeToken: "resume-token-a",
    },
    "lost-cities:room:state",
  );

  assert.equal(state.viewerPlayerId, "player-a");
  assert.deepEqual(state.viewerHand, currentHand);
  assert.equal(
    state.players.find((player) => player.id === "player-a")?.connected,
    true,
  );
  assert.equal(
    lostCitiesTestApi.getRoom("TURN01")?.players[0].socketId,
    replacement.id,
  );
});

test("a player credential cannot impersonate the opponent on rejoin", async () => {
  const { opponent } = await seedTurnRoom();
  const attacker = await connectClient();
  const opponentSocketId = opponent.id;
  const before = structuredClone(lostCitiesTestApi.getRoom("TURN01"));

  const response = await emitAndWait<{ message: string }>(
    attacker,
    "lost-cities:room:rejoin",
    {
      roomCode: "TURN01",
      playerId: "player-b",
      resumeToken: "resume-token-a",
    },
    "lost-cities:error",
  );

  assert.ok(response.message);
  assert.equal(
    lostCitiesTestApi.getRoom("TURN01")?.players[1].socketId,
    opponentSocketId,
  );
  assert.deepEqual(lostCitiesTestApi.getRoom("TURN01"), before);
});

test("an invalid credential cannot claim a disconnected player", async () => {
  const { current, opponent } = await seedTurnRoom();
  const disconnectedState = waitFor<LostCitiesRoomState>(
    opponent,
    "lost-cities:room:state",
    (state) =>
      state.players.some(
        (player) => player.id === "player-a" && !player.connected,
      ),
  );
  current.disconnect();
  await disconnectedState;
  const attacker = await connectClient();
  const before = structuredClone(lostCitiesTestApi.getRoom("TURN01"));

  const response = await emitAndWait<{ message: string }>(
    attacker,
    "lost-cities:room:rejoin",
    {
      roomCode: "TURN01",
      playerId: "player-a",
      resumeToken: "invalid-token",
    },
    "lost-cities:error",
  );

  assert.ok(response.message);
  assert.deepEqual(lostCitiesTestApi.getRoom("TURN01"), before);
});

test("explicit leave abandons an active game and informs the remaining player", async () => {
  const { current, opponent } = await seedTurnRoom();
  const left = waitFor(current, "lost-cities:room:left");
  const abandonedState = waitFor<LostCitiesRoomState>(
    opponent,
    "lost-cities:room:state",
    (state) => state.status === "abandoned",
  );

  current.emit("lost-cities:room:leave");
  const [, state] = await Promise.all([left, abandonedState]);

  assert.equal(state.status, "abandoned");
  assert.match(state.lastAction, /나갔습니다/);
  assert.equal(state.viewerPlayerId, "player-b");
});
