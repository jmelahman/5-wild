import { defineConfig } from "vitest/config"

export default defineConfig({
  // Relative asset paths: Capacitor serves the bundle from a non-root scheme,
  // so absolute "/assets/..." URLs 404 inside the APK.
  base: "./",
  build: {
    target: "es2022",
    outDir: "dist",
  },
  server: {
    // host:true exposes the dev server on the LAN so a physical phone can
    // load it via capacitor.config server.url for live reload.
    host: true,
    port: 5173,
  },
  test: {
    // The engine is pure and DOM-free, so node is the right default. UI tests
    // opt into jsdom per-file with an @vitest-environment docblock.
    environment: "node",
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
  },
})
