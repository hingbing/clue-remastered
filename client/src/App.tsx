import { useState } from "react";
import ClueGame from "./ClueGame";
import AbracaWhatGame from "./AbracaWhatGame";
import LostCitiesGame from "./LostCitiesGame";

type GameType = "home" | "clue" | "abraca" | "lost-cities";

function App() {
  const [game, setGame] = useState<GameType>("home");

  if (game === "clue") {
    return <ClueGame />;
  }

  if (game === "abraca") {
    return <AbracaWhatGame />;
  }

  if (game === "lost-cities") {
    return <LostCitiesGame />;
  }

  return (
    <main className="landing">
      <section className="hero">
        <h1>BOARD GAME HUB</h1>
        <p>플레이할 게임을 선택하세요</p>

        <div className="gameSelect">
          <button onClick={() => setGame("clue")}>클루</button>
          <button onClick={() => setGame("abraca")}>아브라카왓</button>
          <button onClick={() => setGame("lost-cities")}>로스트 시티</button>
        </div>
      </section>
    </main>
  );
}

export default App;
