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
import { placeMod } from "./scenarios"

/** One scored guess, with the round it belonged to so a failure can be placed. */
export type GuessVector = {
  stage: number
  round: number
  word: string
  chips: number
  mult: number
  solveBonus: number
  score: number
  /**
   * What the boss told the player instead of showing it. Recorded because it is
   * a rule's output that a player can act on, so a reimplementation that counted
   * it wrong would be wrong in a way no score here would catch. Omitted when
   * there is none, which is every guess under eleven of the twelve bosses.
   */
  note?: string
}

export type GoldVector = { delta: number; reason: string }

export type Vector = {
  name: string
  covers: string
  seed: number
  /**
   * The difficulty the run was recorded at, omitted for the ordinary game. Part
   * of the input rather than of the expectation: an ascension changes which
   * words the engine will accept and which answers it will deal, so a replay
   * that started at the wrong level would not be replaying the same run.
   */
  ascension?: number
  contentVersion: number
  actions: Action[]
  expected: {
    guesses: GuessVector[]
    gold: GoldVector[]
    /** Itemised per round cleared — the gold event only carries the total. */
    rewards: RewardBreakdown[]
    outcome: Phase
    stage: number
    round: number
    finalGold: number
    relics: string[]
    /** "A+2" — letter and the chips its etching adds. */
    etched: string[]
    /** "e:steel" — letter and the modifier stuck to it. */
    mods: string[]
    /** "distinct:3" — word category and the level it was bought up to. */
    levels: string[]
    /** "range_ae:2" — alphabet slice and the level it was bought up to. */
    ranges: string[]
    /** "snowball:mult=310" — what each growing relic has banked. */
    grown: string[]
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
    stage: state.stage,
    round: state.roundIndex,
    finalGold: state.gold,
    relics: state.relics.map((relic) => relic.id),
    etched: letters
      .filter(([, value]) => value.etch > 0)
      .map(([letter, value]) => `${letter}+${value.etch}`)
      .sort(),
    mods: letters
      .filter(([, value]) => value.mod !== null)
      .map(([letter, value]) => `${letter}:${value.mod}`)
      .sort(),
    // The third permanent upgrade line, recorded beside the other two: a
    // levelling bug that happens not to move a score is still a bug, and this
    // is what makes the diff say which levels a run actually bought.
    levels: Object.entries(state.levels ?? {})
      .map(([id, level]) => `${id}:${level}`)
      .sort(),
    // The other levelled line, recorded beside its twin. Kept separate from
    // `etched` even though both end up as chips on a letter, because the diff
    // has to be able to say *which* upgrade a run bought — the two crosscut, so
    // a total alone could not tell a levelled range from an etched group.
    ranges: Object.entries(state.ranges ?? {})
      .map(([id, level]) => `${id}:${level}`)
      .sort(),
    // The fourth line that outlives a round. Recorded for the same reason as
    // `levels`: a relic that banks the wrong amount is a bug even on the runs
    // where the wrong amount happens to score the same, and this is the only
    // place the number is ever written down.
    grown: state.relics
      .flatMap((relic) =>
        Object.entries(relic.data ?? {}).map(([key, value]) => `${relic.id}:${key}=${value}`),
      )
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
  ascension = 0,
): Vector["expected"] {
  let state = startRun(seed, words, ascension).state
  const guesses: GuessVector[] = []
  const gold: GoldVector[] = []
  const rewards: RewardBreakdown[] = []

  for (const action of actions) {
    // The round is read *before* the action, because clearing one swaps the
    // round out and a guess scored on the way belongs to the round it was
    // played in, not the one that replaced it.
    const stage = state.stage
    const round = state.roundIndex
    const before = state.round.guesses.length
    const wasRewarding = state.phase === "reward"

    const result = reduce(state, action, words)
    state = result.state
    collectGold(result.events, gold)
    if (!wasRewarding && state.phase === "reward" && state.reward) rewards.push(state.reward)

    const scored = state.round.guesses[before]
    if (state.round.guesses.length > before && scored) {
      guesses.push({
        stage,
        round,
        word: scored.word,
        chips: scored.chips,
        mult: scored.mult,
        solveBonus: scored.solveBonus,
        score: scored.score,
        ...(scored.note ? { note: scored.note } : {}),
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
  const ascension = scenario.ascension ?? 0
  let state = startRun(scenario.seed, words, ascension).state
  const actions: Action[] = []

  for (let step = 0; step < 2000; step++) {
    if (state.phase === "game_over" || state.phase === "victory") break
    // A modifier in hand is not a decision a bot may defer: the shop refuses
    // every other action until it is placed. Handled here rather than in each
    // scenario because it is forced, and because a bot that bought one by
    // accident would otherwise stall against a shop it cannot leave.
    const batch = state.placing ? placeMod(state) : scenario.next(state, words)
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
    // Written only when there is one, so every vector recorded before ascensions
    // existed re-records byte for byte.
    ...(ascension > 0 ? { ascension } : {}),
    contentVersion,
    actions,
    expected: replay(scenario.seed, actions, words, ascension),
  }
}
