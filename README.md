<div align="center">

<img src="./build/appicon.png" alt="Kaflow — Native Apache Kafka Desktop Client Logo" width="96" />

# Kaflow — Native Apache Kafka GUI Desktop Client

A fast, lightweight, open-source native desktop GUI client for **Apache Kafka** on **macOS, Windows, and Linux**. Built with **Go** and **Wails v3** for a small RAM footprint and zero Electron bloat.

<p>
  <a href="https://github.com/pankaj-kumar34/kaflow/releases/latest">
    <img src="https://img.shields.io/github/v/release/pankaj-kumar34/kaflow?style=flat-square&color=594c5b&label=Release" alt="Latest Release" />
  </a>
  <a href="https://github.com/pankaj-kumar34/kaflow/actions/workflows/release.yml">
    <img src="https://img.shields.io/github/actions/workflow/status/pankaj-kumar34/kaflow/release.yml?style=flat-square&label=Build" alt="Release Build Status" />
  </a>
  <img src="https://img.shields.io/badge/Go-1.26%2B-00ADD8?style=flat-square&logo=go&logoColor=white" alt="Go 1.26+" />
  <img src="https://img.shields.io/badge/UI-React%2019%20%2B%20TypeScript-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React 19 and TypeScript" />
  <img src="https://img.shields.io/badge/Framework-Wails%20v3-DF0000?style=flat-square" alt="Wails v3" />
  <img src="https://img.shields.io/badge/Platforms-macOS%20%7C%20Windows%20%7C%20Linux-18181b?style=flat-square" alt="macOS, Windows, and Linux" />
</p>

</div>

---

