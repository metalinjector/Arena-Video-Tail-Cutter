import { Router } from "express";
import multer from "multer";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";

const execAsync = promisify(exec);
const router = Router();

const UPLOAD_DIR = path.resolve(process.cwd(), "tmp-uploads");
const OUTPUT_DIR = path.resolve(process.cwd(), "tmp-outputs");
const REF_TAIL = path.resolve(process.cwd(), "src/reference-frames/ref_tail.mp4");
const TAIL_DURATION_S = 5.0;
const SEARCH_OFFSETS_S = [3.5, 4.0, 4.5, 4.75, 5.0, 5.25, 5.5, 6.0];
const SSIM_THRESHOLD = 0.65;

[UPLOAD_DIR, OUTPUT_DIR].forEach((d) => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 500 * 1024 * 1024 },
});

function ffmpeg(cmd: string): Promise<{ stdout: string; stderr: string }> {
  return execAsync(`ffmpeg ${cmd}`, { maxBuffer: 10 * 1024 * 1024 });
}

function ffprobe(cmd: string): Promise<{ stdout: string; stderr: string }> {
  return execAsync(`ffprobe ${cmd}`, { maxBuffer: 10 * 1024 * 1024 });
}

async function getVideoDuration(filePath: string): Promise<number> {
  const { stdout } = await ffprobe(
    `-v quiet -show_entries format=duration -of default=noprint_wrappers=1 "${filePath}"`
  );
  const match = stdout.match(/duration=([\d.]+)/);
  if (!match) throw new Error("Cannot read video duration");
  return parseFloat(match[1]);
}

async function getFrameRate(filePath: string): Promise<number> {
  const { stdout } = await ffprobe(
    `-v quiet -select_streams v:0 -show_entries stream=r_frame_rate -of default=noprint_wrappers=1 "${filePath}"`
  );
  const match = stdout.match(/r_frame_rate=(\d+)\/(\d+)/);
  if (!match) return 25;
  const num = parseInt(match[1], 10);
  const den = parseInt(match[2], 10);
  if (!den || !num) return 25;
  return num / den;
}

async function computeSSIM(
  videoPath: string,
  startSec: number,
  durationSec: number,
  refPath: string
): Promise<number> {
  const statsFile = path.join(UPLOAD_DIR, `ssim_${uuidv4()}.txt`);
  try {
    const cmd = [
      `-ss ${startSec} -t ${durationSec} -i "${videoPath}"`,
      `-t ${durationSec} -i "${refPath}"`,
      `-lavfi "[0:v]fps=4,scale=160:90[a];[1:v]fps=4,scale=160:90[b];[a][b]ssim=f='${statsFile}'"`,
      `-f null -`,
    ].join(" ");
    await ffmpeg(cmd);
    if (!fs.existsSync(statsFile)) return 0;
    const content = fs.readFileSync(statsFile, "utf-8");
    const lines = content.trim().split("\n");
    const lastLine = lines[lines.length - 1];
    const allMatch = lastLine.match(/All:([\d.]+)/);
    return allMatch ? parseFloat(allMatch[1]) : 0;
  } catch {
    return 0;
  } finally {
    if (fs.existsSync(statsFile)) fs.unlinkSync(statsFile);
  }
}

router.post("/trim", upload.single("video"), async (req, res) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "No video file uploaded" });
    return;
  }

  const inputPath = file.path;
  const outputId = uuidv4();
  const ext = path.extname(file.originalname) || ".mp4";
  const outputPath = path.join(OUTPUT_DIR, `${outputId}${ext}`);
  const outputName = path.basename(file.originalname, ext) + "_trimmed" + ext;

  try {
    const duration = await getVideoDuration(inputPath);

    if (duration < TAIL_DURATION_S + 1) {
      fs.unlinkSync(inputPath);
      res.status(400).json({ error: "Video is too short to contain the tail segment" });
      return;
    }

    const refExists = fs.existsSync(REF_TAIL);
    const fps = await getFrameRate(inputPath);
    const frameDuration = 1 / fps;
    let cutPoint: number | null = null;

    if (refExists) {
      // Phase 1: coarse SSIM scan to locate the approximate tail boundary
      const compareDuration = 1.5;
      let bestSsim = 0;
      let bestOffset = TAIL_DURATION_S;

      for (const offset of SEARCH_OFFSETS_S) {
        if (duration - offset < 0.5) continue;
        const startSec = duration - offset;
        const ssim = await computeSSIM(inputPath, startSec, compareDuration, REF_TAIL);
        req.log.info({ offset, ssim }, "Coarse SSIM scan");
        if (ssim > bestSsim) {
          bestSsim = ssim;
          bestOffset = offset;
        }
      }

      req.log.info({ bestSsim, bestOffset }, "Best coarse SSIM match");

      if (bestSsim >= SSIM_THRESHOLD) {
        // Phase 2: frame-accurate refinement around the coarse boundary.
        // Scan candidate start times one frame apart and find the exact frame
        // where the uploaded video best matches the start of the tail clip.
        const coarseStart = duration - bestOffset;
        const fineCompare = 0.6;
        const windowFrames = Math.max(1, Math.ceil(0.25 / frameDuration));
        let fineBest = -1;
        let fineStart = coarseStart;

        for (let k = -windowFrames; k <= windowFrames; k++) {
          const startSec = coarseStart + k * frameDuration;
          if (startSec < 0.5 || startSec + fineCompare > duration) continue;
          const ssim = await computeSSIM(inputPath, startSec, fineCompare, REF_TAIL);
          if (ssim > fineBest) {
            fineBest = ssim;
            fineStart = startSec;
          }
        }

        req.log.info({ fineBest, fineStart }, "Fine SSIM boundary");

        // Cut half a frame before the first tail frame so the entire tail,
        // including its very first frame, is removed without dropping good frames.
        cutPoint = fineStart - 0.5 * frameDuration;
      }
    }

    if (cutPoint === null) {
      cutPoint = duration - TAIL_DURATION_S;
    }

    if (cutPoint <= 0) {
      fs.unlinkSync(inputPath);
      res.status(400).json({ error: "Detected cut point is invalid" });
      return;
    }

    await ffmpeg(
      `-i "${inputPath}" -t ${cutPoint.toFixed(4)} -c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart "${outputPath}" -y`
    );

    fs.unlinkSync(inputPath);

    const finalDuration = await getVideoDuration(outputPath);

    res.json({
      id: outputId,
      filename: outputName,
      originalDuration: parseFloat(duration.toFixed(3)),
      trimmedDuration: parseFloat(finalDuration.toFixed(3)),
      removedSeconds: parseFloat((duration - finalDuration).toFixed(3)),
    });
  } catch (err) {
    req.log.error({ err }, "Trim failed");
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    res.status(500).json({ error: "Processing failed" });
  }
});

router.get("/download/:id", (req, res) => {
  const { id } = req.params;
  const filename = req.query.filename as string | undefined;

  if (!/^[\w-]+$/.test(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const files = fs.readdirSync(OUTPUT_DIR).filter((f) => f.startsWith(id));
  if (files.length === 0) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  const filePath = path.join(OUTPUT_DIR, files[0]);
  const downloadName = filename || files[0];

  res.download(filePath, downloadName, (err) => {
    if (!err) {
      setTimeout(() => {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }, 60_000);
    }
  });
});

export default router;
