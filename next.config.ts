import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  output: "standalone",
  outputFileTracingRoot: process.cwd(),
  serverExternalPackages: ["mcp-echarts"],
  outputFileTracingIncludes: {
    "/api/visualization": ["./node_modules/mcp-echarts/fonts/*.otf", "./node_modules/@napi-rs/canvas-*/**/*.node"],
  },
};

export default nextConfig;
