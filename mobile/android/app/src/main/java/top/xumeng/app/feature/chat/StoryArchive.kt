package top.xumeng.app.feature.chat

import org.json.JSONArray
import org.json.JSONObject
import top.xumeng.app.core.network.Line
import java.io.IOException
import java.util.UUID

data class ImportedTalk(
    val character: JSONObject?,
    val characterId: String,
    val title: String,
    val clock: String,
    val messages: JSONArray,
    val memory: JSONObject?,
    val world: JSONObject?,
    val opening: JSONObject?,
    val unavailable: Boolean,
)

/** Read a website conversation backup and rebind it onto fresh message ids. */
object StoryArchive {
    private const val limit = 15_000
    private val publishedId = Regex("^published-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$")

    fun parse(raw: String): ImportedTalk {
        if (raw.toByteArray(Charsets.UTF_8).size > 2_000_000) throw IOException("会话文件不能超过 2 MB。")
        val root = try {
            JSONObject(raw)
        } catch (_: Exception) {
            throw IOException("会话格式无效。")
        }
        if (root.optString("spec") == "xumeng_conversation_archive_v1") return unavailable(root)
        val character = root.optJSONObject("character") ?: throw IOException("会话格式无效。")
        val original = readMessages(root.optJSONArray("messages"), requireIds = false)
        val name = character.optString("name").trim()
        if (name.isEmpty() || name.length > 120 || name.contains('\u0000')) throw IOException("角色卡缺少 name。")
        val id = "local-${UUID.randomUUID()}"
        val card = JSONObject(character.toString())
        listOf("publication", "authoringDraft", "listPreview", "catalogReadiness", "introductionDeferred", "contextDeferred").forEach { card.remove(it) }
        card.put("id", id)
        card.put("name", name)
        card.put("sourceKind", "original")
        card.put("promptOrigin", "original")
        card.put("sourceUrl", "")
        val copied = original.map { it.copy(id = UUID.randomUUID().toString()) }
        return ImportedTalk(
            character = card,
            characterId = id,
            title = name,
            clock = clock(root.optString("worldClockMode")),
            messages = wire(copied),
            memory = memory(root.optJSONObject("storyMemory"), original, copied),
            world = WorldJournal.rebind(root.optJSONObject("worldState")?.toString().orEmpty(), original, copied),
            opening = opening(root.optJSONObject("opening")),
            unavailable = false,
        )
    }

    private fun unavailable(root: JSONObject): ImportedTalk {
        val keys = buildSet {
            val iterator = root.keys()
            while (iterator.hasNext()) add(iterator.next())
        }
        if (!root.has("character") || !root.isNull("character") || keys != setOf("spec", "character", "conversation")) {
            throw IOException("缺卡会话存档不能包含伪造的角色卡或未知字段。")
        }
        val source = root.optJSONObject("conversation") ?: throw IOException("缺卡会话存档需要有效的角色关联、会话 ID、标题与时间。")
        val characterId = source.optString("characterId").trim()
        val title = source.optString("title").trim()
        val id = source.optString("id").trim()
        if (id.isEmpty() || id.length > 120 || characterId.isEmpty() || characterId.length > 120 || title.isEmpty() || title.length > 12_000) {
            throw IOException("缺卡会话存档需要有效的角色关联、会话 ID、标题与时间。")
        }
        if (characterId.startsWith("published-") && !publishedId.matches(characterId)) {
            throw IOException("缺卡会话存档需要有效的角色关联、会话 ID、标题与时间。")
        }
        if (!source.has("updatedAt") || source.optLong("updatedAt") < 0) throw IOException("缺卡会话存档需要有效的角色关联、会话 ID、标题与时间。")
        val original = readMessages(source.optJSONArray("messages"), requireIds = true)
        val copied = original.map { it.copy(id = UUID.randomUUID().toString()) }
        return ImportedTalk(
            character = null,
            characterId = characterId,
            title = title,
            clock = clock(source.optString("worldClockMode")),
            messages = wire(copied),
            memory = memory(source.optJSONObject("storyMemory"), original, copied),
            world = WorldJournal.rebind(source.optJSONObject("worldState")?.toString().orEmpty(), original, copied),
            opening = opening(source.optJSONObject("opening")),
            unavailable = true,
        )
    }

    private fun readMessages(messages: JSONArray?, requireIds: Boolean): List<Line> {
        if (messages == null) throw IOException("会话格式无效：消息应为非空文本，且每条不超过 $limit 字。")
        return buildList {
            for (index in 0 until messages.length()) {
                val message = messages.optJSONObject(index) ?: throw IOException("会话格式无效：消息应为非空文本，且每条不超过 $limit 字。")
                val role = message.optString("role")
                val text = message.optString("content")
                val id = message.optString("id").trim()
                if ((role != "user" && role != "assistant") || text.isBlank() || text.length > limit || text.contains('\u0000')) {
                    throw IOException("会话格式无效：消息应为非空文本，且每条不超过 $limit 字。")
                }
                if (requireIds && (id.isEmpty() || id.length > 120 || id.contains('\u0000'))) {
                    throw IOException("会话格式无效：每条消息需要有效 ID、角色与不超过 $limit 字的非空文本。")
                }
                add(Line(id.ifBlank { "import-$index" }, role, text))
            }
        }
    }

    private fun memory(source: JSONObject?, original: List<Line>, copied: List<Line>): JSONObject? {
        val memory = source ?: return null
        val count = memory.optInt("sourceCount", -1)
        val state = memory.optJSONObject("state") ?: return null
        if (memory.optInt("version") != 1 || count !in 1..original.size) return null
        if (memory.optString("sourceFingerprint") != StoryFingerprint.of(original.take(count))) return null
        return JSONObject()
            .put("version", 1)
            .put("sourceCount", count)
            .put("sourceFingerprint", StoryFingerprint.of(copied.take(count)))
            .put("state", state)
    }

    private fun opening(source: JSONObject?): JSONObject? {
        if (source == null || source.optInt("version") != 1) return null
        val kind = source.optString("kind")
        val origin = source.optString("source")
        val messages = source.optJSONArray("messages") ?: return null
        if (kind !in setOf("opening", "background", "welcome") || origin !in setOf("template", "history") || messages.length() > 20) return null
        return source
    }

    private fun clock(value: String): String = if (value == "realtime") "realtime" else "story"

    private fun wire(lines: List<Line>): JSONArray = JSONArray().apply {
        lines.forEach { put(JSONObject().put("id", it.id).put("role", it.role).put("content", it.text)) }
    }
}
