"""本机模拟成人玩具。只记录连接、电量、强度和模式，不连接真实硬件。"""

from __future__ import annotations

import fcntl
import json
import os
import time
from pathlib import Path

PATTERNS = {
    "off": "关闭",
    "steady": "持续",
    "pulse": "脉冲",
    "wave": "起伏",
    "escalate": "渐强",
}
MAX_INTENSITY = 20
MAX_SECONDS = 120


def state_path() -> Path:
    raw = os.environ.get("TOY_STATE_PATH", "").strip()
    if raw:
        return Path(raw).expanduser()
    return Path(__file__).resolve().parent / "state.json"


class Device:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path or state_path()

    def status(self) -> dict:
        with self._locked() as current:
            current = self._expire(current)
            self._write(current)
            return current

    def set(self, intensity: int, pattern: str = "steady", seconds: int = 20) -> dict:
        level = max(0, min(MAX_INTENSITY, int(intensity)))
        mode = str(pattern or "steady").strip().lower()
        if mode not in PATTERNS:
            raise ValueError("模式只能是 off、steady、pulse、wave、escalate")
        duration = max(1, min(MAX_SECONDS, int(seconds)))
        with self._locked() as current:
            current = self._expire(current)
            now = time.time()
            if level == 0 or mode == "off":
                current = self._stopped(current, "停止")
            else:
                current.update(
                    connected=True,
                    running=True,
                    intensity=level,
                    pattern=mode,
                    running_until=now + duration,
                    battery_anchor=now,
                    battery_at_anchor=current["battery"],
                    updated_at=now,
                    last_command=f"{PATTERNS[mode]} · 强度 {level} · {duration} 秒",
                )
                self._log(current, current["last_command"])
            self._write(current)
            return current

    def hold(self, seconds: int = 90) -> dict:
        """对话还没变时延长这一档，避免计时结束把还在进行的震动关掉。"""
        duration = max(1, min(MAX_SECONDS, int(seconds)))
        with self._locked() as current:
            current = self._expire(current)
            if not current["running"]:
                return current
            now = time.time()
            if current["running_until"] - now > 30:
                return current
            current["running_until"] = now + duration
            current["battery_anchor"] = now
            current["battery_at_anchor"] = current["battery"]
            current["updated_at"] = now
            self._write(current)
            return current

    def stop(self) -> dict:
        with self._locked() as current:
            current = self._expire(current)
            current = self._stopped(current, "立刻停止")
            self._write(current)
            return current

    def status_text(self) -> str:
        return _text(self.status())

    def set_text(self, intensity: int, pattern: str = "steady", seconds: int = 20) -> str:
        return _text(self.set(intensity, pattern, seconds))

    def stop_text(self) -> str:
        return _text(self.stop())

    def _locked(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        return _Lock(self.path)

    def _read(self) -> dict:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            data = {}
        now = time.time()
        battery = data.get("battery", 86)
        return {
            "connected": True,
            "device_name": "模拟玩具",
            "battery": max(0, min(100, int(battery))),
            "intensity": int(data.get("intensity") or 0),
            "pattern": data.get("pattern") if data.get("pattern") in PATTERNS else "off",
            "running": bool(data.get("running")),
            "running_until": float(data.get("running_until") or 0),
            "battery_anchor": float(data.get("battery_anchor") or now),
            "battery_at_anchor": int(data.get("battery_at_anchor") or battery),
            "updated_at": float(data.get("updated_at") or now),
            "last_command": str(data.get("last_command") or "尚未控制"),
            "log": [str(item) for item in data.get("log") or []][-12:],
        }

    def _expire(self, current: dict) -> dict:
        now = time.time()
        if current["running"]:
            elapsed = max(0.0, now - float(current["battery_anchor"]))
            current["battery"] = max(0, int(current["battery_at_anchor"] - elapsed / 30))
            if now >= float(current["running_until"]) or current["battery"] <= 0:
                current = self._stopped(current, "时间到，已停止" if current["battery"] > 0 else "电量耗尽，已停止")
        return current

    def _stopped(self, current: dict, reason: str) -> dict:
        now = time.time()
        current.update(
            running=False,
            intensity=0,
            pattern="off",
            running_until=0,
            updated_at=now,
            last_command=reason,
        )
        self._log(current, reason)
        return current

    def _log(self, current: dict, line: str) -> None:
        stamp = time.strftime("%H:%M:%S", time.localtime())
        current["log"] = ([*current["log"], f"{stamp}  {line}"])[-12:]

    def _write(self, current: dict) -> None:
        temporary = self.path.with_name(self.path.name + ".tmp")
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            json.dump(current, output, ensure_ascii=False, indent=2)
            output.write("\n")
        temporary.chmod(0o600)
        temporary.replace(self.path)


def _text(state: dict) -> str:
    mode = PATTERNS.get(state["pattern"], "关闭")
    motion = "运行中" if state["running"] else "已停止"
    remaining = max(0, int(state["running_until"] - time.time())) if state["running"] else 0
    return (
        f"模拟玩具已连接，电量 {state['battery']}%。"
        f"状态：{motion}，模式 {mode}，强度 {state['intensity']}/20，剩余 {remaining} 秒。"
        f"最近指令：{state['last_command']}。"
    )


class _Lock:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.handle = None

    def __enter__(self) -> dict:
        lock_path = self.path.with_name(self.path.name + ".lock")
        self.handle = lock_path.open("a+", encoding="utf-8")
        fcntl.flock(self.handle.fileno(), fcntl.LOCK_EX)
        return Device(self.path)._read()

    def __exit__(self, *_args) -> None:
        if self.handle is not None:
            fcntl.flock(self.handle.fileno(), fcntl.LOCK_UN)
            self.handle.close()
