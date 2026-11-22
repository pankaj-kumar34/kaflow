# Kaflow Feature Plan — Kafka Management

Feature-level scope, priorities, and milestones for kaflow's Kafka management capabilities.
[PLAN.md](PLAN.md) owns the technical migration roadmap (franz-go backend, frontend remap); this doc owns **what the product does**. It assumes PLAN.md Phase 1's foundation (franz-go + kadm client, connection manager, Wails event streaming) and does not restate it.

## Resolved Scope

PLAN.md's non-goal ("no cluster management write ops beyond topic config + offset resets") reads ambiguously against its own Phase 1 list. Resolved here:

**In-scope writes:**
- Topic create, delete, alter configs, increase partitions
- Consumer-group offset reset (earliest / latest / timestamp)

**Out of scope (v1):**
- Replication-factor change, partition reassignment, preferred leader election
- Broker-level configs, ACLs, quotas
- Cluster provisioning of any kind
- Delete consumer group (beyond any reading of the non-goal — dropped)

Schema formats (Avro / Protobuf / schema registry) are deferred to v2 per PLAN.md's non-goal; the message viewer ships JSON / plain-text / binary (base64 + hex) rendering.

## Architecture

Core Go services exposed to the React workspace:

| Service | Responsibility |
|---|---|
| `connection_service.go` | Profiles with SASL (PLAIN/SCRAM/OAUTHBEARER), TLS/mTLS, seed brokers, SSH tunnel reuse |
| `topic_service.go` | Topic CRUD, partition layout, config updates, add partitions |
| `message_service.go` | Bounded offset-clamped fetches and message production |
| `tail_service.go` | Explicit-offset live tail via `kaflow:message` events |
| `group_service.go` | Consumer group list, per-partition lag, offset reset |
| `diagnostics_service.go` | Cluster and broker health |
| `updater_service.go` | GitHub-release-backed self-update |

Frontend: `topics` (topic explorer, message viewer/producer, live tail), `groups` (consumer groups & lag), `cluster` (cluster health), `connections`, env badges, read-only mode, shortcuts, updater, toast/confirm primitives.

## Feature Areas

### A. Topic Explorer & Management — browse P0 (M1), mutations P1 (M3)

**Browse:** list topics (name, partitions, replication factor, ISR status, internal flag) in a virtualized table with search/filter; topic detail with per-partition leader / replicas / ISR / log-start offset / high watermark / size; config view (retention.ms, cleanup.policy, …).

**Mutate:** create topic (partitions, RF, configs); alter configs; increase partitions (warn — cannot decrease); delete topic (typed confirm).

**Backend:** `topic_service.go` (kadm). **Frontend:** explorer + detail drawer + ConfirmModal.

**Accepts:** ISR shrink and under-replicated state visible per partition; delete blocked hard in read-only mode.

### B. Message Viewer / Payload Debugging — core P0 (M1), debugging P1 (M2)

Browse records per topic → partition with bounded fetches: offset-range mode and latest-N mode. Row shows offset, partition, timestamp, key, value, headers.

**Debugging (M2):** JSON pretty-print + syntax highlight; plain text; binary → base64/hex with byte size; text search across key/value; header filters; time-range filter; copy raw / save to file.

**Produce (M2):** key/value/headers, optional target partition, ack confirmation.

**Backend:** `message_service.go`. **Frontend:** viewer pane + producer form.

**Accepts:** fetch ranges clamp to `[logStartOffset, highWatermark)` — no `OffsetOutOfRange` on compacted or partially-retained topics; HWM displayed so latest-N and tail position are meaningful.

**v2:** Avro / Protobuf / schema-registry rendering.

### C. Live Tail — P1 (M2)

`tail -f` semantics: follow from latest or a chosen offset; pause/resume; same filters as the viewer; message-rate counter; stream via `kaflow:message` with ring-buffer backpressure; auto-stop on connection loss.

**Backend:** `tail_service.go` (explicit-offset, group-less consume). **Frontend:** topics feature.

**Accepts:** zero commits, zero coordinator joins — tailing never appears in the consumer-groups list and never disturbs real consumer lag.

### D. Consumer Groups & Lag — read P1 (M2), offset reset P1 (M3)

List groups with state (Empty / Stable / PreparingRebalance), members, protocol, total lag. Per-partition lag table (committed offset vs log-end offset), sortable, with per-topic aggregation.

**Offset reset (M3):** earliest / latest / timestamp, always with a dry-run preview of target offsets + typed confirm.

**Backend:** `group_service.go`. **Frontend:** groups dashboard.

**Accepts (lag edge cases render explicit states, never wrong numbers):** empty groups; no committed offset; leaderless partitions; purged partitions (log start > committed offset).

### E. Cluster Diagnostics — P2 (M4)

Broker list (id, host, port, rack, controller flag); cluster health: under-replicated partitions, offline partitions, controller id; topic/partition counts.

## Priorities & Milestones

P0 = must-have for a usable v1 · P1 = core debugging/ops · P2 = power features.

| Milestone | Ships | Areas |
|---|---|---|
| **M1 — Core read paths** | Kafka connections (franz-go, TLS/SASL/SSH), topic explorer, message viewer (clamped fetch, JSON/text/binary) | A-browse, B-core |
| **M2 — Debugging** | Search/filters, format rendering, produce, live tail, consumer groups + lag | B-debug, C, D-read |
| **M3 — Operations** | Topic create/alter/increase-partitions/delete, config edits, offset reset | A-mutate, D-reset |
| **M4 — Power** | Cluster diagnostics, polish | E |

## Safety Model (cross-cutting)

- A single `ReadOnly` flag per connection guards **every** mutation: topic CRUD/config, offset reset, produce. No second opt-in flag.
- All browsing, tailing, and producing uses **explicit-offset group-less fetch** (`kgo.ConsumePartitions` with explicit offsets) — never an ephemeral consumer group: no commits possible, no coordinator residue, nothing in the groups list.
- Destructive ops (delete topic, offset reset) require typed confirmation via the existing ConfirmModal.
- Offset reset always shows a dry-run preview of target offsets before applying.

## Testing Strategy

- **Unit:** define small per-service interfaces (`TopicAdmin`, `RecordFetcher`, `GroupAdmin`, …) and mock them; table-driven `_test.go` patterns cover lag computation and offset clamping.
- **Integration:** testcontainers (KRaft Kafka or Redpanda image) — Docker-required, local runs only for now (no CI test workflow exists; only `release.yml`).

## Open Questions

- Schema registry: how painful is JSON-only rendering in practice? Revisit after M2 dogfooding.
- Message size caps for viewer/tail payloads (protect the UI from 50 MB records).
- Multi-cluster: tabs per connection vs single active connection.
- CI: add a GitHub Actions workflow for unit tests (containerized integration later)?
