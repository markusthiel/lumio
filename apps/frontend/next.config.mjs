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
  // Fallback-Proxy für Direktzugriff auf den Frontend-Port (3000), z.B. per
  // SSH-Tunnel im Quick Start (GitHub-Issue #3). Im Normalbetrieb routet
  // Caddy /api/* bereits VOR dem Frontend zur API — diese Rewrites greifen
  // dann nie. Ziel wird zur Build-Zeit fixiert (output: standalone);
  // Default = Compose-Servicename. Überschreibbar via INTERNAL_API_URL
  // im Build-Environment.
  async rewrites() {
    const api = process.env.INTERNAL_API_URL ?? "http://api:3001";
    return [
      { source: "/api/:path*", destination: `${api}/api/:path*` },
      { source: "/health", destination: `${api}/health` },
    ];
  },
};

export default nextConfig;
