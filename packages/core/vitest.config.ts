import { defineConfig } from "vitest/config";

// ponytail: satu config, di sebelah tes yang dijalankannya. Config root menyusul
// kalau apps/web nanti punya suite sendiri.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
