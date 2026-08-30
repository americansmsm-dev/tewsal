# ============================================================
#  Tewsal — صورة التطبيق
#  متعددة المراحل عشان الصورة النهائية تبقى صغيرة
#  نفس الصورة بتشغّل التطبيق أو الـ worker (بيتحدد بالـ CMD)
# ============================================================

# ---------- المرحلة ١: الاعتماديات ----------
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts && cp -R node_modules /prod_modules
# ⚠️ --include=dev إجباري: البناء (next/tailwind/typescript) محتاج devDependencies
#    حتى لو NODE_ENV=production اتحقن من منصة النشر (Coolify بيحقنها)
RUN npm ci --include=dev --ignore-scripts

# ---------- المرحلة ٢: البناء ----------
FROM node:22-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---------- المرحلة ٣: التشغيل ----------
FROM node:22-alpine AS runner
WORKDIR /app

# ⚠️ توقيت القاهرة — عشان الكرون والتقارير تتطابق مع حدس المالك
RUN apk add --no-cache tzdata curl && \
    cp /usr/share/zoneinfo/Africa/Cairo /etc/localtime && \
    echo "Africa/Cairo" > /etc/timezone
ENV TZ=Africa/Cairo
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# مستخدم غير جذر
RUN addgroup -g 1001 -S nodejs && adduser -S tewsal -u 1001

COPY --from=builder --chown=tewsal:nodejs /app/.next/standalone ./
COPY --from=builder --chown=tewsal:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=tewsal:nodejs /app/public ./public

# ملفات الـ worker والـ migrations والسكربتات
COPY --from=deps    --chown=tewsal:nodejs /prod_modules ./node_modules
COPY --from=builder --chown=tewsal:nodejs /app/src/server/db/migrations ./src/server/db/migrations
COPY --from=builder --chown=tewsal:nodejs /app/scripts ./scripts
COPY --from=builder --chown=tewsal:nodejs /app/src ./src
COPY --from=builder --chown=tewsal:nodejs /app/package.json ./package.json
# tsconfig.json لازم عشان tsx يحلّ اختصار "@/*" في السكربتات اللي بتستورد خدمات
COPY --from=builder --chown=tewsal:nodejs /app/tsconfig.json ./tsconfig.json

# entrypoint: migrate + seed (idempotent) ثم تشغيل السيرفر
COPY --chown=tewsal:nodejs docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

USER tewsal
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=5 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

CMD ["./docker-entrypoint.sh"]
