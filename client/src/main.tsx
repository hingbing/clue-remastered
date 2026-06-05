import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { io } from "socket.io-client";
import {
  boardRooms,
  BOARD_COLS,
  BOARD_ROWS,
  characters,
  rooms,
  secretPassages,
  suspects,
  weapons,
  tiles,
  tileById,
  tileCenter,
  type Card,
  type PublicRoomState,
  type RoomName,
  type Suggestion,
} from "../../shared/game";
import "./style.css";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";
const socket = io(SERVER_URL, { autoConnect: true });
const CELL = 32;
const W = BOARD_COLS * CELL;
const H = BOARD_ROWS * CELL;

type NoteMark = "unknown" | "mine" | "seen" | "none" | "maybe";
type Notes = Record<string, NoteMark>;
const allNames = [...suspects, ...weapons, ...rooms];
const markLabel: Record<NoteMark, string> = {
  unknown: "?",
  mine: "내 카드",
  seen: "본 카드",
  none: "X",
  maybe: "의심",
};

function playSound(type: "dice" | "move" | "win") {
  const audio = new AudioContext();

  const osc = audio.createOscillator();
  const gain = audio.createGain();

  const freq = {
    dice: 250,
    move: 420,
    win: 880,
  };

  osc.frequency.value = freq[type];

  gain.gain.value = 0.05;

  osc.connect(gain);
  gain.connect(audio.destination);

  osc.start();
  osc.stop(audio.currentTime + 0.15);
}

