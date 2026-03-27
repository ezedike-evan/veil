/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Allow imports from outside the Next.js project root (e.g. ../../sdk/src)
    externalDir: true,
  },
}

module.exports = nextConfig
