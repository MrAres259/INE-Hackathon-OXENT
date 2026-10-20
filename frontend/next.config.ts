import type { NextConfig } from "next";

const backendUrl = process.env.BACKEND_URL ?? "http://localhost:8001";

// Builds launched by automated agents set NEXT_AGENT_BUILD=1. Inside the agent
// terminal sandbox on Windows, the build's worker processes (one per CPU) and
// its in-build TypeScript pass have hung on inter-process pipes, so agent builds
// use a single worker and skip the in-build type check. The type check is not
// lost: agents run `npm run typecheck` (tsc --noEmit) as its own step.
// Normal builds (people, the demo scripts) keep the full defaults.
const agentBuild = process.env.NEXT_AGENT_BUILD === "1";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: agentBuild,
  },
  ...(agentBuild ? { experimental: { cpus: 1 } } : {}),
  async rewrites() {
    return [
      {
        source: "/api/:path((?!admin(?:/|$)).*)",
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
