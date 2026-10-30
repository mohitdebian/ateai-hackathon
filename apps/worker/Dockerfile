# ate.ai worker — container image (Vercel Container Runtime & Cloud Run).
# esbuild bundles @ate/shared source + all deps into dist/bundle.js,
# so the runtime image needs no node_modules, no TS toolchain, and
# builds reliably inside any container context (including Vercel monorepo services).

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY dist/bundle.js ./bundle.js
EXPOSE 8080
CMD ["node", "bundle.js"]
