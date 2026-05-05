/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

import fs from "fs";
import path from "path";

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    {
      name: "copy-sample-files",
      closeBundle() {
        const srcDir = path.resolve(__dirname, "sample");
        const destDir = path.resolve(__dirname, "dist", "sample");
        if (fs.existsSync(srcDir)) {
          fs.mkdirSync(destDir, { recursive: true });
          fs.readdirSync(srcDir).forEach((file) => {
            fs.copyFileSync(
              path.join(srcDir, file),
              path.join(destDir, file),
            );
          });
        }
      },
    },
  ],
  test: {
    include: ["src/**/*.test.ts"],
  },
});
