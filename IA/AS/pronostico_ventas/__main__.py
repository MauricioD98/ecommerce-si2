import sys

from .cli import main

if __name__ == "__main__":
    # La consola de Windows puede no ser UTF-8: evita UnicodeEncodeError con tildes y "—"
    for flujo in (sys.stdout, sys.stderr):
        try:
            flujo.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass
    sys.exit(main())
