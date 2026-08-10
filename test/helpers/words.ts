import { readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { WordSource } from "../../src/engine"

const WORDS = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "words")

const load = (name: string) => readFileSync(join(WORDS, name), "utf8").split("\n").filter(Boolean)

/** The real shipped lists, for tests that want to exercise the game as played. */
export const realWords: WordSource = {
  answers: load("answers.txt"),
  allowed: new Set(load("allowed.txt")),
}
