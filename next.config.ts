import type { NextConfig } from "next";

const chartRuntime = ["./node_modules/mcp-echarts/fonts/*.otf", "./node_modules/@napi-rs/canvas-*/**/*.node"];

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  output: "standalone",
  outputFileTracingRoot: process.cwd(),
  serverExternalPackages: ["mcp-echarts"],
  outputFileTracingIncludes: {
    "/api/visualization": chartRuntime,
    "/api/mcp/visualization": chartRuntime,
  },
};

export default nextConfig;
