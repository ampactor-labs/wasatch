import { defineConfig } from "vitest/config";

// Served at ampactor.dev/wasatch/ by GitHub Pages, like noodles.
export default defineConfig({
  root: "web",
  base: "/wasatch/",
  publicDir: "public",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    target: "es2022",
    assetsInlineLimit: 0,
  },
  worker: { format: "es" },
  test: {
    root: ".",
    include: ["web/src/**/*.test.ts"],
    environment: "node",
  },
});
