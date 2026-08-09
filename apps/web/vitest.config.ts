import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Suite kecil apps/web: geometri peta + smoke render komponennya. Pembawa
// kontrak tetap diuji di packages/core; yang butuh vitest DI SINI hanyalah
// berkas .tsx — `node lib/cek.ts` (skrip assert yang sudah ada) tidak bisa
// mem-parse JSX.
export default defineConfig({
  test: { include: ["test/**/*.test.ts", "test/**/*.test.tsx"], environment: "node" },
  // tsconfig apps/web memakai jsx: "preserve" (Next yang mentransformasi saat
  // build), jadi transformer vitest harus diberi tahu sendiri.
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
});
