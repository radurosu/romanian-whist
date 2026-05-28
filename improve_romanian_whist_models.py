#!/usr/bin/env python3
"""
Run index2.html through several NVIDIA-hosted models and save one improved
HTML file per model.

Default behavior compares models fairly: each model receives the original
input file. Use --chain to pass each generated file to the next model instead.

Usage:
  export NVIDIA_API_KEY="your-real-key"
  python3 improve_romanian_whist_models.py \
    --input /Users/radurosu/dev/romanian-whist/index2.html \
    --output-dir /Users/radurosu/dev/romanian-whist/model_outputs
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1"
DEFAULT_INPUT = "/Users/radurosu/dev/romanian-whist/index2.html"
DEFAULT_OUTPUT_DIR = "/Users/radurosu/dev/romanian-whist/model_outputs"

DEFAULT_MODELS = [
    "minimaxai/minimax-m2.7",
    "deepseek-ai/deepseek-v3.2",
    "qwen/qwen3-coder-480b-a35b-instruct",
]


SYSTEM_PROMPT = """You are a senior JavaScript game-AI engineer.

You will receive a complete standalone HTML file for a Romanian Whist browser
game. Return a complete improved standalone HTML file.

Hard requirements:
- Return only the full HTML file. Do not wrap it in Markdown.
- Preserve the existing game as a single file with no build step.
- Do not add external dependencies, remote assets, or network calls.
- Keep all user-facing gameplay working: setup, bidding, legal play, scoring,
  saving/resuming, history, and mobile layout.
- Focus your changes on the bidding, card-play AI, and suggestion algorithms.
- Preserve Romanian Whist rules already implemented unless you find a clear bug.
- Add concise comments only where algorithm changes need explanation.

Useful improvement targets:
- Avoid treating a non-trump high card as a guaranteed winner when future
  players may be void and able to trump.
- Improve bid estimation with visible information, player count, trump risk,
  hand shape, and position.
- Make AI personalities behaviorally distinct in code, especially the
  opportunist and analyst/blocking styles.
- Improve the human suggestion engine so its reasoning matches the refined AI.
- Keep changes understandable and testable; do not rewrite the whole app unless
  necessary.
"""


USER_TEMPLATE = """Improve this Romanian Whist HTML game.

Please return exactly one complete standalone HTML document and nothing else.

Source file path: {source_path}

```html
{html}
```
"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Ask selected NVIDIA models to improve Romanian Whist HTML."
    )
    parser.add_argument(
        "--input",
        default=DEFAULT_INPUT,
        help=f"Input HTML file. Default: {DEFAULT_INPUT}",
    )
    parser.add_argument(
        "--output-dir",
        default=DEFAULT_OUTPUT_DIR,
        help=f"Directory for generated HTML files. Default: {DEFAULT_OUTPUT_DIR}",
    )
    parser.add_argument(
        "--api-key",
        default=os.getenv("NVIDIA_API_KEY"),
        help="NVIDIA API key. Prefer NVIDIA_API_KEY instead of this flag.",
    )
    parser.add_argument(
        "--base-url",
        default=os.getenv("NVIDIA_BASE_URL", DEFAULT_BASE_URL),
        help=f"NVIDIA API base URL. Default: {DEFAULT_BASE_URL}",
    )
    parser.add_argument(
        "--models",
        nargs="+",
        default=DEFAULT_MODELS,
        help="Model IDs to run, in order.",
    )
    parser.add_argument(
        "--max-tokens",
        type=int,
        default=60000,
        help="Max output tokens requested from each model. Default: 60000",
    )
    parser.add_argument(
        "--temperature",
        type=float,
        default=0.2,
        help="Sampling temperature. Default: 0.2",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=900,
        help="HTTP timeout per model in seconds. Default: 900",
    )
    parser.add_argument(
        "--chain",
        action="store_true",
        help="Feed each model the previous model's output instead of the original.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print planned model/output files without calling the API.",
    )
    return parser.parse_args()


def model_slug(model: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9._-]+", "_", model.strip())
    return slug.strip("_").replace("__", "_")


def extract_html(text: str) -> str:
    stripped = text.strip()

    fence = re.search(r"```(?:html)?\s*(.*?)```", stripped, flags=re.DOTALL | re.IGNORECASE)
    if fence:
        stripped = fence.group(1).strip()

    start = stripped.lower().find("<!doctype html")
    if start == -1:
        start = stripped.lower().find("<html")
    if start > 0:
        stripped = stripped[start:].strip()

    end = stripped.lower().rfind("</html>")
    if end != -1:
        stripped = stripped[: end + len("</html>")].strip()

    return stripped


