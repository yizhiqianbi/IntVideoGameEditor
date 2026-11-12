import { serveNovel } from "../../xumeng-gen/lib/novel-request.mjs";

export function novelApi(options = {}) {
  return {
    name: "novel-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        serveNovel(req, res, options).then(handled => {
          if (!handled) next();
        }).catch(next);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        serveNovel(req, res, options).then(handled => {
          if (!handled) next();
        }).catch(next);
      });
    },
  };
}
