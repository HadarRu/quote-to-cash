import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source.
  transpilePackages: ['@q2c/ui', '@q2c/utils', '@q2c/types'],
};

export default nextConfig;
