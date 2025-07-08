import type { NextConfig } from 'next'
import type { Configuration } from 'webpack'
import path from 'path'

const nextConfig: NextConfig = {
  webpack(config: Configuration) {
    config.resolve = config.resolve || {}
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      '@': path.resolve(__dirname, 'src'),
    }
    return config
  },
}

export default nextConfig
