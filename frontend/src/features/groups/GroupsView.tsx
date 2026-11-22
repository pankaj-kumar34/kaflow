import React, { useState, useEffect, useCallback } from "react";
import {
  RefreshCw,
  Loader2,
  Inbox,
  Rewind,
  AlertTriangle,
  ChevronRight,
} from "lucide-react";
import type {
  GroupInfo,
  GroupLagResult,
} from "../../../bindings/kaflow/backend/models/index.js";
import {
  GroupService,
} from "../../../bindings/kaflow/backend/services/index.js";
import { Button } from "../../components/ui/button";
import { ConfirmModal } from "../../components/ui/ConfirmModal";
import { useToast } from "../../components/ui/Toast";
import { getErrorMessage } from "../../lib/utils";

interface GroupsViewProps {
  connId: string;
  readOnly: boolean;
  isActive: boolean;
}

export const GroupsView: React.FC<GroupsViewProps> = ({
  connId,
  readOnly,
  isActive,
}) => {
  const toast = useToast();
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [lag, setLag] = useState<GroupLagResult | null>(null);
  const [loadingLag, setLoadingLag] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<"earliest" | "latest">(
    "earliest",
  );

  const loadGroups = useCallback(async () => {
    setLoading(true);
    try {
      const list = await GroupService.ListGroups(connId);
      setGroups(list || []);
    } catch (err) {
      toast.error("Failed to load consumer groups", getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [connId, toast]);

  useEffect(() => {
    if (!isActive) return;
    const t = setTimeout(() => void loadGroups(), 0);
    return () => clearTimeout(t);
  }, [isActive, loadGroups]);

  const selectGroup = async (group: string) => {
    setSelectedGroup(group);
    setLag(null);
    setLoadingLag(true);
    try {
      const result = await GroupService.GetGroupLag(connId, group);
      setLag(result);
    } catch (err) {
      toast.error("Failed to compute lag", getErrorMessage(err));
    } finally {
      setLoadingLag(false);
    }
  };

  const resetOffsets = async () => {
    if (!selectedGroup) return;
    try {
      await GroupService.ResetGroupOffsets(
        connId,
        selectedGroup,
        resetTarget,
        0,
      );
      toast.success(
        "Offsets reset",
        `${selectedGroup} → ${resetTarget} (restart members to re-read)`,
      );
      selectGroup(selectedGroup);
    } catch (err) {
      toast.error("Reset failed", getErrorMessage(err));
    } finally {
      setResetOpen(false);
    }
  };

  const fmt = (n: number) => n.toLocaleString("en-US");
  const stateTone = (state: string) =>
    state === "Stable"
      ? "bg-emerald-50 text-emerald-700"
      : state === "Empty"
        ? "bg-zinc-100 text-zinc-500"
        : state === "Dead"
          ? "bg-red-50 text-red-600"
          : "bg-amber-50 text-amber-700";

  return (
    <div className="size-full overflow-y-auto bg-white select-none">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3">
          <span className="text-xs text-zinc-400">
            {groups.length} group{groups.length === 1 ? "" : "s"} · click a
            group for per-partition lag
          </span>
          <Button variant="outline" size="icon" onClick={loadGroups} disabled={loading} title="Refresh">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </Button>
        </div>

        {/* Groups Table */}
        <div className="border-b border-zinc-200">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-100 text-[10px] tracking-wider text-zinc-400 uppercase">
                <th className="px-4 py-2.5 font-semibold">Group</th>
                <th className="px-4 py-2.5 font-semibold">State</th>
                <th className="px-4 py-2.5 font-semibold">Members</th>
                <th className="px-4 py-2.5 font-semibold">Topics</th>
                <th className="px-4 py-2.5 text-right font-semibold">Total lag</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr
                  key={g.group}
                  onClick={() => selectGroup(g.group)}
                  className={`cursor-pointer border-b border-zinc-50 transition-colors last:border-0 hover:bg-mauve-50/50 ${
                    selectedGroup === g.group ? "bg-mauve-50" : ""
                  }`}
                >
                  <td className="px-4 py-2.5 font-mono font-semibold text-mauve-800">
                    {g.group}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${stateTone(g.state)}`}>
                      {g.state || "?"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-zinc-600">{g.members?.length ?? 0}</td>
                  <td className="max-w-56 truncate px-4 py-2.5 font-mono text-[11px] text-zinc-500">
                    {g.topics?.join(", ") || "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <span
                      className={`font-mono font-semibold ${
                        g.totalLag > 10000
                          ? "text-red-600"
                          : g.totalLag > 0
                            ? "text-amber-600"
                            : "text-emerald-600"
                      }`}
                    >
                      {fmt(g.totalLag)}
                    </span>
                  </td>
                </tr>
              ))}
              {!loading && groups.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-24 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <Inbox size={22} className="text-zinc-300" />
                      <p className="text-[11px] text-zinc-400">
                        No consumer groups in this cluster
                      </p>
                    </div>
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan={5} className="px-4 py-24 text-center text-zinc-400">
                    <Loader2 size={16} className="mx-auto animate-spin" />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Lag Breakdown */}
        {selectedGroup && (
          <div className="border-b border-zinc-200">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-4 py-2.5">
              <span className="flex items-center gap-2 text-xs font-bold text-zinc-700">
                <ChevronRight size={13} className="text-mauve-600" />
                Lag breakdown ·{" "}
                <span className="font-mono text-mauve-800">{selectedGroup}</span>
                {lag && (
                  <span className="rounded-full bg-mauve-100 px-2 py-0.5 text-[10px] font-semibold text-mauve-700">
                    total {fmt(lag.totalLag)}
                  </span>
                )}
              </span>
              {!readOnly && (
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setResetTarget("earliest");
                      setResetOpen(true);
                    }}
                  >
                    <Rewind size={12} className="text-mauve-600" />
                    Reset → earliest
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setResetTarget("latest");
                      setResetOpen(true);
                    }}
                  >
                    <Rewind size={12} className="text-mauve-600" />
                    Reset → latest
                  </Button>
                </div>
              )}
            </div>
            {loadingLag ? (
              <div className="px-4 py-10 text-center">
                <Loader2 size={16} className="mx-auto animate-spin text-zinc-400" />
              </div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-zinc-100 text-[10px] tracking-wider text-zinc-400 uppercase">
                    <th className="px-4 py-2 font-semibold">Topic</th>
                    <th className="px-4 py-2 font-semibold">Partition</th>
                    <th className="px-4 py-2 text-right font-semibold">Committed</th>
                    <th className="px-4 py-2 text-right font-semibold">End (HW)</th>
                    <th className="px-4 py-2 text-right font-semibold">Lag</th>
                    <th className="px-4 py-2 font-semibold">Member</th>
                  </tr>
                </thead>
                <tbody>
                  {(lag?.partitions ?? []).map((p, i) => (
                    <tr
                      key={`${p.topic}-${p.partition}-${i}`}
                      className="border-b border-zinc-50 last:border-0 hover:bg-mauve-50/50"
                    >
                      <td className="px-4 py-2 font-mono text-[11px] text-zinc-600">{p.topic}</td>
                      <td className="px-4 py-2 font-semibold text-zinc-700">{p.partition}</td>
                      <td className="px-4 py-2 text-right font-mono text-[11px] text-zinc-500">
                        {fmt(p.committed)}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-[11px] text-zinc-500">
                        {fmt(p.logEndOffset)}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <span
                          className={`font-mono font-semibold ${
                            p.lag > 10000
                              ? "text-red-600"
                              : p.lag > 0
                                ? "text-amber-600"
                                : "text-emerald-600"
                          }`}
                        >
                          {fmt(p.lag)}
                        </span>
                      </td>
                      <td className="px-4 py-2 font-mono text-[10px] text-zinc-400">
                        {p.memberId || "—"}
                      </td>
                    </tr>
                  ))}
                  {lag && (lag.partitions?.length ?? 0) === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-[11px] text-zinc-400">
                        No committed offsets for this group
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Hint */}
        <div className="flex items-start gap-2 border-t border-zinc-200 px-5 py-2.5">
          <AlertTriangle size={13} className="mt-0.5 shrink-0 text-mauve-500" />
          <p className="text-[11px] leading-relaxed text-zinc-500">
            Offset resets only apply to groups without active members. Stop your
            consumers first, then reset and restart them.
          </p>
        </div>

      <ConfirmModal
        isOpen={resetOpen}
        title="Reset consumer group offsets"
        description={`Reset "${selectedGroup}" to the ${resetTarget} offsets for all assigned topic-partitions. The group must have no active members. Existing committed offsets are overwritten.`}
        confirmText="Reset offsets"
        variant="warning"
        onConfirm={resetOffsets}
        onCancel={() => setResetOpen(false)}
      />
    </div>
  );
};
