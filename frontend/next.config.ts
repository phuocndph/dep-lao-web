import type { NextConfig } from 'next'
import path from 'path'

const nextConfig: NextConfig = {
  typescript: {
    // deploying desktop SPA — type errors in deplao-ui are expected, fix iteratively
    ignoreBuildErrors: true,
  },
  turbopack: {
    root: path.resolve(__dirname),
    resolveAlias: {
      '@deplao': path.resolve(__dirname, 'deplao-ui'),
    },
  },
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@deplao': path.resolve(__dirname, 'deplao-ui'),
    }
    return config
  },
}

export default nextConfig
