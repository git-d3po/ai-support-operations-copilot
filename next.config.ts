import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root explicitly: an unrelated package-lock.json in
  // the parent directory (outside this git repo) otherwise makes Next's
  // root inference guess wrong and warn on every build.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
