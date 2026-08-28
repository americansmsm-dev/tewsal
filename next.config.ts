import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // ⚠️ لازم للنشر بـ Docker — بيطلّع نسخة standalone صغيرة
  //    (الـ Dockerfile بيعتمد على .next/standalone)
  output: "standalone",
  // الحزم اللي بتشتغل على السيرفر بس — متتحطش في باندل العميل
  serverExternalPackages: ["postgres", "@node-rs/argon2"],
};

export default nextConfig;
