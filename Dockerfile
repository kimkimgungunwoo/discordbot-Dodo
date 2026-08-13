FROM python:3.13-slim

# 음악 재생/음성 인코딩은 전부 Lavalink(별도 컨테이너)가 담당 — ffmpeg/libopus 불필요.

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && playwright install --with-deps chromium

COPY . .

CMD ["python", "-m", "bot.main"]
