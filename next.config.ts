import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  output: 'standalone',
  // Standalone repo — turbopack root is this package
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
