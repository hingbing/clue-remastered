import assert from "node:assert/strict";
import http from "node:http";
import { afterEach, beforeEach, test } from "node:test";
import { AddressInfo } from "node:net";
import { Server } from "socket.io";
import { io as createClient, type Socket as ClientSocket } from "socket.io-client";
import type { LostCitiesRoomState } from "../../shared/lostCities.js";
import { registerLostCities } from "./lostCities.js";

type RoomResponse = {
  roomCode: string;
  playerId: string;
  roomState: LostCitiesRoomState;
};

let httpServer: http.Server;
let io: Server;
let serverUrl: string;
const clients: ClientSocket[] = [];

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
  httpServer = http.createServer();
  io = new Server(httpServer);
  registerLostCities(io);
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address() as AddressInfo;
  serverUrl = `http://127.0.0.1:${address.port}`;
});

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
