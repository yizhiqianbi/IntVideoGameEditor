import { serveRemoveOuterwear } from "../../xumeng-gen/lib/remove-outerwear.mjs";

export function removeOuterwearApi(options = {}) {
  return {
    name: "remove-outerwear-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        serveRemoveOuterwear(req, res, options).then(handled => {
          if (!handled) next();
        }).catch(next);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        serveRemoveOuterwear(req, res, options).then(handled => {
          if (!handled) next();
        }).catch(next);
      });
    },
  };
}
