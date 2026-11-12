import { serveStudio } from "../../xumeng-gen/lib/studio-page.mjs";

export function studioApi(options = {}) {
  const attach = server => {
    server.middlewares.use((req, res, next) => {
      serveStudio(req, res, options).then(handled => {
        if (!handled) next();
      }).catch(next);
    });
  };
  return {
    name: "studio-api",
    configureServer: attach,
    configurePreviewServer: attach,
  };
}
