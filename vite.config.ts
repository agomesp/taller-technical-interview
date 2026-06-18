import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "client",
  server: {
    port: 5173,
    proxy: {
      // Anchor to "/api/" via a regex key (Vite treats keys starting with "^"
      // as RegExp). A bare "/api" matches by PREFIX, so it also swallowed the
      // "/api.ts" source-module request and forwarded it to the backend -> 404.
      "^/api/": "http://localhost:3000",
    },
  },
});
