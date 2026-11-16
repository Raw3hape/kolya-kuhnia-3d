"""One bounded QA server; /baseline/ uses a supplied git archive of web/js.

python3 tools/qa/performance-server.py <baseline-web-directory> [port]
All large assets are shared read-only with web/. Stop the foreground process after QA.
"""
import importlib.util
import pathlib
import sys
import urllib.parse

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("kitchen_serve", ROOT / "tools/serve.py")
serve = importlib.util.module_from_spec(spec)
spec.loader.exec_module(serve)
baseline = pathlib.Path(sys.argv[1]).resolve()


class Handler(serve.Handler):
    def translate_path(self, path):
        clean = urllib.parse.urlparse(path).path
        if clean.startswith("/baseline/"):
            relative = clean[len("/baseline/"):]
            archived = (baseline / relative).resolve()
            if archived.is_relative_to(baseline) and archived.is_file():
                return str(archived)
            path = "/" + relative
        return super().translate_path(path)

    def do_GET(self):
        if urllib.parse.urlparse(self.path).path in ("/baseline/", "/baseline/index.html"):
            original = self.path
            self.path = "/"
            try:
                super().do_GET()
            finally:
                self.path = original
        else:
            super().do_GET()


server = serve.PreviewServer(("127.0.0.1", int(sys.argv[2]) if len(sys.argv) > 2 else 8776), Handler)
print(f"Performance QA server PID ready on {server.server_port}", flush=True)
server.serve_forever()
