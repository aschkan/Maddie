import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Every server-side upstream goes out through undici with an explicit
  // dispatcher (see src/lib/http/fetch.ts). Nothing here may be bundled for
  // the browser.
  serverExternalPackages: ["undici", "tz-lookup"],
};

export default config;
