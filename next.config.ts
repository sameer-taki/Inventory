import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Type errors must fail the build (invariant I4/P4 — correctness first).
  typescript: { ignoreBuildErrors: false },
  // ESLint is advisory here; CI runs `typecheck` as the hard gate.
  eslint: { ignoreDuringBuilds: true },
  reactStrictMode: true,
};

export default nextConfig;
