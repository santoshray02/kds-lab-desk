FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.mjs wa.mjs index.mjs run-forever.mjs ./
ENV HOST=0.0.0.0 PORT=8080 AUTH_DIR=/data/auth
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:8080/health || exit 1
CMD ["node", "run-forever.mjs"]
