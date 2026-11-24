package top.xumeng.app.feature.novel

import org.json.JSONArray
import org.json.JSONObject
import top.xumeng.app.core.network.NovelChapter
import top.xumeng.app.core.network.NovelDraft
import top.xumeng.app.core.network.NovelPerson
import java.io.File
import java.net.URLEncoder
import java.util.UUID

data class NovelRecovery(
    val accountId: String,
    val ownerId: String,
    val workId: String,
    val revision: String,
    val draft: NovelDraft,
    val chapterId: String?,
    val updatedAt: Long,
    val storageKey: String,
    val raw: String,
    val file: File,
)

/**
 * One file per account, editor owner and work, matching the site's v2 recovery slot.
 * Dropping a copy hides that revision. A newer edit of the same slot shows up again.
 */
class NovelRecoveryStore(private val root: File) {
    fun read(accountId: String): List<NovelRecovery> {
        if (accountId.isBlank() || !idOk(accountId)) return emptyList()
        val accountDir = File(root, enc(accountId))
        if (!accountDir.isDirectory) return emptyList()
        val entries = mutableListOf<NovelRecovery>()
        accountDir.listFiles()?.forEach { ownerDir ->
            if (!ownerDir.isDirectory || ownerDir.name == "_dismissed") return@forEach
            ownerDir.listFiles()?.forEach { file ->
                if (!file.isFile || !file.name.endsWith(".json")) return@forEach
                val raw = runCatching { file.readText(Charsets.UTF_8) }.getOrNull() ?: return@forEach
                val entry = parse(accountId, file, raw) ?: return@forEach
                if (!dismissed(accountId, entry)) entries.add(entry)
            }
        }
        return entries.sortedWith(compareByDescending<NovelRecovery> { it.updatedAt }.thenBy { it.storageKey })
    }

    fun write(accountId: String, ownerId: String, draft: NovelDraft, chapterId: String?): NovelRecovery {
        if (!idOk(accountId) || !idOk(ownerId) || !idOk(draft.id)) throw IllegalArgumentException("恢复副本的作品归属无效。")
        val revision = UUID.randomUUID().toString()
        val selected = chapterId?.takeIf { id -> draft.chapters.any { it.id == id } } ?: draft.chapters.firstOrNull()?.id
        val payload = JSONObject()
            .put("accountId", accountId)
            .put("draft", draftJson(draft))
            .put("baseVersion", draft.version ?: JSONObject.NULL)
            .put("selectedChapterId", selected ?: JSONObject.NULL)
            .put("updatedAt", System.currentTimeMillis())
            .put("recoveryVersion", 2)
            .put("ownerId", ownerId)
            .put("workId", draft.id)
            .put("revision", revision)
        val raw = payload.toString()
        if (raw.toByteArray(Charsets.UTF_8).size > MAX_BYTES) throw IllegalArgumentException("作品恢复副本或备份不能超过 16 MB。")
        val file = slot(accountId, ownerId, draft.id)
        file.parentFile?.mkdirs()
        val temporary = File(file.parentFile, "${file.name}.tmp")
        temporary.writeText(raw, Charsets.UTF_8)
        if (!temporary.renameTo(file)) {
            file.writeText(raw, Charsets.UTF_8)
            temporary.delete()
        }
        return parse(accountId, file, raw) ?: throw IllegalArgumentException("恢复副本的作品归属无效。")
    }

    fun clear(entry: NovelRecovery, ownerId: String): Boolean {
        if (entry.ownerId != ownerId) return false
        val inside = runCatching { entry.file.parentFile?.parentFile?.parentFile?.canonicalFile == root.canonicalFile }.getOrDefault(false)
        if (!inside) return false
        val current = runCatching { entry.file.readText(Charsets.UTF_8) }.getOrNull()
        if (current != entry.raw) return false
        return entry.file.delete()
    }

    fun dismiss(entry: NovelRecovery) {
        val marker = File(File(root, enc(entry.accountId)), "_dismissed")
        marker.mkdirs()
        File(marker, "${enc(entry.storageKey)}.${enc(entry.revision)}").writeText("1", Charsets.UTF_8)
    }

    private fun dismissed(accountId: String, entry: NovelRecovery): Boolean {
        val marker = File(File(root, enc(accountId)), "_dismissed/${enc(entry.storageKey)}.${enc(entry.revision)}")
        return marker.isFile && marker.readText(Charsets.UTF_8) == "1"
    }

    private fun slot(accountId: String, ownerId: String, workId: String) =
        File(root, "${enc(accountId)}/${enc(ownerId)}/${enc(workId)}.json")

