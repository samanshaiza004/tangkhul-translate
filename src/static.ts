import { Elysia } from "elysia";

interface StaticAsset {
  path: string;
  contentType: string;
  cacheControl: string;
}

const ASSETS: Record<string, StaticAsset> = {
  "/static/app.css": {
    path: "public/app.css",
    contentType: "text/css; charset=utf-8",
    cacheControl: "no-cache",
  },
  "/static/htmx-2.0.10.min.js": {
    path: "public/htmx-2.0.10.min.js",
    contentType: "text/javascript; charset=utf-8",
    cacheControl: "public, max-age=31536000, immutable",
  },
  "/static/app.js": {
    path: "public/app.js",
    contentType: "text/javascript; charset=utf-8",
    cacheControl: "no-cache",
  },
  "/static/mannerhtml-form-0.2.0.js": {
    path: "public/mannerhtml-form-0.2.0.js",
    contentType: "text/javascript; charset=utf-8",
    cacheControl: "public, max-age=31536000, immutable",
  },
  "/static/mannerhtml-register.js": {
    path: "public/mannerhtml-register.js",
    contentType: "text/javascript; charset=utf-8",
    cacheControl: "no-cache",
  },
};

export function createStaticRoutes() {
  let app = new Elysia();
  for (const [route, asset] of Object.entries(ASSETS)) {
    app = app.get(route, ({ set }) => {
      set.headers["Content-Type"] = asset.contentType;
      set.headers["Cache-Control"] = asset.cacheControl;
      return Bun.file(asset.path);
    });
  }
  return app;
}
