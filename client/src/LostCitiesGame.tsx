import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import type { LostCitiesRoomState } from "../../shared/lostCities";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";
const ROOM_KEY = "lost_cities_room_code";
const PLAYER_KEY = "lost_cities_player_id";
const RESUME_TOKEN_KEY = "lost_cities_resume_token";

type RoomResponse = {
  roomCode: string;
  playerId: string;
  resumeToken: string;
  roomState: LostCitiesRoomState;
};

function LostCitiesGame() {
  const socketRef = useRef<ReturnType<typeof io> | null>(null);
  const isRejoiningRef = useRef(false);
  const [nickname, setNickname] = useState("");
  const [roomCodeInput, setRoomCodeInput] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [room, setRoom] = useState<LostCitiesRoomState | null>(null);
  const [error, setError] = useState("");

  function clearSession() {
    sessionStorage.removeItem(ROOM_KEY);
    sessionStorage.removeItem(PLAYER_KEY);
    sessionStorage.removeItem(RESUME_TOKEN_KEY);
  }

  useEffect(() => {
    const socket = io(SERVER_URL, { autoConnect: true });
    socketRef.current = socket;

    function handleRoom(response: RoomResponse) {
      isRejoiningRef.current = false;
      setPlayerId(response.playerId);
      setRoom(response.roomState);
      setError("");
      sessionStorage.setItem(ROOM_KEY, response.roomCode);
      sessionStorage.setItem(PLAYER_KEY, response.playerId);
      sessionStorage.setItem(RESUME_TOKEN_KEY, response.resumeToken);
    }

    function handleState(roomState: LostCitiesRoomState) {
      setRoom(roomState);
    }

    function handleLeft() {
      clearSession();
      setPlayerId("");
      setRoom(null);
      setError("");
    }

    function handleError({ message }: { message: string }) {
      if (isRejoiningRef.current) {
        isRejoiningRef.current = false;
        clearSession();
        setPlayerId("");
        setRoom(null);
      }
      setError(message);
    }

    function rejoinStoredRoom() {
      const roomCode = sessionStorage.getItem(ROOM_KEY);
      const savedPlayerId = sessionStorage.getItem(PLAYER_KEY);
      const resumeToken = sessionStorage.getItem(RESUME_TOKEN_KEY);
      if (!roomCode || !savedPlayerId || !resumeToken) return;

      isRejoiningRef.current = true;
      socket.emit("lost-cities:room:rejoin", {
        roomCode,
        playerId: savedPlayerId,
        resumeToken,
      });
    }

    socket.on("connect", rejoinStoredRoom);
    socket.on("lost-cities:room:created", handleRoom);
    socket.on("lost-cities:room:joined", handleRoom);
    socket.on("lost-cities:room:state", handleState);
    socket.on("lost-cities:room:left", handleLeft);
    socket.on("lost-cities:error", handleError);

    return () => {
      socket.off("connect", rejoinStoredRoom);
      socket.off("lost-cities:room:created", handleRoom);
      socket.off("lost-cities:room:joined", handleRoom);
      socket.off("lost-cities:room:state", handleState);
      socket.off("lost-cities:room:left", handleLeft);
      socket.off("lost-cities:error", handleError);
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  function createRoom() {
    socketRef.current?.emit("lost-cities:room:create", { nickname });
  }

  function joinRoom() {
    socketRef.current?.emit("lost-cities:room:join", {
      nickname,
      roomCode: roomCodeInput.trim().toUpperCase(),
    });
  }

  function leaveRoom() {
    socketRef.current?.emit("lost-cities:room:leave");
  }

  function startGame() {
    socketRef.current?.emit("lost-cities:game:start");
  }

  if (!room) {
    return (
      <main className="lostCitiesPage">
        <section className="lostCitiesLobby">
          <h1>LOST CITIES</h1>
          <p>닉네임을 입력하고 방을 만들거나 참가하세요.</p>
          <input
            aria-label="닉네임"
            placeholder="닉네임"
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
          />
          <div className="lostCitiesActions">
            <button onClick={createRoom}>방 만들기</button>
          </div>
          <div className="lostCitiesJoin">
            <input
              aria-label="방 코드"
              placeholder="방 코드"
              value={roomCodeInput}
              onChange={(event) => setRoomCodeInput(event.target.value.toUpperCase())}
            />
            <button onClick={joinRoom}>참가</button>
          </div>
          {error && <p className="lostCitiesError">{error}</p>}
        </section>
      </main>
    );
  }

  const connectedPlayers = room.players.filter((player) => player.connected);
  const me = room.players.find((player) => player.id === playerId);
  const canStart =
    room.status === "waiting" && me?.isHost === true && connectedPlayers.length === 2;

  return (
    <main className="lostCitiesPage">
      <section className="lostCitiesLobby">
        <header className="lostCitiesHeader">
          <div>
            <p>방 코드</p>
            <strong>{room.roomCode}</strong>
          </div>
          <button className="lostCitiesLeave" onClick={leaveRoom}>
            나가기
          </button>
        </header>
        <h1>LOST CITIES</h1>
        <p className="lostCitiesStatus">
          {room.status === "waiting" ? "플레이어를 기다리고 있습니다." : room.lastAction}
        </p>
        <div className="lostCitiesPlayers" aria-label="플레이어 연결 상태">
          {room.players.map((player) => (
            <div className="lostCitiesPlayer" key={player.id}>
              <span
                aria-label={player.connected ? "연결됨" : "연결 끊김"}
                className={`lostCitiesConnection ${player.connected ? "lostCitiesConnected" : ""}`}
              />
              <span>{player.nickname}{player.id === playerId ? " (나)" : ""}</span>
              {player.isHost && <em>방장</em>}
            </div>
          ))}
          {room.players.length < 2 && (
            <div className="lostCitiesPlayer lostCitiesEmpty">두 번째 플레이어 대기 중</div>
          )}
        </div>
        {room.status === "waiting" && me?.isHost && (
          <button className="lostCitiesStart" disabled={!canStart} onClick={startGame}>
            게임 시작
          </button>
        )}
        {error && <p className="lostCitiesError">{error}</p>}
      </section>
    </main>
  );
}

export default LostCitiesGame;
