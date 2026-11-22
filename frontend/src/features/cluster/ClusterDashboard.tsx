import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Server,
  FolderTree,
  Layers,
  AlertTriangle,
  CircleCheck,
  Loader2,
  ChevronDown,
  Copy,
  Check,
  Pause,
  Play,
} from "lucide-react";
import type {
  BrokerInfo,
  ClusterMetrics,
  ConfigEntryInfo,
} from "../../../bindings/kaflow/backend/models/index.js";
import {
  DiagnosticsService,
} from "../../../bindings/kaflow/backend/services/index.js";
import { useToast } from "../../components/ui/Toast";
import { getErrorMessage } from "../../lib/utils";

interface ClusterDashboardProps {
  connId: string;
  isActive: boolean;
  connectionName?: string;
  envColor?: string;
}

interface PartitionSample {
  count: number;
  at: number;
}

const POLL_MS = 10000;
const MAX_SAMPLES = 30;
const RING_CIRCUMFERENCE = 37.7;

// Deterministic 5x5 vertically symmetric sigil derived from FNV-1a over the cluster seed.
function buildClusterSigil(seed: string): Array<{ x: number; y: number }> {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const cells: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) {
      const isCenter = x === 2 && y === 2;
      const lit = ((h >>> (y * 3 + x)) & 1) === 1;
      if (isCenter || lit) {
        cells.push({ x, y });
        if (x < 2) cells.push({ x: 4 - x, y });
      }
    }
  }
  return cells;
}

