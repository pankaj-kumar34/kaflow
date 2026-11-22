import React, { useState, useEffect, useRef } from "react";
import {
  Server,
  FolderTree,
  Gauge,
  Users,
  Plus,
  AlertTriangle,
  Clock,
  Shield,
  Zap,
  PanelLeftClose,
  PanelLeft,
  Lock,
  Unplug,
  Edit2,
  Trash2,
  Layers,
  RefreshCw,
  Power,
} from "lucide-react";
import type {
  AppVersionInfo,
  ConnectionConfig,
  ConnectionStatus,
  UpdateCheckResult,
} from "../bindings/kaflow/backend/models/index.js";
import {
  ConnectionService,
  UpdaterService,
} from "../bindings/kaflow/backend/services/index.js";
import { Events } from "@wailsio/runtime";
import { ConnectionList } from "./features/connections/ConnectionList";
import { ConnectionProfile } from "./features/connections/ConnectionProfile";
import { TopicExplorer } from "./features/topics/TopicExplorer";
import { ClusterDashboard } from "./features/cluster/ClusterDashboard";
import { GroupsView } from "./features/groups/GroupsView";
import { TailService } from "../bindings/kaflow/backend/services/index.js";
import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
import { ConfirmModal } from "./components/ui/ConfirmModal";
import { ShortcutsModal } from "./components/ui/ShortcutsModal";
import { UpdateModal } from "./components/ui/UpdateModal";
import { useToast } from "./components/ui/Toast";
import {
  applyConnectionOrder,
  reorderWithConnectedFirst,
  removeConnectionFromOrder,
} from "./lib/connectionOrder";
import { getErrorMessage, getModSymbol, isMacPlatform } from "./lib/utils";

interface KaflowWindowBridge extends Window {
  __navTab?: (tab: unknown) => void;
  __toggleSidebar?: () => void;
  __newConn?: () => void;
  __toggleShortcuts?: () => void;
}

