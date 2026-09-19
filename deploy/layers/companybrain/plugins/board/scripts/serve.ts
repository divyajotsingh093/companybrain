import { serve } from "@hono/node-server";
import app from "../src/index.ts";
import { loadConfig } from "../src/config.ts";

const config = loadConfig();

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`companybrain board listening on :${info.port} (${config.publicUrl})`);
});
