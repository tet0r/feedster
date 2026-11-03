FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
ENV NODE_ENV=production PORT=8080 FEEDSTER_DATA=/data
VOLUME /data
EXPOSE 8080
USER node
CMD ["node", "src/server.js"]
