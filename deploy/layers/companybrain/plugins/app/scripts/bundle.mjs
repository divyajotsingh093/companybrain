import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dist = join(import.meta.dirname, "..", "dist", "assets");
const js = readdirSync(dist).filter((f) => f.endsWith(".js"));
const css = readdirSync(dist).filter((f) => f.endsWith(".css"));
if (js.length !== 1) throw new Error(`expected one bundle, found ${js.length}`);

const target = join(import.meta.dirname, "..", "..", "board", "src", "app-bundle.ts");
const encode = (file) => Buffer.from(readFileSync(join(dist, file))).toString("base64");
writeFileSync(
  target,
  [
    `export const APP_JS_BASE64 =`,
    `  "${encode(js[0])}";`,
    ``,
    `export const APP_CSS_BASE64 =`,
    `  "${css.length ? encode(css[0]) : ""}";`,
    ``,
  ].join("\n"),
);
console.log(`bundled ${js[0]} (${readFileSync(join(dist, js[0])).length} bytes) into the board`);