    private fun parse(accountId: String, file: File, raw: String): NovelRecovery? {
        if (raw.isBlank() || raw.toByteArray(Charsets.UTF_8).size > MAX_BYTES) return null
        val rootObject = runCatching { JSONObject(raw) }.getOrNull() ?: return null
        if (rootObject.optString("accountId") != accountId) return null
        if (rootObject.optInt("recoveryVersion") != 2) return null
        val updatedAt = rootObject.optLong("updatedAt", -1)
        if (updatedAt < 0) return null
        val baseVersion = when {
            rootObject.isNull("baseVersion") -> null
            else -> rootObject.optInt("baseVersion", 0).takeIf { it >= 1 && rootObject.opt("baseVersion") is Number }
        } ?: if (rootObject.isNull("baseVersion")) null else return null
        val ownerId = rootObject.optString("ownerId")
        val revision = rootObject.optString("revision")
        val draft = draftFrom(rootObject.optJSONObject("draft"), baseVersion) ?: return null
        if (!idOk(ownerId) || !idOk(revision) || rootObject.optString("workId") != draft.id) return null
        val expected = slot(accountId, ownerId, draft.id)
        val sameFile = runCatching { file.canonicalFile == expected.canonicalFile }.getOrDefault(false)
        if (!sameFile) return null
        val selectedRaw = if (rootObject.isNull("selectedChapterId")) null else rootObject.optString("selectedChapterId").ifBlank { null }
        val selected = selectedRaw?.takeIf { id -> draft.chapters.any { it.id == id } } ?: draft.chapters.firstOrNull()?.id
        return NovelRecovery(
            accountId = accountId,
            ownerId = ownerId,
            workId = draft.id,
            revision = revision,
            draft = draft,
            chapterId = selected,
            updatedAt = updatedAt,
            storageKey = "xumeng-novel-recovery-v2:${enc(accountId)}:${enc(ownerId)}:${enc(draft.id)}",
            raw = raw,
            file = file,
        )
    }

    private fun draftFrom(work: JSONObject?, version: Int?): NovelDraft? {
        if (work == null) return null
        val id = work.optString("id")
        if (!idOk(id)) return null
        val type = work.optString("type")
        if (type != "novel" && type != "story") return null
        val chapters = work.optJSONArray("chapters") ?: return null
        if (chapters.length() > 100) return null
        val seen = mutableSetOf<String>()
        val parsedChapters = buildList {
            for (index in 0 until chapters.length()) {
                val chapter = chapters.optJSONObject(index) ?: return null
                val chapterId = chapter.optString("id")
                if (!idOk(chapterId) || !seen.add(chapterId)) return null
                val title = chapter.optString("title")
                val content = chapter.optString("content")
                if (title.length > 120 || content.length > 50_000) return null
                add(NovelChapter(chapterId, title, content))
            }
        }.ifEmpty { listOf(NovelChapter(UUID.randomUUID().toString(), "第一章", "")) }
        if ((work.optJSONArray("characters")?.length() ?: 0) > 30) return null
        val tags = buildList {
            val values = work.optJSONArray("tags") ?: return@buildList
            for (index in 0 until values.length()) {
                val tag = values.optString(index).trim()
                if (tag.isEmpty() || tag.length > 40) return null
                add(tag)
            }
        }
        if (tags.size != tags.distinct().size) return null
        val title = work.optString("title")
        val synopsis = work.optString("synopsis")
        val notes = work.optString("notes")
        val outline = work.optString("outline")
        if (title.length > 120 || synopsis.length > 4000 || notes.length > 8000 || outline.length > 20_000) return null
        return NovelDraft(
            id = id,
            title = title,
            synopsis = synopsis,
            type = type,
            tags = tags,
            notes = notes,
            outline = outline,
            version = version,
            chapters = parsedChapters,
            characters = peopleFrom(work.optJSONArray("characters")),
        )
    }

    private fun peopleFrom(array: JSONArray?): List<NovelPerson> {
        if (array == null) return emptyList()
        return buildList {
            for (index in 0 until array.length()) {
                val item = array.optJSONObject(index) ?: continue
                val id = item.optString("id")
                if (!idOk(id)) continue
                add(
                    NovelPerson(
                        id,
                        item.optString("name").take(120),
                        item.optString("avatar").take(2048),
                        item.optString("description").take(2000),
                        item.optString("personality").take(2000),
                        item.optString("scenario").take(2000),
                        item.optString("dialogue").take(2000),
                        item.optString("liveVoice").ifBlank { "zh_female_liuchangnv_uranus_bigtts" },
                        item.optString("speechVoice").ifBlank { "cRL5y2g9Apu45tuoclY0" },
                    ),
                )
            }
        }
    }

    private fun draftJson(draft: NovelDraft): JSONObject = JSONObject()
        .put("id", draft.id)
        .put("title", draft.title)
        .put("synopsis", draft.synopsis)
        .put("type", draft.type)
        .put("tags", JSONArray(draft.tags))
        .put("notes", draft.notes)
        .put("outline", draft.outline)
        .put("characters", JSONArray().apply {
            draft.characters.forEach { person ->
                put(JSONObject()
                    .put("id", person.id)
                    .put("name", person.name)
                    .put("avatar", person.avatar)
                    .put("description", person.description)
                    .put("personality", person.personality)
                    .put("scenario", person.scenario)
                    .put("dialogue", person.dialogue)
                    .put("liveVoice", person.liveVoice.ifBlank { "zh_female_liuchangnv_uranus_bigtts" })
                    .put("speechVoice", person.speechVoice.ifBlank { "cRL5y2g9Apu45tuoclY0" }))
            }
        })
        .put("chapters", JSONArray().apply {
            draft.chapters.forEach { put(JSONObject().put("id", it.id).put("title", it.title).put("content", it.content)) }
        })

    private fun enc(value: String) = URLEncoder.encode(value, Charsets.UTF_8.name()).replace("+", "%20")

    private fun idOk(value: String) = idPattern.matches(value)

    private companion object {
        const val MAX_BYTES = 16_000_000
        val idPattern = Regex("^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$")
    }
}
