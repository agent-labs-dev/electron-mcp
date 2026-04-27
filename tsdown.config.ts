import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/types.ts"],
  format: "esm",
  dts: true,
  sourcemap: true,
  clean: true,
  deps: {
    neverBundle: [
      "@modelcontextprotocol/sdk",
      "async-mutex",
      "electron",
      "zod",
      /^node:/,
    ],
  },
});
