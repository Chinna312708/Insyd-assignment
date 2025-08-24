# Insyd Notification System – System Design (POC → Scale)

## 1. Problem Statement
Insyd enables the Architecture community to share blogs, chat, and discover jobs. Users should be notified when:
- Someone they follow posts.
- Their content receives engagement (like/comment).
- Organic discovery happens (someone new views/interacts).

**Constraints for POC**: ~100 DAUs, single region, in-app notifications only, no auth, minimal UI, zero external dependencies beyond DB and Node.
**Scale Target (Future)**: 1M DAUs, multi-channel notifications, horizontally scalable components.

## 2. Architecture (POC)
- **Frontend**: React (Vite). Polls `/notifications?userId=...` every 5s.
- **Backend**: Node.js + Express. Synchronous event handling.
- **DB**: SQLite (better-sqlite3). Tables for users, follows, posts, likes, comments, notifications, events.
- **Notification Service (in-process)**: Creates notifications on writes (post/like/comment/discovery).

Sequence (Post creation):
1. Client `POST /posts`.
2. Backend writes `posts` row.
3. Backend finds followers of author and **fan-out writes** to `notifications` (one row per follower).
4. Client polls `/notifications` to display.

## 3. Data Model (simplified)
```
users(id, name, created_at)
follows(id, follower_id, followed_id, created_at, UNIQUE(follower_id, followed_id))
posts(id, user_id, content, created_at)
likes(id, user_id, post_id, created_at, UNIQUE(user_id, post_id))
comments(id, user_id, post_id, content, created_at)
notifications(id, user_id, actor_id, verb, entity_type, entity_id, message, read, created_at)
events(id, type, payload_json, created_at) -- optional audit trail
```
**Notification verbs**: `POSTED`, `LIKED`, `COMMENTED`, `DISCOVERED`.

## 4. APIs
- `POST /users {name}` → `{id, name}`
- `POST /follow {followerId, followedId}`
- `POST /posts {userId, content}`
- `POST /likes {userId, postId}`
- `POST /comments {userId, postId, content}`
- `POST /discover {viewerId, postId}`
- `GET /notifications?userId=&sinceId=` → latest first
- `POST /notifications/read {userId, ids: number[]}`

**Headers**: None required (no auth).

## 5. Execution Flow (examples)
### New Post
- On post, fetch followers of author (N).
- For each follower, insert notification: `actor=author`, `verb=POSTED`, `entity=post`.
- Complexity: O(N) writes (fan-out on write). Acceptable at 100 DAUs.

### Like / Comment
- On engagement by X on post P (author=A), insert notification for A (if X != A).

### Discovery
- When viewer V opens a post by A from discovery feed, insert `DISCOVERED` to A.

## 6. Performance (POC)
- **Polling**: 5s interval, `sinceId` filter to reduce payload.
- **Indexes**: `notifications(user_id, id DESC)`, `follows(followed_id)`, `posts(user_id)`.
- **Fan-out**: Direct inserts. Batching per 100 followers.

Limitations:
- No retries, no dedupe beyond unique constraints.
- No rate limits.
- No cross-device sync beyond DB.

## 7. Scale-Out Strategy (1M DAUs)
- **Eventing**: Publish `PostCreated`, `LikeCreated`, `CommentCreated`, `DiscoveryEvent` to **Kafka**. Consumers create notifications.
- **Delivery**: Migrate from polling to **WebSockets/SSE** via a **Gateway** (e.g., NGINX + WS pods).
- **Storage**: Partitioned `notifications_{shard}` tables by `user_id % K`; keep **Redis** list for unread heads.
- **Fan-out**: Hybrid: large-follower users → **fan-out-on-read** (compute per follower at read time), others → fan-out-on-write.
- **Multi-channel**: Push (FCM/APNs), Email workers, Quiet Hours logic.
- **Privacy/Prefs**: User-level notification settings & GDPR controls.
- **Reliability**: Idempotent consumers, outbox/inbox pattern, DLQ for poison events, observability (metrics, tracing).
- **Cost**: Spot instances for consumers, autoscaling with queue lag, storage tiering for old notifications.

## 8. Testing Strategy
- Unit tests for services generating notifications.
- API integration tests for routes.
- Load test with 100 concurrent users (k6/Artillery).

## 9. Deployment (POC)
- Backend: Render/Railway.
- Frontend: Vercel/Netlify.
- DB: SQLite (file) bundled with backend or use Postgres on Railway for persistence.

## 10. Risks & Mitigations
- Fan-out spikes → batch inserts, queue later.
- Hot partitions on celebrity IDs → hybrid fan-out, sharding.
- Lost polls → next poll picks up via `sinceId`.

---