export function App() {
  const { error: toastError, info: toastInfo } = useToast();
  const [connections, setConnections] = useState<ConnectionConfig[]>([]);
  const [activeConnId, setActiveConnId] = useState<string | null>(null);
  const [activeStatus, setActiveStatus] = useState<ConnectionStatus | null>(
    null,
  );
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<
    "topics" | "cluster" | "groups"
  >("topics");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const isMac = isMacPlatform();
  const modSymbol = getModSymbol();

  // Dialog State
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editingConfig, setEditingConfig] = useState<ConnectionConfig | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [isUpdaterOpen, setIsUpdaterOpen] = useState(false);
  const [versionInfo, setVersionInfo] = useState<AppVersionInfo | null>(null);
  const [updateCheckResult, setUpdateCheckResult] =
    useState<UpdateCheckResult | null>(null);

  const [ephemeralConn, setEphemeralConn] = useState<ConnectionConfig | null>(
    null,
  );

  // Stable refs for event listeners and global window bridge
  const connectionsRef = useRef(connections);
  const activeConnIdRef = useRef(activeConnId);
  const activeStatusRef = useRef(activeStatus);
  const handleNavTabRef = useRef<
    (tab: "topics" | "cluster" | "groups") => void
  >(() => {});
  const handleOpenAddRef = useRef<() => void>(() => {});

  const loadConnections = async () => {
    try {
      const list = await ConnectionService.GetConnections();
      const savedOnly = (list || []).filter((c) => !c.ephemeral);
      const ordered = applyConnectionOrder(savedOnly);
      setConnections(ordered);
      return ordered;
    } catch (err) {
      console.error("Failed to load connections:", err);
      return [];
    }
  };

  const handleConnect = async (
    id: string,
    directConn?: ConnectionConfig,
  ): Promise<boolean> => {
    let conn = directConn || connections.find((c) => c.id === id);
    if (!conn) {
      const list = await loadConnections();
      conn = (list || []).find((c) => c.id === id);
    }
    const previousConnId = activeConnId;
    setConnectingId(id);
    try {
      const status = await ConnectionService.Connect(id);
      if (!status || !status.connected) {
        throw new Error(
          status?.errorMessage || "Failed to establish connection",
        );
      }
      setActiveConnId(id);
      setActiveStatus(status);
      setActiveTab("topics");
      setIsEditingProfile(false);
      setEditingConfig(null);

      // Clean up previous active connection on the backend if switching to a different server
      if (previousConnId && previousConnId !== id) {
        ConnectionService.Disconnect(previousConnId)
          .then(() => {
            if (ephemeralConn?.id === previousConnId) {
              setEphemeralConn(null);
              ConnectionService.DeleteConnection(previousConnId).catch(
                () => {},
              );
            }
            const prevConn = connectionsRef.current.find(
              (c) => c.id === previousConnId,
            );
            if (prevConn?.ephemeral) {
              removeConnectionFromOrder(previousConnId);
              loadConnections();
            }
          })
          .catch((err) => {
            console.warn("Failed to disconnect previous connection:", err);
          });
      }

      // Promote connected profile to the first position with smooth animation (saved profiles only)
      if (!conn?.ephemeral) {
        setConnections((prev) => {
          const exists = prev.some((c) => c.id === id);
          const baseList = exists ? prev : conn ? [...prev, conn] : prev;
          return reorderWithConnectedFirst(baseList, id);
        });
      }

      return true;
    } catch (err: unknown) {
      let errMsg = getErrorMessage(err) || "Unknown error";
      // Remove dial host:port prefix and any broker reference so cluster hosts are not exposed in toast
      errMsg = errMsg.replace(/dial (?:tcp|udp)?\s*[^:]+:\d+:\s*/gi, "");
      errMsg = errMsg.replace(/lookup\s+[^:]+:\s*/gi, "lookup: ");
      for (const broker of conn?.seedBrokers ?? []) {
        const host = broker.split(":")[0];
        if (host && host.trim()) {
          errMsg = errMsg.split(host).join("");
        }
      }
      errMsg = errMsg.replace(/^:\s*/, "").trim();

      const connName = conn?.name || "Server";
      toastError(
        "Connection Failed",
        `Could not connect to "${connName}": ${errMsg}`,
      );
      return false;
    } finally {
      setConnectingId(null);
    }
  };

  const handleDisconnect = async (id: string) => {
    try {
      const conn =
        connections.find((c) => c.id === id) ||
        (ephemeralConn?.id === id ? ephemeralConn : null);
      await ConnectionService.Disconnect(id);
      if (conn?.ephemeral) {
        removeConnectionFromOrder(id);
        await ConnectionService.DeleteConnection(id);
        setEphemeralConn(null);
      }
      if (activeConnId === id) {
        setActiveConnId(null);
        setActiveStatus(null);
        setActiveTab("topics");
      }
      // Stop any live tail left running on this connection
      TailService.StopTail(id).catch(() => {});
      await loadConnections();
    } catch (err: unknown) {
      toastError(
        "Disconnect Failed",
        `Failed to disconnect: ${getErrorMessage(err)}`,
      );
    }
  };

  // Stop any live tail before switching/disconnecting so background streams don't linger
  const stopActiveTailIfAny = async (id: string) => {
    try {
      if (await TailService.IsTailing(id)) {
        await TailService.StopTail(id);
        toastInfo("Stream stopped");
      }
    } catch {
      // ignore
    }
  };

  const requestConnect = (id: string, directConn?: ConnectionConfig) => {
    if (activeConnId === id) {
      setIsEditingProfile(false);
      setEditingConfig(null);
      setActiveTab("topics");
      return;
    }
    if (activeConnId) stopActiveTailIfAny(activeConnId);
    handleConnect(id, directConn);
  };

  const requestDisconnect = (id: string) => {
    stopActiveTailIfAny(id);
    handleDisconnect(id);
  };

  const handleOpenAdd = () => {
    setEditingConfig(null);
    setIsEditingProfile(true);
  };

  const handleNavTab = (
    tab: "topics" | "cluster" | "groups",
  ) => {
    const isConn = !!(
      activeConnIdRef.current && activeStatusRef.current?.connected
    );
    if (isConn) {
      setActiveTab(tab);
      setIsEditingProfile(false);
      setEditingConfig(null);
      return;
    }

    const conns = connectionsRef.current;
    if (conns && conns.length > 0) {
      const targetConn =
        conns.find((c) => c.id === activeConnIdRef.current) || conns[0];
      setActiveTab(tab);
      setIsEditingProfile(false);
      setEditingConfig(null);
      handleConnect(targetConn.id, targetConn);
      return;
    }

    const tabLabels: Record<string, string> = {
      topics: `Topics (${modSymbol}1)`,
      groups: `Groups (${modSymbol}2)`,
      cluster: `Cluster (${modSymbol}3)`,
    };
    toastError(
      "Connection Required",
      `Connect to a Kafka cluster first to access ${tabLabels[tab] || tab}.`,
    );
  };

  useEffect(() => {
    connectionsRef.current = connections;
    activeConnIdRef.current = activeConnId;
    activeStatusRef.current = activeStatus;
    handleNavTabRef.current = handleNavTab;
    handleOpenAddRef.current = handleOpenAdd;
  });

  useEffect(() => {
    ConnectionService.GetConnections()
      .then((list) => {
        const savedOnly = (list || []).filter((c) => !c.ephemeral);
        setConnections(applyConnectionOrder(savedOnly));
      })
      .catch((err) => {
        console.error("Failed to load connections:", err);
      });

    // Load current version info and perform a non-blocking startup update check
    UpdaterService.GetVersionInfo()
      .then((info) => {
        if (info) setVersionInfo(info);
      })
      .catch(() => {});

    UpdaterService.CheckForUpdate()
      .then((res) => {
        if (res) setUpdateCheckResult(res);
      })
      .catch(() => {});

    // 1. Listen for native desktop shortcuts via Wails Events
    const cancelNav = Events.On("nav:tab", (eventData: unknown) => {
      const raw = eventData as { data?: unknown } | string | null;
      const tab =
        raw && typeof raw === "object" && "data" in raw ? raw.data : raw;
      if (
        tab === "topics" ||
        tab === "cluster" ||
        tab === "groups"
      ) {
        handleNavTabRef.current(tab);
      }
    });

    const cancelToggleSidebar = Events.On("nav:toggle-sidebar", () => {
      setSidebarCollapsed((prev) => !prev);
    });

    const cancelNewConn = Events.On("nav:new-connection", () => {
      handleOpenAddRef.current();
    });

    let lastToggleTime = 0;
    const triggerToggleShortcuts = (e?: Event) => {
      const now = Date.now();
      if (now - lastToggleTime < 250) return;
      lastToggleTime = now;
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      setIsShortcutsOpen((prev) => !prev);
    };

    const cancelShortcuts = Events.On("nav:shortcuts", () => {
      triggerToggleShortcuts();
    });

    // 2. Direct JavaScript bridge for Wails window.ExecJS
    const win = window as KaflowWindowBridge;
    win.__navTab = (tab: unknown) => {
      if (
        tab === "topics" ||
        tab === "cluster" ||
        tab === "groups"
      ) {
        handleNavTabRef.current(tab);
      }
    };
    win.__toggleSidebar = () => {
      setSidebarCollapsed((prev) => !prev);
    };
    win.__newConn = () => {
      handleOpenAddRef.current();
    };
    win.__toggleShortcuts = () => {
      triggerToggleShortcuts();
    };

    // 3. DOM keydown listeners with capture phase (supports Cmd, Ctrl, and Alt/Option)
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return; // Prevent duplicate repeat events while holding key down

      const isCmdOrCtrl = e.metaKey || e.ctrlKey;
      const isAlt = e.altKey;

      const target = e.target as HTMLElement | null;
      const isInput = !!(
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      );

      const isSlashOrQuestion =
        e.key === "/" ||
        e.key === "?" ||
        e.code === "Slash" ||
        e.keyCode === 191 ||
        e.which === 191;

      // 1. Cmd/Ctrl + / (or Cmd/Ctrl + ?)
      if (isCmdOrCtrl && isSlashOrQuestion) {
        triggerToggleShortcuts(e);
        return;
      }

      // 2. '?' or '/' when outside inputs
      if (
        !isCmdOrCtrl &&
        !isAlt &&
        !isInput &&
        (e.key === "?" || e.key === "/" || isSlashOrQuestion)
      ) {
        triggerToggleShortcuts(e);
        return;
      }

      if (!isCmdOrCtrl && !isAlt) return;

      const is1 = e.key === "1" || e.code === "Digit1" || e.code === "Numpad1";
      const is2 = e.key === "2" || e.code === "Digit2" || e.code === "Numpad2";
      const is3 = e.key === "3" || e.code === "Digit3" || e.code === "Numpad3";
      const isB = e.key === "b" || e.key === "B" || e.code === "KeyB";
      const isN = e.key === "n" || e.key === "N" || e.code === "KeyN";

      if (isCmdOrCtrl && isN) {
        e.preventDefault();
        e.stopPropagation();
        handleOpenAddRef.current();
      } else if (isCmdOrCtrl && isB) {
        e.preventDefault();
        e.stopPropagation();
        setSidebarCollapsed((prev) => !prev);
      } else if (is1) {
        e.preventDefault();
        e.stopPropagation();
        handleNavTabRef.current("topics");
      } else if (is2) {
        e.preventDefault();
        e.stopPropagation();
        handleNavTabRef.current("groups");
      } else if (is3) {
        e.preventDefault();
        e.stopPropagation();
        handleNavTabRef.current("cluster");
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });

    return () => {
      cancelNav();
      cancelToggleSidebar();
      cancelNewConn();
      cancelShortcuts();
      delete win.__navTab;
      delete win.__toggleSidebar;
      delete win.__newConn;
      delete win.__toggleShortcuts;
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, []);

  const handleOpenEdit = (cfg: ConnectionConfig) => {
    setEditingConfig(cfg);
    setIsEditingProfile(true);
  };

  const handleDeleteConnection = (id: string, name?: string) => {
    const targetName =
      name ||
      connections.find((c) => c.id === id)?.name ||
      (ephemeralConn?.id === id ? ephemeralConn.name : undefined) ||
      "this connection";
    setDeleteTarget({ id, name: targetName });
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const { id } = deleteTarget;
    setDeleteTarget(null);

    try {
      await ConnectionService.DeleteConnection(id);
      removeConnectionFromOrder(id);

      if (ephemeralConn?.id === id) {
        setEphemeralConn(null);
      }

      // If active, cleanly disconnect and reset
      if (activeConnId === id) {
        setActiveConnId(null);
        setActiveStatus(null);
        setActiveTab("topics");
      }
      TailService.StopTail(id).catch(() => {});

      // If editing this connection, exit edit mode
      if (editingConfig?.id === id) {
        setIsEditingProfile(false);
        setEditingConfig(null);
      }

      await loadConnections();
    } catch (err: unknown) {
      console.error("Failed to delete connection:", err);
    }
  };

  const proceedQuickConnectLocal = async () => {
    // Check if user already has a saved (non-ephemeral) connection for localhost:9092
    const isLocal = (brokers: string[]) =>
      brokers.some((b) => /^(127\.0\.0\.1|localhost)(:9092)?$/.test(b.trim()));
    const existingSaved = connections.find(
      (c) => !c.ephemeral && isLocal(c.seedBrokers),
    );
    if (existingSaved) {
      await handleConnect(existingSaved.id, existingSaved);
      return;
    }

    // Clean up any stale ephemeral localhost entries from previous failed attempts
    const staleEphemerals = connections.filter(
      (c) => c.ephemeral && isLocal(c.seedBrokers),
    );
    for (const stale of staleEphemerals) {
      await ConnectionService.DeleteConnection(stale.id);
      removeConnectionFromOrder(stale.id);
    }
    if (staleEphemerals.length > 0) {
      const cleaned = await ConnectionService.GetConnections();
      setConnections(cleaned || []);
    }

    const tempId = `ephemeral-local-${Date.now()}`;
    const newLocal: ConnectionConfig = {
      id: tempId,
      name: "Localhost",
      seedBrokers: ["localhost:9092"],
      username: "",
      password: "",
      sasl: { mechanism: "" },
      ssh: {
        enabled: false,
        host: "",
        port: 22,
        user: "",
        password: "",
        keyPath: "",
        passphrase: "",
      },
      tls: {
        enabled: false,
        caCert: "",
        clientCert: "",
        clientKey: "",
        insecureSkipVerify: false,
      },
      readOnly: false,
      color: "#10b981",
      group: "Local",
      ephemeral: true,
    };

    setConnectingId(tempId);
    try {
      // 1. Temporarily register with backend so Connect can dial it
      await ConnectionService.SaveConnection(newLocal);

      // 2. Attempt connect - do NOT add to saved connections state (no profile in sidebar or recents)
      const success = await handleConnect(tempId, newLocal);

      if (success) {
        setEphemeralConn(newLocal);
        // Clean refresh: ensure only saved non-ephemeral connections are in state
        await loadConnections();
      } else {
        // Failed to connect! Remove temporary entry from backend
        await ConnectionService.DeleteConnection(tempId);
        removeConnectionFromOrder(tempId);
      }
    } catch (err: unknown) {
      await ConnectionService.DeleteConnection(tempId);
      removeConnectionFromOrder(tempId);
      toastError(
        "Connection Failed",
        "Failed to initialize connection: " + getErrorMessage(err),
      );
    } finally {
      setConnectingId(null);
    }
  };

  const handleQuickConnectLocal = async () => {
    // If already connecting, no-op
    if (connectingId) return;

    // If already connected to localhost, no-op
    if (activeConnId) {
      const active =
        connections.find((c) => c.id === activeConnId) ||
        (ephemeralConn?.id === activeConnId ? ephemeralConn : null);
      const isLocal = (brokers: string[]) =>
        brokers.some((b) =>
          /^(127\.0\.0\.1|localhost)(:9092)?$/.test(b.trim()),
        );
      if (active && isLocal(active.seedBrokers)) {
        return;
      }
    }

    // Stop any live tail before switching
    if (activeConnId) stopActiveTailIfAny(activeConnId);

    await proceedQuickConnectLocal();
  };

  const activeConnection =
    connections.find((c) => c.id === activeConnId) ||
    (ephemeralConn && ephemeralConn.id === activeConnId ? ephemeralConn : null);

  const getEnvInfo = (conn: ConnectionConfig) => {
    const rawGroup = conn.group?.trim() || "Development";
    const g = rawGroup.toLowerCase();
    let defaultColor = "#3b82f6";
    let label = rawGroup;
    if (g.includes("prod")) {
      defaultColor = "#dc2626";
      if (g === "prod") label = "Production";
    } else if (g.includes("stag") || g.includes("uat")) {
      defaultColor = "#f59e0b";
      if (g === "stag" || g === "stg") label = "Staging";
    } else if (g.includes("local")) {
      defaultColor = "#10b981";
      if (g === "local") label = "Local";
    } else if (g.includes("dev")) {
      defaultColor = "#3b82f6";
      if (g === "dev") label = "Development";
    }
    const color =
      conn.color && conn.color.trim() !== "" ? conn.color : defaultColor;
    return { label, color };
  };

  const activeEnv = activeConnection ? getEnvInfo(activeConnection) : null;

  const envBreakdown = React.useMemo(() => {
    const map = new Map<
      string,
      { label: string; count: number; color: string; order: number }
    >();

    connections.forEach((conn) => {
      const { label, color } = getEnvInfo(conn);
      const lk = label.toLowerCase();
      let order = 50;
      if (lk.includes("prod")) order = 10;
      else if (lk.includes("stag") || lk.includes("uat")) order = 20;
      else if (lk.includes("dev")) order = 30;
      else if (lk.includes("local")) order = 40;

      const existing = map.get(label);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(label, { label, count: 1, color, order });
      }
    });

    return Array.from(map.values()).sort(
      (a, b) => a.order - b.order || a.label.localeCompare(b.label),
    );
  }, [connections]);

  const recentConnections = connections.slice(0, 3);

  const sidebarConnections = React.useMemo(() => {
    if (!ephemeralConn) return connections;
    return [
      ephemeralConn,
      ...connections.filter((c) => c.id !== ephemeralConn.id),
    ];
  }, [connections, ephemeralConn]);

  return (
    <div className="flex size-full overflow-hidden bg-[#fafafa] font-sans text-mauve-900 select-none">
      {/* 1. Left Sidebar: Connection Management (Collapsible) */}
      <ConnectionList
        connections={sidebarConnections}
        activeConnId={activeConnId}
        activeStatus={activeStatus}
        activeTab={activeTab}
        onSelectTab={handleNavTab}
        onConnect={requestConnect}
        onDisconnect={requestDisconnect}
        onEdit={handleOpenEdit}
        onDelete={handleDeleteConnection}
        onAddNew={handleOpenAdd}
        onRefresh={loadConnections}
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
        connectingId={connectingId}
        appVersion={versionInfo?.version || "1.0.0"}
        updateAvailableVersion={
          updateCheckResult?.hasUpdate ? updateCheckResult.latestVersion : null
        }
        onOpenUpdater={() => setIsUpdaterOpen(true)}
      />

      {/* 2. Main Content Area */}
      <div className="flex h-full flex-1 flex-col overflow-hidden bg-[#fafafa]">
        {isEditingProfile ? (
          <ConnectionProfile
            initialConfig={editingConfig}
            onBack={() => {
              setIsEditingProfile(false);
              setEditingConfig(null);
            }}
            onDelete={handleDeleteConnection}
            onSaved={async (savedCfg, andConnect) => {
              if (ephemeralConn?.id === savedCfg.id && !savedCfg.ephemeral) {
                setEphemeralConn(null);
              }
              await loadConnections();
              setIsEditingProfile(false);
              setEditingConfig(null);
              if (activeConnId === savedCfg.id) {
                stopActiveTailIfAny(savedCfg.id);
                handleConnect(savedCfg.id, savedCfg);
              } else if (andConnect) {
                requestConnect(savedCfg.id, savedCfg);
              }
            }}
          />
        ) : activeConnection ? (
          <>
            {/* Safety Banner */}
            {(() => {
              const isProd = activeConnection.group
                ?.toLowerCase()
                .includes("prod");
              const isReadOnly = activeConnection.readOnly;
              if (!isProd && !isReadOnly) return null;

              return (
                <div
                  className={`flex shrink-0 items-center gap-2 border-b px-4 py-1.5 text-xs font-semibold tracking-wide ${
                    isProd
                      ? "border-red-200 bg-red-50 text-red-700"
                      : "border-amber-200 bg-amber-50 text-amber-700"
                  }`}
                >
                  <AlertTriangle
                    size={13}
                    className={isProd ? "text-red-600" : "text-amber-600"}
                  />
                  <span>
                    {isProd && isReadOnly
                      ? "PRODUCTION ENVIRONMENT (READ-ONLY) — MUTATION COMMANDS ARE DISABLED."
                      : isProd
                        ? "WARNING: CONNECTED TO PRODUCTION INSTANCE. PROCEED WITH CAUTION."
                        : "READ-ONLY MODE ENABLED — WRITE AND MUTATION COMMANDS ARE BLOCKED."}
                  </span>
                </div>
              );
            })()}

            {/* Top Workspace Header (When Connected) with Dynamic Environment Tint */}
            <div
              className="relative flex h-14 shrink-0 items-center justify-between gap-4 overflow-hidden border-b px-5 shadow-2xs transition-all duration-300"
              style={{
                backgroundColor: "#ffffff",
                backgroundImage: activeEnv
                  ? `linear-gradient(180deg, ${activeEnv.color}0d 0%, rgba(255, 255, 255, 0.98) 100%)`
                  : undefined,
                borderBottomColor: activeEnv
                  ? `${activeEnv.color}35`
                  : "#e4e4e7",
                boxShadow: activeEnv
                  ? `0 2px 14px -3px ${activeEnv.color}15`
                  : undefined,
              }}
            >
              {/* Subtle Ambient Radial Glow */}
              {activeEnv && (
                <div
                  className="pointer-events-none absolute inset-0 transition-opacity duration-500"
                  style={{
                    background: `radial-gradient(ellipse 60% 140% at 50% 0%, ${activeEnv.color}10 0%, transparent 80%)`,
                  }}
                />
              )}

              {/* Left: Sidebar Toggle & Breadcrumb */}
              <div className="z-10 flex shrink-0 items-center gap-2.5 text-xs">
                <button
                  onClick={() => setSidebarCollapsed((prev) => !prev)}
                  className="mr-1 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-mauve-100 hover:text-mauve-900"
                  title={
                    sidebarCollapsed
                      ? `Expand Sidebar (${modSymbol}B)`
                      : `Collapse Sidebar (${modSymbol}B)`
                  }
                >
                  {sidebarCollapsed ? (
                    <PanelLeft size={16} />
                  ) : (
                    <PanelLeftClose size={16} />
                  )}
                </button>
                {activeTab === "topics" && (
                  <FolderTree size={15} className="text-mauve-600" />
                )}
                {activeTab === "groups" && (
                  <Users size={15} className="text-mauve-600" />
                )}
                {activeTab === "cluster" && (
                  <Gauge size={15} className="text-mauve-600" />
                )}
                <span className="text-sm font-bold text-mauve-900">
                  {activeTab === "topics" && "Topics"}
                  {activeTab === "cluster" && "Cluster"}
                  {activeTab === "groups" && "Groups"}
                </span>
              </div>

              {/* Right: Quick Actions */}
              <div className="z-10 flex items-center gap-2.5">
                {activeConnection.readOnly && (
                  <Badge
                    variant="destructive"
                    className="gap-1.5 px-2.5 py-1 text-xs"
                  >
                    <Shield size={11} /> Read-Only
                  </Badge>
                )}

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => requestDisconnect(activeConnection.id)}
                  className="text-zinc-500 hover:bg-red-50 hover:text-red-600"
                  title="Disconnect from active session"
                >
                  <Unplug size={13} />
                  <span>Disconnect</span>
                </Button>
              </div>
            </div>

            {/* Main Tab Views (State preserved across navigation within active connection) */}
            <div
              key={activeConnection.id}
              className="relative flex flex-1 overflow-hidden"
            >
              {/* 1. Topic Explorer */}
              <div
                className={`size-full ${
                  activeTab === "topics" ? "flex" : "hidden"
                }`}
              >
                <TopicExplorer
                  connId={activeConnection.id}
                  readOnly={activeConnection.readOnly}
                  isActive={activeTab === "topics"}
                />
              </div>

              {/* 2. Consumer Groups */}
              <div
                className={`size-full ${
                  activeTab === "groups" ? "block" : "hidden"
                }`}
              >
                <GroupsView
                  connId={activeConnection.id}
                  readOnly={activeConnection.readOnly}
                  isActive={activeTab === "groups"}
                />
              </div>

              {/* 3. Cluster Health Dashboard */}
              <div
                className={`size-full ${
                  activeTab === "cluster" ? "block" : "hidden"
                }`}
              >
                <ClusterDashboard
                  connId={activeConnection.id}
                  isActive={activeTab === "cluster"}
                  connectionName={activeConnection.name}
                  envColor={activeEnv?.color}
                />
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Top Workspace Header (When Not Connected) */}
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-200 bg-white px-5 shadow-2xs">
              <div className="flex items-center gap-2.5 text-xs">
                <button
                  onClick={() => setSidebarCollapsed((prev) => !prev)}
                  className="mr-1 flex size-8 cursor-pointer items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-mauve-100 hover:text-mauve-900"
                  title={
                    sidebarCollapsed
                      ? `Expand Sidebar (${modSymbol}B)`
                      : `Collapse Sidebar (${modSymbol}B)`
                  }
                >
                  {sidebarCollapsed ? (
                    <PanelLeft size={16} />
                  ) : (
                    <PanelLeftClose size={16} />
                  )}
                </button>
                <Server size={15} className="text-mauve-600" />
                {activeTab === "topics" && (
                  <FolderTree size={15} className="text-mauve-600" />
                )}
                {activeTab === "groups" && (
                  <Users size={15} className="text-mauve-600" />
                )}
                {activeTab === "cluster" && (
                  <Gauge size={15} className="text-mauve-600" />
                )}
                <span className="text-sm font-bold text-mauve-900">
                  Overview
                </span>
              </div>
            </div>

            {/* Rich Welcome & Saved Connections Screen */}
            <div className="flex-1 overflow-y-auto bg-[#fafafa] p-6 select-none sm:p-7 lg:p-8">
              <div className="mx-auto max-w-6xl space-y-8 sm:space-y-9">
                {/* Hero Header */}
                <div className="relative flex flex-col justify-between gap-4 overflow-hidden rounded-2xl border border-zinc-200/90 bg-white p-4 shadow-2xs sm:flex-row sm:items-center sm:p-5">
                  <div className="pointer-events-none absolute -top-20 -right-20 size-96 rounded-full bg-mauve-500/10 blur-3xl" />

                  <div className="z-10 flex items-start gap-4 sm:items-center">
                    <img
                      src="/icon.png"
                      alt="Kaflow"
                      className="size-16 shrink-0 rounded-xl object-contain shadow-md shadow-mauve-600/10 select-none"
                    />
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-bold tracking-tight text-mauve-900 sm:text-xl">
                          Welcome to Kaflow
                        </h2>
                        <button
                          onClick={() => setIsUpdaterOpen(true)}
                          className="cursor-pointer rounded-full border border-mauve-200 bg-mauve-50 px-2 py-0.5 text-[11px] font-medium text-mauve-700 transition-colors hover:bg-mauve-100"
                          title="Click to check for updates"
                        >
                          v{versionInfo?.version || "1.0.0"}
                        </button>
                      </div>
                      <p className="mt-1 max-w-md text-xs leading-relaxed text-zinc-500 sm:text-sm">
                        Select a saved connection below or connect to a local
                        instance to begin.
                      </p>
                    </div>
                  </div>

                  <div className="z-10 flex shrink-0 items-center gap-2.5">
                    <Button
                      onClick={handleOpenAdd}
                      variant="default"
                      size="sm"
                      className="h-9 cursor-pointer gap-1.5 rounded-lg bg-mauve-600 px-4 text-xs font-semibold text-white shadow-xs shadow-mauve-600/15 hover:bg-mauve-500 sm:text-sm"
                    >
                      <Plus size={15} />
                      <span>New Connection</span>
                    </Button>
                    <Button
                      onClick={handleQuickConnectLocal}
                      disabled={!!connectingId}
                      variant="outline"
                      size="sm"
                      className={`h-9 cursor-pointer gap-1.5 rounded-lg border-zinc-200 px-3.5 text-xs font-medium text-zinc-700 hover:bg-mauve-50 sm:text-sm ${
                        connectingId?.startsWith("ephemeral-local")
                          ? "cursor-wait opacity-75"
                          : connectingId
                            ? "cursor-not-allowed opacity-50"
                            : ""
                      }`}
                    >
                      {connectingId?.startsWith("ephemeral-local") ? (
                        <>
                          <RefreshCw
                            size={13.5}
                            className="animate-spin text-mauve-600"
                          />
                          <span>Connecting...</span>
                        </>
                      ) : (
                        <>
                          <Zap size={13.5} className="text-red-900" />
                          <span>Connect to Localhost</span>
                        </>
                      )}
                    </Button>
                  </div>
                </div>

                {/* Saved Connections or Empty State */}
                <div className="space-y-8 sm:space-y-9">
                  {connections.length > 0 ? (
                    <>
                      {/* Environments Summary */}
                      {envBreakdown.length > 0 && (
                        <div className="space-y-3.5">
                          <div className="flex items-center justify-between px-1">
                            <h3 className="flex items-center gap-2 text-xs font-bold tracking-wider text-mauve-800 uppercase">
                              <Layers size={13.5} className="text-mauve-600" />
                              <span>Environments</span>
                            </h3>
                          </div>

                          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            {envBreakdown.map((env) => (
                              <div
                                key={env.label}
                                className="flex items-center justify-between gap-2 rounded-xl border border-zinc-200/90 bg-white px-3.5 py-3 shadow-2xs transition-all hover:border-zinc-300"
                              >
                                <div className="flex min-w-0 items-center gap-2.5">
                                  <span
                                    className="size-2.5 shrink-0 rounded-full shadow-2xs"
                                    style={{ backgroundColor: env.color }}
                                  />
                                  <span className="truncate text-xs font-semibold text-mauve-800">
                                    {env.label}
                                  </span>
                                </div>
                                <span
                                  className="shrink-0 rounded-md border px-2 py-0.5 font-mono text-xs font-bold"
                                  style={{
                                    backgroundColor: `${env.color}15`,
                                    color: env.color,
                                    borderColor: `${env.color}35`,
                                  }}
                                >
                                  {env.count}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Recent Connections (Top 3) */}
                      <div className="space-y-3.5">
                        <div className="flex items-center justify-between px-1">
                          <h3 className="flex items-center gap-2 text-xs font-bold tracking-wider text-mauve-800 uppercase">
                            <Clock size={13.5} className="text-mauve-600" />
                            <span>Recent Connections</span>
                          </h3>
                        </div>

                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                          {recentConnections.map((conn) => {
                            const isConnecting = connectingId === conn.id;
                            const envBadge = conn.group
                              ?.toLowerCase()
                              .includes("prod")
                              ? {
                                  label: "PROD",
                                  bg: "bg-red-50 text-red-700 border-red-200",
                                  color: "#dc2626",
                                }
                              : conn.group?.toLowerCase().includes("stag") ||
                                  conn.group?.toLowerCase().includes("uat")
                                ? {
                                    label: "STG",
                                    bg: "bg-amber-50 text-amber-700 border-amber-200",
                                    color: "#f59e0b",
                                  }
                                : conn.group?.toLowerCase().includes("local")
                                  ? {
                                      label: "LOCAL",
                                      bg: "bg-emerald-50 text-emerald-700 border-emerald-200",
                                      color: "#10b981",
                                    }
                                  : {
                                      label: "DEV",
                                      bg: "bg-blue-50 text-blue-700 border-blue-200",
                                      color: "#3b82f6",
                                    };
                            const accentColor =
                              conn.color && conn.color.trim() !== ""
                                ? conn.color
                                : envBadge.color;

                            return (
                              <div
                                key={conn.id}
                                className={`group relative flex flex-col justify-between gap-4 overflow-hidden rounded-xl border border-zinc-200 bg-white p-4 shadow-2xs transition-all duration-200 hover:border-(--card-accent) sm:p-4.5 ${
                                  isConnecting ? "opacity-90" : ""
                                }`}
                                style={
                                  {
                                    "--card-accent": `${accentColor}70`,
                                  } as React.CSSProperties
                                }
                              >
                                <div className="flex items-start justify-between gap-2.5">
                                  <div className="min-w-0 flex-1 overflow-hidden">
                                    <div className="flex min-w-0 items-center gap-2">
                                      <h4 className="truncate text-sm font-bold text-mauve-900 transition-colors">
                                        {conn.name}
                                      </h4>
                                      <span
                                        className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-bold tracking-wider uppercase ${envBadge.bg}`}
                                      >
                                        {envBadge.label}
                                      </span>
                                    </div>
                                    <div className="mt-1 flex items-center font-mono text-xs text-zinc-500">
                                      <span
                                        className="truncate"
                                        title={conn.seedBrokers.join(", ")}
                                      >
                                        {conn.seedBrokers.join(", ")}
                                      </span>
                                    </div>
                                  </div>

                                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleOpenEdit(conn);
                                      }}
                                      className="flex size-7 cursor-pointer items-center justify-center rounded-md text-zinc-400 transition-colors hover:text-mauve-800"
                                      title="Edit Connection"
                                    >
                                      <Edit2 size={12.5} />
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteConnection(
                                          conn.id,
                                          conn.name,
                                        );
                                      }}
                                      className="flex size-7 cursor-pointer items-center justify-center rounded-md text-zinc-400 transition-colors hover:text-red-600"
                                      title="Delete Connection"
                                    >
                                      <Trash2 size={12.5} />
                                    </button>
                                  </div>
                                </div>

                                <div className="flex items-center justify-between border-t border-zinc-100 pt-3 text-xs">
                                  <div className="flex flex-wrap items-center gap-1.5 text-zinc-500">
                                    {conn.tls?.enabled && (
                                      <span
                                        className="flex items-center gap-1 text-[11px] font-medium text-emerald-600"
                                        title="TLS Enabled"
                                      >
                                        <Lock size={11} /> TLS
                                      </span>
                                    )}
                                    {conn.readOnly && (
                                      <span
                                        className="flex items-center gap-1 rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700"
                                        title="Read-Only Mode Enabled: Destructive commands are blocked"
                                      >
                                        <Shield size={10} /> Read-Only
                                      </span>
                                    )}
                                    {conn.sasl?.mechanism && (
                                      <span className="flex items-center gap-1 rounded border border-mauve-200 bg-mauve-50 px-1.5 py-0.5 text-[10px] font-semibold text-mauve-700">
                                        <Lock size={10} />
                                        {conn.sasl.mechanism}
                                      </span>
                                    )}
                                    {conn.ssh?.enabled && (
                                      <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">
                                        SSH
                                      </span>
                                    )}
                                  </div>

                                  <button
                                    onClick={() => {
                                      if (!isConnecting) {
                                        requestConnect(conn.id, conn);
                                      }
                                    }}
                                    disabled={isConnecting}
                                    className={`flex size-7.5 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-transparent transition-all hover:bg-mauve-100 active:scale-93 ${
                                      isConnecting
                                        ? "cursor-wait text-red-400"
                                        : "text-red-500 hover:text-emerald-600"
                                    }`}
                                    title={
                                      isConnecting
                                        ? "Connecting..."
                                        : `Power On • Connect to ${conn.name}`
                                    }
                                  >
                                    <Power
                                      size={14}
                                      className={
                                        isConnecting ? "animate-pulse" : ""
                                      }
                                    />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col items-center justify-center rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-2xs sm:p-12">
                      <div className="mb-3.5 flex size-13 items-center justify-center rounded-2xl border border-mauve-200 bg-mauve-50 text-mauve-600 shadow-xs">
                        <Server size={24} className="text-mauve-600" />
                      </div>
                      <h3 className="text-base font-semibold text-mauve-900">
                        No Connections
                      </h3>
                      <p className="mt-1 max-w-sm text-xs leading-relaxed text-zinc-500">
                        Get started by creating a new Kafka
                        connection, or quickly connect to an instance running on
                        localhost.
                      </p>
                      <div className="mt-5 flex items-center gap-2.5">
                        <Button
                          onClick={handleOpenAdd}
                          size="sm"
                          className="h-9 cursor-pointer gap-1.5 rounded-lg bg-mauve-600 px-4 text-xs font-semibold text-white shadow-xs shadow-mauve-600/15 hover:bg-mauve-500"
                        >
                          <Plus size={14} />
                          <span>New Connection</span>
                        </Button>
                        <Button
                          onClick={handleQuickConnectLocal}
                          disabled={!!connectingId}
                          variant="outline"
                          size="sm"
                          className={`h-9 cursor-pointer gap-1.5 rounded-lg border-zinc-200 px-3.5 text-xs font-medium text-zinc-700 hover:bg-mauve-50 ${
                            connectingId ? "cursor-wait opacity-75" : ""
                          }`}
                        >
                          {connectingId ? (
                            <>
                              <RefreshCw
                                size={13.5}
                                className="animate-spin text-mauve-600"
                              />
                              <span>Connecting...</span>
                            </>
                          ) : (
                            <>
                              <Zap size={13.5} className="text-mauve-600" />
                              <span>Connect to Localhost</span>
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Keyboard Shortcuts Modal */}
      <ShortcutsModal
        isOpen={isShortcutsOpen}
        onClose={() => setIsShortcutsOpen(false)}
        isMac={isMac}
      />

      {/* GitHub Releases Auto-Update Modal */}
      <UpdateModal
        isOpen={isUpdaterOpen}
        onClose={() => setIsUpdaterOpen(false)}
        versionInfo={versionInfo}
        initialCheckResult={updateCheckResult}
        onUpdateCheckComplete={(res) => setUpdateCheckResult(res)}
      />

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={!!deleteTarget}
        title="Delete Connection"
        description={`Are you sure you want to delete "${deleteTarget?.name}"? This action cannot be undone and will permanently remove all stored credentials.`}
        confirmText="Delete Connection"
        cancelText="Cancel"
        variant="danger"
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

export default App;
