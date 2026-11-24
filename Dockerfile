# Hébergement permanent (Render, Fly.io, Railway, VPS…) : inscriptions en ligne avant le jour J.
FROM node:22-alpine
WORKDIR /app
COPY package.json server.js ./
COPY public ./public
ENV PORT=8080 DATA_DIR=/data TRUST_PROXY=1
# Montez un disque persistant sur /data, et définissez PUBLIC_URL (https://votre-adresse) et ADMIN_KEY.
VOLUME /data
EXPOSE 8080
CMD ["node", "server.js"]
