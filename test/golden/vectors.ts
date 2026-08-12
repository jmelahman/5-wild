/**
 * The shape of a golden vector, and the machinery that produces one.
 *
 * A vector is `{ seed, contentVersion, actions[] }` in, `{ guesses[], gold[],
 * outcome }` out. It is the portability contract: any implementation of these
 * rules — a rewrite, a port to another language — is correct if and only if it
 * reproduces these numbers from these actions.
 */

import type {
  Action,
  GameEvent,
  Phase,
  RewardBreakdown,
  RunState,
  WordSource,
} from "../../src/engine"
import { reduce, startRun } from "../../src/engine"
import type { Scenario } from "./scenarios"

/** One scored guess, with the blind it belonged to so a failure can be placed. */
export type GuessVector = {
  ante: number
  blind: number
  word: string
  chips: number
  mult: number
  solveBonus: number
  score: number
}

export type GoldVector = { delta: number; reason: string }

export type Vector = {
  name: string
  covers: string
  seed: number
  contentVersion: number
  actions: Action[]
  expected: {
    guesses: GuessVector[]
    gold: GoldVector[]
    /** Itemised per blind cleared — the gold event only carries the total. */
    rewards: RewardBreakdown[]
    outcome: Phase
    ante: number
    blind: number
    finalGold: number
    jokers: string[]
    /** "A+2" — letter and the chips its etching adds. */
    etched: string[]
    /** "e:steel" — letter and the modifier stuck to it. */
    mods: string[]
    destroyed: string[]
  }
}

/** Everything a vector asserts, read off a finished run. */
function summarise(
  state: RunState,
  guesses: GuessVector[],
  gold: GoldVector[],
  rewards: RewardBreakdown[],
): Vector["expected"] {
  const letters = Object.entries(state.letters)
  return {
    guesses,
    gold,
    rewards,
    outcome: state.phase,
    ante: state.ante,
    blind: state.blindIndex,
    finalGold: state.gold,
    jokers: state.jokers.map((joker) => joker.id),
    etched: letters
      .filter(([, value]) => value.etch > 0)
      .map(([letter, value]) => `${letter}+${value.etch}`)
      .sort(),
    mods: letters
      .filter(([, value]) => value.mod !== null)
      .map(([letter, value]) => `${letter}:${value.mod}`)
      .sort(),
    destroyed: letters
      .filter(([, value]) => value.destroyed)
      .map(([letter]) => letter)
      .sort(),
  }
}

/**
 * Replays a recorded action list. This is what the test runs, and it never
 * consults a scenario — the JSON is the input, so the bots that wrote it can
 * change freely without moving the baseline.
 */
export function replay(
  seed: number,
  actions: readonly Action[],
  words: WordSource,
): Vector["expected"] {
  let state = startRun(seed, words).state
  const guesses: GuessVector[] = []
  const gold: GoldVector[] = []
  const rewards: RewardBreakdown[] = []

  for (const action of actions) {
    // The blind is read *before* the action, because clearing one swaps the
    // blind out and a guess scored on the way belongs to the blind it was
    // played in, not the one that replaced it.
    const ante = state.ante
    const blind = state.blindIndex
    const before = state.blind.guesses.length
    const wasRewarding = state.phase === "reward"

    const result = reduce(state, action, words)
    state = result.state
    collectGold(result.events, gold)
    if (!wasRewarding && state.phase === "reward" && state.reward) rewards.push(state.reward)

    const scored = state.blind.guesses[before]
    if (state.blind.guesses.length > before && scored) {
      guesses.push({
        ante,
        blind,
        word: scored.word,
        chips: scored.chips,
        mult: scored.mult,
        solveBonus: scored.solveBonus,
        score: scored.score,
      })
    }
  }

  return summarise(state, guesses, gold, rewards)
}

function collectGold(events: readonly GameEvent[], into: GoldVector[]): void {
  for (const event of events) {
    if (event.type === "gold") into.push({ delta: event.delta, reason: event.reason })
  }
}

/**
 * Plays a scenario and records what it did. The action cap is a recorder
 * guard, not a rule: a bot that stops producing actions ends the vector, and
 * one that never stops would otherwise write a vector the size of the repo.
 */
export function record(scenario: Scenario, words: WordSource, contentVersion: number): Vector {
  let state = startRun(scenario.seed, words).state
  const actions: Action[] = []

  for (let step = 0; step < 2000; step++) {
    if (state.phase === "game_over" || state.phase === "victory") break
    const batch = scenario.next(state, words)
    if (!batch || batch.length === 0) break
    for (const action of batch) {
      actions.push(action)
      state = reduce(state, action, words).state
    }
  }

  return {
    name: scenario.name,
    covers: scenario.covers,
    seed: scenario.seed,
    contentVersion,
    actions,
    expected: replay(scenario.seed, actions, words),
  }
}
