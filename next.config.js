/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  compress: true,
  experimental: {
    serverActions: { bodySizeLimit: '5mb' },
    optimizePackageImports: ['react-markdown', 'remark-gfm', 'rehype-raw', 'rehype-sanitize'],
  },
};
module.exports = nextConfig;
