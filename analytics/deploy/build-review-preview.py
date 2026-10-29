"""Build the private, non-submitting website review from public website assets."""
from pathlib import Path
import hashlib
import json
import re
import sys

source = Path(__file__).resolve().parents[2]
target = Path(sys.argv[1]).resolve()
target.mkdir(parents=True, exist_ok=True)
config = json.loads((source / 'analytics-config.json').read_text())
if config.get('enabled'):
    raise SystemExit('Review source must have tracking disabled')
inventory = {}
for path in sorted(source.iterdir()):
    if not path.is_file() or path.suffix.lower() not in {'.html', '.css', '.js', '.svg', '.png', '.pdf'} or path.name.startswith('check_'):
        continue
    raw = path.read_bytes()
    inventory[path.name] = hashlib.sha256(raw).hexdigest()
    if path.suffix == '.html':
        html = raw.decode()
        html = html.replace('</head>', '<meta name="robots" content="noindex,nofollow"><script src="preview-guard.js" defer></script></head>')
        html = re.sub(r'(<form\b[^>]*\baction=")[^"]*', r'\1#preview-disabled', html)
        html = html.replace('id="quote-submit"', 'id="quote-submit" disabled')
        html = re.sub(r'(<body\b[^>]*>)', r'\1<p style="margin:0;padding:10px 20px;background:#fff4df;color:#26333d;text-align:center;font:14px system-ui">Private review preview · Tracking and form submissions are disabled.</p>', html, count=1)
        raw = html.encode()
    (target / path.name).write_bytes(raw)
(target / 'preview-guard.js').write_text('document.addEventListener("submit",function(e){if(e.target.matches("form")){e.preventDefault();e.stopImmediatePropagation();var s=document.getElementById("quote-status");if(s){s.hidden=false;s.textContent="Review preview — submissions are disabled. No request was sent.";s.focus();}}},true);\n')
(target / 'robots.txt').write_text('User-agent: *\nDisallow: /\n')
(target / 'review-source-manifest.json').write_text(json.dumps({'scope':'public website review; no collection or submission','source_sha256':inventory},indent=2)+'\n')
print(json.dumps({'public_files':len(inventory),'tracking_enabled':False,'submissions_enabled':False}))
