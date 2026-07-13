/* NEXT NATION — Pyodide 봇 워커 (모듈 워커 — Pyodide 314+는 클래식 워커를 거부한다).
   pypy 서브프로세스 대신 브라우저 안에서 순수 파이썬 봇을 실행한다.
   - stdin: 메인 스레드가 SharedArrayBuffer에 라인 청크를 쓰고 notify →
     여기서 Atomics.wait로 블로킹 수신 (봇의 sys.stdin.readline()에 연결)
   - stdout/stderr: postMessage로 메인에 흘려보냄
   봇 스크립트(runPython)는 FINISH까지 이 워커를 통째로 블로킹하며 돌아간다. */

import { loadPyodide } from "/pyodide/pyodide.mjs";

let ctrl = null; // Int32Array [0]=플래그(0 빈/1 데이터 있음), [1]=바이트 길이
let data = null; // Uint8Array (SAB offset 8~)
const decoder = new TextDecoder();

function stdinChunk() {
  // 봇이 입력을 기다림 — 메인이 다음 청크를 쓸 때까지 블로킹
  Atomics.wait(ctrl, 0, 0);
  const len = Atomics.load(ctrl, 1);
  const text = decoder.decode(data.slice(0, len));
  Atomics.store(ctrl, 0, 0);
  Atomics.notify(ctrl, 0); // 메인이 다음 청크를 써도 된다는 ack
  return text;
}

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type !== "init") return;
  try {
    ctrl = new Int32Array(msg.sab, 0, 2);
    data = new Uint8Array(msg.sab, 8);

    const pyodide = await loadPyodide({ indexURL: "/pyodide/" });

    const [botSrc, dataBin] = await Promise.all([
      fetch(msg.botUrl).then((r) => {
        if (!r.ok) throw new Error("bot fetch " + r.status);
        return r.text();
      }),
      fetch(msg.dataUrl)
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .catch(() => null),
    ]);
    // 봇이 CWD에서 data.bin을 읽는다(latest.py 상수 테이블) — 가상 FS에 기록
    if (dataBin) pyodide.FS.writeFile("data.bin", new Uint8Array(dataBin));

    pyodide.setStdin({ stdin: stdinChunk });
    pyodide.setStdout({ batched: (line) => self.postMessage({ type: "line", line }) });
    pyodide.setStderr({ batched: (line) => self.postMessage({ type: "stderr", line }) });
    pyodide.globals.set("__name__", "__main__"); // if __name__ == "__main__" 가드 통과

    self.postMessage({ type: "ready" });
    pyodide.runPython(botSrc); // 봇 main 루프 — FINISH 수신까지 블로킹
    self.postMessage({ type: "exit" });
  } catch (err) {
    self.postMessage({ type: "error", message: String((err && err.message) || err) });
  }
};
