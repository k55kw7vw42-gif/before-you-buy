import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // node:sqlite is a Node built-in; keep it (and the AI SDK) out of the bundler.
  serverExternalPackages: ["@anthropic-ai/sdk"],
  experimental: {
    serverActions: {
      // Screenshots are posted to a route handler, not a server action, but keep
      // the ceiling aligned with MAX_IMAGE_BYTES so limits are enforced in one place.
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
