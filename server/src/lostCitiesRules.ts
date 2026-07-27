import {
  LOST_CITIES_COLORS,
  type LostCitiesCard,
  type LostCitiesColor,
  type LostCitiesScoreLine,
} from "../../shared/lostCities";

export function createLostCitiesDeck(): LostCitiesCard[] {
  return LOST_CITIES_COLORS.flatMap((color) => [
    ...[2, 3, 4, 5, 6, 7, 8, 9, 10].map((value) => ({
      id: `${color}-number-${value}`,
      color,
      kind: "number" as const,
      value,
    })),
    ...[1, 2, 3].map((copy) => ({
      id: `${color}-investment-${copy}`,
      color,
      kind: "investment" as const,
      value: null,
    })),
  ]);
}

export function canPlayToExpedition(
  expedition: LostCitiesCard[],
  card: LostCitiesCard,
): boolean {
  if (card.kind === "investment") {
    return expedition.every((played) => played.kind === "investment");
  }

  const lastNumber = [...expedition].reverse().find((played) => played.kind === "number");
  return lastNumber === undefined || card.value! > lastNumber.value!;
}

export function shuffleLostCitiesDeck(
  cards: LostCitiesCard[],
  random: () => number = Math.random,
): LostCitiesCard[] {
  const shuffled = [...cards];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

export function scoreExpedition(
  cards: LostCitiesCard[],
): Omit<LostCitiesScoreLine, "color"> {
  if (cards.length === 0) {
    return {
      numberTotal: 0,
      investmentCount: 0,
      multiplier: 1,
      longExpeditionBonus: 0,
      total: 0,
    };
  }

  const numberTotal = cards.reduce(
    (total, card) => total + (card.kind === "number" ? card.value! : 0),
    0,
  );
  const investmentCount = cards.filter((card) => card.kind === "investment").length;
  const multiplier = investmentCount + 1;
  const longExpeditionBonus = cards.length >= 8 ? 20 : 0;

  return {
    numberTotal,
    investmentCount,
    multiplier,
    longExpeditionBonus,
    total: (numberTotal - 20) * multiplier + longExpeditionBonus,
  };
}

export function scorePlayer(
  expeditions: Record<LostCitiesColor, LostCitiesCard[]>,
): { lines: LostCitiesScoreLine[]; total: number } {
  const lines = LOST_CITIES_COLORS.map((color) => ({
    color,
    ...scoreExpedition(expeditions[color]),
  }));

  return {
    lines,
    total: lines.reduce((total, line) => total + line.total, 0),
  };
}
