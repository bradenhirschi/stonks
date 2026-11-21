import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Invite links from before the site hosted more than one game were `/?room=CODE`
  // (Stock Market rooms). The room query string is passed through.
  async redirects() {
    return [
      {
        source: "/",
        has: [{ type: "query", key: "room" }],
        destination: "/stock-market",
        permanent: false,
      },
    ];
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