export const ClusterDashboard: React.FC<ClusterDashboardProps> = ({
  connId,
  isActive,
  connectionName,
  envColor,
}) => {
  const toast = useToast();
  const [metrics, setMetrics] = useState<ClusterMetrics | null>(null);
  const [brokers, setBrokers] = useState<BrokerInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<PartitionSample[]>([]);
  const [live, setLive] = useState(true);
  const [pollTick, setPollTick] = useState(0);
  const [copiedId, setCopiedId] = useState(false);
  const [selectedBroker, setSelectedBroker] = useState<number | null>(null);
  const [brokerConfigs, setBrokerConfigs] = useState<ConfigEntryInfo[]>([]);
  const [loadingConfigs, setLoadingConfigs] = useState(false);

  const hasLoadedRef = useRef(false);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  const load = useCallback(async (): Promise<boolean> => {
    try {
      const [m, b] = await Promise.all([
        DiagnosticsService.GetClusterMetrics(connId),
        DiagnosticsService.GetBrokers(connId),
      ]);
      hasLoadedRef.current = true;
      setMetrics(m);
      setBrokers(b || []);
      setHistory((prev) => [
        ...prev.slice(-(MAX_SAMPLES - 1)),
        { count: m?.partitionCount ?? 0, at: Date.now() },
      ]);
      return true;
    } catch (err) {
      // keep last good values on transient background poll errors
      console.warn("cluster poll failed:", getErrorMessage(err));
      return false;
    }
  }, [connId]);

  useEffect(() => {
    if (!isActive) return;
    let cancelled = false;
    let timer: number | null = null;

    const run = async (initial: boolean) => {
      if (initial) setLoading(true);
      await load();
      if (cancelled) return;
      setLoading(false);
      setPollTick((n) => n + 1);
      if (live) {
        timer = window.setTimeout(() => void run(false), POLL_MS);
      }
    };

    if (live || !hasLoadedRef.current) {
      timer = window.setTimeout(() => void run(!hasLoadedRef.current), 0);
    }

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [isActive, live, load]);

  const copyClusterId = () => {
    const id = metrics?.clusterId;
    if (!id) return;
    navigator.clipboard?.writeText(id).catch(() => {});
    setCopiedId(true);
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopiedId(false), 1500);
  };

  const selectBroker = async (id: number) => {
    if (selectedBroker === id) {
      setSelectedBroker(null);
      setBrokerConfigs([]);
      return;
    }
    setSelectedBroker(id);
    setBrokerConfigs([]);
    setLoadingConfigs(true);
    try {
      const configs = await DiagnosticsService.GetBrokerConfigs(connId, id);
      const sorted = [...(configs || [])].sort(
        (a, b) => Number(a.isDefault) - Number(b.isDefault) || a.key.localeCompare(b.key),
      );
      setBrokerConfigs(sorted);
    } catch (err) {
      toast.error("Failed to load broker config", getErrorMessage(err));
    } finally {
      setLoadingConfigs(false);
    }
  };

  const healthy =
    metrics && metrics.underReplicatedPartitions === 0 && metrics.offlinePartitions === 0;

  const accent = envColor || "#594c5b";
  const sigilCells = buildClusterSigil(metrics?.clusterId || connectionName || connId);

  const alertCard = (label: string, count: number | undefined) => {
    const hasAlert = (count ?? 0) > 0;
    return {
      label,
      value: count !== undefined ? String(count) : "…",
      icon: hasAlert ? AlertTriangle : CircleCheck,
      tone: hasAlert ? "text-red-600" : "text-emerald-600",
      bg: hasAlert ? "bg-red-50" : "bg-white",
    };
  };

  const cards = [
    {
      label: "Brokers",
      value: metrics ? String(metrics.brokerCount) : "…",
      icon: Server,
      tone: "text-mauve-600",
      bg: "bg-mauve-50",
    },
    {
      label: "Topics",
      value: metrics ? String(metrics.topicCount) : "…",
      icon: FolderTree,
      tone: "text-mauve-600",
      bg: "bg-white",
    },
    {
      label: "Partitions",
      value: metrics ? metrics.partitionCount.toLocaleString("en-US") : "…",
      icon: Layers,
      tone: "text-mauve-600",
      bg: "bg-white",
    },
    alertCard("Under-replicated", metrics?.underReplicatedPartitions),
    alertCard("Offline partitions", metrics?.offlinePartitions),
  ];

  return (
    <div className="flex size-full flex-col overflow-hidden bg-white select-none">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-200 px-5 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div
            className="flex size-7 shrink-0 items-center justify-center rounded-lg border"
            style={{
              backgroundColor: `${accent}12`,
              borderColor: `${accent}30`,
            }}
            title="Cluster sigil (derived from cluster ID)"
          >
            <svg viewBox="0 0 15 15" className="size-4" aria-hidden="true">
              {sigilCells.map(({ x, y }) => (
                <rect
                  key={`${x}-${y}`}
                  x={x * 3 + 0.35}
                  y={y * 3 + 0.35}
                  width={2.3}
                  height={2.3}
                  rx={0.6}
                  fill={accent}
                  opacity={x === 2 && y === 2 ? 1 : 0.78}
                />
              ))}
            </svg>
          </div>
          <span className="truncate text-sm font-bold tracking-tight text-mauve-900">
            {connectionName || "Cluster"}
          </span>
          <button
            type="button"
            onClick={copyClusterId}
            disabled={!metrics?.clusterId}
            title={
              metrics?.clusterId
                ? copiedId
                  ? "Copied cluster ID"
                  : `Copy cluster ID: ${metrics.clusterId}`
                : "Loading cluster ID"
            }
            className={`inline-flex h-6 max-w-48 cursor-pointer items-center gap-1.5 rounded-md border px-2 font-mono text-xs transition-colors disabled:cursor-default disabled:opacity-60 ${
              copiedId
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-zinc-200 bg-zinc-50 text-zinc-500 hover:border-zinc-300 hover:bg-zinc-100 hover:text-zinc-700"
            }`}
          >
            <span className="truncate">{metrics?.clusterId || "…"}</span>
            {metrics?.clusterId &&
              (copiedId ? (
                <Check size={11} className="shrink-0 text-emerald-600" />
              ) : (
                <Copy size={11} className="shrink-0 opacity-70" />
              ))}
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {healthy ? (
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
              <CircleCheck size={12} />
              healthy
            </span>
          ) : metrics ? (
            <span className="flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-600">
              <AlertTriangle size={12} />
              degraded
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => setLive((v) => !v)}
            title={
              live
                ? `Refreshing every ${POLL_MS / 1000}s while tab is open — click to pause`
                : `Auto-refresh paused — click to resume (${POLL_MS / 1000}s cadence)`
            }
            className={`group inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
              live
                ? "border-emerald-200/80 bg-emerald-50/70 text-emerald-700 hover:bg-emerald-100/70"
                : "border-zinc-200 bg-zinc-50 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700"
            }`}
          >
            {live ? (
              <>
                <span className="relative flex size-4 items-center justify-center">
                  <svg
                    viewBox="0 0 16 16"
                    className="size-4 -rotate-90"
                    aria-hidden="true"
                  >
                    <circle
                      cx="8"
                      cy="8"
                      r="6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="text-zinc-200"
                    />
                    {pollTick > 0 && (
                      <circle
                        key={pollTick}
                        cx="8"
                        cy="8"
                        r="6"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeDasharray={RING_CIRCUMFERENCE}
                        className="text-emerald-500"
                        style={{
                          animation: `cluster-ring ${POLL_MS}ms linear forwards`,
                        }}
                      />
                    )}
                  </svg>
                  <span className="absolute size-1.5 rounded-full bg-emerald-500 group-hover:hidden" />
                  <Pause
                    size={8}
                    className="absolute hidden text-emerald-700 group-hover:block"
                  />
                </span>
                <span>Live</span>
              </>
            ) : (
              <>
                <Play size={11} className="fill-current" />
                <span>Paused</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Metric Cells */}
      <div className="grid shrink-0 grid-cols-2 divide-x divide-zinc-100 border-b border-zinc-200 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((c) => (
          <div key={c.label} className={`p-4 ${c.bg}`}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold tracking-wider text-zinc-500 uppercase">
                {c.label}
              </span>
              <c.icon size={15} className={c.tone} />
            </div>
            <p className={`mt-1.5 text-2xl font-bold tracking-tight ${c.tone}`}>
              {c.value}
            </p>
          </div>
        ))}
      </div>

      {/* Partition trend */}
      <div className="shrink-0 border-b border-zinc-200 px-4 py-3">
        <span className="mb-2 block text-xs font-semibold tracking-wider text-zinc-500 uppercase">
          Partitions over time
        </span>
        <div className="flex h-14 items-end gap-0.5">
          {history.length === 0 ? (
            <div className="flex w-full items-center justify-center text-zinc-300">
              <Loader2 size={14} className="animate-spin" />
            </div>
          ) : (
            <>
              {Array.from({ length: MAX_SAMPLES - history.length }).map((_, i) => (
                <div
                  key={`empty-${i}`}
                  className="min-w-1 flex-1 rounded-t bg-zinc-100"
                  style={{ height: "14%" }}
                />
              ))}
              {(() => {
                const counts = history.map((s) => s.count);
                const max = Math.max(...counts);
                const min = Math.min(...counts);
                const span = max - min;
                return history.map((sample, i) => {
                  const h =
                    span === 0 ? 55 : 18 + ((sample.count - min) / span) * 78;
                  const isLatest = i === history.length - 1;
                  return (
                    <div
                      key={`${sample.at}-${i}`}
                      className={`min-w-1 flex-1 rounded-t transition-all ${
                        isLatest
                          ? "bg-mauve-600"
                          : "bg-mauve-400/65 hover:bg-mauve-500"
                      }`}
                      style={{ height: `${h}%` }}
                      title={`${sample.count.toLocaleString("en-US")} partitions · ${new Date(sample.at).toLocaleTimeString()}`}
                    />
                  );
                });
              })()}
            </>
          )}
        </div>
      </div>

      {/* Brokers */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-xs font-semibold tracking-wider text-zinc-500 uppercase">
          Brokers
        </div>
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
          <table className="w-full table-fixed text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-100 text-xs tracking-wider text-zinc-400 uppercase">
              <th className="w-16 px-4 py-2 font-semibold">ID</th>
              <th className="px-4 py-2 font-semibold">Address</th>
              <th className="w-28 px-4 py-2 font-semibold">Rack</th>
              <th className="w-28 px-4 py-2 font-semibold">Role</th>
            </tr>
          </thead>
          <tbody>
            {brokers.map((b) => (
              <React.Fragment key={b.id}>
                <tr
                  onClick={() => selectBroker(b.id)}
                  className="cursor-pointer border-b border-zinc-50 transition-colors last:border-0 hover:bg-mauve-50/50"
                >
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded px-1.5 py-0.5 font-mono text-xs font-semibold ${
                        b.isController
                          ? "bg-mauve-600 text-white"
                          : "bg-mauve-50 text-mauve-700"
                      }`}
                    >
                      {b.id}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-zinc-600">
                    {b.host}:{b.port}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-500">{b.rack || "—"}</td>
                  <td className="px-4 py-2.5">
                    {b.isController ? (
                      <span className="rounded-full bg-mauve-100 px-2 py-0.5 text-xs font-semibold text-mauve-700">
                        controller
                      </span>
                    ) : (
                      <span className="text-xs text-zinc-400">broker</span>
                    )}
                  </td>
                </tr>
                {selectedBroker === b.id && (
                  <tr className="border-b border-zinc-50 bg-[#fafafa]">
                    <td colSpan={4} className="px-4 py-3">
                      {loadingConfigs ? (
                        <div className="py-2 text-center">
                          <Loader2 size={14} className="mx-auto animate-spin text-zinc-400" />
                        </div>
                      ) : (
                        <div className="max-h-52 w-full overflow-x-hidden overflow-y-auto rounded-xl border border-zinc-200 bg-white">
                          <div className="flex items-center gap-1.5 border-b border-zinc-100 px-3 py-1.5 text-xs font-semibold tracking-wider text-zinc-400 uppercase">
                            <ChevronDown size={11} />
                            Broker {b.id} dynamic configuration
                          </div>
                          {brokerConfigs.length === 0 ? (
                            <p className="p-3 text-xs text-zinc-400">
                              No dynamic overrides — broker runs on defaults.
                            </p>
                          ) : (
                            brokerConfigs.map((c) => (
                              <div
                                key={c.key}
                                className="flex min-w-0 items-baseline justify-between gap-4 border-b border-zinc-50 px-3 py-1.5 last:border-0"
                              >
                                <div className="flex max-w-[55%] min-w-0 items-center gap-1.5">
                                  <span
                                    className="truncate font-mono text-xs text-zinc-600"
                                    title={c.key}
                                  >
                                    {c.key}
                                  </span>
                                  {!c.isDefault && (
                                    <span className="shrink-0 rounded bg-mauve-100 px-1.5 py-0.5 text-[10px] font-semibold text-mauve-700">
                                      override
                                    </span>
                                  )}
                                </div>
                                <span
                                  className={`min-w-0 flex-1 truncate text-right font-mono text-xs ${
                                    c.sensitive ? "text-zinc-400" : "text-zinc-800"
                                  }`}
                                  title={c.sensitive ? undefined : c.value || "—"}
                                >
                                  {c.sensitive ? "••••••" : c.value || "—"}
                                </span>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {!loading && brokers.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-xs text-zinc-400">
                  No brokers reachable
                </td>
              </tr>
            )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
