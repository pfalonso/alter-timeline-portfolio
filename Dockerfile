# ── Etapa 1: build ────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# data/ está en .dockerignore: los datos personales NUNCA entran en la imagen.
RUN npm run build

# ── Etapa 2: servidor estático ────────────────────────────────────────────────
FROM nginx:alpine AS runtime
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html
# Punto de montaje de los datos personales (vacío en la imagen → la web usa los de ejemplo).
RUN mkdir -p /usr/share/nginx/userdata
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
