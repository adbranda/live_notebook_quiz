# Socket protocol

The browser clients communicate with the server through Socket.IO events. This document is intentionally boring: it makes the MVP easy to extend without adding a framework-specific state layer.

## Host → server

- `host:claim` — `{ pin }`
- `host:start` — starts question zero
- `host:next` — ends results and starts the next question, or finishes the game
- `host:end-question` — immediately ends the active question

## Player → server

- `player:join` — `{ pin, name }`
- `player:answer` — `{ answer }`, where answer is A, B, C, or D

## Server → clients

- `host:ready` — complete public room snapshot
- `player:joined` — player identity plus room snapshot
- `room:update` — lobby/results/finished room state
- `question:started` — question payload without the answer key
- `answer:accepted` — confirms the player's answer was accepted
- `answer:count` — host-only progress count
- `question:ended` — correct answer, rationale, answer distribution, leaderboard
- `game:finished` — final leaderboard
- `game:closed` — host/session shutdown notice
- `error:message` — user-facing validation or session error

## Security boundary

The correct answer is never included in `question:started`. The client can see the four choices, but the authoritative answer remains on the server until `question:ended`. The server also ignores duplicate answers and answers submitted after the timer expires.
