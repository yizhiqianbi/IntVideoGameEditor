import { register } from "node:module";

register(new URL("./resolve-ts-extension.mjs", import.meta.url).href, import.meta.url);
