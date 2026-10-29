// node --import file:///…/tools/chaos/register.mjs — see stub-loader.mjs
import { register } from "node:module";
register("./stub-loader.mjs", import.meta.url);
