# Kaflow: Native Apache Kafka Desktop Client (Wails v3)

Kaflow is a native-first Apache Kafka desktop client built with **Wails v3**, **Go**, and **React 19 + TypeScript + Tailwind CSS v4**. Feature-level scope lives in [FEATURES.md](FEATURES.md).

## Current State

Kaflow's Go backend speaks Apache Kafka via [`github.com/twmb/franz-go`](https://github.com/twmb/franz-go) and `franz-go/pkg/kadm`, with `~/.kaflow` profile storage, OS keyring secrets, and a 3-tab React workspace (**Topics**, **Groups**, **Cluster**).

## Roadmap

### Phase 1 — Kafka Backend

- [x] [`github.com/twmb/franz-go`](https://github.com/twmb/franz-go) (+ `franz-go/pkg/kadm` for admin ops)
- [x] `backend/connection`: broker connection manager — seed brokers, TLS/mTLS, SASL (PLAIN/SCRAM/OAUTHBEARER), SSH tunnel reuse; connection health check (`Metadata`)
- [x] `backend/services/connection_service.go`: test/save/list profiles (keyring, env badges, read-only flag)
- [x] Topic service: list/describe topics, partition leaders + ISR, configs, create/alter/increase-partitions, delete (read-only guarded)
- [x] Consumer group service: list groups, describe (members/offsets), lag computation, offset reset to earliest/latest/timestamp
- [x] Message service: bounded fetches per topic-partition (key/value/headers/timestamp), produce records
- [x] Tail service: live message tail event stream (`kaflow:message` events)
- [x] Diagnostics service: broker/cluster metrics (controller id, topic count, under-replicated partitions)
- [~] Tests: unit tests (manager save/load/redaction, SASL/TLS builders) pass; containerized Kafka integration tests still open

### Phase 2 — Frontend

- [x] **Topic Explorer**: topic list, partition layout & watermarks, inline-editable configs, message browser (filter, copy, JSON export), live tail, produce
- [x] **Consumer Groups**: group list, per-partition lag table, offset reset
- [x] **Cluster Dashboard**: broker list, controller, under-replicated & offline partition visibility
- [x] Connection profiles UI, environment badges, read-only mode, shortcuts modal, updater, toast/confirm primitives

### Non-Goals

- No Electron. No external schema-registry dependency in v1. No cluster management write ops beyond topic config + offset resets.
