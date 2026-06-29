import http from "node:http";
import { readFile, stat, writeFile, appendFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HOST = "127.0.0.1";
const PORT = 17861;
const appDir = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.JROS_DATA_DIR
  ? resolve(process.env.JROS_DATA_DIR)
  : resolve(appDir, "..");
const htmlPath = resolve(appDir, "回到主线V1.1test.html");
const taskCsvPath = resolve(dataDir, "主线任务.csv");
const historyCsvPath = resolve(dataDir, "回到主线记录.csv");

const taskHeader = ["saved_at", "scope", "slot", "parent_slot", "task"];
const historyHeader = [
  "timestamp",
  "month_1",
  "month_2",
  "month_3",
  "week_1",
  "week_2",
  "week_3",
  "today_mainline",
  "reason",
  "context"
];

function csvEscape(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function buildCsv(header, rows) {
  return "\uFEFF" + [
    header,
    ...rows.map((row) => header.map((key) => csvEscape(row[key])))
  ].map((row) => row.join(",")).join("\r\n") + "\r\n";
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }

  return rows.filter((candidate) => candidate.some((value) => value !== ""));
}

function rowsToObjects(rows) {
  if (rows.length < 2) return [];
  const header = rows[0];
  return rows.slice(1).map((row) =>
    Object.fromEntries(header.map((key, index) => [key, row[index] ?? ""]))
  );
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) {
      throw new Error("Request body is too large");
    }
    chunks.push(chunk);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
  });
  response.end(JSON.stringify(value));
}

async function sendHtml(response) {
  const html = await readFile(htmlPath);
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
  });
  response.end(html);
}

async function readTasks() {
  try {
    const text = await readFile(taskCsvPath, "utf8");
    return rowsToObjects(parseCsv(text));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function appendHistory(entry) {
  let needsHeader = false;

  try {
    const fileStat = await stat(historyCsvPath);
    needsHeader = fileStat.size === 0;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    needsHeader = true;
  }

  if (needsHeader) {
    await writeFile(historyCsvPath, buildCsv(historyHeader, [entry]), "utf8");
    return;
  }

  const row = historyHeader.map((key) => csvEscape(entry[key])).join(",") + "\r\n";
  await appendFile(historyCsvPath, row, "utf8");
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${HOST}:${PORT}`);

    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      });
      response.end();
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      sendJson(response, 200, { ok: true, app: "jros-mainline", port: PORT });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/tasks") {
      sendJson(response, 200, { ok: true, tasks: await readTasks() });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/tasks") {
      const body = await readJsonBody(request);
      if (!Array.isArray(body.tasks) || body.tasks.length !== 6) {
        sendJson(response, 400, { ok: false, error: "Expected exactly six tasks" });
        return;
      }

      await writeFile(taskCsvPath, buildCsv(taskHeader, body.tasks), "utf8");
      sendJson(response, 200, { ok: true, path: taskCsvPath });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/return") {
      const body = await readJsonBody(request);
      if (!body.entry?.timestamp || !body.entry?.today_mainline || !body.entry?.reason) {
        sendJson(response, 400, { ok: false, error: "Missing return-to-mainline data" });
        return;
      }

      await appendHistory(body.entry);
      sendJson(response, 200, { ok: true, path: historyCsvPath });
      return;
    }

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      await sendHtml(response);
      return;
    }

    if (request.method === "GET" && url.pathname === "/favicon.ico") {
      response.writeHead(204);
      response.end();
      return;
    }

    const extension = extname(url.pathname);
    if (extension === ".html") {
      await sendHtml(response);
      return;
    }

    sendJson(response, 404, { ok: false, error: "Not found" });
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { ok: false, error: error.message });
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use.`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  console.log(`JROS Mainline is running at http://${HOST}:${PORT}/`);
  console.log(`Task CSV: ${taskCsvPath}`);
  console.log(`History CSV: ${historyCsvPath}`);
});
