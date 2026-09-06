import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    // ⚠️ لازم app/ تكون هنا — من غيرها أي اختبار يتكتب فيها
    //    بيتجاهَل **بصمت** وتفتكر إن عندك تغطية وهي مش موجودة.
    include: ["src/**/*.test.ts", "app/**/*.test.ts", "app/**/*.test.tsx"],
    // اختبارات المتصفح (Playwright) ليها مشغّلها الخاص
    exclude: ["node_modules/**", ".next/**", "e2e/**"],
    reporters: ["verbose"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
