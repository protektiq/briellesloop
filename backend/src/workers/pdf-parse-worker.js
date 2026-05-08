import { parentPort, workerData } from "node:worker_threads";
import { PDFParse } from "pdf-parse";

const run = async () => {
  const bytes = workerData?.pdfBytes;
  if (!bytes || typeof bytes.length !== "number" || bytes.length < 5) {
    throw new Error("Missing PDF bytes.");
  }

  const buffer = Buffer.from(bytes);
  const parser = new PDFParse({ data: buffer });
  try {
    const textResult = await parser.getText();
    const text = typeof textResult?.text === "string" ? textResult.text : "";
    parentPort?.postMessage({ ok: true, text });
  } finally {
    await parser.destroy();
  }
};

void run().catch((error) => {
  const message = error instanceof Error ? error.message : "PDF parsing failed.";
  throw new Error(message);
});
