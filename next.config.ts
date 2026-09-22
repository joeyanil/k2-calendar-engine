import type { NextConfig } from 'next'

/**
 * K2 Calendar Engine runs as a first-class subsystem inside the K2 Next.js
 * application — no separate backend, no separate runtime (02_Technology_Architecture.md).
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
}

export default nextConfig
