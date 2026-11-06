# Aicser voice transcription (optional): Whisper speech-to-text on CPU, for voice input when the
# browser's own speech service is missing or turned off. Start with `make ee-voice`.
FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/models

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
 && useradd --create-home --uid 10001 whisper \
 && mkdir -p /models && chown whisper:whisper /models
COPY app.py ./

USER whisper
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import os, urllib.request; urllib.request.urlopen('http://localhost:%s/health' % os.getenv('PORT', '8000'), timeout=3)"
# WHISPER_HOST=:: listens on IPv6 too (Railway's private network); PORT is set by some hosts.
ENV WHISPER_HOST=0.0.0.0
CMD ["sh", "-c", "exec uvicorn app:app --host \"$WHISPER_HOST\" --port \"${PORT:-8000}\" --workers 1"]
