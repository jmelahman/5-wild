# 5 Wild

A Wordle roguelike. Every guess is a hand played: letters carry chip values,
feedback colours carry multipliers, and jokers bend the arithmetic. Beat a score
target per blind, shop between blinds, survive eight antes.

Guesses are one currency spent on two competing goals — information or income —
and solving pays a tempo bonus but ends the blind on the spot. That tension is
the game.

## Running it

```sh
npm ci
npm run dev        # http://localhost:5173
```

Quality gate, the same three commands CI runs:

```sh
npm run typecheck
npm run check      # Biome lint + format
npm test           # Vitest
```

## Building the APK

The web build is wrapped by Capacitor. CI produces a debug APK as a workflow
artifact (`5-wild-debug-apk`) on every push, which is the intended way to get it
onto a phone:

```sh
gh run download -n 5-wild-debug-apk
adb install -r app-debug.apk
```

Building locally additionally needs a JDK and the Android SDK:

```sh
npm run apk        # build + cap sync + gradlew assembleDebug
```

## Layout

```
src/engine/     pure TypeScript rules engine — no DOM, no clocks, no ambient RNG
src/content/    letter tables and blind curves
src/ui/         DOM rendering and the scoring animation
public/words/   answer and allowed-guess lists
test/           unit tests, a headless full-run bot, and the engine-purity guard
tools/          word-list generation
android/        Capacitor's Android project, committed
```

`src/engine` is deliberately kept portable: it imports nothing outside itself and
`src/content`, and touches no ambient nondeterminism. `test/engine-purity.test.ts`
enforces that in CI rather than by discipline.
