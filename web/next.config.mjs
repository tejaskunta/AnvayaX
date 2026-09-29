/** @type {import('next').NextConfig} */
const nextConfig = {
  // better-sqlite3 is a native module; Next already treats it as external
  // (require'd, not bundled) in 14.2, so the .node binary loads at runtime.
  // The demo corpus is opened via a runtime-constructed path (db/client.ts),
  // which @vercel/nft cannot see, so force the committed snapshot into every
  // server function's output trace. On Vercel it is then copied to /tmp.
  experimental: {
    outputFileTracingIncludes: {
      "/*": ["./db/snapshot.db"],
    },
  },
};

export default nextConfig;
