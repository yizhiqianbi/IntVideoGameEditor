package top.xumeng.app.feature.chat

import org.json.JSONObject
import top.xumeng.app.core.network.Line

data class MemoryUpdate(val summarize: List<Line>, val prefix: List<Line>, val previous: JSONObject?)

/** Same batch rule as the website: leave the latest raw turns, and summarize older ones in bounded batches. */
object MemoryPlan {
    private const val tailWindow = 40
    private const val minimumRaw = 28
    private const val batchMessages = 24
    private const val batchChars = 24_000

    fun select(lines: List<Line>, memoryRaw: String): MemoryUpdate? {
        if (lines.size < 2) return null
        val memory = memoryObject(memoryRaw, lines)
        val covered = memory?.optInt("sourceCount") ?: 0
        val normalTarget = if (lines.size - covered > tailWindow) lines.size - minimumRaw else covered
        val target = minOf(maxOf(normalTarget, 0), lines.size - 1)
        if (target <= covered) return null
        val prefix = lines.take(covered).toMutableList()
        val summarize = mutableListOf<Line>()
        var chars = 0
        var index = covered
        while (index < target && summarize.size < batchMessages) {
            val message = lines[index]
            if (chars + message.text.length > batchChars) break
            chars += message.text.length
            prefix.add(message)
            summarize.add(message)
            index++
        }
        if (summarize.isEmpty()) return null
        return MemoryUpdate(summarize, prefix, memory?.optJSONObject("state"))
    }

    fun pack(state: JSONObject, prefix: List<Line>): JSONObject = JSONObject()
        .put("version", 1)
        .put("sourceCount", prefix.size)
        .put("sourceFingerprint", StoryFingerprint.of(prefix))
        .put("state", state)

    private fun memoryObject(raw: String, lines: List<Line>): JSONObject? {
        val memory = runCatching { JSONObject(raw) }.getOrNull() ?: return null
        val count = memory.optInt("sourceCount", -1)
        if (memory.optInt("version") != 1 || count !in 1..lines.size) return null
        if (StoryFingerprint.of(lines.take(count)) != memory.optString("sourceFingerprint")) return null
        return memory
    }
}
