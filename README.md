# JWT Auth Server

Commercial-ready starter API for products that need authentication without baking user/session logic into the main application.

The service provides a compact Express/MySQL authentication layer: login, JWT access tokens, refresh tokens, logout, health checks, a MySQL-backed user store, demo/test seeding, DB-free route tests, and a live MySQL/binlog cache test.

> Status: integration starter. Dependencies are current and `npm audit` is clean, but production deployments still need real secrets, HTTPS, stricter CORS, rate limiting, and environment-specific config.

## Why It Exists

- Keep authentication isolated from the product API.
- Use MySQL as the source of truth for users and refresh tokens.
- Issue short-lived JWT access tokens and longer-lived refresh tokens.
- Seed demo or benchmark users quickly for reviewers and integrators.
- Validate the route layer without a database and the cache layer with a live MySQL binlog test.
- Provide `/health` for uptime checks and load balancers.

## Current Stack

| Area | Package |
| --- | --- |
| HTTP API | Express 5 |
| Database driver | mysql2 |
| Cache watcher | @rodrigogs/mysql-events |
| Token signing | jsonwebtoken |
| Password hashing | bcrypt |
| Configuration | config |
| HTTP tests | node:test + supertest |

## Feature Snapshot

| Capability | Included |
| --- | --- |
| Login with JSON body or Basic Auth | Yes |
| JWT access tokens | Yes |
| Refresh tokens stored in MySQL | Yes |
| Logout token invalidation | Yes |
| Health check | Yes |
| Demo user seed | Yes, via `npm run seed:test` |
| Benchmark user seed | Yes, via `npm run benchmark:login` |
| Automated route tests | Yes, via `npm test` |
| Live MySQL/binlog test | Yes, via `npm run test:mysql` |
| Optional in-memory cache | Yes, updated from MySQL binlog events |
| Bulk demo account generator | Yes, via `/generate` |

## Project Structure

```text
.
├── config/default.json          # Server, database, and JWT configuration
├── scripts/benchmark-login.js   # Seeds 10k users and runs login load test
├── scripts/seed-test-user.js    # Creates/updates a demo MySQL user
├── server.js                    # Clustered HTTP server bootstrap
├── spec/mysql-live.test.js      # Live MySQL + binlog cache test
├── spec/routes.test.js          # DB-free HTTP route tests
├── src/db.js                    # mysql2 data access layer + binlog cache watcher
├── src/routes.js                # Auth API routes
├── src/terminate.js             # Graceful shutdown helper
└── test/test.js                 # Manual helper routes for token testing
```

## Requirements

- Node.js 20+
- MySQL 5.7+ or 8+
- A MySQL database matching `config/default.json`

The seed scripts can create the `users` table if it does not exist:

```sql
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(255),
  password VARCHAR(255) NOT NULL,
  language VARCHAR(10),
  role VARCHAR(50) DEFAULT 'user',
  refresh_token TEXT
);
```

## Quick Start

Install dependencies:

```bash
npm install
```

Update `config/default.json` with your local MySQL settings:

```json
{
  "server": {
    "host": "localhost",
    "port": 8001,
    "withlocalcache": false
  },
  "dbserver": {
    "connectionLimit": 500,
    "password": "root",
    "user": "root",
    "database": "pacs",
    "host": "127.0.0.1",
    "port": 3337
  },
  "secret": {
    "secret_key": "replace-me",
    "secret_key_refresh": "replace-me-too",
    "expires": 30,
    "refresh_expires": 1800
  }
}
```

Run the DB-free route tests:

```bash
npm test
```

Seed a demo user into MySQL:

```bash
npm run seed:test
```

Default demo credentials:

```text
email: demo@example.com
password: DemoPass123!
```

Run the live MySQL/binlog cache test:

```bash
npm run test:mysql
```

Start the API:

```bash
npm start
```

By default, the API listens on:

```text
http://localhost:8001
```

## API

### Service Profile

```http
GET /
```

Returns a JSON overview of the service, version, positioning, and available endpoints.

### Health Check

```http
GET /health
```

Returns `200 OK` when the Node process is responding.

### Login

```http
POST /login
Content-Type: application/json
```

Body:

```json
{
  "username": "demo@example.com",
  "password": "DemoPass123!"
}
```

The route also accepts Basic Auth credentials through the `Authorization` header.

Successful response:

```json
{
  "error": false,
  "accessToken": "jwt-access-token",
  "refreshToken": "jwt-refresh-token",
  "message": "success"
}
```

### Refresh Access Token

```http
POST /refresh
Content-Type: application/json
```

Body:

```json
{
  "refreshToken": "jwt-refresh-token"
}
```

The route also accepts the refresh token as a Bearer token through the `Authorization` header.

