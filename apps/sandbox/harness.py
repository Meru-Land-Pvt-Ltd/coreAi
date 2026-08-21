"""
RUNNING ONE PIECE OF PYTHON.

The architect writes the body of a function. It is handed `input` and returns a
value, and that value becomes what the next step reads.

Run with `-I -S`: isolated mode, so the current directory and PYTHONPATH are
ignored and nothing on disk can be imported by being placed next to us, and no
site-packages are loaded.

As with the JavaScript harness, the restrictions here stop ACCIDENTS. They are
not a jail — no arrangement of Python builtins is — and this file does not
pretend otherwise. The wall is the container: no network, no secrets, no
privileges, read-only disk. See README.md.
"""

import json
import sys


def _say(result):
    """One line of JSON, last, so the service can find it after any output."""
    sys.stdout.write("\n" + json.dumps(result))
    sys.stdout.flush()


def main():
    try:
        request = json.loads(sys.stdin.read())
    except Exception:
        _say({"ok": False, "error": "The sandbox could not read the code."})
        return

    logs = []

    def _print(*args, **_kwargs):
        logs.append(" ".join(str(a) for a in args))

    # Named explicitly so an ordinary mistake produces a sentence rather than a
    # traceback about a missing name.
    def _no_imports(*_args, **_kwargs):
        raise RuntimeError(
            "Other packages are not available here. This step can only work with what it is given."
        )

    def _no_open(*_args, **_kwargs):
        raise RuntimeError("This step cannot read or write files.")

    safe_builtins = {
        "abs": abs, "all": all, "any": any, "bool": bool, "dict": dict,
        "divmod": divmod, "enumerate": enumerate, "filter": filter, "float": float,
        "format": format, "int": int, "isinstance": isinstance, "len": len,
        "list": list, "map": map, "max": max, "min": min, "pow": pow,
        "range": range, "repr": repr, "reversed": reversed, "round": round,
        "set": set, "sorted": sorted, "str": str, "sum": sum, "tuple": tuple,
        "zip": zip, "True": True, "False": False, "None": None,
        "print": _print,
        "__import__": _no_imports,
        "open": _no_open,
        # A few standard modules that are genuinely useful and reach nothing.
        "json": json,
    }

    scope = {"__builtins__": safe_builtins, "input": request.get("input", {})}

    # The architect writes a function body, so it is wrapped in one — which also
    # means `return` behaves the way anybody would expect it to.
    body = request.get("code", "")
    indented = "\n".join("    " + line for line in body.split("\n"))
    source = "def __step(input):\n" + (indented if indented.strip() else "    return None") + "\n"

    try:
        exec(compile(source, "<your code>", "exec"), scope)  # noqa: S102 - see README
        output = scope["__step"](scope["input"])
    except Exception as error:  # noqa: BLE001 - anything they wrote may raise
        _say({"ok": False, "logs": logs, "error": str(error)[:1000]})
        return

    # What comes back has to survive the trip to the next step, so it must be
    # plain data.
    try:
        clean = json.loads(json.dumps(output))
    except Exception:
        _say({
            "ok": False,
            "logs": logs,
            "error": "What your code returned cannot be passed to the next step. Return plain values - text, numbers, lists and dictionaries.",
        })
        return

    _say({"ok": True, "output": clean, "logs": logs})


main()
