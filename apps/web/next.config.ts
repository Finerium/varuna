import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @varuna/core dipublikasikan sebagai TypeScript mentah (exports -> ./src/*.ts),
  // jadi bundler apps/web yang mentranspilasinya. architecture.md: satu runtime TS.
  transpilePackages: ["@varuna/core", "@varuna/agents"],
  // Golden set dibaca dari filesystem saat permintaan datang, jadi berkasnya
  // harus ikut terbawa ke bundel serverless — bukan hanya ada saat build.
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
  outputFileTracingIncludes: {
    "/**": ["../../packages/core/golden/**"],
  },
  typedRoutes: true,
};

export default nextConfig;
