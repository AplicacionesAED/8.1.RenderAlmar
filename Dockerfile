FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
# Modelos y texturas no cambian entre despliegues sin cambiar de archivo: caché larga en assets con hash
RUN printf 'server {\n  listen 80;\n  root /usr/share/nginx/html;\n  gzip on;\n  gzip_types application/javascript text/css application/json application/wasm;\n  location /assets/ { expires 1y; add_header Cache-Control "public, immutable"; }\n  location / { try_files $uri $uri/ /index.html; }\n}\n' > /etc/nginx/conf.d/default.conf
EXPOSE 80
