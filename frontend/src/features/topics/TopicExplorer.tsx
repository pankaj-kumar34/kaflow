import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  FolderTree,
  RefreshCw,
  Plus,
  Trash2,
  Layers,
  Play,
  CircleStop,
  Send,
  ChevronDown,
  ChevronRight,
  Loader2,
  Inbox,
  Zap,
  Edit2,
  Check,
  X,
  Copy,
  Download,
} from "lucide-react";
import { Events } from "@wailsio/runtime";
import type {
  FetchResult,
  MessageRecord,
  SchemaInfo,
  TopicInfo,
} from "../../../bindings/kaflow/backend/models/index.js";
import {
  MessageService,
  TailService,
  TopicService,
} from "../../../bindings/kaflow/backend/services/index.js";
import { Button } from "../../components/ui/button";
import { ConfirmModal } from "../../components/ui/ConfirmModal";
import { ValueDetailModal } from "../editors/ValueDetailModal";
import { useToast } from "../../components/ui/Toast";
import { getErrorMessage } from "../../lib/utils";

interface TopicExplorerProps {
  connId: string;
  readOnly: boolean;
  isActive: boolean;
}

const MESSAGES_PAGE = 200;

export const TopicExplorer: React.FC<TopicExplorerProps> = ({
  connId,
  readOnly,
  isActive,
}) => {
  const toast = useToast();
  const [topics, setTopics] = useState<TopicInfo[]>([]);
  const [search, setSearch] = useState("");
  const [loadingTopics, setLoadingTopics] = useState(false);
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [details, setDetails] = useState<TopicInfo | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [showConfigs, setShowConfigs] = useState(false);
  const [editingConfigKey, setEditingConfigKey] = useState<string | null>(null);
  const [editingConfigVal, setEditingConfigVal] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);

  // Message browser
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [msgFilter, setMsgFilter] = useState("");
  const [copiedMsgKey, setCopiedMsgKey] = useState<string | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [selectedPartition, setSelectedPartition] = useState<number>(-1);
  const [detailMessage, setDetailMessage] = useState<MessageRecord | null>(
    null,
  );
  const [detailSchema, setDetailSchema] = useState<SchemaInfo | null>(null);
  const [oldestFetched, setOldestFetched] = useState<number | null>(null);

  useEffect(() => {
    setDetailSchema(null);
    const sid = detailMessage?.schemaId;
    if (!sid) return;
    let active = true;
    MessageService.GetSchemaById(connId, sid)
      .then((s) => {
        if (active && s) setDetailSchema(s);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [connId, detailMessage]);

  // Live tail
  const [tailing, setTailing] = useState(false);
  const tailCancelRef = useRef<(() => void) | null>(null);

  // Produce
  const [produceOpen, setProduceOpen] = useState(false);
  const [produceKey, setProduceKey] = useState("");
  const [produceValue, setProduceValue] = useState("");
  const [producing, setProducing] = useState(false);

  // Create / delete / grow
  const [createOpen, setCreateOpen] = useState(false);
  const [newTopicName, setNewTopicName] = useState("");
  const [newTopicPartitions, setNewTopicPartitions] = useState("3");
  const [newTopicRF, setNewTopicRF] = useState("");
  const [deleteTopicName, setDeleteTopicName] = useState<string | null>(null);
  const [growOpen, setGrowOpen] = useState(false);
  const [growCount, setGrowCount] = useState("3");

  const loadTopics = useCallback(async () => {
    setLoadingTopics(true);
    try {
      const list = await TopicService.ListTopics(connId);
      setTopics(list || []);
    } catch (err) {
      toast.error("Failed to load topics", getErrorMessage(err));
    } finally {
      setLoadingTopics(false);
    }
  }, [connId, toast]);

  useEffect(() => {
    if (!isActive) return;
    // defer: setState inside async loaders must not run synchronously in the effect body
    const t = setTimeout(() => void loadTopics(), 0);
    return () => clearTimeout(t);
  }, [isActive, loadTopics]);

  const loadDetails = useCallback(
    async (topic: string) => {
      setLoadingDetails(true);
      setDetails(null);
      setMessages([]);
      setOldestFetched(null);
      setSelectedPartition(-1);
      setEditingConfigKey(null);
      setMsgFilter("");
      try {
        const d = await TopicService.GetTopicDetails(connId, topic);
        setDetails(d);
      } catch (err) {
        toast.error("Failed to describe topic", getErrorMessage(err));
      } finally {
        setLoadingDetails(false);
      }
    },
    [connId, toast],
  );

  const selectTopic = (topic: string) => {
    setSelectedTopic(topic);
    loadDetails(topic);
  };

  const fetchMessages = useCallback(
    async (topic: string, partition: number, before?: number, pageLimit = MESSAGES_PAGE) => {
      setLoadingMessages(true);
      try {
        const from = before ?? -1;
        const result: FetchResult | null =
          await MessageService.FetchMessages(
            connId,
            topic,
            partition,
            from,
            pageLimit,
          );
        setOldestFetched(before !== undefined ? from : (result?.startOffset ?? 0));
        const incoming = result?.messages ?? [];
        setMessages((prev) =>
          before === undefined ? incoming : [...incoming, ...prev],
        );
      } catch (err) {
        toast.error("Failed to fetch messages", getErrorMessage(err));
      } finally {
        setLoadingMessages(false);
      }
    },
    [connId, toast],
  );

  // Fetch messages when topic or partition selection changes
  useEffect(() => {
    if (!selectedTopic || !details) return;
    const t = setTimeout(
      () => void fetchMessages(selectedTopic, selectedPartition),
      0,
    );
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTopic, details, selectedPartition]);

  const stopTail = useCallback(() => {
    if (tailCancelRef.current) {
      tailCancelRef.current();
      tailCancelRef.current = null;
    }
    TailService.StopTail(connId).catch(() => {});
    setTailing(false);
  }, [connId]);

  const toggleTail = async () => {
    if (tailing || !selectedTopic) {
      stopTail();
      return;
    }
    let cancel: (() => void) | null = null;
    try {
      // Register listener before StartTail so early records aren't dropped.
      cancel = Events.On("kaflow:message", (eventData: unknown) => {
        const raw = eventData as { data?: MessageRecord } | MessageRecord | null;
        const payload =
          raw && typeof raw === "object" && "data" in raw
            ? raw.data
            : (raw as MessageRecord | null);
        if (!payload || payload.topic !== selectedTopic) return;
        if (selectedPartition >= 0 && payload.partition !== selectedPartition)
          return;
        setMessages((prev) => {
          const next = [payload, ...prev];
          return next.length > 1000 ? next.slice(0, 1000) : next;
        });
      });
      await TailService.StartTail(connId, selectedTopic, selectedPartition, true);
      tailCancelRef.current = cancel;
      setTailing(true);
    } catch (err) {
      if (cancel) cancel();
      toast.error("Failed to start tail", getErrorMessage(err));
    }
  };

  useEffect(() => {
    return () => {
      if (tailCancelRef.current) tailCancelRef.current();
      TailService.StopTail(connId).catch(() => {});
    };
  }, [connId]);

  const produce = async () => {
    if (!selectedTopic || !produceValue.trim()) return;
    setProducing(true);
    try {
      await MessageService.ProduceMessage(
        connId,
        selectedTopic,
        -1,
        produceKey,
        produceValue,
        [],
      );
      toast.success("Produced", `Record written to ${selectedTopic}`);
      setProduceOpen(false);
      setProduceKey("");
      setProduceValue("");
      if (!tailing) {
        fetchMessages(selectedTopic, selectedPartition);
      }
    } catch (err) {
      toast.error("Produce failed", getErrorMessage(err));
    } finally {
      setProducing(false);
    }
  };

  const createTopic = async () => {
    const name = newTopicName.trim();
    if (!name) return;
    try {
      const rf = newTopicRF.trim() === "" ? -1 : parseInt(newTopicRF, 10) || -1;
      await TopicService.CreateTopic(
        connId,
        name,
        parseInt(newTopicPartitions, 10) || 1,
        rf,
        {},
      );
      toast.success("Topic created", name);
      setCreateOpen(false);
      setNewTopicName("");
      loadTopics();
    } catch (err) {
      toast.error("Create failed", getErrorMessage(err));
    }
  };

  const deleteTopic = async () => {
    if (!deleteTopicName) return;
    try {
      await TopicService.DeleteTopic(connId, deleteTopicName);
      toast.success("Topic deleted", deleteTopicName);
      if (selectedTopic === deleteTopicName) {
        stopTail();
        setSelectedTopic(null);
        setDetails(null);
        setMessages([]);
      }
      loadTopics();
    } catch (err) {
      toast.error("Delete failed", getErrorMessage(err));
    } finally {
      setDeleteTopicName(null);
    }
  };

  const growPartitions = async () => {
    if (!selectedTopic) return;
    try {
      const current = details?.partitions ?? 1;
      const target = parseInt(growCount, 10) || current;
      const add = target - current;
      if (add <= 0) {
        toast.warning(
          "Cannot shrink",
          `Topic already has ${current} partitions`,
        );
        return;
      }
      await TopicService.IncreasePartitions(connId, selectedTopic, add);
      toast.success("Partitions added", `${selectedTopic} → ${target}`);
      setGrowOpen(false);
      loadDetails(selectedTopic);
    } catch (err) {
      toast.error("Failed to add partitions", getErrorMessage(err));
    }
  };

  const filtered = topics.filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase()),
  );

  const msgQuery = msgFilter.trim().toLowerCase();
  const visibleMessages = msgQuery
    ? messages.filter(
        (m) =>
          m.key?.toLowerCase().includes(msgQuery) ||
          m.value?.toLowerCase().includes(msgQuery) ||
          m.headers?.some(
            (h) =>
              h.key.toLowerCase().includes(msgQuery) ||
              h.value.toLowerCase().includes(msgQuery),
          ),
      )
    : messages;

  const saveTopicConfig = async () => {
    if (!selectedTopic || !editingConfigKey) return;
    setSavingConfig(true);
    try {
      await TopicService.UpdateTopicConfig(
        connId,
        selectedTopic,
        editingConfigKey,
        editingConfigVal,
      );
      toast.success("Config updated", `${editingConfigKey} = ${editingConfigVal}`);
      setEditingConfigKey(null);
      const d = await TopicService.GetTopicDetails(connId, selectedTopic);
      setDetails(d);
    } catch (err) {
      toast.error("Failed to update config", getErrorMessage(err));
    } finally {
      setSavingConfig(false);
    }
  };

  const exportMessages = () => {
    if (!selectedTopic || visibleMessages.length === 0) return;
    const blob = new Blob([JSON.stringify(visibleMessages, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selectedTopic}-messages-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyMessageValue = (key: string, value: string) => {
    navigator.clipboard?.writeText(value).catch(() => {});
    setCopiedMsgKey(key);
    setTimeout(() => setCopiedMsgKey((cur) => (cur === key ? null : cur)), 1500);
  };

  const fmtOffset = (n: number) => n.toLocaleString("en-US");
  const fmtTime = (ms: number) =>
    ms > 0 ? new Date(ms).toLocaleTimeString() : "—";

  return (
    <div className="flex size-full overflow-hidden">
      {/* Topic List Sidebar */}
      <div className="flex w-72 shrink-0 flex-col border-r border-zinc-200 bg-white">
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-bold text-zinc-700">
            <FolderTree size={14} className="text-mauve-600" />
            Topics
            <span className="rounded-full bg-mauve-100 px-1.5 py-0.5 text-[11px] font-semibold text-mauve-700">
              {topics.length}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => loadTopics()}
              className="flex size-7 cursor-pointer items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-mauve-100 hover:text-mauve-700"
              title="Refresh topics"
            >
              <RefreshCw
                size={13}
                className={loadingTopics ? "animate-spin" : ""}
              />
            </button>
            {!readOnly && (
              <button
                onClick={() => setCreateOpen(true)}
                className="flex size-7 cursor-pointer items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-mauve-100 hover:text-mauve-700"
                title="Create topic"
              >
                <Plus size={14} />
              </button>
            )}
          </div>
        </div>
        <div className="border-b border-zinc-200 px-3 py-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter topics…"
            className="h-7 w-full rounded-lg border border-zinc-200 bg-[#fafafa] px-2.5 text-sm text-zinc-700 outline-none placeholder:text-zinc-400 focus:border-mauve-400 focus:bg-white"
          />
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {filtered.map((t) => (
            <button
              key={t.name}
              onClick={() => selectTopic(t.name)}
              className={`group flex w-full cursor-pointer items-center justify-between rounded-lg px-2.5 py-2 text-left transition-colors ${
                selectedTopic === t.name
                  ? "bg-mauve-100 text-mauve-900"
                  : "text-zinc-600 hover:bg-mauve-50"
              }`}
            >
              <span className="truncate text-sm font-medium">{t.name}</span>
            </button>
          ))}
          {!loadingTopics && filtered.length === 0 && (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <Inbox size={20} className="text-zinc-300" />
              <p className="text-xs text-zinc-400">No topics found</p>
            </div>
          )}
        </div>
      </div>

      {/* Topic Detail */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-white">
        {!selectedTopic ? (
          <div className="flex h-full flex-1 flex-col items-center justify-center gap-2.5 p-6 text-zinc-400 select-none">
<FolderTree size={24} className="text-zinc-400" />
            <p className="text-sm font-semibold text-zinc-700">
              Select a topic to inspect partitions and browse messages.
            </p>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            {/* Header */}
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
              <div className="min-w-0">
                <h3 className="truncate text-base font-bold tracking-tight text-mauve-900">
                  {selectedTopic}
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={toggleTail}
                  disabled={loadingDetails}
                >
                  {tailing ? (
                    <CircleStop size={13} className="text-red-500" />
                  ) : (
                    <Play size={13} className="text-mauve-600" />
                  )}
                  {tailing ? "Stop tail" : "Live tail"}
                </Button>
                {!readOnly && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setGrowCount(String((details?.partitions ?? 1) * 2));
                        setGrowOpen(true);
                      }}
                    >
                      <Layers size={13} className="text-mauve-600" />
                      Add partitions
                    </Button>
                    <Button variant="default" size="sm" onClick={() => setProduceOpen(true)}>
                      <Send size={13} />
                      Produce
                    </Button>
                    <button
                      onClick={() => setDeleteTopicName(selectedTopic)}
                      className="flex size-8 cursor-pointer items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-400 shadow-2xs transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                      title="Delete topic"
                    >
                      <Trash2 size={13} />
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Partitions Table */}
            <div className="shrink-0 border-b border-zinc-200">
              
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 text-[11px] tracking-wider text-zinc-400 uppercase">
                    <th className="px-4 py-2 font-semibold">Partition</th>
                    <th className="px-4 py-2 font-semibold">Leader</th>
                    <th className="px-4 py-2 font-semibold">Replicas</th>
                    <th className="px-4 py-2 font-semibold">ISR</th>
                    <th className="px-4 py-2 text-right font-semibold">Start</th>
                    <th className="px-4 py-2 text-right font-semibold">End (HW)</th>
                    <th className="px-4 py-2 text-right font-semibold">Messages</th>
                  </tr>
                </thead>
                <tbody>
                  {(details?.partitionDetails ?? []).map((p) => (
                    <tr
                      key={p.id}
                      className="border-b border-zinc-50 text-zinc-600 last:border-0 hover:bg-mauve-50/50"
                    >
                      <td className="px-4 py-2 font-semibold text-zinc-700">
                        {p.id}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                            p.leader < 0
                              ? "bg-red-100 text-red-700"
                              : "bg-mauve-50 text-mauve-700"
                          }`}
                        >
                          {p.leader}
                        </span>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">
                        [{p.replicas.join(",")}]
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">
                        <span
                          className={
                            p.isr.length < p.replicas.length
                              ? "font-semibold text-amber-600"
                              : ""
                          }
                        >
                          [{p.isr.join(",")}]
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs">
                        {fmtOffset(p.logStartOffset)}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs">
                        {fmtOffset(p.logEndOffset)}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs font-semibold text-mauve-700">
                        {fmtOffset(p.logEndOffset - p.logStartOffset)}
                      </td>
                    </tr>
                  ))}
                  {loadingDetails && (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-zinc-400">
                        <Loader2 size={14} className="mx-auto animate-spin" />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Configs */}
            <div className="shrink-0 border-b border-zinc-200">
              <button
                onClick={() => setShowConfigs((v) => !v)}
                className="flex w-full cursor-pointer items-center justify-between px-4 py-2.5 text-left"
              >
                <span className="flex items-center gap-2 text-sm font-bold text-zinc-700">
                  <ChevronDown
                    size={13}
                    className={`text-zinc-400 transition-transform ${showConfigs ? "" : "-rotate-90"}`}
                  />
                  Topic configuration
                </span>
                <span className="text-[11px] text-zinc-400">
                  {details?.configs ? `${Object.keys(details.configs).length} entries` : ""}
                </span>
              </button>
              {showConfigs && details?.configs && (
                <div className="max-h-64 overflow-y-auto border-t border-zinc-100 px-4 py-3">
                  {Object.entries(details.configs)
                    .filter(([k]) => k.length > 0)
                    .map(([k, v]) => (
                      <div
                        key={k}
                        className="group flex items-center justify-between gap-4 border-b border-zinc-50 py-1.5 last:border-0"
                      >
                        <span className="shrink-0 font-mono text-xs text-zinc-500">
                          {k}
                        </span>
                        {editingConfigKey === k ? (
                          <div className="flex items-center gap-1">
                            <input
                              value={editingConfigVal}
                              onChange={(e) => setEditingConfigVal(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") void saveTopicConfig();
                                if (e.key === "Escape") setEditingConfigKey(null);
                              }}
                              autoFocus
                              disabled={savingConfig}
                              className="h-6 w-44 rounded border border-mauve-300 bg-white px-2 font-mono text-xs text-zinc-800 outline-none focus:border-mauve-500"
                            />
                            <button
                              onClick={() => void saveTopicConfig()}
                              disabled={savingConfig}
                              className="flex size-6 cursor-pointer items-center justify-center rounded text-emerald-600 hover:bg-emerald-50"
                              title="Save"
                            >
                              {savingConfig ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                <Check size={12} />
                              )}
                            </button>
                            <button
                              onClick={() => setEditingConfigKey(null)}
                              disabled={savingConfig}
                              className="flex size-6 cursor-pointer items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
                              title="Cancel"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ) : (
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate text-right font-mono text-xs text-zinc-800">
                              {v || "—"}
                            </span>
                            {!readOnly && (
                              <button
                                onClick={() => {
                                  setEditingConfigKey(k);
                                  setEditingConfigVal(v ?? "");
                                }}
                                className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-zinc-300 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-mauve-50 hover:text-mauve-600"
                                title={`Edit ${k}`}
                              >
                                <Edit2 size={11} />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                </div>
              )}
            </div>

            {/* Message Browser */}
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-4 py-2">
                <div className="flex items-center gap-2 text-sm font-bold text-zinc-700">
                  <Zap size={13} className="text-mauve-600" />
                  Messages
                  {messages.length > 0 && (
                    <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-500">
                      {msgQuery
                        ? `${visibleMessages.length}/${messages.length}`
                        : messages.length}
                    </span>
                  )}
                  {tailing && (
                    <span className="flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-600">
                      <span className="size-1.5 animate-pulse rounded-full bg-red-500" />
                      live
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    value={msgFilter}
                    onChange={(e) => setMsgFilter(e.target.value)}
                    placeholder="Filter key, value, header…"
                    className="h-7 w-48 rounded-lg border border-zinc-200 bg-[#fafafa] px-2.5 text-xs text-zinc-700 outline-none placeholder:text-zinc-400 focus:border-mauve-400 focus:bg-white"
                  />
                  <select
                    value={selectedPartition}
                    onChange={(e) => setSelectedPartition(Number(e.target.value))}
                    className="h-7 cursor-pointer rounded-lg border border-zinc-200 bg-white px-2 text-xs text-zinc-700 outline-none focus:border-mauve-400"
                    disabled={tailing}
                  >
                    <option value={-1}>All partitions</option>
                    {(details?.partitionDetails ?? []).map((p) => (
                      <option key={p.id} value={p.id}>
                        Partition {p.id}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={(() => {
                      if (loadingMessages || tailing || oldestFetched === null) return true;
                      const parts = details?.partitionDetails ?? [];
                      if (selectedPartition < 0 && parts.length > 1) return true;
                      const targetPart =
                        selectedPartition >= 0
                          ? parts.find((p) => p.id === selectedPartition)
                          : parts[0];
                      return oldestFetched <= (targetPart?.logStartOffset ?? 0);
                    })()}
                    title={
                      selectedPartition < 0 && (details?.partitionDetails.length ?? 0) > 1
                        ? "Select a partition to load older messages"
                        : "Load older messages"
                    }
                    onClick={() => {
                      if (!selectedTopic || oldestFetched === null || oldestFetched <= 0) return;
                      const from = Math.max(0, oldestFetched - MESSAGES_PAGE);
                      const count = Math.min(MESSAGES_PAGE, oldestFetched);
                      fetchMessages(selectedTopic, selectedPartition, from, count);
                    }}
                  >
                    {loadingMessages ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <ChevronRight size={12} className="rotate-180" />
                    )}
                    Older
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={exportMessages}
                    disabled={visibleMessages.length === 0}
                    title="Export visible messages as JSON"
                  >
                    <Download size={12} />
                    Export
                  </Button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {visibleMessages.length === 0 ? (
                  <div className="flex size-full flex-col items-center justify-center gap-2 px-4 text-center">
                    {loadingMessages && messages.length === 0 ? (
                      <>
                        <Loader2 size={20} className="animate-spin text-mauve-500" />
                        <p className="text-xs text-zinc-400">Loading messages…</p>
                      </>
                    ) : (
                      <>
                        <Inbox size={22} className="text-zinc-300" />
                        <p className="text-xs text-zinc-400">
                          {messages.length > 0
                            ? "No messages match your filter"
                            : tailing
                              ? "Waiting for records…"
                              : "No messages loaded for this range"}
                        </p>
                      </>
                    )}
                  </div>
                ) : (
                  visibleMessages.map((m, i) => {
                    const rowKey = `${m.partition}-${m.offset}-${i}`;
                    return (
                      <div
                        key={rowKey}
                        onClick={() => setDetailMessage(m)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setDetailMessage(m);
                          }
                        }}
                        className="group flex w-full cursor-pointer items-center gap-3 border-b border-zinc-50 px-4 py-2 text-left transition-colors last:border-0 hover:bg-mauve-50/50"
                      >
                        <span className="w-14 shrink-0 font-mono text-[11px] text-zinc-400">
                          p{m.partition}
                        </span>
                        <span className="w-20 shrink-0 font-mono text-[11px] text-zinc-400">
                          #{m.offset}
                        </span>
                        <span className="w-16 shrink-0 font-mono text-[11px] text-zinc-400">
                          {fmtTime(m.timestamp)}
                        </span>
                        <span className="w-32 shrink-0 truncate font-mono text-xs font-semibold text-mauve-700">
                          {m.key || "∅"}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-600">
                          {m.value}
                        </span>
                        {m.schemaId ? (
                          <span className="shrink-0 rounded bg-mauve-100 px-1.5 py-0.5 font-mono text-[10px] font-medium text-mauve-700">
                            #{m.schemaId}
                          </span>
                        ) : null}
                        {m.binary && (
                          <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] font-medium text-zinc-500">
                            BIN
                          </span>
                        )}
                        {m.truncated && (
                          <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-amber-700">
                            Truncated
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            copyMessageValue(rowKey, m.value ?? "");
                          }}
                          className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-zinc-300 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-mauve-100 hover:text-mauve-700"
                          title="Copy value"
                        >
                          {copiedMsgKey === rowKey ? (
                            <Check size={12} className="text-emerald-500" />
                          ) : (
                            <Copy size={12} />
                          )}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Message Detail Modal */}
      <ValueDetailModal
        isOpen={detailMessage !== null}
        onClose={() => setDetailMessage(null)}
        title={`Record · p${detailMessage?.partition} #${detailMessage?.offset}`}
        subtitle={[
          `Key: ${detailMessage?.key || "∅"}`,
          new Date(detailMessage?.timestamp ?? 0).toLocaleString(),
          detailMessage?.schemaId
            ? `Schema #${detailMessage.schemaId}${detailSchema ? ` (${detailSchema.schemaType})` : ""}`
            : null,
          detailMessage?.truncated && detailMessage?.size
            ? `Truncated (${Math.round(detailMessage.size / 1024)} KB total)`
            : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        value={detailMessage?.value ?? ""}
        readOnly
      />

      {/* Produce Modal */}
      {produceOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl">
            <h3 className="text-sm font-bold text-mauve-900">
              Produce to {selectedTopic}
            </h3>
            <p className="mt-0.5 text-xs text-zinc-400">
              Kafka picks the partition when the key is empty.
            </p>
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-semibold text-zinc-600">Key</label>
                <input
                  value={produceKey}
                  onChange={(e) => setProduceKey(e.target.value)}
                  placeholder="optional record key"
                  className="mt-1 h-8 w-full rounded-lg border border-zinc-200 px-2.5 font-mono text-sm outline-none focus:border-mauve-400"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-zinc-600">Value</label>
                <textarea
                  value={produceValue}
                  onChange={(e) => setProduceValue(e.target.value)}
                  placeholder="record payload (JSON or text)"
                  rows={8}
                  className="mt-1 w-full resize-none rounded-lg border border-zinc-200 p-2.5 font-mono text-sm outline-none focus:border-mauve-400"
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setProduceOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={produce}
                disabled={producing || !produceValue.trim()}
              >
                {producing ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                Produce
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Create Topic Modal */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl">
            <h3 className="text-sm font-bold text-mauve-900">Create topic</h3>
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-semibold text-zinc-600">Name</label>
                <input
                  value={newTopicName}
                  onChange={(e) => setNewTopicName(e.target.value)}
                  placeholder="my-topic"
                  autoFocus
                  className="mt-1 h-8 w-full rounded-lg border border-zinc-200 px-2.5 font-mono text-sm outline-none focus:border-mauve-400"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-zinc-600">Partitions</label>
                  <input
                    value={newTopicPartitions}
                    onChange={(e) => setNewTopicPartitions(e.target.value)}
                    className="mt-1 h-8 w-full rounded-lg border border-zinc-200 px-2.5 font-mono text-sm outline-none focus:border-mauve-400"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-zinc-600">Replication factor</label>
                  <input
                    value={newTopicRF}
                    onChange={(e) => setNewTopicRF(e.target.value)}
                    placeholder="broker default"
                    className="mt-1 h-8 w-full rounded-lg border border-zinc-200 px-2.5 font-mono text-sm outline-none focus:border-mauve-400"
                  />
                </div>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={createTopic}
                disabled={!newTopicName.trim()}
              >
                <Plus size={13} />
                Create
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Grow Partitions Modal */}
      {growOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl">
            <h3 className="text-sm font-bold text-mauve-900">Add partitions</h3>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">
              Growing <span className="font-semibold">{selectedTopic}</span> from{" "}
              {details?.partitions} to the target count. Kafka cannot shrink partitions.
            </p>
            <label className="mt-3 block text-xs font-semibold text-zinc-600">Total partitions</label>
            <input
              value={growCount}
              onChange={(e) => setGrowCount(e.target.value)}
              className="mt-1 h-8 w-full rounded-lg border border-zinc-200 px-2.5 font-mono text-sm outline-none focus:border-mauve-400"
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setGrowOpen(false)}>
                Cancel
              </Button>
              <Button variant="default" size="sm" onClick={growPartitions}>
                <Layers size={13} />
                Apply
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Topic Confirm */}
      <ConfirmModal
        isOpen={deleteTopicName !== null}
        title="Delete topic"
        description={`This permanently deletes "${deleteTopicName}" and all of its records on every partition. This cannot be undone.`}
        confirmText="Delete topic"
        variant="danger"
        onConfirm={deleteTopic}
        onCancel={() => setDeleteTopicName(null)}
      />
    </div>
  );
};
