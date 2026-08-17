import "./style.css"
import type { WordSource } from "./engine"
import { App, loadSave } from "./ui/app"

/**
 * The shell. Its whole job is to load the two things the engine refuses to
 * load itself, the word lists, and hand them to a pure state machine.
 */

const app = document.querySelector<HTMLDivElement>("#app")
if (!app) throw new Error("#app missing from index.html")

async function loadWords(): Promise<WordSource> {
  const base = import.meta.env.BASE_URL
  const read = async (name: string): Promise<string[]> => {
    const response = await fetch(`${base}words/${name}.txt`)
    if (!response.ok) throw new Error(`${name}.txt: ${response.status}`)
    return (await response.text()).split("\n").filter(Boolean)
  }
  const [answers, allowed] = await Promise.all([read("answers"), read("allowed")])
  return { answers, allowed: new Set(allowed) }
}

loadWords()
  .then((words) => {
    new App(app, words, loadSave()).start()
  })
  .catch((error: unknown) => {
    app.replaceChildren()
    const note = document.createElement("div")
    note.className = "screen center"
    note.textContent = `Could not load the word lists: ${String(error)}`
    app.append(note)
  })
