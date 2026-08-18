FROM python:3.11-slim

WORKDIR /app

COPY main.py .
COPY install.sh .
COPY metric_agent.py .
COPY database.py .
COPY cors_config.py .
COPY target_security.py .
COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
