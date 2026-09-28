import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  async redirects() {
    return [
      // Email confirmation moved from /verify to /confirm-email so /verify can be
      // the public receipt lookup. Old links carry ?email=, and the query string
      // passes through to the destination.
      {
        source: "/verify",
        has: [{ type: "query", key: "email" }],
        destination: "/confirm-email",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
