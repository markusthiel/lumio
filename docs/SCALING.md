**English** · [Deutsch](SCALING.de.md)

# Horizontal scaling — additional worker nodes

Lumio processes images, RAWs, videos and ZIP exports in **Celery workers** that pull jobs from a central Redis queue. If one server's compute power is no longer enough (large shoots, many videos in parallel), you can attach **additional servers** that only run workers. Celery distributes the jobs automatically across all connected workers — no load balancer, no manual job assignment.

> **Single-node self-hoster?** This chapter is **irrelevant** for you. Leave everything as is — the variables described here (`REDIS_PASSWORD`, `REDIS_BIND_IP`, `POSTGRES_BIND_IP`) are optional and ship in the "local only, no password" state. A single server needs none of this. Don't change anything about Redis/Postgres if you run only one server.

---

## Concept: what scales, what stays central

```
        Private network (e.g. Hetzner Private Network, free)
        ┌──────────────────────────┬──────────────────────────────┐
        │                          │                              │
  ┌─────┴───────────────┐    ┌─────┴────────────────┐
  │  Main server        │    │  Worker node(s)      │
  │  10.0.0.2           │    │  10.0.0.3, .4, …     │
  │                     │    │                      │
  │  API, frontend      │    │  Worker × N          │
  │  Caddy, acme-dns    │    │  (Celery only)       │
  │  Postgres ◄─────────┼────┤  reads/writes the DB │
  │  Redis (queue) ◄────┼────┤  pulls jobs          │
  │  Worker (here too)  │    │                      │
  └─────────────────────┘    └──────────────────────┘
            │                          │
            └───────────┬──────────────┘
                        ▼
          S3 / object storage (external, reachable by all)
```

**Central (exactly once, on the main server):**
- **Postgres** — the single source of truth for all metadata
- **Redis** — the job queue (Celery broker) and cache
- **API, frontend, Caddy** — web layer, database migrations

**Distributable (any number of nodes):**
- **Worker** — hold no state of their own. They take a job from Redis, process it (image/RAW/video/ZIP), write the result to S3, done.

**External (reachable from anywhere):**
- **S3 / object storage** — e.g. Hetzner Object Storage. Already external, so reachable by every node without extra configuration.

Worker nodes run **no** database migrations and need **no** open port to the outside. They are pure consumers.

---

## Requirements

- Two (or more) servers in a **shared private network**. On Hetzner Cloud: one "Network", both servers in the **same region** (e.g. Falkenstein/fsn1), free.
- The main server is already running (see [SELFHOSTING.md](SELFHOSTING.md)).
- S3-compatible external storage (not MinIO-in-Docker, since that would only be on the main server). See [STORAGE.md](STORAGE.md).

> **Why external S3 is mandatory:** a worker node must be able to read the original files and write renditions back. If the storage runs as a MinIO container only on the main server, that too would have to be exposed over the private network. External object storage (Hetzner/S3/R2/B2/Wasabi), which is reachable by all nodes anyway, is cleaner and more robust.

---

## Step 1 — Private network

**Hetzner Cloud Console → Networks → Create Network:**
- Name: `lumio-net`
- IP range: `10.0.0.0/16`

Add both servers to the network (Server → Networking → Attach). They get private IPs, in this guide:
- Main server: `10.0.0.2`
- Worker node: `10.0.0.3`

Verify on **both** servers that the private interface is there:

```bash
ip addr | grep 10.0.0
```

If that shows nothing, the server hasn't pulled the private IP yet — usually a `reboot` after the attach helps.

---

## Step 2 — Secure + expose Redis (main server)

On the private network Redis is only reachable between your servers, but we set a password anyway (defense in depth) and bind it **exclusively** to the private IP — never `0.0.0.0`.

