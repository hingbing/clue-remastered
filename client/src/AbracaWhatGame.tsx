import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";
const socket = io(SERVER_URL, { autoConnect: true });

type SpellNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

type PublicStone = {
  id: string;
  value: SpellNumber | null;
  origin: "deck" | "secret";
};

type PublicPlayer = {
  id: string;
  nickname: string;
  color: string;
  hp: number;
  score: number;
  hand: PublicStone[];
  secretStones: PublicStone[];
  connected: boolean;
  isHost: boolean;
  eliminated: boolean;
};

type AbracaRoomState = {
  roomCode: string;
  status: "waiting" | "playing" | "round-end" | "game-over";
  players: PublicPlayer[];
  currentTurnPlayerId: string | null;
  round: number;
  drawPileCount: number;
  secretPileCount: number;
  discardPileCount: number;
  logs: string[];
  roundSummary: string[];
  winnerIds: string[];
};

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

const spellDescriptions: Record<SpellNumber, string> = {
  1: "주사위를 굴려 다른 모든 플레이어에게 그 수만큼 피해",
  2: "다른 모든 플레이어 생명력 1 감소, 나는 1 회복",
  3: "주사위를 굴려 그 수만큼 회복, 최대 3",
  4: "비밀의 돌 1개 획득",
  5: "왼쪽과 오른쪽 플레이어 생명력 1 감소",
  6: "왼쪽 플레이어 생명력 1 감소",
  7: "오른쪽 플레이어 생명력 1 감소",
  8: "내 생명력 1 회복",
};

const stoneImages: Record<SpellNumber, string> = {
  1: "/stones/1.png",
  2: "/stones/2.png",
  3: "/stones/3.png",
  4: "/stones/4.png",
  5: "/stones/5.png",
  6: "/stones/6.png",
  7: "/stones/7.png",
  8: "/stones/8.png",
};

const STONE_BACK_IMAGE = "/stones/back.png";

function StoneCard({ stone }: { stone: PublicStone }) {
  const hidden = stone.value === null;
  const src = hidden ? STONE_BACK_IMAGE : stoneImages[stone.value];

  return (
    <div className="abracaStone">
      <img src={src} alt={hidden ? "마법의 돌 뒷면" : `${stone.value}번 돌`} />
      <div className="abracaStoneMeta">
        <b>{hidden ? "?" : `${stone.value}번`}</b>
        <span>{hidden ? "숨김" : spellNames[stone.value]}</span>
      </div>
    </div>
  );
}

