// docs0.worker.js — render thread started by docs0.js's worker pool
//
// Messages in:  { type: "routes", routes: [file, route][] } — the site's file → route map, sent before any render and again when
//               files are added or removed
//               { type: "render", page: { file, route } }
// Messages out: { result: PageResult } or { error: string }, one per render, in order

// System dependencies
import { parentPort } from "worker_threads";

// Project dependencies
import { createPageRenderer } from "./docs0.render.js";

const renderer = createPageRenderer();

parentPort.on("message", (msg) => {
  if (msg.type === "routes") return renderer.setRoutes(msg.routes);
  try {
    parentPort.postMessage({ result: renderer.render(msg.page) });
  } catch (err) {
    parentPort.postMessage({ error: /** @type {Error} */ (err).message ?? String(err) });
  }
});
