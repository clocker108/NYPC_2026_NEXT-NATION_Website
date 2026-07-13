// Node worker_threads용 Pyodide 봇 워커 — public/pyodide-bot-worker.js의
// 브라우저 구조(SAB stdin + postMessage stdout)를 그대로 재현해 테스트한다.

import { parentPort, workerData } from "node:worker_threads";
import { readFileSync } from "node:fs";
import { loadPyodide } from "pyodide";

const ctrl = new Int32Array(workerData.sab, 0, 2);
const data = new Uint8Array(workerData.sab, 8);
const decoder = new TextDecoder();

function stdinChunk() {
  Atomics.wait(ctrl, 0, 0);
  const len = Atomics.load(ctrl, 1);
  const text = decoder.decode(data.slice(0, len));
  Atomics.store(ctrl, 0, 0);
  Atomics.notify(ctrl, 0);
  return text;
}

try {
  const pyodide = await loadPyodide();
  const botSrc = readFileSync(workerData.botPath, "utf8");
  const dataBin = readFileSync(workerData.dataBinPath);
  pyodide.FS.writeFile("data.bin", new Uint8Array(dataBin));

  pyodide.setStdin({ stdin: stdinChunk });
  pyodide.setStdout({ batched: (line) => parentPort.postMessage({ type: "line", line }) });
  pyodide.setStderr({ batched: (line) => parentPort.postMessage({ type: "stderr", line }) });
  pyodide.globals.set("__name__", "__main__");

  parentPort.postMessage({ type: "ready" });
  pyodide.runPython(botSrc);
  parentPort.postMessage({ type: "exit" });
} catch (e) {
  parentPort.postMessage({ type: "error", message: String((e && e.message) || e) });
}
