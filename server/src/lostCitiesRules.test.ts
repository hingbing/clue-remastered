import assert from "node:assert/strict";
import test from "node:test";
import { LOST_CITIES_COLORS, type LostCitiesCard, type LostCitiesColor } from "../../shared/lostCities";
import {
  canPlayToExpedition,
  createLostCitiesDeck,
  scoreExpedition,
  scorePlayer,
} from "./lostCitiesRules";

function card(
  color: LostCitiesColor,
  kind: LostCitiesCard["kind"],
  value: number | null,
): LostCitiesCard {
  return { id: `${color}-${kind}-${value ?? "investment"}`, color, kind, value };
}

function number(value: number): LostCitiesCard {
  return card("yellow", "number", value);
}

const investment = card("yellow", "investment", null);

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

test("deck has 72 unique cards and 12 cards per color", () => {
  const deck = createLostCitiesDeck();
  assert.equal(deck.length, 72);
  assert.equal(new Set(deck.map((item) => item.id)).size, 72);
  for (const color of LOST_CITIES_COLORS) {
    const cards = deck.filter((item) => item.color === color);
    assert.equal(cards.length, 12);
    assert.deepEqual(
      cards.filter((item) => item.kind === "number").map((item) => item.value),
      [2, 3, 4, 5, 6, 7, 8, 9, 10],
    );
    assert.equal(cards.filter((item) => item.kind === "investment").length, 3);
  }
});

test("investment must precede number cards and numbers must increase", () => {
  const five = number(5);
  const six = number(6);
  assert.equal(canPlayToExpedition([], investment), true);
  assert.equal(canPlayToExpedition([investment], five), true);
  assert.equal(canPlayToExpedition([five], investment), false);
  assert.equal(canPlayToExpedition([five], five), false);
  assert.equal(canPlayToExpedition([five], six), true);
});

test("empty expeditions score zero", () => {
  assert.deepEqual(scoreExpedition([]), {
    numberTotal: 0,
    investmentCount: 0,
    multiplier: 1,
    longExpeditionBonus: 0,
    total: 0,
  });
});

test("scoring applies negative totals and every investment multiplier", () => {
  assert.equal(scoreExpedition([investment, number(2)]).total, -36);
  assert.equal(scoreExpedition([number(2)]).multiplier, 1);
  assert.equal(scoreExpedition([investment, number(2)]).multiplier, 2);
  assert.equal(scoreExpedition([investment, investment, number(2)]).multiplier, 3);
  assert.equal(scoreExpedition([investment, investment, investment, number(2)]).multiplier, 4);
});

test("eight-card expeditions receive the long expedition bonus", () => {
  assert.equal(scoreExpedition([
    investment, investment, number(2), number(3), number(4), number(5), number(6), number(7),
  ]).total, 41);
});

test("player scoring returns one line per color and sums their totals", () => {
  const expeditions = emptyExpeditions();
  expeditions.yellow = [number(2)];
  expeditions.blue = [card("blue", "number", 10)];

  const result = scorePlayer(expeditions);
  assert.deepEqual(result.lines.map((line) => line.color), LOST_CITIES_COLORS);
  assert.equal(result.total, -28);
});

test("equal player totals remain tied", () => {
  const firstPlayerExpeditions = emptyExpeditions();
  firstPlayerExpeditions.yellow = [number(2)];
  const secondPlayerExpeditions = emptyExpeditions();
  secondPlayerExpeditions.red = [card("red", "number", 2)];

  assert.notEqual(firstPlayerExpeditions, secondPlayerExpeditions);
  assert.equal(
    scorePlayer(firstPlayerExpeditions).total,
    scorePlayer(secondPlayerExpeditions).total,
  );
});
