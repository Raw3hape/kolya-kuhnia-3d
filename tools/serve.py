"""Локальный сервер конфигуратора: раздаёт web/ и принимает снимки/GLB.

    python3 tools/serve.py [порт]      (по умолчанию 8765)

POST /api/save?name=<файл> кладёт тело запроса в exports/<файл>.
Кнопки «Снимок PNG» и «Модель GLB» в интерфейсе пишут сюда, поэтому
агент может сам получить файлы, не скачивая их через браузер.
"""
import http.server
import pathlib
import os
import re
import sys
import urllib.parse

ROOT = pathlib.Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
EXPORTS = ROOT / "exports"


class PreviewServer(http.server.ThreadingHTTPServer):
    # Many small models/modules arrive together. The default backlog of five can
    # reset cold browser requests before a handler thread accepts them.
    request_queue_size = 128
    daemon_threads = True


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
                      ".json": "application/json; charset=utf-8", ".hdr": "application/octet-stream"}

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(WEB), **kw)

    # Тот же каркас, что добавляет публикация Artifact: index.html пишется без doctype/head.
    # Один файл на сервер и сборку для Vercel (tools/build_static.mjs).
    SKELETON = (ROOT / "tools" / "skeleton.html").read_text(encoding="utf-8").strip()

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path in ("/", "/index.html"):
            body = (self.SKELETON + (WEB / "index.html").read_text(encoding="utf-8") + "</html>").encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self):
        url = urllib.parse.urlparse(self.path)
        if url.path != "/api/save":
            self.send_error(404)
            return
        name = urllib.parse.parse_qs(url.query).get("name", ["file.bin"])[0]
        name = re.sub(r"[^A-Za-z0-9._-]", "_", pathlib.Path(name).name)
        stem, ext = os.path.splitext(name)
        name = stem[:120 - len(ext)] + ext   # длинный код варианта режем, расширение (.glb/.png) сохраняем
        size = int(self.headers.get("Content-Length", 0))
        if size > 400_000_000:
            self.send_error(413)
            return
        EXPORTS.mkdir(exist_ok=True)
        (EXPORTS / name).write_bytes(self.rfile.read(size))
        self.send_response(200)
        self.end_headers()
        self.wfile.write(f"exports/{name}".encode())

    def log_message(self, fmt, *args):
        if "/api/" in str(args[0] if args else ""):
            super().log_message(fmt, *args)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    srv = PreviewServer(("127.0.0.1", port), Handler)
    print(f"http://127.0.0.1:{port}/", flush=True)
    srv.serve_forever()
