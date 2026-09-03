import type { NextConfig } from "next";

const config: NextConfig = {
  // Leaflet is mounted once and then owns its own DOM. Strict mode's double
  // mount in development is exactly the case react-leaflet's container
  // handling exists for, so leaving this on is a real test of it.
  reactStrictMode: true,
};

export default config;
