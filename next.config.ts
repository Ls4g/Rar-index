import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev-only. Next blocks its own dev resources (/_next/webpack-hmr and the
  // client bundle bootstrap) from hosts it considers cross-origin, and the
  // browser tooling on this machine cannot attach to "localhost" — it can only
  // open 127.0.0.1. Without this, a locally served page renders its server
  // HTML but never hydrates, so every interactive control looks broken and a
  // UI change cannot actually be verified. Has no effect on a production
  // build; see AGENTS.md on why local verification keeps failing here.
  allowedDevOrigins: ["127.0.0.1"],
  // The demo collector gallery used to live under a "design concept" path.
  // Old links keep working.
  async redirects() {
    return [
      { source: "/design-concept/collector", destination: "/demo", permanent: true },
      { source: "/design-concept", destination: "/", permanent: true },
    ];
  },
};

export default nextConfig;
