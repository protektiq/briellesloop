import { Worker } from "node:worker_threads";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = path.resolve(__dirname, "..", "workers", "pdf-parse-worker.js");

export const parsePdfTextIsolated = async (pdfBuffer, timeoutMs = 5_000) => {
  if (!Buffer.isBuffer(pdfBuffer) || pdfBuffer.length < 5) {
    throw new Error("pdfBuffer must be a Buffer with at least 5 bytes.");
  }

  const timeout = Number.parseInt(String(timeoutMs), 10);
  if (!Number.isInteger(timeout) || timeout < 500 || timeout > 30_000) {
    throw new Error("timeoutMs must be an integer between 500 and 30000.");
  }

  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_PATH, {
      workerData: {
        pdfBytes: Uint8Array.from(pdfBuffer),
      },
    });

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      void worker.terminate();
      reject(new Error(`PDF parsing exceeded timeout (${timeout}ms).`));
    }, timeout);

    const finalize = (handler) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      handler();
    };

    worker.on("message", (message) => {
      finalize(() => {
        if (message?.ok !== true || typeof message?.text !== "string") {
          reject(new Error("Invalid response from PDF parser worker."));
          return;
        }
        resolve(message.text);
      });
    });

    worker.on("error", (error) => {
      finalize(() => {
        reject(error instanceof Error ? error : new Error("PDF parser worker failed."));
      });
    });

    worker.on("exit", (code) => {
      if (settled) {
        return;
      }
      finalize(() => {
        reject(new Error(`PDF parser worker exited with code ${code}.`));
      });
    });
  });
};
