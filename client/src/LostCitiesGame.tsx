import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import {
  LOST_CITIES_COLORS,
  type LostCitiesCard,
  type LostCitiesColor,
  type LostCitiesRoomState,
  type LostCitiesScoreLine,
} from "../../shared/lostCities";

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

function cardImage(card: LostCitiesCard) {
  return card.kind === "investment"
    ? `/lost-cities/cards/${card.color}-x2.png`
    : `/lost-cities/cards/${card.color}-${card.value}.png`;
}

function fieldImage(color: LostCitiesColor) {
  return `/lost-cities/fields/${color}.png`;
}

function canViewerPlayToExpedition(
  expedition: LostCitiesCard[],
  card: LostCitiesCard,
): boolean {
  if (card.kind === "investment") {
    return expedition.every((placed) => placed.kind === "investment");
  }
  const lastNumber = [...expedition]
    .reverse()
    .find((placed) => placed.kind === "number")?.value;
  return (
    lastNumber === undefined || lastNumber === null || card.value! > lastNumber
  );
}

function estimateLine(
  color: LostCitiesColor,
  cards: LostCitiesCard[],
): LostCitiesScoreLine {
  const investmentCount = cards.filter(
    (card) => card.kind === "investment",
  ).length;
  const numberTotal = cards.reduce(
    (total, card) => total + (card.kind === "number" ? (card.value ?? 0) : 0),
    0,
  );
  const multiplier = investmentCount + 1;
  const longExpeditionBonus = cards.length >= 8 ? 20 : 0;
  return {
    color,
    numberTotal,
    investmentCount,
    multiplier,
    longExpeditionBonus,
    total:
      cards.length === 0
        ? 0
        : (numberTotal - 20) * multiplier + longExpeditionBonus,
  };
}

function scoreTotal(lines: LostCitiesScoreLine[]) {
  return lines.reduce((total, line) => total + line.total, 0);
}

