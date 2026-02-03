import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backendUrl = env.VITE_API_URL || "http://localhost:8000";

  return {
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
      proxy: {
        "/auth": { target: backendUrl, changeOrigin: true },
        "/simulation": { target: backendUrl, changeOrigin: true },
        "/research": { target: backendUrl, changeOrigin: true },
        "/court": { target: backendUrl, changeOrigin: true },
        "/admin": { target: backendUrl, changeOrigin: true },
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