```bash
cd /opt/docker/lumio/lumio
git pull

# Generate a password — keep it safe, the worker node needs it
REDIS_PW=$(openssl rand -hex 24)
echo "Redis password: $REDIS_PW"

# Add to .env
echo "REDIS_PASSWORD=$REDIS_PW"  >> .env
echo "REDIS_BIND_IP=10.0.0.2"    >> .env
echo "POSTGRES_BIND_IP=10.0.0.2" >> .env

# Switch the REDIS_URL of all local services to the password
sed -i 's|^REDIS_URL=.*|REDIS_URL=redis://:'"$REDIS_PW"'@redis:6379|' .env
```

How this works: the Redis container only adds `--requirepass` if `REDIS_PASSWORD` is set (sh expansion in the `command`). `REDIS_BIND_IP`/`POSTGRES_BIND_IP` control the host port mapping — the default is `127.0.0.1` (local only), here we set it to the private IP.

---

## Step 3 — Restart the stack (main server)

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  -f docker-compose.ml.yml \
  up -d
```

A brief interruption (seconds) while Redis + the services restart with the new URL.

---

## Step 4 — Verify (main server)

```bash
# Redis now requires auth
docker exec lumio_redis redis-cli ping
# → (error) NOAUTH Authentication required.     ✓

docker exec lumio_redis redis-cli -a "$REDIS_PW" ping
# → PONG                                         ✓

# Redis + Postgres listen ONLY on the private IP
ss -tlnp | grep -E '10.0.0.2:(6379|5432)'
# → both listed                                  ✓

# ... and NOT publicly
ss -tlnp | grep -E '0.0.0.0:(6379|5432)'
# → empty                                        ✓
```

---

## Step 5 — Set up the worker node (10.0.0.3)

### 5a. Install Docker

```bash
curl -fsSL https://get.docker.com | sh
docker compose version
```

### 5b. Test connectivity (first!)

```bash
nc -zv 10.0.0.2 6379    # Redis
nc -zv 10.0.0.2 5432    # Postgres
```

Both "open/succeeded" → continue. Otherwise check the private network (`ip addr | grep 10.0.0`).

### 5c. Clone the repo

```bash
mkdir -p /opt/docker/lumio && cd /opt/docker/lumio
git clone https://github.com/markusthiel/lumio.git lumio
cd lumio
```

### 5d. Create `.env.worker`

```bash
cp .env.worker.example .env.worker
nano .env.worker
```

The values: DB user/name/password and S3 credentials **1:1 from the main server** (run `grep -E "^POSTGRES_|^REDIS_PASSWORD|^S3_" /opt/docker/lumio/lumio/.env` there), hosts to the **private IP** of the main server:

```
DATABASE_URL=postgres://lumio:<DB_PASSWORD>@10.0.0.2:5432/lumio
REDIS_URL=redis://:<REDIS_PASSWORD>@10.0.0.2:6379
STORAGE_PROVIDER=s3
S3_ENDPOINT=https://fsn1.your-objectstorage.com
S3_REGION=fsn1
S3_BUCKET=lumio-prod
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
S3_FORCE_PATH_STYLE=true
WORKER_CONCURRENCY=10
LOG_LEVEL=info
```

### 5e. Start the worker

```bash
docker compose -f docker-compose.worker.yml --env-file .env.worker up -d --build
```

### 5f. Verify

```bash
docker compose -f docker-compose.worker.yml --env-file .env.worker logs -f
```

Success indicators in the log:
- `Connected to redis://:**@10.0.0.2:6379//` — broker connection is up
- `mingle: sync with 1 nodes` / `mingle: sync complete` — the new worker found the other workers (cluster formed)
- `celery@… ready.` — accepting jobs

As soon as a job comes in, you'll see `Task … received` / `… succeeded`.

---

## Tuning

**Parallel jobs per node** = `WORKER_CONCURRENCY` × `replicas`.

- `WORKER_CONCURRENCY` (in `.env.worker`): rule of thumb ≈ number of CPU cores. 12-vCPU server → 10–12.
- `replicas` (in `docker-compose.worker.yml`): multiple worker processes per node. Usually 1 with high concurrency is enough.

