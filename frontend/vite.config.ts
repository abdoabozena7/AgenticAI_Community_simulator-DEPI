import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

const normalizeBasePath = (value?: string) => {
  const trimmed = (value || "").trim();
  if (!trimmed || trimmed === "/") return "/";
  return `/${trimmed.replace(/^\/+|\/+$/g, "")}/`;
};

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backendUrl = env.VITE_API_URL || "http://localhost:8000";
  const basePath = normalizeBasePath(env.VITE_PUBLIC_BASE_PATH);

  return {
    base: basePath,
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
      proxy: {
        "/auth": { target: backendUrl, changeOrigin: true },
        "/simulation": { target: backendUrl, changeOrigin: true },
        // Keep frontend routes like /research and /court reachable on hard refresh.
        // Only proxy backend API subpaths such as /research/run and /court/run.
        "/research/": { target: backendUrl, changeOrigin: true },
        "/court/": { target: backendUrl, changeOrigin: true },
        "/admin/": { target: backendUrl, changeOrigin: true },
        "/health": { target: backendUrl, changeOrigin: true },
        "/search": { target: backendUrl, changeOrigin: true },
        "/llm": { target: backendUrl, changeOrigin: true },
        "/ws": { target: backendUrl, changeOrigin: true, ws: true },
      },
    },
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
