/** @type {import('next').NextConfig} */

const nextConfig = {
  // Fix Turbopack picking the wrong workspace root
  turbopack: {
    root: __dirname, // explicitly set root to this project folder
  },
  async rewrites() {
    const API = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://127.0.0.1:8000';
    return [
      { source: '/auth/:path*', destination: `${API}/auth/:path*` },
      { source: '/tenants/:path*', destination: `${API}/tenants/:path*` },
      { source: '/users/:path*', destination: `${API}/users/:path*` },
      { source: '/units/:path*', destination: `${API}/units/:path*` },
      { source: '/shifts/:path*', destination: `${API}/shifts/:path*` },
      { source: '/pto/:path*', destination: `${API}/pto/:path*` },
      { source: '/swaps/:path*', destination: `${API}/swaps/:path*` },
    ];
  },

  async redirects() {
    return [
      { source: '/', destination: '/login', permanent: false },
    ];
  },

  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
};

module.exports = nextConfig;
