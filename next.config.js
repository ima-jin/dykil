/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: '/dykil',
  env: { NEXT_PUBLIC_BASE_PATH: '/dykil' },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.imajin.ai',
      },
    ],
  },
};

module.exports = nextConfig;
