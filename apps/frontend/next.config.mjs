/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  images: {
    // Renditions kommen aus S3 oder CDN — exakte Hosts kommen via Env später dazu
    remotePatterns: [
      { protocol: "http", hostname: "minio" },
      { protocol: "http", hostname: "localhost" },
      { protocol: "https", hostname: "**" },
    ],
  },
  experimental: {
    // serverActions: { bodySizeLimit: "10mb" },
  },
};

export default nextConfig;
