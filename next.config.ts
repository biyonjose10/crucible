import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Pin the workspace root to this directory. Without it, Turbopack walks up
    // and finds an unrelated package-lock.json in the parent folder, warns, and
    // guesses. Being explicit keeps local builds identical to CI.
    root: path.resolve(import.meta.dirname),
  },
};

export default nextConfig;
