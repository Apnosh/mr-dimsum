#!/bin/bash
# Mr. Dim Sum — local preview server
# Double-click this file (or run it in Terminal) to view the site at:
#   http://localhost:4500/menu
# Pages are linked without ".html" (/menu, /about), like on Vercel, so this
# server looks up /menu as menu.html.
# Press Control-C in the terminal window to stop it.

cd "$(dirname "$0")" || exit 1
PORT=4500
echo "Serving Mr. Dim Sum at http://localhost:${PORT}/menu"
echo "(Press Control-C to stop)"
python3 - "${PORT}" <<'EOF'
import os, sys, http.server

class CleanUrls(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        local = super().translate_path(path)
        if not os.path.exists(local) and os.path.exists(local + '.html'):
            return local + '.html'
        return local

http.server.ThreadingHTTPServer(('', int(sys.argv[1])), CleanUrls).serve_forever()
EOF
