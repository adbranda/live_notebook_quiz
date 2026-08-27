# Operator guide

## 1. Start the server

Local development:

    npm install
    npm start

Docker:

    docker compose up --build -d

Open the host page at `/host.html`.

## 2. Create a CSV

The first row must be exactly:

    "#","Question","Hint","Option A","Option B","Option C","Option D","Correct Answer","Rationale"

Every subsequent row must contain nine fields. `Correct Answer` must contain one of `A`, `B`, `C`, or `D`.

## 3. Host a game

Upload the CSV, choose the question timer, and click Create game. The server creates a six-digit PIN and a QR code. Display the host screen on a projector or shared display.

## 4. Players join

Players scan the QR code or open the join page and enter the PIN and a nickname. No player account is required.

## 5. Game lifecycle

The lifecycle is lobby → question → results → question → ... → finished. The host controls transitions. The server owns the answer key and score calculation.

## 6. Scoring

A correct answer earns a base 500 points plus a speed bonus of up to 500 points. Incorrect and unanswered questions earn zero points.

## 7. Deployment notes

This MVP stores active rooms in RAM. Restarting the container ends active games. For an internet-facing installation, terminate TLS at a reverse proxy and consider rate limiting and host authentication. The application intentionally has no fixed player cap, but real capacity is determined by the machine, network, and Socket.IO workload.
