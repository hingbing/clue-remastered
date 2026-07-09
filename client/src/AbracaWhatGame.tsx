import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";

type SpellNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
type TurnChainMode = "gte" | "lte";

type PublicStone = {
  id: string;
  value: SpellNumber | null;
  origin: "deck" | "secret";
};

type PublicBoardSlot = {
  id: string;
  spell: SpellNumber;
  slotIndex: number;
  source: "setup" | "used" | null;
  stone: PublicStone | null;
};

type PublicSecretSlot = {
  id: string;
  slotIndex: number;
  stone: PublicStone | null;
};

type PublicPlayer = {
  id: string;
  nickname: string;
  color: string;
  hp: number;
  score: number;
  connected: boolean;
  isHost: boolean;
  eliminated: boolean;
  hand: PublicStone[];
  secretStones: PublicStone[];
};

type LastResult = {
  type: "success" | "fail" | "pass" | "round-end" | "info";
  playerId?: string;
  spell?: SpellNumber;
  message: string;
};

type RoomState = {
  roomCode: string;
  status: "waiting" | "playing" | "round-end" | "game-over";
  players: PublicPlayer[];
  boardSlots?: PublicBoardSlot[];
  secretSlots?: PublicSecretSlot[];
  currentTurnPlayerId: string | null;
  round: number;
  drawPileCount: number;
  secretPileCount: number;
  logs: string[];
  roundSummary: string[];
  winnerIds: string[];
  lastResult: LastResult | null;
  turnChainMinSpell: SpellNumber | null;
  turnChainMode: TurnChainMode;
  turnSuccessCount: number;
  pendingSecretTakePlayerId?: string | null;
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
  1: "주사위 수만큼 다른 모든 플레이어에게 피해. 실패 시 주사위 수만큼 자해.",
  2: "다른 모든 플레이어 생명력 1 감소, 나는 1 회복.",
  3: "주사위를 굴려 그 수만큼 회복. 최대 생명력 6.",
  4: "비밀의 돌 1개를 가져온다. 라운드 종료 시 추가 점수.",
  5: "왼쪽과 오른쪽 플레이어 생명력 1 감소.",
  6: "왼쪽 플레이어 생명력 1 감소.",
  7: "오른쪽 플레이어 생명력 1 감소.",
  8: "내 생명력 1 회복.",
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

const BACK_IMAGE = "/stones/back.png";

function StoneCard({
  stone,
  small = false,
}: {
  stone: PublicStone;
  small?: boolean;
}) {
  if (stone.value === null) {
    return (
      <div className={small ? "abracaMiniStone" : "abracaStone"}>
        <img src={BACK_IMAGE} alt="마법의 돌 뒷면" />
        {!small && (
          <div className="abracaStoneMeta">
            <b>?</b>
            <span>숨김</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={small ? "abracaMiniStone" : "abracaStone"}>
      <img src={stoneImages[stone.value]} alt={`${stone.value}번 돌`} />
      {!small && (
        <div className="abracaStoneMeta">
          <b>{stone.value}번</b>
          <span>{spellNames[stone.value]}</span>
        </div>
      )}
    </div>
  );
}

function AbracaBoard({
  boardSlots = [],
  secretSlots = [],
  selectSecretStone,
  canSelectSecretStone,
}: {
  boardSlots?: PublicBoardSlot[];
  secretSlots?: PublicSecretSlot[];
  selectSecretStone: (slotIndex: number) => void;
  canSelectSecretStone: boolean;
}) {
  function findBoardSlot(spell: SpellNumber, slotIndex: number) {
    return boardSlots.find(
      (slot) => slot.spell === spell && slot.slotIndex === slotIndex,
    );
  }

  function findSecretSlot(index: number) {
    return secretSlots.find((slot) => slot.slotIndex === index);
  }

  function renderCell(row: number, col: number) {
    if (row === 0 || row === 9 || col === 0 || col === 10) {
      return <div className="abracaBoardCell wall" />;
    }

    const spell = (9 - row) as SpellNumber;

    if (col === 1) {
      return (
        <div className="abracaBoardCell label">
          <img src={stoneImages[spell]} alt={`${spell}번 주문`} />
          <b>{spell}</b>
        </div>
      );
    }

    if (col >= 2 && col < 2 + spell) {
      const slotIndex = col - 2;
      const slot = findBoardSlot(spell, slotIndex);

      return (
        <div className="abracaBoardCell stoneSlot">
          {slot?.stone ? (
            <StoneCard stone={slot.stone} small />
          ) : (
            <span className="emptySlot">o</span>
          )}
        </div>
      );
    }

    if ((spell === 2 || spell === 1) && (col === 8 || col === 9)) {
      const secretIndex = spell === 2 ? col - 8 : 2 + (col - 8);
      const secretSlot = findSecretSlot(secretIndex);

      return (
        <button
          type="button"
          className={`abracaBoardCell secretSlot ${
            secretSlot?.stone ? "selectable" : "used"
          }`}
          disabled={!secretSlot?.stone || !canSelectSecretStone}
          onClick={() => {
            if (!secretSlot?.stone || !canSelectSecretStone) return;
            selectSecretStone(secretIndex);
          }}
        >
          {secretSlot?.stone ? (
            <img src={BACK_IMAGE} alt={`비밀의 돌 ${secretIndex + 1}`} />
          ) : (
            <span className="emptySlot">b{secretIndex + 1}</span>
          )}
        </button>
      );
    }

    return <div className="abracaBoardCell wall" />;
  }

  return (
    <section className="abracaBoardPanel">
      <h2>게임판</h2>
      <div className="abracaBoardGrid">
        {Array.from({ length: 10 }).map((_, row) =>
          Array.from({ length: 11 }).map((__, col) => (
            <div key={`${row}-${col}`}>{renderCell(row, col)}</div>
          )),
        )}
      </div>
    </section>
  );
}

function AbracaWhatGame() {
  const socketRef = useRef<ReturnType<typeof io> | null>(null);
  const didRejoinRef = useRef(false);

  const [nickname, setNickname] = useState("");
  const [roomCodeInput, setRoomCodeInput] = useState("");
  const [playerId, setPlayerId] = useState(
    sessionStorage.getItem("abraca_player_id") || "",
  );
  const [room, setRoom] = useState<RoomState | null>(null);
  const [error, setError] = useState("");
  const [showLogs, setShowLogs] = useState(true);

  const me = useMemo(
    () => room?.players.find((p) => p.id === playerId) ?? null,
    [room, playerId],
  );

  const currentPlayer = useMemo(
    () => room?.players.find((p) => p.id === room.currentTurnPlayerId) ?? null,
    [room],
  );

  const resultRanks = useMemo(() => {
    if (!room) return [];

    return [...room.players].sort(
      (a, b) =>
        b.score - a.score ||
        b.hp - a.hp ||
        a.nickname.localeCompare(b.nickname, "ko-KR"),
    );
  }, [room]);

  const winnerNames = useMemo(() => {
    if (!room) return "";

    const winners =
      room.winnerIds.length > 0
        ? room.players.filter((player) => room.winnerIds.includes(player.id))
        : resultRanks.slice(0, 1);

    return winners.map((player) => player.nickname).join(", ");
  }, [resultRanks, room]);

  const isMyTurn =
    !!room &&
    room.status === "playing" &&
    room.currentTurnPlayerId === playerId &&
    !me?.eliminated;

  useEffect(() => {
    const socket = io(SERVER_URL, { autoConnect: true });
    socketRef.current = socket;

    function handleCreated({
      roomCode,
      playerId,
      roomState,
    }: {
      roomCode: string;
      playerId: string;
      roomState: RoomState;
    }) {
      setPlayerId(playerId);
      setRoom(roomState);
      setError("");
      setShowLogs(true);

      sessionStorage.setItem("abraca_room_code", roomCode);
      sessionStorage.setItem("abraca_player_id", playerId);
    }

    function handleJoined({
      roomCode,
      playerId,
      roomState,
    }: {
      roomCode: string;
      playerId: string;
      roomState: RoomState;
    }) {
      setPlayerId(playerId);
      setRoom(roomState);
      setError("");
      setShowLogs(true);

      sessionStorage.setItem("abraca_room_code", roomCode);
      sessionStorage.setItem("abraca_player_id", playerId);
    }

    function handleState(roomState: RoomState) {
      setRoom(roomState);
    }

    function handleLeft() {
      sessionStorage.removeItem("abraca_room_code");
      sessionStorage.removeItem("abraca_player_id");
      setPlayerId("");
      setRoom(null);
      setError("");
      setShowLogs(false);
    }

    function handleError({ message }: { message: string }) {
      setError(message);
      window.setTimeout(() => setError(""), 2500);
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
      socket.disconnect();
    };
  }, []);

  function createRoom() {
    socketRef.current?.emit("abraca:room:create", { nickname });
  }

  function joinRoom() {
    socketRef.current?.emit("abraca:room:join", {
      nickname,
      roomCode: roomCodeInput.trim().toUpperCase(),
    });
  }

  function leaveRoom() {
    socketRef.current?.emit("abraca:room:leave");
  }

  function startGame() {
    socketRef.current?.emit("abraca:game:start");
  }

  function setChainMode(mode: TurnChainMode) {
    socketRef.current?.emit("abraca:chain-mode:set", { mode });
  }

  function nextRound() {
    socketRef.current?.emit("abraca:game:next-round");
  }

  function castSpell(spell: SpellNumber) {
    socketRef.current?.emit("abraca:spell:cast", { spell });
  }

  function passTurn() {
    socketRef.current?.emit("abraca:turn:pass");
  }

  function selectSecretStone(slotIndex: number) {
    socketRef.current?.emit("abraca:secret:take", { slotIndex });
  }

  function canCast(spell: SpellNumber) {
    if (!isMyTurn) return false;
    if (!room) return false;

    const minSpell = room.turnChainMinSpell ?? null;

    if (minSpell === null) return true;

    return room.turnChainMode === "lte" ? spell <= minSpell : spell >= minSpell;
  }

  if (!room) {
    return (
      <main className="landing">
        <section className="hero">
          <h1>ABRACA WHAT</h1>
          <p>닉네임을 입력하고 방을 만들거나 참가하세요.</p>

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
    <main className="abracaTable">
      <header className="abracaTopbar">
        <div>
          <h1>ABRACA WHAT</h1>
          <p>
            방 코드 <b className="code">{room.roomCode}</b> · 라운드{" "}
            {room.round}
          </p>
          <p>
            상태:{" "}
            {room.status === "waiting"
              ? "대기실"
              : room.status === "playing"
                ? `${currentPlayer?.nickname}님의 차례`
                : room.status === "round-end"
                  ? "라운드 종료"
                  : "게임 종료"}
          </p>
        </div>

        <div className="abracaTopbarActions">
          {room.status === "waiting" && me?.isHost && (
            <button onClick={startGame}>게임 시작</button>
          )}

          {room.status === "waiting" && me?.isHost && (
            <div className="abracaChainModeControl" aria-label="추가주문 규칙">
              <button
                className={room.turnChainMode === "gte" ? "active" : ""}
                onClick={() => setChainMode("gte")}
              >
                추가주문 이상
              </button>
              <button
                className={room.turnChainMode === "lte" ? "active" : ""}
                onClick={() => setChainMode("lte")}
              >
                추가주문 이하
              </button>
            </div>
          )}

          {room.status === "round-end" && me?.isHost && (
            <button onClick={nextRound}>다음 라운드</button>
          )}

          {room.status === "game-over" && me?.isHost && (
            <button onClick={startGame}>새 게임</button>
          )}

          <button className="secondary" onClick={() => setShowLogs((v) => !v)}>
            {showLogs ? "로그 닫기" : "로그 보기"}
          </button>

          <button className="secondary" onClick={leaveRoom}>
            방 나가기
          </button>
        </div>
      </header>

      {error && <div className="abracaToast">{error}</div>}

      <section className="abracaScoreStrip">
        {Array.from({ length: 9 }).map((_, score) => (
          <div key={score} className="abracaScoreBox">
            <b>{score}</b>
            <div>
              {room.players
                .filter((player) => Math.min(player.score, 8) === score)
                .map((player) => (
                  <span
                    key={player.id}
                    className="abracaScoreToken"
                    style={{ background: player.color }}
                    title={`${player.nickname} ${player.score}점`}
                  />
                ))}
            </div>
          </div>
        ))}
      </section>

      <div className="abracaMainLayout">
        <div className="abracaCenterArea">
          {room.status === "waiting" ? (
            <section className="abracaLobbyPanel">
              <h2>대기실</h2>
              <p>방장이 게임 시작을 누르면 게임판이 세팅됩니다.</p>

              <div className="abracaLobbyPlayers">
                {room.players.map((player) => (
                  <div key={player.id} className="abracaLobbyPlayer">
                    <span
                      className="abracaColorDot"
                      style={{ background: player.color }}
                    />
                    <b>
                      {player.nickname}
                      {player.isHost ? " (방장)" : ""}
                      {player.id === playerId ? " (나)" : ""}
                    </b>
                  </div>
                ))}
              </div>
            </section>
          ) : (
            <AbracaBoard
              boardSlots={room.boardSlots ?? []}
              secretSlots={room.secretSlots ?? []}
              selectSecretStone={selectSecretStone}
              canSelectSecretStone={room.pendingSecretTakePlayerId === playerId}
            />
          )}

          {showLogs && (
            <section className="abracaLogPanel">
              <h2>전체 로그</h2>
              <div className="abracaLogList">
                {[...room.logs].reverse().map((log, index) => (
                  <p key={`${index}-${log}`}>{log}</p>
                ))}
              </div>
            </section>
          )}
        </div>

        <aside className="abracaSideBar">
          <section
            className={`abracaResultCard ${
              room.lastResult?.type === "success"
                ? "success"
                : room.lastResult?.type === "fail"
                  ? "fail"
                  : ""
            }`}
          >
            <span>최근 주문 결과</span>
            <p>{room.lastResult?.message || "아직 주문 결과가 없습니다."}</p>
          </section>

          {room.pendingSecretTakePlayerId === playerId && (
            <section className="abracaInfoCard">
              <h3>비밀의 돌 선택</h3>
              <p>게임판의 b1~b4 중 back.png가 보이는 칸을 클릭하세요.</p>
            </section>
          )}

          <section className="abracaInfoCard">
            <h3>공급처</h3>
            <p>남은 마법의 돌: {room.drawPileCount}개</p>
            <p>남은 비밀의 돌: {room.secretPileCount}개</p>
          </section>

          <section className="abracaPlayersPanel">
            <h3>플레이어</h3>

            {room.players.map((player) => (
              <article
                key={player.id}
                className={`abracaPlayerMini ${
                  player.id === room.currentTurnPlayerId ? "current" : ""
                } ${player.eliminated ? "dead" : ""}`}
              >
                <div className="abracaPlayerMiniHead">
                  <span
                    className="abracaColorDot"
                    style={{ background: player.color }}
                  />
                  <b>
                    {player.nickname}
                    {player.id === playerId ? " (나)" : ""}
                  </b>
                  {!player.connected && <em>재접속 대기</em>}
                </div>

                <div className="abracaHpRow">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <span
                      key={index}
                      className={index < player.hp ? "hpToken on" : "hpToken"}
                    />
                  ))}
                </div>

                <div className="abracaMiniHand">
                  {player.hand.map((stone) => (
                    <StoneCard key={stone.id} stone={stone} small />
                  ))}
                </div>

                {player.secretStones.length > 0 && (
                  <div className="abracaMiniSecret">
                    <span>비밀의 돌</span>
                    <div>
                      {player.secretStones.map((stone) => (
                        <StoneCard key={stone.id} stone={stone} small />
                      ))}
                    </div>
                  </div>
                )}
              </article>
            ))}
          </section>

          {room.status === "playing" && (
            <section className="abracaSpellPanel">
              <div className="abracaTurnNotice">
                {isMyTurn ? (
                  <b>내 차례입니다</b>
                ) : (
                  <b>{currentPlayer?.nickname}님 차례 대기중</b>
                )}

                {room.turnChainMinSpell != null && (
                  <span>
                    추가 주문 가능: {room.turnChainMinSpell}번{" "}
                    {room.turnChainMode === "lte" ? "이하" : "이상"}
                  </span>
                )}
              </div>

              <div className="abracaSpellButtons">
                {([1, 2, 3, 4, 5, 6, 7, 8] as SpellNumber[]).map((spell) => (
                  <button
                    key={spell}
                    disabled={!canCast(spell)}
                    onClick={() => castSpell(spell)}
                  >
                    <b>
                      {spell}. {spellNames[spell]}
                    </b>
                    <small>{spellDescriptions[spell]}</small>
                  </button>
                ))}
              </div>

              {isMyTurn && room.turnSuccessCount > 0 && (
                <button className="abracaPassButton" onClick={passTurn}>
                  턴 넘기기
                </button>
              )}
            </section>
          )}

          {(room.status === "round-end" || room.status === "game-over") && (
            <section className="abracaRoundSummary">
              <h3>
                {room.status === "game-over" ? "게임 종료" : "라운드 종료"}
              </h3>

              {room.winnerIds.length > 0 && (
                <p className="winnerText">
                  승리:{" "}
                  {room.players
                    .filter((player) => room.winnerIds.includes(player.id))
                    .map((player) => player.nickname)
                    .join(", ")}
                </p>
              )}

              {room.roundSummary.map((line, index) => (
                <p key={index}>{line}</p>
              ))}
            </section>
          )}
        </aside>
      </div>

      {room.status === "game-over" && (
        <div className="abracaWinOverlay" role="dialog" aria-modal="true">
          <section className="abracaWinModal">
            <span>게임 종료</span>
            <h2>{winnerNames} 승리</h2>
            <div className="abracaRankList">
              {resultRanks.map((player, index) => (
                <p key={player.id}>
                  <b>{index + 1}등</b>
                  <span>{player.nickname}</span>
                  <em>{player.score}점</em>
                </p>
              ))}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

export default AbracaWhatGame;
