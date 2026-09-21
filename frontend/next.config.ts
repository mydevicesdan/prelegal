import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static export: FastAPI serves the generated /out directory. trailingSlash makes
  // /documents export as documents/index.html so the backend can serve it without rewrites.
  output: "export",
  trailingSlash: true,
};

export default nextConfig;
