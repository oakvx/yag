import path from "path";
import { fileURLToPath } from "url";
import { readFileSync, readdirSync } from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile(), {
    name: "yag-original-public-assets",
    apply: "build",
    generateBundle() {
      // Keep user files on disk, but do not publish the old proprietary media slots.
      const publicRoot = path.join(__dirname, "public");
      const excluded = /^(?:fonts\/(?:PS4-Logo\.otf|SCE-PS3-Rodin-LATIN\.(?:ttf|woff2))|audio\/(?:start|cursor|select|cancel|trophy)\.mp3)$/i;
      const emit = (directory: string) => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          const absolute = path.join(directory, entry.name);
          if (entry.isDirectory()) emit(absolute);
          else if (entry.isFile()) {
            const fileName = path.relative(publicRoot, absolute).split(path.sep).join("/");
            if (!excluded.test(fileName)) this.emitFile({ type: "asset", fileName, source: readFileSync(absolute) });
          }
        }
      };
      emit(publicRoot);
    },
  }],
  build: { copyPublicDir: false },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