function App() {
  const [nickname, setNickname] = useState("");
  const [roomCodeInput, setRoomCodeInput] = useState("");
  const [playerId, setPlayerId] = useState(
    sessionStorage.getItem("clue_player_id") || "",
  );
  const [roomCode, setRoomCode] = useState(
    sessionStorage.getItem("clue_room_code") || "",
  );
  const [room, setRoom] = useState<PublicRoomState | null>(null);
  const [hand, setHand] = useState<Card[]>([]);
  const [error, setError] = useState("");
  const [selectedTile, setSelectedTile] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<Suggestion>({
    suspect: suspects[0],
    weapon: weapons[0],
    room: rooms[0],
  });
  const [accusation, setAccusation] = useState<Suggestion>({
    suspect: suspects[0],
    weapon: weapons[0],
    room: rooms[0],
  });
  const [disproveCards, setDisproveCards] = useState<Card[]>([]);
  const [revealed, setRevealed] = useState<Card | null>(null);
  const [leftoverRevealed, setLeftoverRevealed] = useState<Card[]>([]);
  const [leftoverChoiceCount, setLeftoverChoiceCount] = useState(0);
  const [temporaryLeftoverCard, setTemporaryLeftoverCard] =
    useState<Card | null>(null);
  const [bonusCards, setBonusCards] = useState<
    Array<"extra-turn" | "extra-suggestion">
  >([]);
  const [privateLogs, setPrivateLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [notes, setNotes] = useState<Notes>(
    () => Object.fromEntries(allNames.map((n) => [n, "unknown"])) as Notes,
  );
  const [winResult, setWinResult] = useState<{
    winner: any;
    solution: Suggestion;
    playerAccusations?: Array<{
      id: string;
      nickname: string;
      finalAccusation: Suggestion | null;
      correct: boolean;
    }>;
  } | null>(null);

  const [bgmEnabled, setBgmEnabled] = useState(false);

  const me = room?.players.find((p) => p.id === playerId) ?? null;
  const isMyTurn =
    !!room &&
    room.currentTurnPlayerId === playerId &&
    room.status === "playing";
  const currentPlayer = room?.players.find(
    (p) => p.id === room.currentTurnPlayerId,
  );
  const currentTile = me ? tileById[me.tileId] : null;
  const inRoom = me?.room ?? null;

  useEffect(() => {
    const savedRoom = sessionStorage.getItem("clue_room_code");
    const savedPlayer = sessionStorage.getItem("clue_player_id");
    if (savedRoom && savedPlayer)
      socket.emit("room:rejoin", {
        roomCode: savedRoom,
        playerId: savedPlayer,
      });

    socket.on("room:created", ({ roomCode, playerId, roomState }) => {
      setRoomCode(roomCode);
      setPlayerId(playerId);
      setRoom(roomState);
      setError("");
      sessionStorage.setItem("clue_room_code", roomCode);
      sessionStorage.setItem("clue_player_id", playerId);
    });
    socket.on("room:joined", ({ playerId, roomState }) => {
      setPlayerId(playerId);
      setRoom(roomState);
      setError("");
      sessionStorage.setItem("clue_player_id", playerId);
      sessionStorage.setItem("clue_room_code", roomState.roomCode);
    });
    socket.on("room:rejoined", ({ playerId, roomState }) => {
      setPlayerId(playerId);
      setRoom(roomState);
      setError("재접속 완료");
    });
    socket.on("room:rejoin-failed", () =>
      setError("이전 게임으로 재접속하지 못했습니다. 새로 입장해주세요."),
    );
    socket.on("room:left", () => {
      sessionStorage.removeItem("clue_player_id");
      sessionStorage.removeItem("clue_room_code");
      setRoom(null);
      setRoomCode("");
      setPlayerId("");
      setHand([]);
    });
    socket.on("room:state", (state) => setRoom(state));
    socket.on("game:your-cards", ({ cards }) => {
      setHand(cards);
      setNotes((prev) => ({
        ...prev,
        ...Object.fromEntries(cards.map((c: Card) => [c.name, "mine"])),
      }));
    });
    socket.on("game:error", ({ message }) => setError(message));
    socket.on("game:disprove-request", ({ matchingCards }) =>
      setDisproveCards(matchingCards),
    );
    socket.on("game:card-revealed", ({ card }) => {
      setRevealed(card);
      setNotes((prev) => ({ ...prev, [card.name]: "seen" }));
    });
    socket.on("game:disproved", () => setDisproveCards([]));
    socket.on("game:leftover-revealed", ({ cards }) => {
      setLeftoverRevealed(cards);
      setNotes((prev) => ({
        ...prev,
        ...Object.fromEntries(cards.map((c: Card) => [c.name, "seen"])),
      }));
    });
    socket.on("game:leftover-choice-needed", ({ count }) => {
      setLeftoverChoiceCount(count);
      setTemporaryLeftoverCard(null);
    });
    socket.on("game:leftover-card-revealed-once", ({ card }) => {
      setTemporaryLeftoverCard(card);
      setLeftoverChoiceCount(0);
      setNotes((prev) => ({ ...prev, [card.name]: "seen" }));
    });
    socket.on("game:bonus-inventory", ({ bonusCards }) =>
      setBonusCards(bonusCards),
    );
    socket.on("game:private-logs", ({ logs }) => setPrivateLogs(logs));
    socket.on("game:private-log", ({ message }) =>
      setPrivateLogs((prev) => [...prev.slice(-79), message]),
    );
    socket.on("game:win", ({ winner, solution, playerAccusations }) => {
      setDisproveCards([]);
      setWinResult({
        winner,
        solution,
        playerAccusations,
      });

      playSound("win");
    });
  }, []);

  useEffect(() => {
    if (inRoom && inRoom !== "현관") {
      setSuggestion((s) => ({ ...s, room: inRoom as RoomName }));
    }
  }, [inRoom]);

  useEffect(() => {
    // 숨김 카드는 “그 턴에만” 보이도록 턴이 바뀌면 자동으로 숨깁니다.
    setLeftoverChoiceCount(0);
    setTemporaryLeftoverCard(null);
  }, [room?.turnNumber, room?.currentTurnPlayerId]);

  const zoomRoom = useMemo(
    () => boardRooms.find((r) => r.name === inRoom) ?? null,
    [inRoom],
  );
  const canMoveTiles = new Set<string>(room?.reachableTileIds ?? []);
  const isChoosingMove = canMoveTiles.size > 0;
  const secretTarget =
    inRoom && inRoom !== "현관"
      ? secretPassages[inRoom as RoomName]
      : undefined;
  const canAccuse =
    isMyTurn &&
    (room?.winnerId ? true : inRoom === "현관") &&
    !room?.pendingDisprove &&
    !me?.finalAccused;

  function createRoom() {
    socket.emit("room:create", { nickname });
  }
  function joinRoom() {
    socket.emit("room:join", { nickname, roomCode: roomCodeInput });
  }
  function startGame() {
    socket.emit("game:start");
  }
  function roll() {
    socket.emit("game:roll");
    setRevealed(null);
  }
  function move(tileId: string) {
    setSelectedTile(tileId);
    socket.emit("game:move", { tileId });
  }
  function suggest() {
    socket.emit("game:suggest", suggestion);
  }
  function useSecretPassage() {
    socket.emit("game:secret-passage");
    setRevealed(null);
  }
  function bonusRevealPlayer(targetPlayerId: string) {
    socket.emit("game:bonus-reveal-player", { targetPlayerId });
  }
  function bonusMoveRoom(roomName: RoomName) {
    socket.emit("game:bonus-move-room", { roomName });
  }
  function chooseLeftoverCard(index: number) {
    socket.emit("game:choose-leftover-card", { index });
  }
  function accuse() {
    if (confirm("정말 최종 추리하시겠습니까? 틀리면 탈락합니다."))
      socket.emit("game:accuse", accusation);
  }
  function useBonusExtraTurn() {
    socket.emit("game:use-bonus-extra-turn");
  }
  function useBonusExtraSuggestion() {
    socket.emit("game:use-bonus-extra-suggestion");
  }
  function pass() {
    socket.emit("game:pass");
    setRevealed(null);
  }
  function leaveRoom() {
    socket.emit("room:leave");
    sessionStorage.removeItem("clue_player_id");
    sessionStorage.removeItem("clue_room_code");
    setRoom(null);
    setRoomCode("");
    setPlayerId("");
    setHand([]);
    setDisproveCards([]);
    setRevealed(null);
    setLeftoverRevealed([]);
    setLeftoverChoiceCount(0);
    setTemporaryLeftoverCard(null);
    setBonusCards([]);
    setPrivateLogs([]);
  }
  function disprove(cardId: string) {
    socket.emit("game:disprove", { cardId });
    setDisproveCards([]);
  }

  function cycleNote(name: string) {
    const order: NoteMark[] = ["unknown", "maybe", "none", "seen", "mine"];
    setNotes((prev) => ({
      ...prev,
      [name]:
        order[(order.indexOf(prev[name] ?? "unknown") + 1) % order.length],
    }));
  }

  if (!room)
    return (
      <main className="landing">
        <section className="hero">
          <h1>CLUE REMASTERED</h1>
          <p>실시간 멀티플레이 추리 게임</p>
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

  return (
    <main className="app">
      {winResult && (
        <div className="winOverlay">
          <div className="winPopup">
            <h1>사건 해결!</h1>

            <h2>🏆 {winResult.winner.nickname} 승리</h2>

            <div className="solutionBox">
              <p>
                <b>범인</b>
                <br />
                {winResult.solution.suspect}
              </p>

              <p>
                <b>흉기</b>
                <br />
                {winResult.solution.weapon}
              </p>

              <p>
                <b>장소</b>
                <br />
                {winResult.solution.room}
              </p>
            </div>

            {winResult.playerAccusations && (
              <div className="playerAccusationsBox">
                <h3>플레이어별 최종 추리</h3>
                <table className="accusationTable">
                  <thead>
                    <tr>
                      <th>플레이어</th>
                      <th>범인</th>
                      <th>흉기</th>
                      <th>장소</th>
                      <th>결과</th>
                    </tr>
                  </thead>
                  <tbody>
                    {winResult.playerAccusations.map((acc) => (
                      <tr key={acc.id} className={acc.correct ? "correct" : ""}>
                        <td>{acc.nickname}</td>
                        <td>{acc.finalAccusation?.suspect || "-"}</td>
                        <td>{acc.finalAccusation?.weapon || "-"}</td>
                        <td>{acc.finalAccusation?.room || "-"}</td>
                        <td
                          className={
                            acc.correct
                              ? "correct"
                              : acc.finalAccusation
                                ? "wrong"
                                : "no-guess"
                          }
                        >
                          {acc.correct ? "✓" : acc.finalAccusation ? "✗" : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <button onClick={() => setWinResult(null)}>확인</button>
          </div>
        </div>
      )}
      <header className="topbar">
        <div>
          <b>방 코드</b> <span className="code">{room.roomCode}</span>
        </div>
        <div className="statusCard">
          <b>{room.turnNumber}번째 턴</b>{" "}
          {currentPlayer
            ? `· ${currentPlayer.nickname}`
            : room.status === "waiting"
              ? "· 대기실"
              : ""}
        </div>
        <button
          className="secondary"
          onClick={() => {
            const bgm = document.getElementById("bgm") as HTMLAudioElement;

            if (!bgm) return;

            if (bgm.paused) {
              bgm.volume = 0.35;
              bgm.play();
              setBgmEnabled(true);
            } else {
              bgm.pause();
              setBgmEnabled(false);
            }
          }}
        >
          {bgmEnabled ? "BGM 끄기" : "BGM 켜기"}
        </button>

        <audio id="bgm" src="/bgm.mp3" loop />
        {room.status === "waiting" && me?.isHost && (
          <button onClick={startGame}>게임 시작</button>
        )}
        {room.status === "playing" && (
          <button disabled={!isMyTurn || !!room.pendingDisprove} onClick={pass}>
            턴 넘기기
          </button>
        )}
        <button className="secondary" onClick={() => setShowLogs((v) => !v)}>
          로그
        </button>
        <button className="secondary" onClick={leaveRoom}>
          방 나가기
        </button>
      </header>
      {error && <div className="toast">{error}</div>}
      {showLogs && (
        <section className="logDrawer">
          <div className="logHead">
            <h2>추리 로그</h2>
            <button onClick={() => setShowLogs(false)}>닫기</button>
          </div>
          <div className="logGrid">
            <div>
              <h3>공개 로그</h3>
              {(room.logs ?? []).length ? (
                room.logs.map((l, i) => <p key={i}>{l}</p>)
              ) : (
                <p className="hint">아직 로그가 없습니다.</p>
              )}
            </div>
            <div>
              <h3>내 비공개 로그</h3>
              {privateLogs.length ? (
                privateLogs.map((l, i) => <p key={i}>{l}</p>)
              ) : (
                <p className="hint">상대가 공개한 카드가 여기에 기록됩니다.</p>
              )}
            </div>
          </div>
        </section>
      )}
      <section className="layout">
        <section
          className={
            zoomRoom && !isChoosingMove ? "boardWrap zoomed" : "boardWrap"
          }
        >
          <Board
            room={room}
            playerId={playerId}
            canMoveTiles={canMoveTiles}
            onMove={move}
            zoomRoom={null}
          />
        </section>
        <aside className="side">
          <section className="panel">
            <h2>플레이어</h2>
            {room.players.map((p) => (
              <div className="playerRow" key={p.id}>
                <span className="dot" style={{ background: p.color }} />
                {p.nickname} {p.id === playerId ? "(나)" : ""}{" "}
                {!p.connected ? " · 재접속 대기" : ""}
              </div>
            ))}
          </section>
          <section className="panel turnPanel">
            <h2>이동</h2>
            <p>{room.lastMessage}</p>
            <p>
              주사위:{" "}
              {room.dice
                ? `${room.dice[0]} + ${room.dice[1]} = ${room.dice[0] + room.dice[1]}`
                : "아직 안 굴림"}
            </p>
            <button
              disabled={
                !isMyTurn ||
                room.hasRolled ||
                !!room.pendingDisprove ||
                room.hasSuggested
              }
              onClick={roll}
            >
              주사위 2개 굴리기
            </button>
            {secretTarget && (
              <button
                disabled={
                  !isMyTurn ||
                  room.hasRolled ||
                  !!room.pendingDisprove ||
                  room.hasSuggested
                }
                onClick={useSecretPassage}
              >
                비밀통로로 {secretTarget} 이동
              </button>
            )}
            {room.firstRolls.length > 0 && (
              <p className="hint">
                선공:{" "}
                {room.firstRolls
                  .map((r) => `${r.nickname} ${r.total}`)
                  .join(" / ")}
              </p>
            )}
            <p className="hint">
              대각선 이동 불가. 초록 칸만 선택 가능. 비밀통로는 주사위 없이
              이동합니다.
            </p>
          </section>
          {room.bonusMessage && (
            <section className="panel bonusBox">
              <h2>보너스 카드</h2>
              <p>{room.bonusMessage}</p>
              {room.pendingBonusAction?.kind === "reveal-card" &&
                room.pendingBonusAction.playerId === playerId && (
                  <div className="bonusButtons">
                    <p className="hint">카드를 확인할 플레이어를 선택하세요.</p>
                    {room.players
                      .filter((p) => p.id !== playerId)
                      .map((p) => (
                        <button
                          key={p.id}
                          onClick={() => bonusRevealPlayer(p.id)}
                        >
                          {p.nickname} 카드 1장 보기
                        </button>
                      ))}
                  </div>
                )}
              {room.pendingBonusAction?.kind === "move-room" &&
                room.pendingBonusAction.playerId === playerId && (
                  <div className="bonusButtons">
                    <p className="hint">즉시 이동할 장소를 선택하세요.</p>
                    {rooms.map((r) => (
                      <button key={r} onClick={() => bonusMoveRoom(r)}>
                        {r}(으)로 이동
                      </button>
                    ))}
                  </div>
                )}
            </section>
          )}

          {bonusCards.length > 0 && (
            <section className="panel storedBonus">
              <h2>보관 중인 보너스 카드</h2>
              <p className="hint">
                추리를 마친 뒤 원하는 보너스 카드를 눌러 사용하세요.
              </p>
              {bonusCards.includes("extra-turn") && (
                <button
                  disabled={
                    !isMyTurn ||
                    !room.hasSuggested ||
                    !!room.pendingDisprove ||
                    room.bonusExtraTurn
                  }
                  onClick={useBonusExtraTurn}
                >
                  차례 한 번 더 사용
                </button>
              )}
              {bonusCards.includes("extra-suggestion") && (
                <button
                  disabled={
                    !isMyTurn ||
                    !room.hasSuggested ||
                    !!room.pendingDisprove ||
                    room.bonusExtraSuggestion ||
                    inRoom === "현관"
                  }
                  onClick={useBonusExtraSuggestion}
                >
                  추리 한 번 더 사용
                </button>
              )}
            </section>
          )}
          <section className="panel cards">
            <h2>내 카드</h2>
            <div className="cardGrid">
              {hand.map((c) => (
                <span className={`card ${c.type}`} key={c.id}>
                  {c.name}
                </span>
              ))}
            </div>
          </section>
          {isMyTurn &&
            !me?.finalAccused &&
            (room?.winnerId || inRoom === "현관") && (
              <section className="panel accusationBox">
                <h2>최종 고발</h2>
                <SelectLine
                  value={accusation}
                  setValue={setAccusation}
                  lockRoom={null}
                />
                <button
                  className="danger"
                  disabled={!canAccuse}
                  onClick={accuse}
                >
                  최종 추리하기
                </button>
                <p className="hint">
                  {room?.winnerId
                    ? "다른 플레이어가 정답을 맞혔습니다. 당신의 최종 추리를 남겨주세요. (현재 위치 무관)"
                    : "최종 추리는 중앙 현관에서만 가능하며, 한 번 실패하면 탈락합니다."}
                </p>
              </section>
            )}
          {zoomRoom && zoomRoom.name !== "현관" && (
            <section className="panel zoomActions">
              <h2>{zoomRoom.name} 도착</h2>
              <p>
                현재 방에서만 추리할 수 있습니다. 다른 추리로 끌려온 경우에는
                이동 후 추리할 수 있습니다.
              </p>
              <SelectLine
                value={suggestion}
                setValue={setSuggestion}
                lockRoom={zoomRoom.name as RoomName}
              />
              <button
                disabled={
                  !isMyTurn ||
                  (room.hasSuggested && !room.bonusExtraSuggestion) ||
                  !!room.pendingDisprove ||
                  !!me?.pulledBySuggestion
                }
                onClick={suggest}
              >
                추리하기
              </button>
            </section>
          )}
          {zoomRoom && zoomRoom.name === "현관" && (
            <section className="panel zoomActions">
              <h2>현관 도착</h2>
              <p>
                이곳에서 최종 추리를 할 수 있습니다. 최종 추리는 오른쪽 ‘최종
                추리’ 영역에서 진행하세요.
              </p>
            </section>
          )}
          {disproveCards.length > 0 && (
            <section className="panel disprove">
              <h2>반증 카드 선택</h2>
              {disproveCards.map((c) => (
                <button key={c.id} onClick={() => disprove(c.id)}>
                  {c.name} 보여주기
                </button>
              ))}
            </section>
          )}
          {revealed && (
            <section className="panel revealed">
              <h2>상대가 보여준 카드</h2>
              <div className="bigCard">{revealed.name}</div>
            </section>
          )}
          {leftoverChoiceCount > 0 && (
            <section className="panel revealed">
              <h2>숨김 카드 선택</h2>
              <p className="hint">
                상대가 증명하지 못했습니다. 이번 턴에만 숨김 카드 1장을 확인할
                수 있습니다.
              </p>
              <div className="bonusButtons">
                {Array.from({ length: leftoverChoiceCount }).map((_, index) => (
                  <button key={index} onClick={() => chooseLeftoverCard(index)}>
                    {index + 1}번 카드 확인
                  </button>
                ))}
              </div>
            </section>
          )}
          {temporaryLeftoverCard && (
            <section className="panel revealed">
              <h2>이번 턴에 확인한 숨김 카드</h2>
              <div className="bigCard">{temporaryLeftoverCard.name}</div>
              <p className="hint">
                이 카드는 나에게만 보이며, 턴이 바뀌면 자동으로 사라집니다.
              </p>
            </section>
          )}
          {leftoverRevealed.length > 0 && (
            <section className="panel revealed">
              <h2>여분 추리 카드</h2>
              <p className="hint">
                증명 없는 추리 3회로 나에게만 공개된 카드입니다.
              </p>
              <div className="cardGrid">
                {leftoverRevealed.map((c) => (
                  <span className={`card ${c.type}`} key={c.id}>
                    {c.name}
                  </span>
                ))}
              </div>
            </section>
          )}
          <Notebook notes={notes} cycleNote={cycleNote} />
        </aside>
      </section>
    </main>
  );
}

function SelectLine({
  value,
  setValue,
  lockRoom,
}: {
  value: Suggestion;
  setValue: (v: Suggestion) => void;
  lockRoom: RoomName | null;
}) {
  return (
    <div className="selectLine">
      <select
        value={value.suspect}
        onChange={(e) => setValue({ ...value, suspect: e.target.value })}
      >
        {suspects.map((x) => (
          <option key={x}>{x}</option>
        ))}
      </select>
      <select
        value={value.weapon}
        onChange={(e) => setValue({ ...value, weapon: e.target.value })}
      >
        {weapons.map((x) => (
          <option key={x}>{x}</option>
        ))}
      </select>
      <select
        value={lockRoom ?? value.room}
        disabled={!!lockRoom}
        onChange={(e) =>
          setValue({ ...value, room: e.target.value as RoomName })
        }
      >
        {rooms.map((x) => (
          <option key={x}>{x}</option>
        ))}
      </select>
    </div>
  );
}

function Board({
  room,
  playerId,
  canMoveTiles,
  onMove,
  zoomRoom,
}: {
  room: PublicRoomState;
  playerId: string;
  canMoveTiles: Set<string>;
  onMove: (id: string) => void;
  zoomRoom: string | null;
}) {
  const me = room.players.find((p) => p.id === playerId) ?? null;
  const viewBox = `0 0 ${W} ${H}`;
  const roomCells = boardRooms.flatMap((r) =>
    r.cells.map((cell) => ({ ...cell, room: r.name, fill: r.fill })),
  );

  return (
    <svg className="board" viewBox={viewBox}>
      <rect width={W} height={H} fill="#24352b" />
      {roomCells.map((cell) => (
        <rect
          key={`${cell.x}-${cell.y}-${cell.room}`}
          x={cell.x * CELL}
          y={cell.y * CELL}
          width={CELL - 2}
          height={CELL - 2}
          rx="4"
          fill={cell.fill}
          stroke="#3b2a20"
          strokeWidth="1.5"
        />
      ))}
      {tiles.map((t) => (
        <rect
          key={t.id}
          x={t.x * CELL}
          y={t.y * CELL}
          width={CELL - 2}
          height={CELL - 2}
          className={`tile ${t.type} ${canMoveTiles.has(t.id) ? "reachable" : ""}`}
          onClick={() => canMoveTiles.has(t.id) && onMove(t.id)}
        />
      ))}
      {boardRooms.map((r, idx) => {
        const cx = (r.x + r.w / 2) * CELL;
        const cy = (r.y + r.h / 2) * CELL;
        return (
          <text
            key={`${r.name}-${idx}`}
            x={cx}
            y={cy}
            textAnchor="middle"
            dominantBaseline="middle"
            className="roomText"
          >
            {r.name}
          </text>
        );
      })}
      {room.players.map((p, idx) => {
        const tile = tileById[p.tileId];
        const c = tile ? tileCenter(tile, CELL) : { x: 0, y: 0 };
        return (
          <g
            key={p.id}
            transform={`translate(${c.x + (idx % 3) * 8 - 8},${c.y + Math.floor(idx / 3) * 8 - 4})`}
            className={p.id === playerId ? "myPiece" : ""}
          >
            <circle r="12" fill={p.color} stroke="#1b1b1b" strokeWidth="3" />
            <path d="M -6 6 L 0 -10 L 6 6 Z" fill="rgba(255,255,255,.55)" />
            <title>{p.nickname}</title>
          </g>
        );
      })}
    </svg>
  );
}

function roomViewBox(name: string, tileId: string | null) {
  const candidates = boardRooms.filter((x) => x.name === name);
  if (candidates.length === 0) return `0 0 ${W} ${H}`;
  const tile = tileId ? tileById[tileId] : null;
  const r = tile
    ? candidates.reduce((best, cur) => {
        const bx = best.x + best.w / 2;
        const by = best.y + best.h / 2;
        const cx = cur.x + cur.w / 2;
        const cy = cur.y + cur.h / 2;
        const bd = Math.abs(tile.x - bx) + Math.abs(tile.y - by);
        const cd = Math.abs(tile.x - cx) + Math.abs(tile.y - cy);
        return cd < bd ? cur : best;
      }, candidates[0])
    : candidates[0];
  const pad = 100;
  return `${Math.max(0, r.x * CELL - pad)} ${Math.max(0, r.y * CELL - pad)} ${Math.min(W, r.w * CELL + pad * 2)} ${Math.min(H, r.h * CELL + pad * 2)}`;
}

function Notebook({
  notes,
  cycleNote,
}: {
  notes: Notes;
  cycleNote: (n: string) => void;
}) {
  return (
    <section className="panel notebook">
      <h2>추리노트</h2>
      {[
        ["용의자", suspects],
        ["무기", weapons],
        ["장소", rooms],
      ].map(([title, list]) => (
        <div key={title as string}>
          <h3>{title as string}</h3>
          {(list as string[]).map((n) => (
            <button
              key={n}
              className={`note ${notes[n]}`}
              onClick={() => cycleNote(n)}
            >
              <span>{n}</span>
              <b>{markLabel[notes[n] ?? "unknown"]}</b>
            </button>
          ))}
        </div>
      ))}
    </section>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
