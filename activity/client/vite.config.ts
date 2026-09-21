import { defineConfig } from "vite";

export default defineConfig({
  build: { target: "es2022" },
  server: {
    host: true, // 0.0.0.0 — 도커 컨테이너 밖(호스트)에서 접속하려면 필요
    port: 5173,
    // cloudflared 터널이 매번 다른 *.trycloudflare.com 호스트명으로 붙기 때문에
    // Vite의 기본 host 검사(DNS 리바인딩 방지)를 꺼야 디스코드 Activity가 접속 가능하다.
    allowedHosts: true,
    proxy: {
      "/api": { target: process.env.ACTIVITY_PROXY_TARGET ?? "http://localhost:3001" },
      "/ws": { target: process.env.ACTIVITY_PROXY_TARGET ?? "http://localhost:3001", ws: true },
    },
  },
});
