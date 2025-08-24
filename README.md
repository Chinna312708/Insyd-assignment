# Insyd Notification POC

Monorepo delivering:
- **Part 1:** `system_design.md`
- **Part 2:** Full-stack POC (React + Node + SQLite)

## Quickstart

### Backend
```bash
cd backend
npm install
npm run dev
# server runs at http://localhost:4000
```
Optional: set `PORT=4000` in `.env`.

### Frontend
```bash
cd frontend
npm install
npm run dev
# app runs at http://localhost:5173
```

## Test Drive
1. Create users (or use seeded: Alice=1, Bob=2, Cara=3).
2. Make Bob follow Alice: `POST /follow { followerId:2, followedId:1 }`
3. Alice posts: `POST /posts { userId:1, content:"Hello Architects!" }`
4. Bob polls notifications: `GET /notifications?userId=2`
5. Like/comment/discover and observe notifications.

## Deploy
- Backend → Render/Railway (Node 18+). Persist `data.sqlite`.
- Frontend → Vercel/Netlify. Set `VITE_API_BASE` to your backend URL.

## Notes
- No auth; pass `userId` in body/query.
- Polling every 5s in UI; adjustable via `VITE_POLL_MS`.