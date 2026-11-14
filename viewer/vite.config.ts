import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import preact from "@preact/preset-vite";
import { defineConfig, type Plugin } from "vite";

// The development server stands in for the site, which serves the viewer next to index.json and data/:
// - bundles and indexes are in ../data, answered at / (index.json's own entries) and also under /data/, where the
//   site keeps them, so a person's area ../data/u/<login>/ is at data/u/<login>/ as on the site;
// - a bundle or an index that is not there is a 404, as on the site (Vite would answer with the page itself);
// - `whoami` (on the site a small script behind the single sign-on, saying who is signed in): EVD_WHOAMI=<login>
//   answers with that login, unset there is no such page, so both ways of knowing whose "My files" to list can be tried.
const DATA = fileURLToPath(new URL("../data", import.meta.url));
const site = (): Plugin => ({
  name: "evd-site",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const [path, query = ""] = (req.url ?? "").split("?");
      if (path === "/whoami") {
        const login = process.env.EVD_WHOAMI;
        res.statusCode = login ? 200 : 404;
        res.setHeader("Content-Type", "application/json");
        return res.end(login ? JSON.stringify({ login }) : "{}");
      }
      const file = path.startsWith("/data/") ? path.slice(5) : path;
      const decoded = (() => {
        try {
          return decodeURIComponent(path);
        } catch {
          return null;
        }
      })(); // e.g. "%E0": no such file
      if (
        decoded === null ||
        (/\.evdb$|\/index\.json$/.test(file) && !existsSync(join(DATA, decodeURIComponent(file))))
      ) {
        res.statusCode = 404;
        return res.end();
      }
      if (file !== path) req.url = file + (query && `?${query}`);
      next();
    });
  },
});

// Development serves bundles and index.json from ../data. A build is only the viewer (relative paths, so it works in
// any folder of a site); the site provides index.json and data/ next to it (evdtools sync).
export default defineConfig(({ command }) => ({
  plugins: [preact(), site()],
  base: "./",
  publicDir: command === "serve" ? "../data" : false,
  server: { port: 5173, strictPort: true },
}));
