"""Bound successful Qingyu deliveries using the native stop-after-tool contract."""


def finish_qingyu_reply(result, tool_name, profile):
    if profile in ("classic", "intimate", "traveler") and tool_name in ("reply", "xumeng_send_voice", "xumeng_send_image", "xumeng_send_emoji") and result.success:
        result.stop_after_execution = True
