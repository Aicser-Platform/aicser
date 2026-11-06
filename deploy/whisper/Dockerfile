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
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)"
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
