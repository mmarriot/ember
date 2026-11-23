import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import preact from "@preact/preset-vite";
import { defineConfig, type Plugin } from "vite";

// The bundles and indexes the development server serves (the repository's data/ folder).
const DATA = fileURLToPath(new URL("../data", import.meta.url));

/** `s` URL-decoded, or null if it is not valid (e.g. "%E0"). */
function decoded(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

/** Makes the development server answer as the site does (the viewer next to index.json and data/):
 *  - bundles and indexes in ../data are served at / (where the site's index.json names them) and under /data/ (where
 *    the site keeps them, so ../data/u/<login>/ is at data/u/<login>/);
 *  - a missing bundle or index is a 404, as on the site (Vite would answer with the page itself);
 *  - `whoami` (on the site, a script behind the single sign-on) answers with the login in EMBER_WHOAMI, or 404
 *    without it, so both ways the viewer learns whose "My files" to list (the site says, or the person types it) can
 *    be tried. */
const site = (): Plugin => ({
  name: "ember-site",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const [path, query = ""] = (req.url ?? "").split("?");
      if (path === "/whoami") {
        const login = process.env.EMBER_WHOAMI;
        res.statusCode = login ? 200 : 404;
        res.setHeader("Content-Type", "application/json");
        return res.end(login ? JSON.stringify({ login }) : "{}");
      }
      const file = path.startsWith("/data/") ? path.slice(5) : path,
        name = decoded(file); // decodable exactly when `path` is: "/data" is plain ASCII
      if (name === null || (/\.(ember|evdb)$|\/index\.json$/.test(file) && !existsSync(join(DATA, name)))) {
        res.statusCode = 404;
        return res.end();
      }
      if (file !== path) req.url = file + (query && `?${query}`);
      next();
    });
  },
});

// Development serves the bundles and index.json from ../data. A build is the viewer alone, with relative paths so
// that it works in any folder of a site; the site provides index.json and data/ next to it (ember sync).
export default defineConfig(({ command }) => ({
  plugins: [preact(), site()],
  base: "./",
  publicDir: command === "serve" ? "../data" : false,
  server: { port: 5173, strictPort: true },
}));