function LostCitiesGame() {
  const socketRef = useRef<ReturnType<typeof io> | null>(null);
  const isRejoiningRef = useRef(false);
  const [nickname, setNickname] = useState("");
  const [roomCodeInput, setRoomCodeInput] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [room, setRoom] = useState<LostCitiesRoomState | null>(null);
  const [error, setError] = useState("");
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

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
      setSelectedCardId(null);
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

  useEffect(() => {
    if (!room) return;
    const stillInHand = room.viewerHand.some(
      (card) => card.id === selectedCardId,
    );
    if (room.turnPhase !== "play" || !stillInHand) setSelectedCardId(null);
  }, [room, selectedCardId]);

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

  function play(card: LostCitiesCard, destination: "expedition" | "discard") {
    if (!room || room.turnPhase !== "play") return;
    socketRef.current?.emit("lost-cities:card:play", {
      cardId: card.id,
      destination,
    });
  }

  function drawDeck() {
    socketRef.current?.emit("lost-cities:card:draw", { source: "deck" });
  }

  function drawDiscard(color: LostCitiesColor) {
    socketRef.current?.emit("lost-cities:card:draw", {
      source: "discard",
      color,
    });
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
              onChange={(event) =>
                setRoomCodeInput(event.target.value.toUpperCase())
              }
            />
            <button onClick={joinRoom}>참가</button>
          </div>
          {error && (
            <p className="lostCitiesError" role="alert">
              {error}
            </p>
          )}
        </section>
      </main>
    );
  }

  const viewerId = room.viewerPlayerId || playerId;
  const me = room.players.find((player) => player.id === viewerId);
  const opponent = room.players.find((player) => player.id !== viewerId);
  const connectedPlayers = room.players.filter((player) => player.connected);
  const canStart =
    room.status === "waiting" &&
    me?.isHost === true &&
    connectedPlayers.length === 2;
  const isViewerTurn =
    room.status === "playing" && room.currentTurnPlayerId === viewerId;
  const selectedCard =
    room.viewerHand.find((card) => card.id === selectedCardId) ?? null;
  const selectedLegal = selectedCard
    ? canViewerPlayToExpedition(
        me?.expeditions[selectedCard.color] ?? [],
        selectedCard,
      )
    : false;
  const viewerLines = LOST_CITIES_COLORS.map((color) =>
    estimateLine(color, me?.expeditions[color] ?? []),
  );
  const opponentLines = LOST_CITIES_COLORS.map((color) =>
    estimateLine(color, opponent?.expeditions[color] ?? []),
  );

  if (room.status === "waiting") {
    return (
      <main className="lostCitiesPage">
        <section className="lostCitiesLobby">
          <RoomHeader room={room} onLeave={leaveRoom} />
          <h1>LOST CITIES</h1>
          <p className="lostCitiesStatus">플레이어를 기다리고 있습니다.</p>
          <div className="lostCitiesPlayers" aria-label="플레이어 연결 상태">
            {room.players.map((player) => (
              <PlayerStatus
                key={player.id}
                player={player}
                viewerId={viewerId}
              />
            ))}
            {room.players.length < 2 && (
              <div className="lostCitiesPlayer lostCitiesEmpty">
                두 번째 플레이어 대기 중
              </div>
            )}
          </div>
          {me?.isHost && (
            <button
              className="lostCitiesStart"
              disabled={!canStart}
              onClick={startGame}
            >
              게임 시작
            </button>
          )}
          {error && (
            <p className="lostCitiesError" role="alert">
              {error}
            </p>
          )}
        </section>
      </main>
    );
  }

  const isFinished = room.status === "finished";
  const isAbandoned = room.status === "abandoned";

  return (
    <main className="lostCitiesPage lostCitiesBoardPage">
      <section className="lostCitiesRotateNotice">
        <div>
          <h1>LOST CITIES</h1>
          <p>더 넓은 탐험 지도가 필요합니다. 기기를 가로로 돌려주세요.</p>
          <button onClick={leaveRoom}>방 나가기</button>
        </div>
      </section>
      <section className="lostCitiesGameShell">
        <header className="lostCitiesBoardHeader">
          <div>
            <strong>{room.roomCode}</strong>
            <span>{room.lastAction}</span>
          </div>
          <div className="lostCitiesTurnState">
            {isViewerTurn
              ? "내 차례"
              : isFinished
                ? "게임 종료"
                : isAbandoned
                  ? "게임 중단"
                  : `${opponent?.nickname ?? "상대"}의 차례`}
          </div>
          <button className="lostCitiesLeave" onClick={leaveRoom}>
            나가기
          </button>
        </header>

        {error && (
          <p className="lostCitiesError lostCitiesBoardError" role="alert">
            {error}
          </p>
        )}

        <section className="lostCitiesBoard" aria-label="로스트 시티 게임 보드">
          {LOST_CITIES_COLORS.map((color) => {
            const discard = room.discardTops[color];
            const discardAvailable =
              isViewerTurn &&
              room.turnPhase === "draw" &&
              discard &&
              discard.id !== room.discardedCardIdThisTurn;
            return (
              <article
                className={`lostCitiesColumn lostCities${color[0].toUpperCase()}${color.slice(1)}`}
                key={color}
              >
                <div className="lostCitiesColumnTitle">
                  <span>{opponent?.nickname ?? "상대"}</span>
                  <b>
                    {opponentLines.find((line) => line.color === color)
                      ?.total ?? 0}
                  </b>
                </div>
                <Expedition
                  cards={opponent?.expeditions[color] ?? []}
                  label={`${color} 상대 탐험`}
                />
                <button
                  className={`lostCitiesDiscard ${discardAvailable ? "lostCitiesDiscardAvailable" : ""}`}
                  disabled={!discardAvailable}
                  aria-label={
                    discard
                      ? `${color} 버린 카드 ${room.discardCounts[color]}장`
                      : `${color} 빈 버림 더미`
                  }
                  onClick={() => drawDiscard(color)}
                >
                  <img
                    className="lostCitiesDiscardField"
                    src={fieldImage(color)}
                    alt=""
                  />
                  {discard && (
                    <img
                      className="lostCitiesDiscardCard"
                      src={cardImage(discard)}
                      alt=""
                    />
                  )}
                  {discard && (
                    <span className="lostCitiesDiscardCount">
                      {room.discardCounts[color]}
                    </span>
                  )}
                  {discardAvailable && (
                    <span className="lostCitiesDiscardHint">
                      이 카드 가져오기
                    </span>
                  )}
                </button>
                <Expedition
                  cards={me?.expeditions[color] ?? []}
                  label={`${color} 내 탐험`}
                />
                <div className="lostCitiesColumnTitle lostCitiesViewerScore">
                  <span>나</span>
                  <b>
                    {viewerLines.find((line) => line.color === color)?.total ??
                      0}
                  </b>
                </div>
              </article>
            );
          })}
        </section>

        <section className="lostCitiesControlRow" aria-label="턴 행동">
          {isViewerTurn && room.turnPhase === "play" && selectedCard && (
            <>
              <button
                disabled={!selectedLegal}
                onClick={() => play(selectedCard, "expedition")}
              >
                탐험하기
              </button>
              <button
                className="lostCitiesDiscardAction"
                onClick={() => play(selectedCard, "discard")}
              >
                버리기
              </button>
            </>
          )}
          {isViewerTurn && room.turnPhase === "draw" && (
            <>
              <p className="lostCitiesDrawPrompt">카드를 뽑으세요</p>
              <button
                className="lostCitiesDeck"
                disabled={room.drawPileCount === 0}
                onClick={drawDeck}
              >
                <img src="/lost-cities/card-back.png" alt="중앙 덱" />
                <span>덱에서 뽑기 · {room.drawPileCount}</span>
              </button>
            </>
          )}
          {!isViewerTurn && !isFinished && !isAbandoned && (
            <p>상대의 행동을 기다리는 중입니다.</p>
          )}
        </section>

        <section className="lostCitiesHand" aria-label="내 손패">
          {room.viewerHand.map((card) => (
            <button
              className={`lostCitiesHandCard ${selectedCardId === card.id ? "lostCitiesSelected" : ""}`}
              key={card.id}
              disabled={!isViewerTurn || room.turnPhase !== "play"}
              aria-pressed={selectedCardId === card.id}
              onClick={() => setSelectedCardId(card.id)}
            >
              <img
                src={cardImage(card)}
                alt={`${card.color} ${card.kind === "investment" ? "X2" : card.value}`}
              />
            </button>
          ))}
        </section>

        {(isFinished || isAbandoned) && (
          <section className="lostCitiesResultPanel">
            <h2>{isFinished ? "탐험 결과" : "게임이 중단되었습니다"}</h2>
            <p>{room.lastAction}</p>
            {isFinished &&
              room.scores &&
              room.players.map((player) => {
                const lines = room.scores?.[player.id] ?? [];
                return (
                  <ScoreCard
                    key={player.id}
                    name={player.nickname}
                    lines={lines}
                    winner={room.winnerIds.includes(player.id)}
                  />
                );
              })}
            <button onClick={leaveRoom}>방 나가기</button>
          </section>
        )}
      </section>
    </main>
  );
}

