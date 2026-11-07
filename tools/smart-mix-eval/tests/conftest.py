import sys
from pathlib import Path

TOOLS_ROOT = Path(__file__).resolve().parents[1]
APP_ROOT = Path(__file__).resolve().parents[3] / "app"

for path in (TOOLS_ROOT, TOOLS_ROOT / "vocals", TOOLS_ROOT / "structure", APP_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))
