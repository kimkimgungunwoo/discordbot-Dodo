FROM python:3.13-slim

# ffmpeg: 음악 재생(yt-dlp)에 필요 / libopus0: 음성 전송(discord.py voice) 인코딩에 필요
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libopus0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && playwright install --with-deps chromium

COPY . .

CMD ["python", "-m", "bot.main"]
