/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'i.ytimg.com' },
      { protocol: 'https', hostname: 'img.youtube.com' },
      { protocol: 'https', hostname: '*.ytimg.com' },
      { protocol: 'https', hostname: 'i9.ytimg.com' },
    ],
  },
  // /api/* is handled by app/api/[...path]/route.ts which properly proxies
  // to the FastAPI backend, preserving Range headers and streaming responses.
};

export default nextConfig;