**CPU load by job type:**
- **Video transcoding** (libx264 without GPU) is the biggest CPU hog — additional hardware helps most here.
- **Image/RAW** (libvips/LibRaw) is relatively light — one node goes a long way.

More nodes: repeat step 5 on further servers (10.0.0.4, .5, …). Nothing to change on the main server — new workers register automatically via `mingle`.

**Queues:** Celery uses `default`, `heavy` (video/large jobs), `io` and `ml` (auto-tagging/CLIP). Which queues a worker serves is controlled by the env variable `WORKER_QUEUES` (default `default,heavy,io,ml`). If you want to reserve a node only for video, you can restrict it to `WORKER_QUEUES=heavy` — extend as needed.

**Important — CLIP/auto-tagging:** the CLIP tagger only runs in workers with the ML image (`docker-compose.ml.yml`, usually the main server). Pure Celery nodes without CLIP must therefore **not** pull the `ml` queue — otherwise images processed there would only get the rule-based tags (format/brightness), but no content CLIP tags. `docker-compose.worker.yml` therefore sets `WORKER_QUEUES=default,heavy,io` (without `ml`); auto-tagging tasks thus land exclusively on the CLIP-capable main server. If your main server has no ML image, auto-tagging still runs (the default pulls `ml`), but then only delivers rule-based tags.

---

## Updates on the worker node

```bash
cd /opt/docker/lumio/lumio
git pull
docker compose -f docker-compose.worker.yml --env-file .env.worker up -d --build
```

Important: update worker nodes after the main server (first the migrations on the main server via the API, then the workers), so the DB schema matches.

### Which change needs which server?

| Changed | Main server | Worker node(s) |
|---|---|---|
| `apps/frontend` (studio/customer UI) | ✅ `up -d --build frontend` | — |
| `apps/api` (backend, endpoints) | ✅ `up -d --build api` | — |
| `apps/worker` (image/video/RAW/ZIP processing) | ✅ `up -d --build worker` | ✅ `up -d --build` |
| Compose/infra files | depending on the affected service | only if worker-relevant |
| Docs, marketing sites | — (or their own marketing deploy) | — |

Rule of thumb: the frontend and the API run **only** on the main server. Only changes to `apps/worker` (the conversion logic) have to additionally be rolled out to every worker node. The main server's standard deploy stays:

```bash
cd /opt/docker/lumio/lumio && git pull && docker compose \
  -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.ml.yml \
  up -d --build
```

---

## Security — summary

- Redis + Postgres bind **only** to the private IP (`10.0.0.2`), never `0.0.0.0`. From outside (the public IP) the ports are closed.
- Redis is additionally password-protected.
- Worker nodes need **no** inbound port to the outside.
- The private network carries no internet traffic — the worker↔DB/Redis connection never leaves the Hetzner-internal network.

---

## Troubleshooting

**`Connection refused` to 10.0.0.2:6379/5432 from the worker node**
The private network isn't end-to-end. Run `ip addr | grep 10.0.0` on both servers; reboot the server after the network attach if needed. `nc -zv 10.0.0.2 6379` to test.

**`NOAUTH` / `WRONGPASS` in the worker log**
The `REDIS_URL` in `.env.worker` doesn't contain (or contains the wrong) password. It must exactly match the main server's `REDIS_PASSWORD`: `redis://:<PW>@10.0.0.2:6379`.

**Worker starts but pulls no jobs**
Check whether `mingle: sync` worked. If `mingle: all alone`, the node doesn't see the queue — usually a wrong/missing Redis connection. Also check: is there any load on the main server at all? With an empty queue, silence is normal.

**`SecurityWarning: running with superuser privileges`**
Just a notice, not an error. Workers run as root in the container (like on the main server). Not critical.

**Images are processed but renditions are missing**
The S3 credentials on the worker node don't match the main server, or the wrong bucket/endpoint. The worker then writes into nothing. Compare `.env.worker` against the main `.env`.
