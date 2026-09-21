FROM python:3.13-slim

# print()가 파이프(도커 로그)로 나갈 땐 기본이 완전 버퍼링이라 실시간으로 안 보인다 — 강제로 언버퍼링.
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && playwright install --with-deps chromium

COPY . .

CMD ["python", "-m", "bot.main"]
