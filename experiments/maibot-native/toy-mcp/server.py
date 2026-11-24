"""MaiBot 用 stdio 连接的模拟玩具 MCP 服务。日志只能走 stderr。"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from mcp.server.fastmcp import FastMCP

from device import Device

mcp = FastMCP("xumeng-toy")
device = Device()


@mcp.tool(structured_output=False)
def toy_status() -> str:
    """读取本机模拟成人玩具的连接、电量、强度和模式。准备控制前先调用。"""

    return device.status_text()


@mcp.tool(structured_output=False)
def toy_set(intensity: int, pattern: str = "steady", seconds: int = 20) -> str:
    """设置模拟玩具。intensity 取 0 到 20；pattern 取 steady、pulse、wave、escalate 或 off；seconds 取 1 到 120。强度 0 或 off 会停止。"""

    try:
        return device.set_text(intensity, pattern, seconds)
    except ValueError as error:
        return str(error)


@mcp.tool(structured_output=False)
def toy_stop() -> str:
    """立刻停止模拟玩具。对方说停、不要、不想或太痛时必须先调用这个工具。"""

    return device.stop_text()


if __name__ == "__main__":
    mcp.run(transport="stdio")
