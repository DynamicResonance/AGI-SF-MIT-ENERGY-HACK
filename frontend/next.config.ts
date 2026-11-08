import type { NextConfig } from "next";

// "standalone" -> small self-contained server for Docker / Railway.
const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
