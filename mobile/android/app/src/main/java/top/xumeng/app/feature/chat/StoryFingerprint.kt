package top.xumeng.app.feature.chat

import org.json.JSONArray
import org.json.JSONObject
import top.xumeng.app.core.network.Line

data class StoryMemoryFields(
    val summary: String,
    val scene: String,
    val completed: String,
    val pending: String,
    val relationships: String,
    val items: String,
    val covered: Int,
)

object StoryMemory {
    const val FORMAT = "内容过长或格式不正确。摘要最多2400字，场景最多1000字；列表每项最多400字，全部记录总量约6000字。"

    fun fields(raw: String, lines: List<Line>): StoryMemoryFields? {
        val memory = matched(raw, lines) ?: return null
        val state = memory.optJSONObject("state") ?: return null
        return StoryMemoryFields(
            state.optString("summary"),
            state.optString("scene"),
            linesOf(state.optJSONArray("completed")),
            linesOf(state.optJSONArray("pending")),
            linesOf(state.optJSONArray("relationships")),
            linesOf(state.optJSONArray("items")),
            memory.optInt("sourceCount"),
        )
    }

    fun matched(raw: String, lines: List<Line>): JSONObject? {
        val memory = runCatching { JSONObject(raw) }.getOrNull() ?: return null
        val count = memory.optInt("sourceCount", -1)
        if (memory.optInt("version") != 1 || count !in 1..lines.size) return null
        if (StoryFingerprint.of(lines.take(count)) != memory.optString("sourceFingerprint")) return null
        if (memory.optJSONObject("state") == null) return null
        return memory
    }

    fun edited(raw: String, lines: List<Line>, summary: String, scene: String, completed: String, pending: String, relationships: String, items: String): JSONObject {
        val memory = matched(raw, lines) ?: throw IllegalArgumentException("剧情记忆已更新，请关闭并重新打开后再修改。")
        val state = JSONObject()
            .put("summary", text(summary, 2400))
            .put("scene", text(scene, 1000))
            .put("completed", list(completed))
            .put("pending", list(pending))
            .put("relationships", list(relationships))
            .put("items", list(items))
        if (state.toString().length > 6000) throw IllegalArgumentException(FORMAT)
        return JSONObject(memory.toString()).put("state", state)
    }

    private fun text(value: String, maximum: Int): String {
        if (value.length > maximum || value.contains('\u0000')) throw IllegalArgumentException(FORMAT)
        return value
    }

    private fun list(value: String): JSONArray {
        if (value.contains('\u0000')) throw IllegalArgumentException(FORMAT)
        val items = value.split('\n').map { it.trim() }.filter { it.isNotEmpty() }
        if (items.size > 12 || items.any { it.length > 400 }) throw IllegalArgumentException(FORMAT)
        return JSONArray().apply { items.forEach { put(it) } }
    }

    private fun linesOf(array: JSONArray?): String {
        if (array == null) return ""
        return buildList {
            for (index in 0 until array.length()) {
                val item = array.optString(index)
                if (item.isNotBlank()) add(item)
            }
        }.joinToString("\n")
    }
}

/** Same accidental cache key as the website's fingerprintDzmmStoryMessages. */
object StoryFingerprint {
    fun of(messages: List<Line>): String {
        val canonical = JSONArray().apply {
            messages.forEach { message ->
                val hasId = message.id.isNotBlank()
                put(JSONArray().put(message.role).put(message.text).put(if (hasId) 1 else 0).put(if (hasId) message.id else ""))
            }
        }.toString()
        var h1 = 1_779_033_703
        var h2 = 3_144_134_277.toInt()
        var h3 = 1_013_904_242
        var h4 = 2_773_480_762.toInt()
        canonical.forEach { char ->
            val code = char.code
            h1 = h2 xor imul(h1 xor code, 597_399_067)
            h2 = h3 xor imul(h2 xor code, 2_869_860_233.toInt())
            h3 = h4 xor imul(h3 xor code, 951_274_213)
            h4 = h1 xor imul(h4 xor code, 2_716_044_179.toInt())
        }
        h1 = imul(h3 xor ushr(h1, 18), 597_399_067)
        h2 = imul(h4 xor ushr(h2, 22), 2_869_860_233.toInt())
        h3 = imul(h1 xor ushr(h3, 17), 951_274_213)
        h4 = imul(h2 xor ushr(h4, 19), 2_716_044_179.toInt())
        val hashes = intArrayOf(h1 xor h2 xor h3 xor h4, h2 xor h1, h3 xor h1, h4 xor h1)
        return "dzmm-v1-" + hashes.joinToString("") { it.toUInt().toString(16).padStart(8, '0') }
    }

    private fun imul(left: Int, right: Int): Int = (left.toLong() * right.toLong()).toInt()

    private fun ushr(value: Int, bits: Int): Int = (value.toUInt() shr bits).toInt()
}