def looks_like_complete_html(text: str) -> bool:
    lowered = text.lower()
    return (
        ("<!doctype html" in lowered or "<html" in lowered)
        and "<script" in lowered
        and "</html>" in lowered
        and "function computeaibid" in lowered
        and "function chooseaicard" in lowered
    )


def chat_completion(
    base_url: str,
    api_key: str,
    model: str,
    html: str,
    source_path: Path,
    max_tokens: int,
    temperature: float,
    timeout: int,
) -> str:
    url = base_url.rstrip("/") + "/chat/completions"
    payload: dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": USER_TEMPLATE.format(source_path=source_path, html=html),
            },
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
    }

    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )

    with urllib.request.urlopen(request, timeout=timeout) as response:
        data = json.loads(response.read().decode("utf-8"))

    choices = data.get("choices") or []
    if not choices:
        raise RuntimeError(f"{model} returned no choices: {json.dumps(data)[:1000]}")

    message = choices[0].get("message") or {}
    content = message.get("content") or choices[0].get("text") or ""
    if not content:
        raise RuntimeError(f"{model} returned empty content: {json.dumps(data)[:1000]}")
    return content


def print_http_error(model: str, error: urllib.error.HTTPError) -> None:
    detail = error.read().decode("utf-8", errors="replace")
    print(f"[{model}] HTTP {error.code}: {error.reason}", file=sys.stderr)
    if detail:
        try:
            print(json.dumps(json.loads(detail), indent=2), file=sys.stderr)
        except json.JSONDecodeError:
            print(detail, file=sys.stderr)


def main() -> int:
    args = parse_args()
    input_path = Path(args.input).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()

    if not input_path.exists():
        print(f"Input file not found: {input_path}", file=sys.stderr)
        return 2

    api_key = args.api_key
    if not api_key and not args.dry_run:
        api_key = getpass.getpass("NVIDIA API key: ")
    if not api_key and not args.dry_run:
        print("No API key provided. Set NVIDIA_API_KEY or pass --api-key.", file=sys.stderr)
        return 2

    original_html = input_path.read_text(encoding="utf-8")
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"Input: {input_path}")
    print(f"Output dir: {output_dir}")
    print(f"Mode: {'chain' if args.chain else 'independent comparison'}")
    print("Models:")
    for model in args.models:
        print(f"  - {model}")

    if args.dry_run:
        for index, model in enumerate(args.models, start=1):
            output_path = output_dir / f"index2_improved_{index:02d}_{model_slug(model)}.html"
            print(f"Would write: {output_path}")
        return 0

    current_html = original_html
    summary: list[tuple[str, Path, str]] = []

    for index, model in enumerate(args.models, start=1):
        source_html = current_html if args.chain else original_html
        output_path = output_dir / f"index2_improved_{index:02d}_{model_slug(model)}.html"
        raw_path = output_dir / f"index2_improved_{index:02d}_{model_slug(model)}.raw.txt"

        print(f"\n[{index}/{len(args.models)}] Calling {model}...")
        started = time.time()

        try:
            raw = chat_completion(
                base_url=args.base_url,
                api_key=api_key,
                model=model,
                html=source_html,
                source_path=input_path,
                max_tokens=args.max_tokens,
                temperature=args.temperature,
                timeout=args.timeout,
            )
        except urllib.error.HTTPError as error:
            print_http_error(model, error)
            summary.append((model, output_path, "failed"))
            continue
        except urllib.error.URLError as error:
            print(f"[{model}] Network error: {error.reason}", file=sys.stderr)
            summary.append((model, output_path, "failed"))
            continue
        except Exception as error:  # noqa: BLE001 - CLI should continue to next model.
            print(f"[{model}] Error: {error}", file=sys.stderr)
            summary.append((model, output_path, "failed"))
            continue

        improved_html = extract_html(raw)
        raw_path.write_text(raw, encoding="utf-8")

        if not looks_like_complete_html(improved_html):
            print(
                f"[{model}] Output did not look like a complete game HTML file. "
                f"Saved raw output only: {raw_path}",
                file=sys.stderr,
            )
            summary.append((model, raw_path, "raw-only"))
            continue

        output_path.write_text(improved_html + "\n", encoding="utf-8")
        current_html = improved_html

        elapsed = time.time() - started
        print(f"[{model}] Wrote {output_path} in {elapsed:.1f}s")
        summary.append((model, output_path, "ok"))

    print("\nSummary:")
    for model, path, status in summary:
        print(f"  {status:8s} {model} -> {path}")

    return 0 if any(status == "ok" for _, _, status in summary) else 1


if __name__ == "__main__":
    raise SystemExit(main())