### Logout

```http
POST /logout
Content-Type: application/json
```

Body:

```json
{
  "token": "jwt-access-token"
}
```

The route also accepts the access token as a Bearer token through the `Authorization` header. On success, the stored refresh token is cleared for the authenticated user.

### Bulk Demo Account Generator

```http
GET /generate
```

Inserts many demo users into MySQL. Keep this route disabled or protected outside local development.

## Curl Examples

Login with the seeded user:

```bash
curl -X POST http://localhost:8001/login \
  -H "Content-Type: application/json" \
  -d '{"username":"demo@example.com","password":"DemoPass123!"}'
```

Refresh:

```bash
curl -X POST http://localhost:8001/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"jwt-refresh-token"}'
```

Logout:

```bash
curl -X POST http://localhost:8001/logout \
  -H "Content-Type: application/json" \
  -d '{"token":"jwt-access-token"}'
```

## Benchmark Results

Local benchmark run on `2026-06-25 00:55:39 EEST`.

Environment:

| Item | Value |
| --- | --- |
| Runtime | Node.js `v22.21.1` |
| OS | WSL2 Ubuntu 24.04.3 |
| CPU threads reported by Node | 16 |
| API | `127.0.0.1:8001` |
| MySQL | `127.0.0.1:3337/pacs` |
| MySQL version | 8.0.46 |
| MySQL binlog | Enabled, `ROW` format |
| User pool | 10,000 benchmark users |
| Password hashing | bcrypt cost 10 |
| Endpoint | `POST /login` |
| Target rate | 100 requests/second |
| Duration | 60 seconds |

Command:

```bash
npm run benchmark:login
```

Result:

| Metric | Value |
| --- | ---: |
| Requests scheduled | 6,000 |
| Requests completed | 6,000 |
| Successful responses | 6,000 |
| Failed responses | 0 |
| HTTP 200 responses | 6,000 |
| Target RPS | 100 |
| Scheduled RPS | 98.55 |
| Completed RPS | 98.48 |
| Peak in-flight requests | 13 |
| Min latency | 49.20 ms |
| Avg latency | 56.42 ms |
| p50 latency | 54.32 ms |
| p90 latency | 63.70 ms |
| p95 latency | 66.99 ms |
| p99 latency | 73.78 ms |
| Max latency | 136.24 ms |

The benchmark script recreates users matching `benchmark-%@example.com`, starts the real clustered API server if it is not already running, and submits login requests against the real MySQL-backed auth flow.

You can tune it with environment variables:

```bash
BENCHMARK_USERS=10000 BENCHMARK_RPS=100 BENCHMARK_DURATION=60 npm run benchmark:login
```

## Useful Scripts

```bash
npm run check          # Syntax-check project files
npm test               # Run DB-free route tests
npm run test:mysql     # Run live MySQL + binlog cache test
npm run seed:test      # Create/update the demo MySQL user
npm run benchmark:login # Seed benchmark users and run the login benchmark
npm start              # Start the clustered API server
```

## Configuration Notes

- `server.withlocalcache`: when enabled, users are loaded in a process-local memory cache and updated from MySQL binlog events. This is event-driven, not polling.
- `secret.expires`: access token lifetime, passed to `jsonwebtoken`.
- `secret.refresh_expires`: refresh token lifetime, passed to `jsonwebtoken`.
- `dbserver.connectionLimit`: MySQL pool connection limit.
- `dbserver.port`: MySQL TCP port. This workspace is configured for `3337`.

### Local Cache Requirements

The local cache watcher needs MySQL binary logging enabled and a database user that can read binlog events.

Typical MySQL settings:

```ini
server-id=101
log_bin=/var/log/mysql/mysql-bin.log
binlog_format=ROW
binlog_row_image=FULL
port=3337
```

Typical privileges:

```sql
GRANT REPLICATION SLAVE, REPLICATION CLIENT, SELECT ON *.* TO 'app_user'@'%';
FLUSH PRIVILEGES;
```

If binlog is not available, keep `server.withlocalcache` set to `false`; the API will read from MySQL through `mysql2` for each lookup.

For production deployments, use environment-specific config files supported by `node-config`, for example `config/production.json`, and set:

```bash
export NODE_ENV=production
```

## Production Checklist

- Replace the default JWT secrets with strong private values.
- Keep database credentials and secrets out of source control.
- Serve the API only over HTTPS.
- Restrict CORS to trusted origins instead of `*`.
- Protect or remove `/generate`.
- Add integration tests against a disposable MySQL database.
- Add request logging, rate limiting, and brute-force protection.
- Decide whether the binlog-backed local cache is useful enough to keep; otherwise leave `withlocalcache` disabled.

## License

ISC
