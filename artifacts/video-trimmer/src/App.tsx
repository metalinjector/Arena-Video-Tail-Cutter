import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import logo from "@assets/image_1782587909428.png";

const MAX_SIZE_MB = 50;
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;
const MAX_BATCH = 10;

type ItemStatus = "queued" | "uploading" | "done" | "error";

interface TrimResult {
  id: string;
  filename: string;
  originalDuration: number;
  trimmedDuration: number;
  removedSeconds: number;
}

interface QueueItem {
  id: string;
  file: File;
  name: string;
  size: number;
  status: ItemStatus;
  progress: string;
  result: TrimResult | null;
  error: string;
}

const PROGRESS_STEPS = [
  "Analyzing content...",
  "Searching for the repeating segment...",
  "Comparing with reference...",
  "Trimming video...",
];

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(2).padStart(5, "0");
  return `${m}:${sec}`;
}

function downloadUrl(r: TrimResult) {
  return `/api/download/${r.id}?filename=${encodeURIComponent(r.filename)}`;
}

export default function App() {
  const [batchMode, setBatchMode] = useState(false);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [oversize, setOversize] = useState<{ name: string; mb: number }[]>([]);

  const updateItem = useCallback((id: string, patch: Partial<QueueItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  const processItem = useCallback(
    async (item: QueueItem) => {
      updateItem(item.id, { status: "uploading", progress: "Uploading video...", error: "" });

      const formData = new FormData();
      formData.append("video", item.file);

      let stepIndex = 0;
      const timer = setInterval(() => {
        if (stepIndex < PROGRESS_STEPS.length) {
          updateItem(item.id, { progress: PROGRESS_STEPS[stepIndex] });
          stepIndex++;
        }
      }, 2000);

      try {
        const resp = await fetch("/api/trim", { method: "POST", body: formData });
        clearInterval(timer);
        if (!resp.ok) {
          const body = await resp.json().catch(() => ({ error: "Server error" }));
          throw new Error(body.error || "Processing error");
        }
        const data: TrimResult = await resp.json();
        updateItem(item.id, { status: "done", result: data, progress: "" });
      } catch (e: unknown) {
        clearInterval(timer);
        updateItem(item.id, {
          status: "error",
          error: e instanceof Error ? e.message : "Unknown error",
          progress: "",
        });
      }
    },
    [updateItem],
  );

  const runQueue = useCallback(
    async (queue: QueueItem[]) => {
      setIsProcessing(true);
      // Sequential processing — one file at a time to keep CPU usage low.
      for (const item of queue) {
        await processItem(item);
      }
      setIsProcessing(false);
    },
    [processItem],
  );

  const onDrop = useCallback(
    (accepted: File[]) => {
      if (accepted.length === 0) return;
      const max = batchMode ? MAX_BATCH : 1;
      const selected = accepted.slice(0, max);

      const tooBig: { name: string; mb: number }[] = [];
      const valid: File[] = [];
      for (const f of selected) {
        if (f.size > MAX_SIZE_BYTES) tooBig.push({ name: f.name, mb: f.size / (1024 * 1024) });
        else valid.push(f);
      }

      if (tooBig.length > 0) setOversize(tooBig);
      if (valid.length === 0) return;

      const newItems: QueueItem[] = valid.map((f) => ({
        id: crypto.randomUUID(),
        file: f,
        name: f.name,
        size: f.size,
        status: "queued",
        progress: "",
        result: null,
        error: "",
      }));
      setItems(newItems);
      void runQueue(newItems);
    },
    [batchMode, runQueue],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "video/*": [".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"] },
    multiple: batchMode,
    maxFiles: batchMode ? MAX_BATCH : 1,
    disabled: isProcessing,
  });

  const reset = () => {
    if (isProcessing) return;
    setItems([]);
  };

  const toggleBatch = () => {
    if (isProcessing) return;
    setItems([]);
    setBatchMode((v) => !v);
  };

  const showDropzone = items.length === 0;
  const doneCount = items.filter((i) => i.status === "done").length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-xl">
        {/* Header */}
        <div className="mb-8 text-center">
          <img
            src={logo}
            alt="Arena"
            className="w-20 h-20 mx-auto mb-5 rounded-2xl shadow-lg shadow-violet-600/30 ring-1 ring-white/10"
          />
          <h1 className="text-2xl font-bold text-white tracking-tight">Arena Video Tail Remover</h1>
          <p className="mt-2 text-slate-400 text-sm">
            Automatically detects and removes the repeating tail from your video
          </p>
        </div>

        {/* Mode toggle */}
        <div className="mb-6 flex items-center justify-center gap-3">
          <span className={`text-sm ${batchMode ? "text-slate-500" : "text-slate-200 font-medium"}`}>
            Single file
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={batchMode}
            onClick={toggleBatch}
            disabled={isProcessing}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              batchMode ? "bg-violet-600" : "bg-slate-700"
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                batchMode ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
          <span className={`text-sm ${batchMode ? "text-slate-200 font-medium" : "text-slate-500"}`}>
            Batch processing
            <span className="text-slate-500"> (up to {MAX_BATCH})</span>
          </span>
        </div>

        {/* Upload Zone */}
        {showDropzone && (
          <div
            {...getRootProps()}
            className={`
              relative border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all duration-200
              ${isDragActive
                ? "border-violet-500 bg-violet-500/10"
                : "border-slate-700 bg-slate-900 hover:border-violet-500/60 hover:bg-slate-900/80"
              }
            `}
          >
            <input {...getInputProps()} />
            <div className="flex flex-col items-center gap-3">
              <div className={`w-14 h-14 rounded-xl flex items-center justify-center transition-colors ${isDragActive ? "bg-violet-500/20" : "bg-slate-800"}`}>
                <svg className={`w-7 h-7 transition-colors ${isDragActive ? "text-violet-400" : "text-slate-500"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
              </div>
              {isDragActive ? (
                <p className="text-violet-400 font-medium">Drop {batchMode ? "files" : "the file"}...</p>
              ) : (
                <>
                  <p className="text-slate-300 font-medium">
                    {batchMode ? "Drag & drop up to 10 videos here" : "Drag & drop your video here"}
                  </p>
                  <p className="text-slate-500 text-sm">or click to browse</p>
                </>
              )}
              <p className="text-slate-600 text-xs mt-1">MP4, MOV, AVI, MKV, WebM · up to {MAX_SIZE_MB} MB each</p>
            </div>
          </div>
        )}

        {/* Single-file view */}
        {!showDropzone && !batchMode && items[0] && (
          <SingleView item={items[0]} onReset={reset} />
        )}

        {/* Batch view */}
        {!showDropzone && batchMode && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between px-1">
              <p className="text-sm text-slate-400">
                {isProcessing
                  ? `Processing… ${doneCount}/${items.length} done`
                  : `Finished · ${doneCount}/${items.length} processed`}
              </p>
              <button
                onClick={reset}
                disabled={isProcessing}
                className="text-sm text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Clear
              </button>
            </div>
            {items.map((item, idx) => (
              <BatchRow key={item.id} item={item} index={idx} />
            ))}
          </div>
        )}

        <p className="text-center text-slate-600 text-xs mt-8">
          Files are processed on the server and deleted automatically after download
        </p>
      </div>

      {/* Oversize Warning Modal */}
      {oversize.length > 0 && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm"
          onClick={() => setOversize([])}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-rose-900/50 bg-slate-900 p-7 text-center shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-rose-500/20">
              <svg className="h-7 w-7 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
            </div>
            <h2 className="text-lg font-bold text-white">
              {oversize.length > 1 ? "Some files are too large" : "File is too large"}
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              The maximum allowed size is{" "}
              <span className="font-medium text-slate-200">{MAX_SIZE_MB} MB</span> per file. The following{" "}
              {oversize.length > 1 ? "files were skipped" : "file was skipped"}:
            </p>
            <ul className="mt-3 max-h-40 overflow-auto text-left text-sm text-slate-300 space-y-1">
              {oversize.map((f) => (
                <li key={f.name} className="flex justify-between gap-3 rounded-lg bg-slate-800/60 px-3 py-1.5">
                  <span className="truncate">{f.name}</span>
                  <span className="shrink-0 text-rose-400">{f.mb.toFixed(1)} MB</span>
                </li>
              ))}
            </ul>
            <button
              onClick={() => setOversize([])}
              className="mt-6 w-full rounded-xl bg-violet-600 py-2.5 px-4 font-medium text-white transition-colors hover:bg-violet-500"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SingleView({ item, onReset }: { item: QueueItem; onReset: () => void }) {
  if (item.status === "uploading" || item.status === "queued") {
    return (
      <div className="border border-slate-800 rounded-2xl p-10 text-center bg-slate-900">
        <div className="flex flex-col items-center gap-5">
          <div className="relative">
            <div className="w-14 h-14 rounded-full border-2 border-slate-700" />
            <div className="absolute inset-0 w-14 h-14 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
          </div>
          <div>
            <p className="text-slate-200 font-medium truncate max-w-xs">{item.name}</p>
            <p className="text-slate-400 text-sm mt-1">{item.progress || "Uploading video..."}</p>
          </div>
        </div>
      </div>
    );
  }

  if (item.status === "done" && item.result) {
    const r = item.result;
    return (
      <div className="border border-slate-800 rounded-2xl overflow-hidden bg-slate-900">
        <div className="p-6 border-b border-slate-800">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
            <span className="text-emerald-400 font-medium text-sm">Tail removed successfully</span>
          </div>
          <p className="text-slate-300 text-sm font-medium truncate">{item.name}</p>
        </div>

        <div className="grid grid-cols-3 divide-x divide-slate-800">
          <div className="p-4 text-center">
            <p className="text-slate-500 text-xs mb-1">Original</p>
            <p className="text-slate-200 font-mono font-medium">{formatTime(r.originalDuration)}</p>
          </div>
          <div className="p-4 text-center">
            <p className="text-slate-500 text-xs mb-1">Result</p>
            <p className="text-emerald-400 font-mono font-medium">{formatTime(r.trimmedDuration)}</p>
          </div>
          <div className="p-4 text-center">
            <p className="text-slate-500 text-xs mb-1">Removed</p>
            <p className="text-rose-400 font-mono font-medium">-{formatTime(r.removedSeconds)}</p>
          </div>
        </div>

        <div className="p-5 flex flex-col gap-3">
          <a
            href={downloadUrl(r)}
            download={r.filename}
            className="flex items-center justify-center gap-2 w-full py-3 px-4 bg-violet-600 hover:bg-violet-500 text-white font-medium rounded-xl transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Download video
          </a>
          <button
            onClick={onReset}
            className="w-full py-2.5 px-4 text-slate-400 hover:text-slate-200 text-sm transition-colors rounded-xl hover:bg-slate-800"
          >
            Process another video
          </button>
        </div>
      </div>
    );
  }

  // error
  return (
    <div className="border border-rose-900/50 rounded-2xl p-8 text-center bg-rose-950/20">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 rounded-full bg-rose-500/20 flex items-center justify-center">
          <svg className="w-6 h-6 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
        </div>
        <div>
          <p className="text-rose-300 font-medium">Processing error</p>
          <p className="text-slate-400 text-sm mt-1">{item.error}</p>
        </div>
        <button
          onClick={onReset}
          className="mt-2 py-2 px-5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm rounded-lg transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

function BatchRow({ item, index }: { item: QueueItem; index: number }) {
  return (
    <div className="border border-slate-800 rounded-xl bg-slate-900 p-4">
      <div className="flex items-center gap-3">
        <span className="shrink-0 w-6 h-6 rounded-full bg-slate-800 text-slate-400 text-xs flex items-center justify-center font-mono">
          {index + 1}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-200">{item.name}</p>
          {item.status === "done" && item.result ? (
            <p className="mt-0.5 text-xs text-slate-500 font-mono">
              {formatTime(item.result.originalDuration)} → {formatTime(item.result.trimmedDuration)}{" "}
              <span className="text-rose-400">(-{formatTime(item.result.removedSeconds)})</span>
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-slate-500">
              {item.status === "queued" && "Queued"}
              {item.status === "uploading" && (item.progress || "Processing...")}
              {item.status === "error" && <span className="text-rose-400">{item.error}</span>}
            </p>
          )}
        </div>

        <div className="shrink-0">
          {item.status === "queued" && (
            <span className="text-xs text-slate-500">Waiting</span>
          )}
          {item.status === "uploading" && (
            <div className="relative w-6 h-6">
              <div className="w-6 h-6 rounded-full border-2 border-slate-700" />
              <div className="absolute inset-0 w-6 h-6 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
            </div>
          )}
          {item.status === "done" && item.result && (
            <a
              href={downloadUrl(item.result)}
              download={item.result.filename}
              className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 px-3 py-1.5 text-xs font-medium text-white transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              Download
            </a>
          )}
          {item.status === "error" && (
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-rose-500/20">
              <svg className="w-4 h-4 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