> 🚧 **Status: under active development.** The Kafka backend ([franz-go](https://github.com/twmb/franz-go) + kadm) and frontend remap are in place — see [PLAN.md](./PLAN.md) and [FEATURES.md](./FEATURES.md) for scope and remaining milestones.

---

## Why Kaflow?

Most Kafka desktop clients are Electron apps (or web consoles that need a deployed server), eating hundreds of megabytes of RAM. Kaflow takes a native-first approach:

- **Featherweight Native Performance**: Go backend + **Wails v3** native OS webviews (`WKWebView` on macOS, `WebView2` on Windows, `WebKitGTK` on Linux) — no Chromium, no Node runtime.
- **Production-Safe by Design**: Environment groups (`Production`, `Staging`, `Development`, `Local`) with color-coded badges and a **Read-Only Mode** per connection to block destructive mutations.
- **OS Keychain Security**: SASL secrets and SSH passphrases stay in **macOS Keychain**, **Windows Credential Manager**, and **Linux Secret Service** (`go-keyring`) — never on disk in plaintext.
- **Built-In SSH Bastion Tunneling**: Pure-Go SSH port forwarding — no external `ssh` binary required.
- **TLS / mTLS + SASL**: PLAIN, SCRAM, and mTLS client certificates for secure clusters.

## Features

- **Topic Explorer**: browse, create, and delete topics, inspect and edit topic configs inline, view partition leaders/ISR, and add partitions.
- **Consumer Group Inspector**: group membership, partition offsets, and lag monitoring with offset reset.
- **Message Browser & Producer**: browse and filter messages by key/value/header, live-tail per topic/partition, copy or export JSON records, and produce test messages.
- **Cluster Diagnostics**: cluster/broker metrics dashboard, controller and under-replicated partition visibility.
- **Built-In Auto-Updater**: GitHub-release-backed self-update with progress events.

## Building from Source

### Prerequisites

- **Go** `1.26+`
- **Node.js** `22+` (or `24+`) and `npm`
- **Wails v3 CLI** (`go install github.com/wailsapp/wails/v3/cmd/wails3@latest`)
- **Linux only**: `libgtk-3-dev`, `libwebkit2gtk-4.1-dev`, `libsecret-1-dev`, `pkg-config`

### Local Development & Production Build

```bash
# 1. Clone the repository
git clone https://github.com/pankaj-kumar34/kaflow.git
cd kaflow

# 2. Install and build the React + TypeScript frontend
cd frontend
npm ci
npm run build
cd ..

# 3. Run backend unit tests
go test ./backend/...

# 4. Run in hot-reload development mode (Wails v3)
wails3 dev

# 5. Or compile a production binary directly
go build -tags production -trimpath -ldflags="-w -s" -o bin/kaflow .
```

---

## Keyboard Shortcuts

Press `Cmd + /` (macOS), `Ctrl + /` (Windows/Linux), or `?` anywhere outside text inputs to open the searchable **Keyboard Shortcuts** modal.

| Action                   | macOS            | Windows / Linux   |
| :----------------------- | :--------------- | :---------------- |
| **Topics**               | `Cmd + 1`        | `Ctrl + 1`        |
| **Consumer Groups**      | `Cmd + 2`        | `Ctrl + 2`        |
| **Cluster Dashboard**    | `Cmd + 3`        | `Ctrl + 3`        |
| **New Connection**       | `Cmd + N`        | `Ctrl + N`        |
| **Toggle Sidebar**       | `Cmd + B`        | `Ctrl + B`        |
| **Save Key Changes**     | `Cmd + S`        | `Ctrl + S`        |
| **Shortcuts Help**       | `Cmd + /` or `?` | `Ctrl + /` or `?` |

---

## Architecture & Tech Stack

| Layer                   | Technology                                                        | Role                                                                                |
| :---------------------- | :---------------------------------------------------------------- | :---------------------------------------------------------------------------------- |
| **Desktop Shell**       | [Wails v3](https://v3.wails.io/) (`github.com/wailsapp/wails/v3`) | Native OS WebView windowing, event bus, and Go-to-TypeScript RPC bindings           |
| **Backend Runtime**     | Go `1.26`                                                         | Non-blocking I/O, goroutines, connection pool management, and binary packaging      |
| **Kafka Client**        | [`franz-go`](https://github.com/twmb/franz-go) _(planned)_        | Cluster admin, consumer groups, produce/fetch with full protocol support            |
| **SSH Tunneling**       | `golang.org/x/crypto/ssh`                                         | Pure-Go SSH bastion port forwarding                                                 |
| **Secret Storage**      | [`go-keyring`](https://github.com/zalando/go-keyring)             | Native macOS Keychain, Windows Credential Manager, and Linux Secret Service         |
| **Frontend UI**         | React 19, TypeScript, Vite, Tailwind CSS v4                       | Responsive desktop UI (red accent) with Lucide icons and custom syntax highlighters |
| **List Virtualization** | `@tanstack/react-virtual`                                         | High-performance scrolling across large topic/message lists                         |

### Repository Layout

```text
kaflow/
├── main.go                          # Wails v3 entrypoint, window setup, and service registration
├── Taskfile.yml                     # Cross-platform build & dev task definitions
├── build/                           # Platform icons, Info.plist, packaging configs, and assets
├── backend/
│   ├── connection/                  # ConnectionManager, TLS & SSH tunnel, credential storage
│   ├── models/                      # Shared Go structs bound to TypeScript definitions
│   └── services/                    # Wails RPC services (Connection, Topic, Message, Tail, Group, Diagnostics, Updater)
└── frontend/
    ├── bindings/                    # Auto-generated Wails v3 Go-to-TypeScript bindings
    └── src/
        ├── App.tsx                  # Root workspace layout, connection switching, and keyboard shortcuts
        ├── components/              # Shared UI primitives, modals, and toasts
        └── features/                # cluster, connections, editors, groups, topics
```

---

## Contributing & License

Contributions are welcome — open an issue or pull request on [GitHub](https://github.com/pankaj-kumar34/kaflow).

Licensed under the [MIT License](./LICENSE).
