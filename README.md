# Notebook Live Quiz

A deliberately small, self-hosted Kahoot-style multiplayer quiz app designed for NotebookLM Quiz Exporter CSV files.

## Features

- Four-choice multiple choice only
- Exact CSV schema: `#,Question,Hint,Option A,Option B,Option C,Option D,Correct Answer,Rationale`
- Host creates a 6-digit PIN session
- QR code join link
- Players join with a nickname, no account required
- Real-time lobby and question delivery over Socket.IO
- Server-side answer validation
- Speed-based scoring
- Live leaderboard and rationale after each question
- No software-imposed player cap
- Docker deployment

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000/`.

## Docker

```bash
docker compose up --build -d
```

Then open `http://localhost:3000/`.

## CSV example

```csv
"#","Question","Hint","Option A","Option B","Option C","Option D","Correct Answer","Rationale"
"1","What is 2 + 2?","Think about basic addition.","3","4","5","6","B","Two plus two equals four."
```

## Architecture

The app is intentionally simple: Express serves the static frontend and HTTP API; Socket.IO handles the live game state; game state is held in memory. There is no account system or database in the MVP.

For public deployment, put it behind HTTPS/reverse proxy, and consider adding rate limiting, persistent quiz/session storage, authentication for hosts, and horizontal scaling if you expect very large concurrent events.
