import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import logo from "@assets/image_1782587909428.png";

type Status = "idle" | "uploading" | "done" | "error";

interface TrimResult {
  id: string;
  filename: string;
  originalDuration: number;
  trimmedDuration: number;
  removedSeconds: number;
}

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(2).padStart(5, "0");
  return `${m}:${sec}`;
}

export default function App() {
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<TrimResult | null>(null);
  const [error, setError] = useState<string>("");
  const [progress, setProgress] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");

  const processFile = useCallback(async (file: File) => {
    setStatus("uploading");
    setResult(null);
    setError("");
    setFileName(file.name);
    setProgress("Загрузка видео...");

    const formData = new FormData();
    formData.append("video", file);

    try {
      const progressSteps = [
        { delay: 1500, msg: "Анализ содержимого..." },
        { delay: 3000, msg: "Поиск повторяющегося фрагмента..." },
        { delay: 6000, msg: "Сравнение с образцом..." },
        { delay: 9000, msg: "Обрезка видео..." },
      ];

      let stepIndex = 0;
      const timer = setInterval(() => {
        if (stepIndex < progressSteps.length) {
          setProgress(progressSteps[stepIndex].msg);
          stepIndex++;
        }
      }, 2000);

      const resp = await fetch("/api/trim", {
        method: "POST",
        body: formData,
      });

      clearInterval(timer);

      if (!resp.ok) {
        const body = await resp.json().catch(() => ({ error: "Ошибка сервера" }));
        throw new Error(body.error || "Ошибка обработки");
      }

      const data = await resp.json();
      setResult(data);
      setStatus("done");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Неизвестная ошибка");
      setStatus("error");
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (acceptedFiles) => {
      if (acceptedFiles.length > 0) processFile(acceptedFiles[0]);
    },
    accept: { "video/*": [".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"] },
    multiple: false,
    disabled: status === "uploading",
  });

  const reset = () => {
    setStatus("idle");
    setResult(null);
    setError("");
    setProgress("");
    setFileName("");
  };

  const downloadUrl = result
    ? `/api/download/${result.id}?filename=${encodeURIComponent(result.filename)}`
    : "";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-xl">
        {/* Header */}
        <div className="mb-10 text-center">
          <img
            src={logo}
            alt="Arena"
            className="w-20 h-20 mx-auto mb-5 rounded-2xl shadow-lg shadow-violet-600/30 ring-1 ring-white/10"
          />
          <h1 className="text-2xl font-bold text-white tracking-tight">Arena Video Tail Remover</h1>
          <p className="mt-2 text-slate-400 text-sm">
            Автоматически находит и удаляет повторяющийся хвост из видео
          </p>
        </div>

        {/* Upload Zone */}
        {status === "idle" && (
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
                <p className="text-violet-400 font-medium">Отпустите файл...</p>
              ) : (
                <>
                  <p className="text-slate-300 font-medium">Перетащите видео сюда</p>
                  <p className="text-slate-500 text-sm">или нажмите для выбора файла</p>
                </>
              )}
              <p className="text-slate-600 text-xs mt-1">MP4, MOV, AVI, MKV, WebM</p>
            </div>
          </div>
        )}

        {/* Processing State */}
        {status === "uploading" && (
          <div className="border border-slate-800 rounded-2xl p-10 text-center bg-slate-900">
            <div className="flex flex-col items-center gap-5">
              <div className="relative">
                <div className="w-14 h-14 rounded-full border-2 border-slate-700" />
                <div className="absolute inset-0 w-14 h-14 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
              </div>
              <div>
                <p className="text-slate-200 font-medium">{fileName}</p>
                <p className="text-slate-400 text-sm mt-1">{progress}</p>
              </div>
            </div>
          </div>
        )}

        {/* Result State */}
        {status === "done" && result && (
          <div className="border border-slate-800 rounded-2xl overflow-hidden bg-slate-900">
            <div className="p-6 border-b border-slate-800">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
                  <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                </div>
                <span className="text-emerald-400 font-medium text-sm">Фрагмент удалён успешно</span>
              </div>
              <p className="text-slate-300 text-sm font-medium truncate">{fileName}</p>
            </div>

            <div className="grid grid-cols-3 divide-x divide-slate-800">
              <div className="p-4 text-center">
                <p className="text-slate-500 text-xs mb-1">Исходная</p>
                <p className="text-slate-200 font-mono font-medium">{formatTime(result.originalDuration)}</p>
              </div>
              <div className="p-4 text-center">
                <p className="text-slate-500 text-xs mb-1">Итоговая</p>
                <p className="text-emerald-400 font-mono font-medium">{formatTime(result.trimmedDuration)}</p>
              </div>
              <div className="p-4 text-center">
                <p className="text-slate-500 text-xs mb-1">Удалено</p>
                <p className="text-rose-400 font-mono font-medium">-{formatTime(result.removedSeconds)}</p>
              </div>
            </div>

            <div className="p-5 flex flex-col gap-3">
              <a
                href={downloadUrl}
                download={result.filename}
                className="flex items-center justify-center gap-2 w-full py-3 px-4 bg-violet-600 hover:bg-violet-500 text-white font-medium rounded-xl transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                Скачать видео
              </a>
              <button
                onClick={reset}
                className="w-full py-2.5 px-4 text-slate-400 hover:text-slate-200 text-sm transition-colors rounded-xl hover:bg-slate-800"
              >
                Обработать другое видео
              </button>
            </div>
          </div>
        )}

        {/* Error State */}
        {status === "error" && (
          <div className="border border-rose-900/50 rounded-2xl p-8 text-center bg-rose-950/20">
            <div className="flex flex-col items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-rose-500/20 flex items-center justify-center">
                <svg className="w-6 h-6 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
              </div>
              <div>
                <p className="text-rose-300 font-medium">Ошибка обработки</p>
                <p className="text-slate-400 text-sm mt-1">{error}</p>
              </div>
              <button
                onClick={reset}
                className="mt-2 py-2 px-5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm rounded-lg transition-colors"
              >
                Попробовать снова
              </button>
            </div>
          </div>
        )}

        <p className="text-center text-slate-600 text-xs mt-8">
          Файлы обрабатываются локально и не сохраняются на сервере
        </p>
      </div>
    </div>
  );
}
