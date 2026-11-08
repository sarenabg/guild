import type { NextConfig } from "next";

// Two ways to run Guild:
//  - Everything in one server (local, or Google Cloud Run): leave GUILD_BACKEND_URL empty.
//  - Website on Vercel, runner on Cloud Run: set GUILD_BACKEND_URL on Vercel to the Cloud Run URL.
//    Every /api call is then forwarded there, so the browser only ever talks to one address.
const backend = process.env.GUILD_BACKEND_URL?.replace(/\/+$/, "");

const nextConfig: NextConfig = {
  // Lets a production build run in a separate folder while the dev server keeps using .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  devIndicators: false,
  // A small self-contained server for the Cloud Run container.
  output: process.env.GUILD_STANDALONE === "1" ? "standalone" : undefined,
  // This folder is the project root (stops Next from guessing a parent folder).
  outputFileTracingRoot: process.cwd(),
  async rewrites() {
    return backend ? { beforeFiles: [{ source: "/api/:path*", destination: `${backend}/api/:path*` }], afterFiles: [], fallback: [] } : [];
  },
};

export default nextConfig;
