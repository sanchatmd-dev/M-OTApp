import json
import sys
from pathlib import Path

model_dir = Path(__file__).resolve().parent / "models" / "openthai-v2.2.0"
sys.path.insert(0, str(model_dir))
from runtime.line_engine import LineOCR

page = LineOCR(model_dir, threads=2).read(sys.stdin.buffer.read())
lines = []
for line in page["lines"]:
    xs, ys = zip(*line["box"])
    lines.append({
        "text": line["text"],
        "confidence": 100 * line["confidence"],
        "bbox": {"x0": min(xs), "y0": min(ys), "x1": max(xs), "y1": max(ys)},
    })
print(json.dumps({"text": page["text"], "blocks": [{"paragraphs": [{"lines": lines}]}]}))
