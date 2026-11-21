# Kaflow: Native Apache Kafka Desktop Client (Wails v3)

Kaflow is the Apache Kafka sibling of [Memspace](https://github.com/pankaj-kumar34/memspace) (Redis/Valkey client). Same native-first architecture and frontend design language, red accent theme. Built with **Wails v3**, **Go**, and **React 19 + TypeScript + Tailwind CSS v4**.

## Current State

The codebase was forked from Memspace and fully rebranded (module `kaflow`, `~/.kaflow` storage, `kaflow` keyring service, red `#dc2626` accent, regenerated bindings). **The backend service layer still speaks Redis (`go-redis`)** — the work below migrates it to Kafka.

## Migration Roadmap

### Phase 1 — Kafka Backend (replaces go-redis)
- [ ] Add [`github.com/twmb/franz-go`](https://github.com/twmb/franz-go) (+ `franz-go/pkg/kadm` for admin ops); remove `go-redis`, `miniredis`
- [ ] `backend/connection`: broker connection manager — seed brokers, TLS/mTLS, SASL (PLAIN/SCRAM/OAUTHBEARER), SSH tunnel reuse; connection health check (`Metadata`)
- [ ] `backend/services/connection_service.go`: test/save/list profiles (keep models, keyring, env badges, read-only flag)
- [ ] Topic service: list/describe topics, partition leaders + ISR, configs, create/alter/increase-partitions, delete (read-only guarded)
- [ ] Consumer group service: list groups, describe (members/offsets), lag computation, offset reset to earliest/latest/timestamp
- [ ] Message service: tail/fetch records per topic-partition (key/value/headers/timestamp), bounded fetches like Memspace's SCAN, produce records
- [ ] Console service: admin operation console with tokenization, history, latency metrics
- [ ] Diagnostics service: broker/cluster metrics (controller id, topic count, under-replicated partitions)
- [ ] PubSub service → live message tail event stream (`kaflow:message` events)
- [ ] Tests: swap `miniredis` for a containerized/local Kafka or `franz-go` mocks

### Phase 2 — Frontend Remap (same design system)
- [ ] Key Explorer → **Topic Explorer** (tree by topic, virtualized table: partitions, replicas, configs)
- [ ] Data-structure editors → **Message viewer/producer** (key/value/headers, JSON highlight, partition/offset meta)
- [ ] Pub/Sub Debugger → **Consumer Groups** dashboard (lag table) + live tail
- [ ] Monitor → broker metrics charts (existing dashboard component, new data source)
- [ ] Terminal → admin console (commands + autocomplete from Kafka admin ops)
- [ ] Copy pass: replace Redis wording (KEYS/TTL/DB selector) with Kafka wording (topics/partitions/replication)
- [ ] Keep: connection profiles UI, environment badges, read-only mode, shortcuts modal, updater, toast/confirm primitives

### Non-Goals
- No Electron. No external schema-registry dependency in v1. No cluster management write ops beyond topic config + offset resets.
