import type { NextConfig } from "next";

const chartRuntime = ["./node_modules/mcp-echarts/fonts/*.otf", "./node_modules/@napi-rs/canvas-*/**/*.node"];

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  output: "standalone",
  outputFileTracingRoot: process.cwd(),
  async headers() {
    return [{
      source: "/intro/graced-night-v1.:format(mp4|webp)",
      headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
    }];
  },
  serverExternalPackages: ["mcp-echarts"],
  outputFileTracingIncludes: {
    "/api/xiaoyun": ["./src/lib/xiaoyun/skills/*/SKILL.md"],
    "/api/visualization": chartRuntime,
    "/api/mcp/visualization": chartRuntime,
  },
};

export default nextConfig;
