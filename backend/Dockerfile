FROM python:3.11-slim

WORKDIR /app

COPY main.py .
COPY install.sh .
COPY metric_agent.py .

RUN pip install fastapi uvicorn requests apscheduler passlib[bcrypt] python-jose[cryptography] pyjwt bcrypt python-dotenv

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]