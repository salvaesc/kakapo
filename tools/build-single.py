"""
Bundles KAKAPO into ONE self-contained HTML file (inline CSS + all JS modules).
Useful for hosts that only accept a single file.

    python3 tools/build-single.py [out.html] [--fragment]

--fragment omits <!doctype>/<html>/<head>/<body> (for hosts that add their own skeleton).
"""
import os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS = os.path.join(ROOT, 'js')

IMPORT_RE = re.compile(r"^import\s*\{([^}]*)\}\s*from\s*'([^']+)';\s*$", re.M)

def resolve(from_file, spec):
    return os.path.normpath(os.path.join(os.path.dirname(from_file), spec))

def collect(entry):
    order, seen = [], set()
    def visit(f):
        if f in seen: return
        seen.add(f)
        src = open(f, encoding='utf-8').read()
        for _, spec in IMPORT_RE.findall(src):
            visit(resolve(f, spec))
        order.append(f)
    visit(entry)
    return order

def transform(f, ids):
    src = open(f, encoding='utf-8').read()
    def imp(m):
        names = []
        for part in m.group(1).split(','):
            part = part.strip()
            if not part: continue
            if ' as ' in part:
                a, b = [s.strip() for s in part.split(' as ')]
                names.append(f'{a}: {b}')
            else:
                names.append(part)
        return f"const {{ {', '.join(names)} }} = __m[{ids[resolve(f, m.group(2))]}];"
    src = IMPORT_RE.sub(imp, src)
    exports = re.findall(r'^export\s+(?:async\s+)?(?:function|class|const|let)\s+([A-Za-z_$][\w$]*)', src, re.M)
    src = re.sub(r'^export\s+', '', src, flags=re.M)
    if re.search(r"^\s*import\s", src, re.M):
        raise SystemExit(f'unsupported import form in {f}')
    rel = os.path.relpath(f, ROOT)
    return f"// ---- {rel}\n__m[{ids[f]}] = (() => {{\n{src}\nreturn {{ {', '.join(exports)} }};\n}})();\n"

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    fragment = '--fragment' in sys.argv
    out = args[0] if args else os.path.join(ROOT, 'dist', 'kakapo.html')
    files = collect(os.path.join(JS, 'main.js'))
    ids = {f: i for i, f in enumerate(files)}
    bundle = "(() => {\n'use strict';\nconst __m = [];\n" + ''.join(transform(f, ids) for f in files) + "})();\n"
    html = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
    css = open(os.path.join(ROOT, 'css', 'style.css'), encoding='utf-8').read()
    body = re.search(r'<body>(.*)</body>', html, re.S).group(1)
    body = re.sub(r'\s*<script type="module" src="js/main.js"></script>', '', body)
    body = body.replace('</script', '<\\/script')
    script = '<script>\n' + bundle.replace('</script', '<\\/script') + '</script>'
    if fragment:
        doc = f'<title>KAKAPO</title>\n<meta name="theme-color" content="#16363a">\n<style>\n{css}</style>\n{body}\n{script}\n'
    else:
        head = re.search(r'<head>(.*)</head>', html, re.S).group(1)
        head = re.sub(r'\s*<link rel="stylesheet" href="css/style.css">', '', head)
        doc = f'<!doctype html>\n<html lang="en">\n<head>{head}<style>\n{css}</style>\n</head>\n<body>{body}\n{script}\n</body>\n</html>\n'
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    open(out, 'w', encoding='utf-8').write(doc)
    print(f'wrote {out} ({len(doc)//1024} KB, {len(files)} modules)')

if __name__ == '__main__':
    main()
