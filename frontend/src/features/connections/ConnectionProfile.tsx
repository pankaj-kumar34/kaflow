import React, { useState, useEffect } from "react";
import {
  ArrowLeft,
  Server,
  Shield,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  Terminal,
  Lock,
  Sliders,
  Sparkles,
  Check,
  Trash2,
  ChevronDown,
} from "lucide-react";
import type { ConnectionConfig } from "../../../bindings/kaflow/backend/models/index.js";
import { ConnectionService } from "../../../bindings/kaflow/backend/services/index.js";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import { useToast } from "../../components/ui/Toast";
import { getErrorMessage } from "../../lib/utils";

interface ConnectionProfileProps {
  initialConfig?: ConnectionConfig | null;
  onBack: () => void;
  onSaved: (savedConfig: ConnectionConfig, andConnect?: boolean) => void;
  onDelete?: (id: string, name?: string) => void;
}

const createDefaultForm = (): ConnectionConfig => ({
  id: "",
  name: "New Cluster",
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
  schemaRegistryUrl: "",
  color: "#3b82f6",
  group: "Development",
});

export const ConnectionProfile: React.FC<ConnectionProfileProps> = ({
  initialConfig,
  onBack,
  onSaved,
  onDelete,
}) => {
  const { error: toastError } = useToast();
  const [activeTab, setActiveTab] = useState<
    "general" | "ssh" | "tls" | "advanced"
  >("general");
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    isHttpTlsError?: boolean;
  } | null>(null);

  const [prevInitialConfig, setPrevInitialConfig] = useState(initialConfig);
  const [form, setForm] = useState<ConnectionConfig>(
    () => initialConfig ?? createDefaultForm(),
  );

  if (initialConfig !== prevInitialConfig) {
    setPrevInitialConfig(initialConfig);
    setForm(initialConfig ?? createDefaultForm());
    setTestResult(null);
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onBack();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onBack]);

  // Draft text for the bootstrap-servers textarea; null = show normalized form value
  const [brokersDraft, setBrokersDraft] = useState<string | null>(null);
  const handleSeedBrokersChange = (raw: string) => {
    setBrokersDraft(raw);
    const brokers = raw
      .split(/[\n,]/)
      .map((b) => b.trim())
      .filter(Boolean);
    setForm((prev) => ({ ...prev, seedBrokers: brokers }));
  };

  const seedBrokersText = form.seedBrokers.join("\n");

  const handleTestWithConfig = async (cfg: ConnectionConfig) => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await ConnectionService.TestConnection(cfg);
      setTestResult({
        success: true,
        message: res || "Connection verified successfully!",
      });
    } catch (err: unknown) {
      const errStr = getErrorMessage(err);
      const isHttpTls =
        !cfg.tls.enabled &&
        (errStr.includes("is TLS missing") ||
          errStr.includes("requires TLS") ||
          errStr.includes("closed the connection immediately") ||
          errStr.includes("EOF") ||
          errStr.includes("connection reset by peer") ||
          errStr.includes("broken pipe") ||
          errStr.includes("HTTP/1.1 400 Bad Request") ||
          errStr.includes("unable to decode") ||
          errStr.includes("connection timed out") ||
          errStr.includes("deadline exceeded") ||
          errStr.includes("i/o timeout") ||
          errStr.includes("Broker could not be reached"));

      setTestResult({
        success: false,
        message: errStr,
        isHttpTlsError: isHttpTls,
      });
    } finally {
      setTesting(false);
    }
  };

  const handleTest = () => {
    handleTestWithConfig(form);
  };

  const handleEnableTlsAndRetest = () => {
    const updated: ConnectionConfig = {
      ...form,
      tls: {
        ...form.tls,
        enabled: true,
        insecureSkipVerify: true,
      },
    };
    setForm(updated);
    handleTestWithConfig(updated);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const cfgToSave = { ...form, ephemeral: false };
      await ConnectionService.SaveConnection(cfgToSave);
      const list = await ConnectionService.GetConnections();
      const saved =
        (list || []).find(
          (c) =>
            c.name === cfgToSave.name &&
            c.seedBrokers.join(",") === cfgToSave.seedBrokers.join(","),
        ) || cfgToSave;
      onSaved(saved);
    } catch (err: unknown) {
      toastError(
        "Save Failed",
        "Failed to save connection: " + getErrorMessage(err),
      );
    } finally {
      setSaving(false);
    }
  };

  const getEnvBadge = (group: string) => {
    const rawGroup = (group || "Development").trim();
    const g = rawGroup.toLowerCase();
    if (g.includes("prod")) {
      return {
        label: g === "prod" ? "Production" : rawGroup,
        bg: "bg-red-50 text-red-700 border-red-200",
        color: "#dc2626",
      };
    }
    if (g.includes("stag") || g.includes("uat")) {
      return {
        label: g === "stag" || g === "stg" ? "Staging" : rawGroup,
        bg: "bg-amber-50 text-amber-700 border-amber-200",
        color: "#f59e0b",
      };
    }
    if (g.includes("local")) {
      return {
        label: g === "local" ? "Local" : rawGroup,
        bg: "bg-emerald-50 text-emerald-700 border-emerald-200",
        color: "#10b981",
      };
    }
    if (g.includes("dev")) {
      return {
        label: g === "dev" ? "Development" : rawGroup,
        bg: "bg-blue-50 text-blue-700 border-blue-200",
        color: "#3b82f6",
      };
    }
    return {
      label: rawGroup,
      bg: "bg-blue-50 text-blue-700 border-blue-200",
      color: "#3b82f6",
    };
  };

  const envBadge = getEnvBadge(form.group);

  return (
    <div className="flex size-full flex-col overflow-hidden bg-[#fafafa] font-sans text-mauve-900 select-none">
      {/* 1. Single Unified Top Header Action Bar */}
      <div className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-zinc-200 bg-white px-6 shadow-2xs">
        <div className="flex min-w-0 items-center gap-3.5">
          <button
            onClick={onBack}
            className="flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-mauve-100 hover:text-mauve-900"
            title="Back / Cancel (Esc)"
          >
            <ArrowLeft size={14} />
            <span>Back</span>
          </button>

          <div className="h-5 w-px shrink-0 bg-mauve-200" />

          {/* Connection Identity */}
          <div className="flex min-w-0 items-center gap-2.5">
            <h2 className="truncate text-sm font-bold text-mauve-900 sm:text-base">
              {initialConfig
                ? form.name || "Untitled Connection"
                : "New Connection"}
            </h2>
            <span
              className={`shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase ${envBadge.bg}`}
            >
              {envBadge.label}
            </span>
            {form.readOnly && (
              <Badge
                variant="destructive"
                className="shrink-0 gap-1 px-2 py-0.5 text-[10px]"
              >
                <Shield size={10} /> Read-Only
              </Badge>
            )}
          </div>
        </div>

        {/* Action Controls (Uncluttered, No Duplicates) */}
        <div className="flex shrink-0 items-center gap-2.5">
          {initialConfig && onDelete && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onDelete(initialConfig.id, form.name)}
              className="h-8.5 cursor-pointer gap-1.5 border-mauve-200 bg-mauve-50/50 px-3 text-xs font-semibold text-mauve-700 transition-colors hover:bg-mauve-100"
              title="Delete Connection"
            >
              <Trash2 size={13} />
              <span>Delete</span>
            </Button>
          )}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleTest}
            disabled={testing || form.seedBrokers.length === 0}
            className="h-8.5 cursor-pointer gap-1.5 border-zinc-200 bg-white px-3.5 text-xs font-semibold text-zinc-700 hover:bg-mauve-50"
          >
            {testing ? (
              <RefreshCw size={13} className="animate-spin text-mauve-600" />
            ) : (
              <Shield size={13} />
            )}
            <span>{testing ? "Testing..." : "Test Connection"}</span>
          </Button>

          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={handleSave}
            disabled={saving || !form.name.trim()}
            className="h-8.5 cursor-pointer rounded-lg bg-mauve-600 px-4 text-xs font-semibold text-white shadow-xs transition-all hover:bg-mauve-500 active:bg-mauve-700"
          >
            {saving ? "Saving..." : "Save Connection"}
          </Button>
        </div>
      </div>

      {/* 2. Subheader Tabs */}
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-zinc-200 bg-mauve-50/80 px-6">
        <div className="flex items-center gap-1">
          {(
            [
              { id: "general", label: "General", icon: <Server size={14} /> },
              {
                id: "ssh",
                label: "SSH Bastion",
                icon: <Terminal size={14} />,
                badge: form.ssh.enabled ? "ON" : null,
              },
              {
                id: "tls",
                label: "TLS / SSL",
                icon: <Lock size={14} />,
                badge: form.tls.enabled ? "ON" : null,
              },
              {
                id: "advanced",
                label: "Advanced & Safety",
                icon: <Sliders size={14} />,
                badge: form.readOnly ? "Read-Only" : null,
              },
            ] satisfies Array<{
              id: "general" | "ssh" | "tls" | "advanced";
              label: string;
              icon: React.ReactNode;
              badge?: string | null;
            }>
          ).map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex cursor-pointer items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-medium transition-all ${
                  isActive
                    ? "border border-zinc-200 bg-white font-semibold text-mauve-900 shadow-2xs"
                    : "text-zinc-500 hover:bg-white/50 hover:text-mauve-800"
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
                {tab.badge && (
                  <span
                    className={`rounded px-1.5 py-px text-[9px] font-bold tracking-wider uppercase ${
                      tab.id === "tls"
                        ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                        : tab.id === "ssh"
                          ? "border border-amber-200 bg-amber-50 text-amber-700"
                          : "border border-red-200 bg-red-50 text-red-700"
                    }`}
                  >
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Main Form Canvas (Scrollable) */}
      <div className="flex-1 overflow-y-auto bg-[#fafafa] p-6 select-text sm:p-10">
        <div className="mx-auto max-w-4xl space-y-6 pb-12">
          {/* Test Status Feedback Banner (Inline, highly visible) */}
          {testResult && (
            <div
              className={`flex flex-col gap-3 rounded-2xl border p-5 text-sm shadow-xs transition-all ${
                testResult.success
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                  : "border-red-200 bg-red-50 text-red-900"
              }`}
            >
              <div className="flex items-start gap-3.5">
                {testResult.success ? (
                  <CheckCircle
                    size={22}
                    className="mt-0.5 shrink-0 text-emerald-600"
                  />
                ) : (
                  <AlertCircle
                    size={22}
                    className="mt-0.5 shrink-0 text-red-600"
                  />
                )}
                <div className="flex-1 leading-relaxed wrap-break-word">
                  <div className="text-sm font-bold">
                    {testResult.success
                      ? "Connection Verified Successfully!"
                      : "Connection Test Failed"}
                  </div>
                  <div className="mt-1 text-xs text-zinc-700">
                    {testResult.message}
                  </div>
                </div>
              </div>

              {testResult.isHttpTlsError && !form.tls.enabled && (
                <div className="mt-2 flex flex-col justify-between gap-4 rounded-xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center">
                  <div className="text-xs leading-relaxed text-amber-900">
                    <strong>TLS Resolution:</strong> This endpoint may require
                    TLS/SSL encryption. Click to automatically enable TLS and
                    re-test:
                  </div>
                  <Button
                    type="button"
                    onClick={handleEnableTlsAndRetest}
                    variant="warning"
                    size="sm"
                    className="shrink-0 cursor-pointer gap-1.5 bg-amber-500 font-bold text-white shadow-xs hover:bg-amber-600"
                  >
                    <Sparkles size={14} />
                    <span>Enable TLS & Re-test</span>
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* General Tab */}
          {activeTab === "general" && (
            <div className="space-y-6">
              {/* Primary Identity Card */}
              <div className="space-y-5 rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xs">
                <div className="border-b border-zinc-100 pb-3">
                  <h3 className="text-sm font-bold tracking-tight text-mauve-900">
                    Identity & Environment
                  </h3>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    Define connection label, grouping tag, and color marker.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-zinc-700">
                      Display Name
                    </label>
                    <Input
                      type="text"
                      value={form.name}
                      onChange={(e) =>
                        setForm({ ...form, name: e.target.value })
                      }
                      placeholder="e.g. Production Cluster or Local Kafka"
                      className="h-10 border-zinc-200 bg-white text-sm text-mauve-900 focus-visible:border-mauve-500"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-zinc-700">
                      Environment Group
                    </label>
                    <div className="relative">
                      <select
                        value={form.group}
                        onChange={(e) => {
                          const newGrp = e.target.value;
                          const defaultColor =
                            newGrp === "Production"
                              ? "#dc2626"
                              : newGrp === "Staging"
                                ? "#f59e0b"
                                : newGrp === "Local"
                                  ? "#10b981"
                                  : "#3b82f6";
                          const isProd = newGrp === "Production";
                          const wasProd = (form.group || "")
                            .toLowerCase()
                            .includes("prod");
                          const nextReadOnly = isProd
                            ? true
                            : wasProd
                              ? false
                              : form.readOnly;
                          setForm({
                            ...form,
                            group: newGrp,
                            color: defaultColor,
                            readOnly: nextReadOnly,
                          });
                        }}
                        className="flex h-10 w-full cursor-pointer rounded-lg border border-zinc-200 bg-white py-2 pr-9 pl-3.5 font-sans text-sm text-mauve-900 shadow-2xs transition-all focus:border-mauve-500 focus:outline-none"
                      >
                        <option value="Production">Production</option>
                        <option value="Staging">Staging</option>
                        <option value="Development">Development</option>
                        <option value="Local">Local</option>
                      </select>
                      <ChevronDown
                        size={14}
                        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-zinc-400"
                      />
                    </div>
                    {form.group === "Production" && (
                      <p className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-red-600">
                        <Shield size={11} /> Read-only enabled for Production
                        (configurable in Advanced &amp; Safety).
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Endpoint & Network Card */}
              <div className="space-y-5 rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xs">
                <div className="border-b border-zinc-100 pb-3">
                  <h3 className="text-sm font-bold tracking-tight text-mauve-900">
                    Bootstrap Servers
                  </h3>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    One or more seed brokers (host:port). The client discovers
                    the full cluster from these.
                  </p>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-zinc-700">
                    Seed Brokers
                  </label>
                  <textarea
                    value={brokersDraft ?? seedBrokersText}
                    onChange={(e) => handleSeedBrokersChange(e.target.value)}
                    onBlur={() => setBrokersDraft(null)}
                    rows={3}
                    spellCheck={false}
                    placeholder={"broker-1:9092\nbroker-2:9092"}
                    className="w-full resize-none rounded-lg border border-zinc-200 bg-white p-3 font-mono text-sm text-mauve-900 shadow-2xs transition-all placeholder:text-zinc-400 focus:border-mauve-500 focus:outline-none"
                  />
                  <p className="mt-1.5 text-[11px] text-zinc-400">
                    Comma or newline separated. Default port 9092 is applied
                    automatically when omitted.
                  </p>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-zinc-700">
                    Schema Registry URL{" "}
                    <span className="font-normal text-zinc-400">(optional)</span>
                  </label>
                  <Input
                    type="text"
                    value={form.schemaRegistryUrl ?? ""}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        schemaRegistryUrl: e.target.value,
                      }))
                    }
                    spellCheck={false}
                    placeholder="http://localhost:8081"
                    className="font-mono text-sm"
                  />
                </div>
              </div>

              {/* Authentication Card */}
              <div className="space-y-5 rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xs">
                <div className="border-b border-zinc-100 pb-3">
                  <h3 className="text-sm font-bold tracking-tight text-mauve-900">
                    Authentication
                  </h3>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    SASL credentials. Leave mechanism empty for clusters
                    without authentication.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-zinc-700">
                      SASL Mechanism
                    </label>
                    <div className="relative">
                      <select
                        value={form.sasl?.mechanism || ""}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            sasl: { mechanism: e.target.value },
                          })
                        }
                        className="flex h-10 w-full cursor-pointer rounded-lg border border-zinc-200 bg-white py-2 pr-9 pl-3.5 font-sans text-sm text-mauve-900 shadow-2xs transition-all focus:border-mauve-500 focus:outline-none"
                      >
                        <option value="">None</option>
                        <option value="PLAIN">PLAIN</option>
                        <option value="SCRAM-SHA-256">SCRAM-SHA-256</option>
                        <option value="SCRAM-SHA-512">SCRAM-SHA-512</option>
                        <option value="OAUTHBEARER">
                          OAUTHBEARER (token as password)
                        </option>
                      </select>
                      <ChevronDown
                        size={14}
                        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-zinc-400"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-zinc-700">
                      Username{" "}
                      <span className="font-normal text-zinc-400">
                        (SASL user)
                      </span>
                    </label>
                    <Input
                      type="text"
                      value={form.username || ""}
                      onChange={(e) =>
                        setForm({ ...form, username: e.target.value })
                      }
                      placeholder="SASL username"
                      className="h-10 border-zinc-200 bg-white text-sm text-mauve-900 focus-visible:border-mauve-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-zinc-700">
                      Password / Token
                    </label>
                    <Input
                      type="password"
                      value={form.password || ""}
                      onChange={(e) =>
                        setForm({ ...form, password: e.target.value })
                      }
                      placeholder="SASL secret or bearer token"
                      className="h-10 border-zinc-200 bg-white text-sm text-mauve-900 focus-visible:border-mauve-500"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* SSH Bastion Tab */}
          {activeTab === "ssh" && (
            <div className="space-y-6">
              <div
                className={`rounded-2xl border p-5 transition-all ${
                  form.ssh.enabled
                    ? "border-amber-200 bg-amber-50/40"
                    : "border-zinc-200 bg-white"
                }`}
              >
                <div className="flex items-center gap-3.5">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={form.ssh.enabled}
                    onClick={() =>
                      setForm((prev) => ({
                        ...prev,
                        ssh: { ...prev.ssh, enabled: !prev.ssh.enabled },
                      }))
                    }
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      form.ssh.enabled ? "bg-mauve-600" : "bg-mauve-300"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block size-5 transform rounded-full bg-white shadow-md transition duration-200 ease-in-out ${
                        form.ssh.enabled ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                  <div>
                    <span className="flex items-center gap-2 text-sm font-bold text-mauve-900">
                      <Terminal
                        size={15}
                        className={
                          form.ssh.enabled ? "text-amber-600" : "text-zinc-400"
                        }
                      />
                      Enable SSH Bastion Tunnel Forwarding
                    </span>
                    <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
                      Connects to brokers inside an isolated VPC
                      or corporate network via an intermediary SSH jump host.
                    </p>
                  </div>
                </div>
              </div>

              {form.ssh.enabled && (
                <div className="space-y-5 rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xs">
                  <div className="border-b border-zinc-100 pb-3">
                    <h3 className="text-sm font-bold tracking-tight text-mauve-900">
                      Bastion Server Settings
                    </h3>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      SSH jump host credentials and private key configuration.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-[3fr_1fr]">
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-zinc-700">
                        SSH Host / IP
                      </label>
                      <Input
                        type="text"
                        value={form.ssh.host}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            ssh: { ...form.ssh, host: e.target.value },
                          })
                        }
                        placeholder="bastion.vpc.internal or 10.0.0.5"
                        className="h-10 border-zinc-200 bg-white text-sm text-mauve-900"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-zinc-700">
                        SSH Port
                      </label>
                      <Input
                        type="number"
                        value={form.ssh.port}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            ssh: {
                              ...form.ssh,
                              port: parseInt(e.target.value) || 22,
                            },
                          })
                        }
                        className="h-10 border-zinc-200 bg-white text-sm text-mauve-900"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-zinc-700">
                        SSH Username
                      </label>
                      <Input
                        type="text"
                        value={form.ssh.user}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            ssh: { ...form.ssh, user: e.target.value },
                          })
                        }
                        placeholder="ubuntu or ec2-user"
                        className="h-10 border-zinc-200 bg-white text-sm text-mauve-900"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-zinc-700">
                        SSH Password (Optional)
                      </label>
                      <Input
                        type="password"
                        value={form.ssh.password || ""}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            ssh: { ...form.ssh, password: e.target.value },
                          })
                        }
                        placeholder="Password if not using private key"
                        className="h-10 border-zinc-200 bg-white text-sm text-mauve-900"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-[2.5fr_1fr]">
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-zinc-700">
                        Private Key Path
                      </label>
                      <Input
                        type="text"
                        value={form.ssh.keyPath || ""}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            ssh: { ...form.ssh, keyPath: e.target.value },
                          })
                        }
                        placeholder="~/.ssh/id_rsa or /Users/name/.ssh/bastion.pem"
                        className="h-10 border-zinc-200 bg-white text-sm text-mauve-900"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-zinc-700">
                        Passphrase
                      </label>
                      <Input
                        type="password"
                        value={form.ssh.passphrase || ""}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            ssh: { ...form.ssh, passphrase: e.target.value },
                          })
                        }
                        placeholder="Optional"
                        className="h-10 border-zinc-200 bg-white text-sm text-mauve-900"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TLS / SSL Tab */}
          {activeTab === "tls" && (
            <div className="space-y-6">
              <div
                className={`rounded-2xl border p-5 transition-all ${
                  form.tls.enabled
                    ? "border-emerald-200 bg-emerald-50/40"
                    : "border-zinc-200 bg-white"
                }`}
              >
                <div className="flex items-center gap-3.5">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={form.tls.enabled}
                    onClick={() =>
                      setForm((prev) => ({
                        ...prev,
                        tls: { ...prev.tls, enabled: !prev.tls.enabled },
                      }))
                    }
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      form.tls.enabled ? "bg-mauve-600" : "bg-mauve-300"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block size-5 transform rounded-full bg-white shadow-md transition duration-200 ease-in-out ${
                        form.tls.enabled ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                  <div>
                    <span className="flex items-center gap-2 text-sm font-bold text-mauve-900">
                      <Lock
                        size={15}
                        className={
                          form.tls.enabled
                            ? "text-emerald-600"
                            : "text-zinc-400"
                        }
                      />
                      Enable TLS / SSL Transport Encryption
                    </span>
                    <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
                      Secures data in transit with TLS handshake. Server SNI is
                      automatically sent matching the target host.
                    </p>
                  </div>
                </div>
              </div>

              {form.tls.enabled && (
                <div className="space-y-5 rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xs">
                  <div className="space-y-1 rounded-xl border border-zinc-200 bg-mauve-50 p-4">
                    <div className="flex items-center gap-3">
                      <div
                        onClick={() =>
                          setForm((prev) => ({
                            ...prev,
                            tls: {
                              ...prev.tls,
                              insecureSkipVerify: !prev.tls.insecureSkipVerify,
                            },
                          }))
                        }
                        className={`flex size-4 cursor-pointer items-center justify-center rounded border transition-colors ${
                          form.tls.insecureSkipVerify
                            ? "border-mauve-600 bg-mauve-600 text-white"
                            : "border-zinc-300 bg-white hover:border-zinc-400"
                        }`}
                      >
                        {form.tls.insecureSkipVerify && (
                          <Check size={12} strokeWidth={3} />
                        )}
                      </div>
                      <span
                        onClick={() =>
                          setForm((prev) => ({
                            ...prev,
                            tls: {
                              ...prev.tls,
                              insecureSkipVerify: !prev.tls.insecureSkipVerify,
                            },
                          }))
                        }
                        className="cursor-pointer text-sm font-semibold text-mauve-900 select-none"
                      >
                        Skip TLS certificate verification (Insecure / Internal
                        CA)
                      </span>
                    </div>
                    <p className="pl-7 text-xs leading-relaxed text-zinc-500">
                      Recommended for AWS ElastiCache, Azure Cache, Upstash, or
                      private corporate certs without adding custom root
                      certificates to macOS keychain.
                    </p>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-zinc-700">
                      Custom CA Certificate Path or Inline PEM (Optional)
                    </label>
                    <Input
                      type="text"
                      value={form.tls.caCert || ""}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          tls: { ...form.tls, caCert: e.target.value },
                        })
                      }
                      placeholder="/path/to/ca.crt or paste certificate PEM string"
                      className="h-10 border-zinc-200 bg-white text-sm text-mauve-900"
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-zinc-700">
                        Client Certificate Path (mTLS)
                      </label>
                      <Input
                        type="text"
                        value={form.tls.clientCert || ""}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            tls: { ...form.tls, clientCert: e.target.value },
                          })
                        }
                        placeholder="/path/to/client.crt"
                        className="h-10 border-zinc-200 bg-white text-sm text-mauve-900"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-zinc-700">
                        Client Private Key Path (mTLS)
                      </label>
                      <Input
                        type="text"
                        value={form.tls.clientKey || ""}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            tls: { ...form.tls, clientKey: e.target.value },
                          })
                        }
                        placeholder="/path/to/client.key"
                        className="h-10 border-zinc-200 bg-white text-sm text-mauve-900"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Advanced Tab */}
          {activeTab === "advanced" && (
            <div className="space-y-6">
              {/* Read-Only Safety Card with Switch */}
              <div
                className={`rounded-2xl border p-5 transition-all ${
                  form.readOnly
                    ? "border-red-200 bg-red-50 text-red-900"
                    : "border-zinc-200 bg-white"
                }`}
              >
                <div className="flex items-center gap-3.5">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={form.readOnly}
                    onClick={() =>
                      setForm((prev) => ({ ...prev, readOnly: !prev.readOnly }))
                    }
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      form.readOnly ? "bg-mauve-600" : "bg-mauve-300"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block size-5 transform rounded-full bg-white shadow-md transition duration-200 ease-in-out ${
                        form.readOnly ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                  <div>
                    <span className="flex items-center gap-2 text-sm font-bold text-red-700">
                      <Shield size={16} />
                      Enable Read-Only Production Guard
                    </span>
                    <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
                      Blocks destructive commands (such as FLUSHALL, FLUSHDB,
                      DEL, UNLINK, RENAME, CONFIG, and mutating EVAL scripts) to
                      prevent accidental data loss.
                    </p>
                  </div>
                </div>
              </div>

              {/* Danger Zone Card */}
              {initialConfig && onDelete && (
                <div className="flex items-center justify-between rounded-2xl border border-red-200 bg-red-50/50 p-6 shadow-2xs">
                  <div>
                    <h3 className="text-sm font-bold tracking-tight text-red-900">
                      Delete Connection
                    </h3>
                    <p className="mt-0.5 text-xs text-red-700">
                      Permanently remove this connection and all stored
                      credentials.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onDelete(initialConfig.id, form.name)}
                    className="h-8.5 cursor-pointer gap-1.5 border-red-300 bg-white px-3.5 text-xs font-semibold text-red-700 shadow-2xs transition-all hover:bg-red-600 hover:text-white"
                  >
                    <Trash2 size={13} />
                    <span>Delete Connection</span>
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
