import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Allow ZeroAI Workspace to iframe /embed
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          {
            key: 'Access-Control-Allow-Methods',
            value: 'GET, POST, OPTIONS',
          },
          {
            key: 'Access-Control-Allow-Headers',
            value: 'Content-Type, Authorization, Accept',
          },
          // Permit embed from ZeroAI hosts
          {
            key: 'Content-Security-Policy',
            value:
              "frame-ancestors 'self' https://*.vercel.app https://zerroai.space http://localhost:3000 http://127.0.0.1:3000",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
