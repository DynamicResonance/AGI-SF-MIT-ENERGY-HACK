FROM python:3.13-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1 CACHE_DIR=/data/cache

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY snapshots ./snapshots
COPY agent_runs ./agent_runs

EXPOSE 8000
# Railway injects $PORT; default 8000 locally. "::" = dual-stack (Railway private network uses IPv6).
CMD ["sh", "-c", "uvicorn app.main:app --host :: --port ${PORT:-8000}"]