function AbracaWhatGame() {
  const [nickname, setNickname] = useState("");
  const [roomCodeInput, setRoomCodeInput] = useState("");
  const [playerId, setPlayerId] = useState(
    sessionStorage.getItem("abraca_player_id") || "",
  );
  const [roomCode, setRoomCode] = useState(
    sessionStorage.getItem("abraca_room_code") || "",
  );
  const [room, setRoom] = useState<AbracaRoomState | null>(null);
  const [error, setError] = useState("");
  const didRejoinRef = useRef(false);
  const [showLogs, setShowLogs] = useState(false);
  const me = useMemo(
    () => room?.players.find((p) => p.id === playerId) ?? null,
    [room, playerId],
  );

  const currentPlayer = useMemo(
    () => room?.players.find((p) => p.id === room.currentTurnPlayerId) ?? null,
    [room],
  );
  const latestLog = room?.logs?.[room.logs.length - 1] ?? "";
  const previousLog = room?.logs?.[room.logs.length - 2] ?? "";

  const isMyTurn =
    !!room &&
    room.status === "playing" &&
    room.currentTurnPlayerId === playerId &&
    !me?.eliminated;

  useEffect(() => {
    function handleCreated({ roomCode, playerId, roomState }: any) {
      setRoomCode(roomCode);
      setPlayerId(playerId);
      setRoom(roomState);
      setError("");

      sessionStorage.setItem("abraca_room_code", roomCode);
      sessionStorage.setItem("abraca_player_id", playerId);
    }

    function handleJoined({ roomCode, playerId, roomState }: any) {
      setRoomCode(roomCode);
      setPlayerId(playerId);
      setRoom(roomState);
      setError("");

      sessionStorage.setItem("abraca_room_code", roomCode);
      sessionStorage.setItem("abraca_player_id", playerId);
    }

    function handleState(roomState: AbracaRoomState) {
      setRoom(roomState);
    }

    function handleLeft() {
      sessionStorage.removeItem("abraca_room_code");
      sessionStorage.removeItem("abraca_player_id");
      setRoom(null);
      setRoomCode("");
      setPlayerId("");
      setError("");
    }

    function handleError({ message }: { message: string }) {
      setError(message);
    }

    socket.on("abraca:room:created", handleCreated);
    socket.on("abraca:room:joined", handleJoined);
    socket.on("abraca:room:state", handleState);
    socket.on("abraca:room:left", handleLeft);
    socket.on("abraca:error", handleError);

    if (!didRejoinRef.current) {
      didRejoinRef.current = true;

      const savedRoom = sessionStorage.getItem("abraca_room_code");
      const savedPlayer = sessionStorage.getItem("abraca_player_id");

      if (savedRoom && savedPlayer) {
        socket.emit("abraca:room:rejoin", {
          roomCode: savedRoom,
          playerId: savedPlayer,
        });
      }
    }

    return () => {
      socket.off("abraca:room:created", handleCreated);
      socket.off("abraca:room:joined", handleJoined);
      socket.off("abraca:room:state", handleState);
      socket.off("abraca:room:left", handleLeft);
      socket.off("abraca:error", handleError);
    };
  }, []);

  function createRoom() {
    socket.emit("abraca:room:create", { nickname });
  }

  function joinRoom() {
    socket.emit("abraca:room:join", {
      nickname,
      roomCode: roomCodeInput.trim().toUpperCase(),
    });
  }

  function leaveRoom() {
    socket.emit("abraca:room:leave");
  }

  function startGame() {
    socket.emit("abraca:game:start");
  }

  function castSpell(spell: SpellNumber) {
    socket.emit("abraca:spell:cast", { spell });
  }

  if (!room) {
    return (
      <main className="landing">
        <section className="hero">
          <h1>ABRACA WHAT</h1>
          <p>실시간 멀티플레이 마법 추리 게임</p>

          <input
            placeholder="닉네임"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
          />

          <div className="row">
            <button onClick={createRoom}>방 만들기</button>
          </div>

          <div className="join">
            <input
              placeholder="방 코드"
              value={roomCodeInput}
              onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
            />
            <button onClick={joinRoom}>참가</button>
          </div>

          {error && <p className="error">{error}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="abracaWrap">
      <header className="abracaTopbar">
        <div>
          <h1>ABRACA WHAT</h1>
          <p>
            방 코드 <b className="code">{room.roomCode}</b>
          </p>
          <p>
            라운드 {room.round} ·{" "}
            {room.status === "waiting"
              ? "대기실"
              : currentPlayer
                ? `현재 차례: ${currentPlayer.nickname}`
                : ""}
          </p>
        </div>

        <div className="abracaTopbarActions">
          {room.status === "waiting" && me?.isHost && (
            <button onClick={startGame}>게임 시작</button>
          )}
          <button className="secondary" onClick={leaveRoom}>
            방 나가기
          </button>
        </div>
      </header>

      <section className="abracaLatestPanel">
        <div>
          <span className="abracaLatestLabel">최근 결과</span>
          <p>{latestLog || "아직 진행된 행동이 없습니다."}</p>
          {previousLog && <small>{previousLog}</small>}
        </div>
      </section>

      {error && <div className="toast">{error}</div>}

      <section className="abracaScoreBoard">
        <h2>점수판</h2>
        <div className="abracaScoreTrack">
          {Array.from({ length: 9 }).map((_, score) => (
            <div key={score} className="abracaScoreCell">
              <b>{score}</b>
              <div className="abracaScoreTokens">
                {room.players
                  .filter((p) => p.score === score)
                  .map((p) => (
                    <span
                      key={p.id}
                      className="abracaToken"
                      style={{ background: p.color }}
                      title={p.nickname}
                    />
                  ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="abracaBoardStats">
        <div className="abracaStatCard">
          <h3>마법의 돌</h3>
          <p>뽑을 돌: {room.drawPileCount}</p>
          <p>사용한 돌: {room.discardPileCount}</p>
        </div>

        <div className="abracaStatCard">
          <h3>비밀의 돌</h3>
          <p>남은 비밀의 돌: {room.secretPileCount}</p>
        </div>
      </section>

      {room.status === "playing" && (
        <section className="abracaActionPanel">
          <div className="abracaActionHead">
            <div>
              <h2>주문 외우기</h2>
              <p>
                현재 차례: <b>{currentPlayer?.nickname}</b>
              </p>
            </div>

            <div className={isMyTurn ? "abracaTurnMine" : "abracaTurnWait"}>
              {isMyTurn ? "내 차례입니다" : "상대 차례 대기중"}
            </div>
          </div>

          <div className="abracaSpellGrid">
            {([1, 2, 3, 4, 5, 6, 7, 8] as SpellNumber[]).map((spell) => (
              <button
                key={spell}
                className="abracaSpellButton"
                disabled={!isMyTurn}
                onClick={() => castSpell(spell)}
              >
                <b>
                  {spell}. {spellNames[spell]}
                </b>
                <span>{spellDescriptions[spell]}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="abracaPlayers">
        {room.players.map((player) => (
          <article
            key={player.id}
            className={`abracaPlayerCard ${
              player.id === room.currentTurnPlayerId ? "current" : ""
            } ${player.eliminated ? "dead" : ""}`}
          >
            <div className="abracaPlayerHead">
              <div className="abracaIdentity">
                <span
                  className="abracaColorDot"
                  style={{ background: player.color }}
                />
                <div>
                  <h3>
                    {player.nickname} {player.id === playerId ? "(나)" : ""}
                  </h3>
                  <p>
                    생명력 {player.hp}/6 · 점수 {player.score}점{" "}
                    {!player.connected ? "· 재접속 대기" : ""}
                  </p>
                </div>
              </div>

              {player.id === room.currentTurnPlayerId && (
                <span className="abracaCurrentBadge">현재 차례</span>
              )}
            </div>

            <div className="abracaSection">
              <h4>마법의 돌</h4>
              <div className="abracaStoneRow">
                {player.hand.map((stone) => (
                  <StoneCard key={stone.id} stone={stone} />
                ))}
              </div>
            </div>

            <div className="abracaSection">
              <h4>획득한 비밀의 돌</h4>
              <div className="abracaStoneRow">
                {player.secretStones.length === 0 && (
                  <p className="hint">없음</p>
                )}
                {player.secretStones.map((stone) => (
                  <StoneCard key={stone.id} stone={stone} />
                ))}
              </div>
            </div>
          </article>
        ))}
      </section>

      {(room.status === "round-end" || room.status === "game-over") && (
        <section className="abracaRoundEnd">
          <h2>{room.status === "game-over" ? "게임 종료" : "라운드 종료"}</h2>

          {room.winnerIds.length > 0 && (
            <p className="abracaWinner">
              승리:{" "}
              {room.players
                .filter((p) => room.winnerIds.includes(p.id))
                .map((p) => p.nickname)
                .join(", ")}
            </p>
          )}

          <div className="abracaSummary">
            <h3>점수 정산</h3>
            {room.roundSummary.map((line, index) => (
              <p key={index}>{line}</p>
            ))}
          </div>

          {room.status === "round-end" && me?.isHost && (
            <button onClick={() => socket.emit("abraca:game:next-round")}>
              다음 라운드 시작
            </button>
          )}
        </section>
      )}

      <section className="abracaLogPanel">
        <div className="abracaLogHeader">
          <h2>전체 로그</h2>
          <button className="secondary" onClick={() => setShowLogs((v) => !v)}>
            {showLogs ? "접기" : "펼치기"}
          </button>
        </div>

        {showLogs && (
          <div className="abracaLogList">
            {[...room.logs].reverse().map((log, index) => (
              <p key={`${index}-${log}`}>{log}</p>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

export default AbracaWhatGame;
