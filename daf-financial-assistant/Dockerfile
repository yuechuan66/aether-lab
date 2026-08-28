# syntax=docker/dockerfile:1
# DAF Financial Assistant — DSH server (carrier mode).
# Verified contract: DSH 0.1.1-rc.2, profile = dsh-base + dsh-web-app + @daf/dsh-server-api.

# ---- Build stage: install dsh, assemble $DSH_HOME (server profile + plugin) ----
FROM node:22-slim AS builder

RUN npm config set registry https://registry.npmjs.org/ \
    && npm install -g @deepseek-ai/dsh@0.1.1-rc.2 pnpm@9

WORKDIR /build/repo
COPY plugins/ plugins/
COPY dsh-home/ dsh-home/

# Build the carrier plugin (TS -> lib/index.js).
RUN cd plugins/daf-server-api \
    && npm install --no-save esbuild@0.25 \
    && ./node_modules/.bin/esbuild src/index.ts --bundle --platform=node --format=esm --outfile=lib/index.js

# Materialize the server profile (file: dep copies the built plugin in).
ENV DSH_HOME=/build/repo/dsh-home
RUN cd dsh-home/profiles/server && pnpm install

# ---- Production stage ----
FROM node:22-slim

LABEL maintainer="DAF Team" \
      description="DAF Financial Assistant - DSH Server (carrier mode)" \
      version="2.0"

RUN groupadd -r daf && useradd -r -g daf -d /app -s /sbin/nologin daf \
    && apt-get update && apt-get install -y --no-install-recommends \
       ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/workspace && chown -R daf:daf /app

# dsh CLI + kernel bundles.
# NB: COPY dereferences the npm bin symlink, so recreate it pointing at the real
# entry — ESM resolution must walk up from the package dir, not /usr/local/bin.
COPY --from=builder /usr/local/lib/node_modules/@deepseek-ai/dsh \
                    /usr/local/lib/node_modules/@deepseek-ai/dsh
RUN ln -sf ../lib/node_modules/@deepseek-ai/dsh/lib/bin.js /usr/local/bin/dsh
# Assembled $DSH_HOME (server profile + installed plugin). Must be daf-owned:
# boot heals/maintains $DSH_HOME/profiles/node_modules and writes sessions.
COPY --from=builder --chown=daf:daf /build/repo/dsh-home /app/.dsh
# Pre-create the sessions dir daf-owned: the named volume inherits ownership
# from the image path on first mount (a missing path becomes root-owned).
RUN mkdir -p /app/.dsh/sessions && chown daf:daf /app/.dsh/sessions

WORKDIR /app
USER daf
ENV DSH_HOME=/app/.dsh \
    DAF_WORKSPACE=/app/workspace \
    NODE_ENV=production \
    TZ=Asia/Shanghai

# Health via the carrier's public endpoint.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

EXPOSE 3000

CMD ["dsh", "--profile", "server", "--host", "127.0.0.1", "--port", "3000", "--no-open"]
