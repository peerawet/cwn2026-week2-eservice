# Playwright (ทางการ) + ffmpeg จาก apt ของ Ubuntu — ไว้แปลงวิดีโอ .webm ของแต่ละ TC เป็น GIF
FROM mcr.microsoft.com/playwright:v1.56.1-noble
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
