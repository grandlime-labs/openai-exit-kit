import { build } from "esbuild";
import { chmodSync } from "node:fs";

await build({
  entryPoints: ["src/cli/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: "dist/cli/index.js",
  banner: { js: '#!/usr/bin/env node\nimport { createRequire as __cr } from "node:module";\nconst require = __cr(import.meta.url);' },
});
chmodSync("dist/cli/index.js", 0o755);
console.log("built dist/cli/index.js");
