import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

// Development serves bundles and index.json from ../data. A build is only the viewer (relative paths, so it works in
// any folder of a site); the site provides index.json and data/ next to it (evdtools sync).
export default defineConfig(({ command }) => ({
  plugins: [preact()],
  base: "./",
  publicDir: command === "serve" ? "../data" : false,
  server: { port: 5173, strictPort: true },
}));