function RoomHeader({
  room,
  onLeave,
}: {
  room: LostCitiesRoomState;
  onLeave: () => void;
}) {
  return (
    <header className="lostCitiesHeader">
      <div>
        <p>방 코드</p>
        <strong>{room.roomCode}</strong>
      </div>
      <button className="lostCitiesLeave" onClick={onLeave}>
        나가기
      </button>
    </header>
  );
}

function PlayerStatus({
  player,
  viewerId,
}: {
  player: LostCitiesRoomState["players"][number];
  viewerId: string;
}) {
  return (
    <div className="lostCitiesPlayer">
      <span
        aria-label={player.connected ? "연결됨" : "연결 끊김"}
        className={`lostCitiesConnection ${player.connected ? "lostCitiesConnected" : ""}`}
      />
      <span>
        {player.nickname}
        {player.id === viewerId ? " (나)" : ""}
      </span>
      {player.isHost && <em>방장</em>}
    </div>
  );
}

function Expedition({
  cards,
  label,
}: {
  cards: LostCitiesCard[];
  label: string;
}) {
  return (
    <div className="lostCitiesExpedition" aria-label={label}>
      {cards.map((card) => (
        <img key={card.id} src={cardImage(card)} alt="" />
      ))}
    </div>
  );
}

function ScoreCard({
  name,
  lines,
  winner,
}: {
  name: string;
  lines: LostCitiesScoreLine[];
  winner: boolean;
}) {
  return (
    <div className={`lostCitiesScoreCard ${winner ? "lostCitiesWinner" : ""}`}>
      <h3>
        {winner ? "승자 · " : ""}
        {name} <b>{scoreTotal(lines)}점</b>
      </h3>
      <div>
        {lines.map((line) => (
          <span key={line.color}>
            <b>{line.color}</b>
            <small>숫자 합 {line.numberTotal} − 기본 비용 20</small>
            <small>
              × {line.multiplier} (투자 {line.investmentCount}) + 장거리{" "}
              {line.longExpeditionBonus}
            </small>
            <strong>
              = {line.total}점
              {line.total === 0 &&
              line.numberTotal === 0 &&
              line.investmentCount === 0
                ? " (미개척)"
                : ""}
            </strong>
          </span>
        ))}
      </div>
    </div>
  );
}

export default LostCitiesGame;
