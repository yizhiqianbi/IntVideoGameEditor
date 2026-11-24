package top.xumeng.app.core.network

import okhttp3.Call
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

/** One cookie jar for the process, matching the website session on this device. */
object XumengApi {
    private var backend: Backend? = null

    fun get(origin: String): Backend {
        val bare = origin.trimEnd('/')
        val current = backend
        if (current != null && current.origin == bare) return current
        return Backend(bare).also { backend = it }
    }
}

/** Same origin, cookies, and JSON contracts as the website. */
class Backend(origin: String) {
    val origin: String = origin.trimEnd('/')
    private val api = "${this.origin}/api/backend/v1"
    private val jsonType = "application/json; charset=utf-8".toMediaType()
    private val http = OkHttpClient.Builder()
        .cookieJar(MemoryCookies())
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .callTimeout(180, TimeUnit.SECONDS)
        .followRedirects(false)
        .build()

    fun ensureSession(): AccountRecord {
        val current = readSession(get("$api/session"))
        if (current != null) return load(current)
        return load(readSession(post("$api/auth/guest", JSONObject())) ?: throw IOException("没有建立游客会话"))
    }

    fun login(email: String, password: String): AccountRecord {
        val body = JSONObject().put("email", email).put("password", password)
        return load(readSession(post("$api/auth/login", body)) ?: throw IOException("登录没有返回账号"))
    }

    fun register(email: String, password: String, nickname: String): AccountRecord {
        val body = JSONObject().put("email", email).put("password", password)
        if (nickname.isNotBlank()) body.put("nickname", nickname)
        return load(readSession(post("$api/auth/register", body)) ?: throw IOException("注册没有返回账号"))
    }

    fun logoutToGuest(): AccountRecord {
        post("$api/auth/logout", JSONObject())
        return load(readSession(post("$api/auth/guest", JSONObject())) ?: throw IOException("没有建立游客会话"))
    }

    fun conversations(): List<Talk> = talks(get("$api/conversations").optJSONArray("conversations"))

    fun createConversation(characterId: String, version: Int, accountId: String, opening: JSONObject? = null): AccountRecord {
        val conversation = JSONObject().put("characterId", characterId)
        if (opening != null) conversation.put("opening", opening)
        val body = JSONObject()
            .put("accountId", accountId)
            .put("version", version)
            .put("conversation", conversation)
        return applyEnvelope(post("$api/conversations", body))
    }

    fun branchConversation(
        characterId: String,
        title: String,
        messages: JSONArray,
        clock: String,
        memory: JSONObject?,
        world: JSONObject?,
        opening: JSONObject?,
        version: Int,
        accountId: String,
    ): AccountRecord {
        val conversation = JSONObject()
            .put("characterId", characterId)
            .put("title", title)
            .put("worldClockMode", if (clock == "realtime") "realtime" else "story")
        if (messages.length() > 0) conversation.put("messages", messages)
        if (memory != null) conversation.put("storyMemory", memory)
        if (world != null) conversation.put("worldState", world)
        if (opening != null) conversation.put("opening", opening)
        val body = JSONObject()
            .put("accountId", accountId)
            .put("version", version)
            .put("conversation", conversation)
        return applyEnvelope(post("$api/conversations", body))
    }

    fun importConversation(raw: String, version: Int, accountId: String): Pair<AccountRecord, Boolean> {
        val parsed = top.xumeng.app.feature.chat.StoryArchive.parse(raw)
        var current = version
        if (parsed.character != null) {
            val created = applyEnvelope(
                post("$api/characters", JSONObject().put("accountId", accountId).put("version", current).put("character", parsed.character)),
            )
            current = created.version
        }
        val saved = try {
            branchConversation(
                parsed.characterId,
                parsed.title,
                parsed.messages,
                parsed.clock,
                parsed.memory,
                parsed.world,
                parsed.opening,
                current,
                accountId,
            )
        } catch (error: Exception) {
            if (parsed.character != null) {
                runCatching { delete("$api/characters/${parsed.characterId}", JSONObject().put("accountId", accountId).put("version", current)) }
            }
            throw error
        }
        return saved to parsed.unavailable
    }

    fun playableCard(id: String): JSONObject {
        val listed = runCatching { get("$api/publishing/catalog/$id").optJSONObject("character") }.getOrNull()
        val prompt = if (listed != null) runCatching { get("$api/publishing/catalog/$id/prompt") }.getOrNull() else null
        val owned = if (listed == null) {
            val custom = get("$api/state").optJSONObject("state")?.optJSONArray("custom")
            (0 until (custom?.length() ?: 0)).firstNotNullOfOrNull { index ->
                custom?.optJSONObject(index)?.takeIf { it.optString("id") == id }
            } ?: throw IOException("角色不存在或不属于当前账户")
        } else {
            null
        }
        val card = JSONObject((listed ?: owned)!!.toString())
        val extra = prompt ?: if (listed == null) null else owned
        if (extra != null) {
            val keys = extra.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                val current = if (card.has(key)) card.opt(key) else null
                if (current == null || current == JSONObject.NULL || (current is String && current.isBlank())) card.put(key, extra.get(key))
            }
        }
        card.remove("authoringDraft")
        card.remove("listPreview")
        return card
    }

    fun saveMessages(conversationId: String, messages: JSONArray, version: Int, accountId: String): AccountRecord {
        val body = JSONObject()
            .put("accountId", accountId)
            .put("version", version)
            .put("messages", messages)
        return applyEnvelope(put("$api/conversations/$conversationId/messages", body))
    }

    fun deleteConversation(conversationId: String, version: Int, accountId: String): AccountRecord {
        return applyEnvelope(delete("$api/conversations/$conversationId", JSONObject().put("accountId", accountId).put("version", version)))
    }

    fun renameConversation(conversationId: String, title: String, version: Int, accountId: String): AccountRecord {
        val body = JSONObject()
            .put("accountId", accountId)
            .put("version", version)
            .put("conversation", JSONObject().put("title", title))
        return applyEnvelope(patch("$api/conversations/$conversationId", body))
    }

    fun remember(conversationId: String, memory: String, lines: List<Line>, model: String, version: Int, accountId: String, shouldStop: () -> Boolean = { false }): Pair<AccountRecord?, String> {
        var saved: AccountRecord? = null
        var currentMemory = memory
        var currentVersion = version
        repeat(12) {
            if (shouldStop()) return saved to currentMemory
            val update = top.xumeng.app.feature.chat.MemoryPlan.select(lines, currentMemory) ?: return saved to currentMemory
            val state = summarizeMemory(update.summarize, update.previous, model)
            val packed = top.xumeng.app.feature.chat.MemoryPlan.pack(state, update.prefix)
            saved = setMemory(conversationId, packed, currentVersion, accountId)
            currentVersion = saved!!.version
            currentMemory = packed.toString()
        }
        if (top.xumeng.app.feature.chat.MemoryPlan.select(lines, currentMemory) != null) {
            throw IOException("这段历史较长，已保存整理进度。请稍后再次发送，继续整理剩余剧情。")
        }
        return saved to currentMemory
    }

    private fun summarizeMemory(messages: List<Line>, previous: JSONObject?, model: String): JSONObject {
        val payload = JSONObject()
            .put("model", model.ifBlank { "gemma31" })
            .put("messages", JSONArray().apply {
                messages.forEach { line ->
                    put(JSONObject().put("role", line.role).put("content", memoryText(line)))
                }
            })
        if (previous != null) payload.put("previousState", previous)
        val state = post("$origin/api/memory", payload).optJSONObject("state") ?: throw IOException("剧情记忆返回格式无效")
        return state
    }

    private fun memoryText(line: Line): String {
        if (line.role != "assistant") return line.text
        val stripped = line.text
            .replace(Regex("""<xumeng-panel>[\s\S]*?(?:</xumeng-panel>|$)"""), "")
            .replace(Regex("""<xumeng-moment>[\s\S]*?(?:</xumeng-moment>|$)"""), "")
            .trim()
        return stripped.ifBlank { "……" }
    }

    fun saveWorld(conversationId: String, journal: JSONObject, version: Int, accountId: String): AccountRecord {
        val body = JSONObject()
            .put("accountId", accountId)
            .put("version", version)
            .put("conversation", JSONObject().put("worldState", journal))
        return applyEnvelope(patch("$api/conversations/$conversationId", body))
    }

    private fun setMemory(conversationId: String, memory: JSONObject, version: Int, accountId: String): AccountRecord =
        saveStoryMemory(conversationId, memory, version, accountId)

    fun saveStoryMemory(conversationId: String, memory: JSONObject?, version: Int, accountId: String): AccountRecord {
        val conversation = JSONObject().put("storyMemory", memory ?: JSONObject.NULL)
        val body = JSONObject()
            .put("accountId", accountId)
            .put("version", version)
            .put("conversation", conversation)
        return applyEnvelope(patch("$api/conversations/$conversationId", body))
    }

    fun setClock(conversationId: String, mode: String, journal: JSONObject, version: Int, accountId: String): AccountRecord {
        val clock = if (mode == "realtime") "realtime" else "story"
        val body = JSONObject()
            .put("accountId", accountId)
            .put("version", version)
            .put("conversation", JSONObject().put("worldClockMode", clock).put("worldState", journal))
        return applyEnvelope(patch("$api/conversations/$conversationId", body))
    }

    fun videoUnlocks(dramaId: String): Set<String> {
        val ids = get("$api/videos/unlocks?dramaId=${java.net.URLEncoder.encode(dramaId, "UTF-8")}").optJSONArray("episodeIds") ?: return emptySet()
        return buildSet {
            for (index in 0 until ids.length()) {
                val id = ids.optString(index)
                if (id.isNotBlank()) add(id)
            }
        }
    }

    fun unlockEpisode(episodeId: String) {
        post("$api/videos/unlock", JSONObject().put("episodeId", episodeId))
    }

    fun catalogCard(id: String): PublicCard {
        val card = get("$api/publishing/catalog/$id").optJSONObject("character") ?: throw IOException("角色详情无效")
        val tags = card.optJSONArray("tags")
        return PublicCard(
            id = card.optString("id", id),
            name = card.optString("name").ifBlank { "角色" },
            author = card.optString("author"),
            description = card.optString("description"),
            personality = card.optString("personality"),
            scenario = card.optString("scenario"),
            firstMessage = card.optString("firstMessage"),
            tags = buildList {
                if (tags == null) return@buildList
                for (index in 0 until tags.length()) add(tags.optString(index))
            },
            cover = AssetUrl.resolve(origin, card.optString("cover")).orEmpty(),
            authorId = card.optJSONObject("publication")?.optString("authorId").orEmpty(),
            openings = cardLines(card.optJSONArray("openingMessages")),
            greetings = textList(card.optJSONArray("alternateGreetings"), 20),
            replies = textList(card.optJSONArray("suggestedReplies"), 12),
            appearance = card.optString("appearance"),
            interactionSettings = card.optString("interactionSettings"),
            introduction = card.optString("introduction"),
            notes = card.optString("creatorNotes"),
            gallery = textList(card.optJSONArray("gallery"), 20),
        )
    }

    fun blockedTags(): List<String> = textList(get("$api/state").optJSONObject("state")?.optJSONObject("preferences")?.optJSONArray("blockedTags"), 50)

    fun followedAuthors(): List<String> {
        val authors = get("$api/state").optJSONObject("state")?.optJSONObject("preferences")?.optJSONArray("followedAuthors") ?: return emptyList()
        return buildList {
            for (index in 0 until authors.length()) {
                val id = authors.optString(index)
                if (id.isNotBlank()) add(id)
            }
        }
    }

    fun followedShelf(): List<FollowedAuthor> {
        val ids = followedAuthors().filter { it.matches(Regex("^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$")) }.distinct().take(20)
        if (ids.isEmpty()) return emptyList()
        val names = mutableMapOf<String, String>()
        val listed = runCatching {
            get("$api/publishing/catalog?limit=40&offset=0&view=card&sort=new&authors=${ids.joinToString(",") { URLEncoder.encode(it, "UTF-8") }}")
        }.getOrNull()?.optJSONArray("characters")
        if (listed != null) {
            for (index in 0 until listed.length()) {
                val card = listed.optJSONObject(index) ?: continue
                val id = card.optJSONObject("publication")?.optString("authorId").orEmpty()
                val name = card.optString("author").trim()
                if (id.isNotBlank() && name.isNotBlank() && id !in names) names[id] = name
            }
        }
        return ids.map { FollowedAuthor(it, names[it] ?: "关注的作者") }
    }

    fun setFollow(authorId: String, follow: Boolean) {
        val root = get("$api/state")
        val accountId = ensureSession().user.id
        val authors = root.optJSONObject("state")?.optJSONObject("preferences")?.optJSONArray("followedAuthors")
        val ids = mutableListOf<String>()
        if (authors != null) {
            for (index in 0 until authors.length()) {
                val id = authors.optString(index)
                if (id.isNotBlank()) ids.add(id)
            }
        }
        if (follow) {
            if (!ids.contains(authorId) && ids.size >= 200) throw IOException("最多关注 200 位作者")
            if (!ids.contains(authorId)) ids.add(authorId)
        } else {
            ids.remove(authorId)
        }
        savePreferences(root.optInt("version"), accountId, JSONObject().put("followedAuthors", JSONArray(ids)))
    }

    fun likeStats(ids: List<String>): Map<String, LikeMark> {
        val unique = ids.filter { it.isNotBlank() && !it.contains("/") }.distinct().take(100)
        if (unique.isEmpty()) return emptyMap()
        val likes = get("$api/publishing/likes?ids=${unique.joinToString(",")}").optJSONObject("likes") ?: return emptyMap()
        return buildMap {
            unique.forEach { id ->
                val item = likes.optJSONObject(id) ?: return@forEach
                put(id, LikeMark(item.optInt("count"), item.optBoolean("liked")))
            }
        }
    }

    fun setLike(id: String, liked: Boolean): LikeMark {
        val url = "$api/publishing/likes/$id"
        val root = if (liked) put(url, JSONObject()) else delete(url, JSONObject())
        return LikeMark(root.optInt("count"), root.optBoolean("liked"))
    }

    fun catalogBriefs(ids: List<String>): List<CatalogBrief> {
        val unique = ids.filter { it.matches(Regex("^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$")) }.distinct().take(24)
        if (unique.isEmpty()) return emptyList()
        val listed = get("$api/publishing/catalog?limit=24&offset=0&view=card&ids=${unique.joinToString(",") { URLEncoder.encode(it, "UTF-8") }}").optJSONArray("characters") ?: return emptyList()
        return buildList {
            for (index in 0 until listed.length()) {
                val card = listed.optJSONObject(index) ?: continue
                val id = card.optString("id")
                val name = card.optString("name").trim()
                if (id.isNotBlank()) add(CatalogBrief(id, name.ifBlank { "角色" }))
            }
        }
    }

    fun favoriteIds(): List<String> {
        val saved = get("$api/state").optJSONObject("state")?.optJSONArray("favorites") ?: return emptyList()
        return buildList {
            for (index in 0 until saved.length()) {
                val id = saved.optString(index)
                if (id.isNotBlank()) add(id)
            }
        }
    }

    fun setFavorite(id: String, saved: Boolean, version: Int, accountId: String): AccountRecord {
        val body = JSONObject().put("accountId", accountId).put("version", version)
        val url = "$api/favorites/$id"
        return applyEnvelope(if (saved) put(url, body) else delete(url, body))
    }

    fun submissions(filter: String, offset: Int): SubmissionPage {
        val root = get("$api/publishing/mine?limit=20&offset=$offset&status=$filter")
        val rows = root.optJSONArray("publications")
        val items = buildList {
            if (rows == null) return@buildList
            for (index in 0 until rows.length()) {
                val publication = rows.optJSONObject(index) ?: continue
                val submission = publication.optJSONObject("latestSubmission") ?: continue
                val character = submission.optJSONObject("character")
                add(
                    SubmissionRow(
                        publicationId = publication.optString("id"),
                        version = publication.optInt("version"),
                        listed = publication.optBoolean("isListed"),
                        submissionId = submission.optString("id"),
                        name = character?.optString("name").orEmpty().ifBlank { "未命名角色" },
                        status = submission.optString("status"),
                        revision = submission.optInt("revision"),
                        reason = submission.optString("reason"),
                        cover = AssetUrl.resolve(origin, submission.optString("previewCoverUrl")),
                        privateCharacterId = publication.optString("privateCharacterId"),
                        createdAt = submission.optLong("createdAt"),
                        approvedRevision = publication.opt("approvedRevision") as? Number,
                    ),
                )
            }
        }
        return SubmissionPage(items, root.optInt("total", items.size), root.optBoolean("hasMore"))
    }

    fun withdrawSubmission(submissionId: String, version: Int, accountId: String) {
        post("$api/publishing/submissions/$submissionId/withdraw", JSONObject().put("version", version).put("accountId", accountId))
    }

    fun unpublish(publicationId: String, version: Int, accountId: String) {
        post("$api/publishing/publications/$publicationId/unpublish", JSONObject().put("version", version).put("accountId", accountId))
    }

    fun submitCard(accountId: String, card: OwnCard) {
        if (card.id.isBlank()) throw IOException("先保存角色，再送审")
        if (card.name.isBlank()) throw IOException("角色名不能为空")
        if (card.firstMessage.isBlank()) throw IOException("公开发布需要至少一条开场白")
        if (listOf(card.description, card.personality, card.scenario, card.systemPrompt).none { it.isNotBlank() }) {
            throw IOException("公开发布需要简介、性格、场景或系统设定")
        }
        val character = JSONObject()
            .put("id", card.id)
            .put("name", card.name.trim())
            .put("author", card.author.ifBlank { "本地创作" })
            .put("description", card.description)
            .put("personality", card.personality)
            .put("scenario", card.scenario)
            .put("tags", JSONArray(cardTags(card.tags)))
            .put("cover", card.cover.ifBlank { "/dzmm/brand/xumeng-character-placeholder.svg" })
            .put("sourceUrl", "")
            .put("sourceKind", "original")
            .put("promptOrigin", "original")
            .put("speechVoice", card.voice.ifBlank { "cRL5y2g9Apu45tuoclY0" })
        if (card.systemPrompt.isNotBlank()) character.put("systemPrompt", card.systemPrompt)
        character.put("postHistoryInstructions", card.postHistory.take(15_000))
        character.put("messageExamples", card.examples.take(15_000))
        character.put("appearance", card.appearance.take(4_000))
        character.put("interactionSettings", card.interactionSettings.take(8_000))
        putOpenings(character, card)
        putReplies(character, card)
        putProfile(character, card)
        putBook(character, card)
        putPlayChrome(character, card, clearWhenEmpty = false)
        val body = JSONObject().put("accountId", accountId).put("character", character)
        val existing = publicationFor(card.id)
        if (existing != null) body.put("publicationId", existing.first).put("version", existing.second)
        post("$api/publishing/submissions", body)
    }

    fun uploadCover(bytes: ByteArray, mime: String): String {
        val type = mime.lowercase().substringBefore(';').trim()
        if (type !in setOf("image/png", "image/jpeg", "image/webp", "image/gif")) throw IOException("封面仅支持 PNG、JPEG、WebP 或 GIF")
        if (bytes.isEmpty() || bytes.size > 5 * 1024 * 1024) throw IOException("图片不能超过 5 MB")
        val uploaded = exchange(
            Request.Builder().url("$api/media")
                .header("Accept", "application/json")
                .header("Content-Type", type)
                .post(bytes.toRequestBody(type.toMediaType())),
        )
        val url = uploaded.optString("url")
        if (!url.startsWith("/api/")) throw IOException("封面地址无效")
        return url
    }

    private fun publicationFor(privateId: String): Pair<String, Int>? {
        var offset = 0
        while (offset <= 200) {
            val page = get("$api/publishing/mine?limit=50&offset=$offset&status=all")
            val rows = page.optJSONArray("publications")
            if (rows != null) {
                for (index in 0 until rows.length()) {
                    val publication = rows.optJSONObject(index) ?: continue
                    if (publication.optString("privateCharacterId") == privateId) {
                        return publication.optString("id") to publication.optInt("version")
                    }
                }
            }
            if (!page.optBoolean("hasMore")) return null
            offset += 50
        }
        return null
    }

    fun generationDesk(accountId: String): GenerationDesk {
        val config = get("$api/generation/config")
        if (config.optString("accountId") != accountId) throw IOException("账号已改变，请重新加载生成")
        val models = config.optJSONArray("models")
        val jobs = get("$api/generation/jobs")
        if (jobs.optString("accountId") != accountId) throw IOException("账号已改变，请重新加载生成")
        return GenerationDesk(
            enabled = config.optBoolean("enabled"),
            models = buildList {
                if (models == null) return@buildList
                for (index in 0 until models.length()) {
                    val item = models.optJSONObject(index) ?: continue
                    val ratios = item.optJSONArray("aspectRatios")
                    val durations = item.optJSONArray("durations")
                    add(
                        GenerationModel(
                            id = item.optString("id"),
                            label = item.optString("label").ifBlank { item.optString("id") },
                            kind = item.optString("kind").ifBlank { "image" },
                            ratios = buildList { if (ratios != null) for (cursor in 0 until ratios.length()) add(ratios.optString(cursor)) },
                            durations = buildList { if (durations != null) for (cursor in 0 until durations.length()) add(durations.optInt(cursor)) },
                        ),
                    )
                }
            },
            jobs = parseJobs(jobs.optJSONArray("jobs")),
        )
    }

    fun quoteGeneration(accountId: String, kind: String, modelId: String, prompt: String, aspect: String, duration: Int?): GenerationQuote {
        val body = JSONObject().put("accountId", accountId).put("kind", kind).put("modelId", modelId).put("prompt", prompt).put("aspectRatio", aspect)
        if (duration != null) body.put("duration", duration)
        val quote = post("$api/generation/quote", body).optJSONObject("quote") ?: throw IOException("报价无效")
        return GenerationQuote(quote.optInt("estimatedCredits"), quote.optInt("maxCredits"))
    }

    fun createGeneration(accountId: String, kind: String, modelId: String, prompt: String, aspect: String, duration: Int?, requestId: String, maxCredits: Int): GenerationJob {
        val body = JSONObject().put("accountId", accountId).put("kind", kind).put("modelId", modelId).put("prompt", prompt).put("aspectRatio", aspect)
            .put("requestId", requestId).put("expectedMaxCredits", maxCredits)
        if (duration != null) body.put("duration", duration)
        return jobFrom(post("$api/generation/jobs", body).optJSONObject("job") ?: throw IOException("任务没有返回"))
    }

    fun deleteGeneration(accountId: String, id: String) {
        val result = delete("$api/generation/jobs/$id", JSONObject().put("accountId", accountId))
        if (result.optString("accountId") != accountId || !result.optBoolean("deleted")) throw IOException("任务没有删除")
    }

    fun studioStill(templateId: String, prompt: String, imageBase64: String, style: String): ByteArray {
        val body = JSONObject().put("templateId", templateId).put("prompt", prompt).put("style", style.ifBlank { "photo" })
        if (imageBase64.isNotBlank()) body.put("image", imageBase64)
        if (templateId == "krea2-free" && imageBase64.isBlank()) body.put("ratio", "3:4")
        return binary("$origin/api/krea2/generate", body, "image/", expectCharge = true)
    }

    fun studioVideo(templateId: String, prompt: String, imageBase64: String): ByteArray {
        val body = JSONObject().put("templateId", templateId).put("prompt", prompt).put("image", imageBase64)
        return binary("$origin/api/h3/r2v", body, "video/", expectCharge = false)
    }

    private fun binary(url: String, body: JSONObject, typePrefix: String, expectCharge: Boolean): ByteArray {
        val request = Request.Builder().url(url)
            .header("Accept", "*/*")
            .header("Content-Type", "application/json")
            .header("User-Agent", XumengHttp.userAgent)
            .post(body.toString().toRequestBody(jsonType))
            .build()
        http.newCall(request).execute().use { response ->
            val bytes = response.body?.bytes() ?: throw IOException("生成结果是空的")
            val type = response.header("Content-Type").orEmpty()
            if (response.code !in 200..299 || !type.startsWith(typePrefix)) throw IOException(errorText(bytes.toString(Charsets.UTF_8), response.code))
            if (expectCharge && response.header("X-Charged-Credits")?.toIntOrNull() != 50) throw IOException("扣费没有完成，这次没有出图")
            return bytes
        }
    }

    private fun parseJobs(array: JSONArray?): List<GenerationJob> {
        if (array == null) return emptyList()
        return buildList { for (index in 0 until array.length()) array.optJSONObject(index)?.let { add(jobFrom(it)) } }
    }

    private fun jobFrom(item: JSONObject) = GenerationJob(
        id = item.optString("id"),
        prompt = item.optString("prompt"),
        status = item.optString("status"),
        kind = item.optString("kind"),
        charged = item.optInt("chargedCredits"),
        reserved = item.optInt("reservedCredits"),
        asset = item.optString("assetUrl").takeIf { it.isNotBlank() }?.let { AssetUrl.resolve(origin, it) },
    )

    fun wallet(accountId: String): Wallet {
        val usage = get("$api/billing/usage?limit=20")
        if (usage.optString("accountId") != accountId) throw IOException("账号已改变，请重新加载余额")
        val items = usage.optJSONArray("items")
        return Wallet(
            available = usage.optInt("availableBalance"),
            reserved = usage.optInt("reservedCredits"),
            spent = usage.optInt("totalSpent"),
            lines = buildList {
                if (items == null) return@buildList
                for (index in 0 until items.length()) {
                    val item = items.optJSONObject(index) ?: continue
                    add(WalletLine(item.optString("model"), item.optString("status"), item.optInt("chargedCredits"), item.optInt("reservedCredits")))
                }
            },
        )
    }

    fun taskCenter(): TaskDesk {
        val root = get("$api/tasks")
        val points = root.optJSONObject("points")
        val tasks = root.optJSONArray("tasks")
        return TaskDesk(
            accountId = root.optString("accountId"),
            guest = root.optBoolean("isGuest"),
            balance = points?.optInt("balance") ?: 0,
            tasks = buildList {
                if (tasks == null) return@buildList
                for (index in 0 until tasks.length()) {
                    val task = tasks.optJSONObject(index) ?: continue
                    add(TaskRow(task.optString("id"), task.optString("title"), task.optString("description"), task.optInt("progress"), task.optInt("target"), task.optInt("rewardPoints"), task.optBoolean("claimable"), task.optBoolean("claimed")))
                }
            },
        )
    }

    fun membership(): Membership = membershipFrom(get("$api/subscriptions"))

    fun claimMembership(accountId: String, subscriptionId: String): Membership {
        if (subscriptionId.isBlank()) throw IOException("没有可领取的会员")
        val root = post(
            "$api/subscriptions/checkin",
            JSONObject()
                .put("accountId", accountId)
                .put("subscriptionId", subscriptionId)
                .put("requestId", java.util.UUID.randomUUID().toString()),
        )
        return membershipFrom(root)
    }

    private fun membershipFrom(root: JSONObject): Membership {
        val subscriptions = root.optJSONArray("subscriptions")
        var chosen: JSONObject? = null
        if (subscriptions != null) {
            for (index in 0 until subscriptions.length()) {
                val item = subscriptions.optJSONObject(index) ?: continue
                if (item.optString("status") == "active") {
                    chosen = item
                    break
                }
                if (chosen == null) chosen = item
            }
        }
        val checkin = root.optJSONObject("checkin")
        return Membership(
            accountId = root.optString("accountId"),
            label = chosen?.optString("label").orEmpty(),
            status = chosen?.optString("status").orEmpty(),
            expiresAt = chosen?.optLong("expiresAt") ?: 0L,
            dailyCredits = chosen?.optInt("dailyCredits") ?: 0,
            claims = chosen?.optInt("claimsCount") ?: 0,
            maxClaims = chosen?.optInt("maxClaims") ?: 0,
            subscriptionId = checkin?.optString("subscriptionId").orEmpty(),
            claimable = checkin?.optBoolean("claimable") == true,
            claimed = checkin?.optBoolean("claimed") == true,
            reward = checkin?.optInt("rewardCredits") ?: 0,
        )
    }

    fun claimTask(id: String, accountId: String) {
        post("$api/tasks/$id/claim", JSONObject().put("accountId", accountId))
    }

    fun forumPosts(category: String = "", offset: Int = 0, q: String = "", tag: String = ""): ForumPage {
        val query = buildString {
            append("$api/forum/posts?limit=20&offset=$offset")
            if (category.isNotBlank()) append("&category=").append(URLEncoder.encode(category, "UTF-8"))
            val text = q.trim().take(120)
            if (text.isNotEmpty()) append("&q=").append(URLEncoder.encode(text, "UTF-8"))
            val label = tag.trim().take(40)
            if (label.isNotEmpty()) append("&tag=").append(URLEncoder.encode(label, "UTF-8"))
        }
        val root = get(query)
        val popular = buildList {
            val array = root.optJSONArray("popularTags") ?: return@buildList
            for (index in 0 until array.length()) {
                val name = array.optJSONObject(index)?.optString("tag")?.trim().orEmpty()
                if (name.isNotEmpty()) add(name)
            }
        }
        return ForumPage(forumList(root.optJSONArray("posts")), root.optInt("total"), root.optBoolean("hasMore"), popular)
    }

    fun forumPost(id: String, offset: Int = 0): ForumThread {
        val root = get("$api/forum/posts/$id?limit=20&offset=$offset")
        val post = forumFrom(root.optJSONObject("post") ?: throw IOException("帖子无效"))
        return ForumThread(post, replyList(root.optJSONArray("replies")), root.optInt("total"), root.optBoolean("hasMore"))
    }

    fun forumReply(id: String, body: String): ForumReply {
        val reply = post("$api/forum/posts/$id/replies", JSONObject().put("body", body)).optJSONObject("reply") ?: throw IOException("回复没有返回")
        val author = reply.optJSONObject("author")
        return ForumReply(reply.optString("id"), author?.optString("nickname").orEmpty(), reply.optString("body"), author?.optString("id").orEmpty())
    }

    fun viewer(): AccountUser = ensureSession().user

    fun reportForumPost(id: String, reason: String) {
        val clean = reason.trim()
        if (clean.isEmpty() || clean.length > 1000 || clean.contains('\u0000')) throw IOException("举报说明应为不超过 1000 字的文本")
        post("$api/forum/posts/$id/report", JSONObject().put("reason", clean))
    }

    fun forumVote(id: String, value: Int): ForumPost {
        val vote = value.coerceIn(-1, 1)
        val post = put("$api/forum/posts/$id/vote", JSONObject().put("value", vote)).optJSONObject("post") ?: throw IOException("投票没有返回帖子")
        return forumFrom(post)
    }

    fun forumCreate(title: String, body: String, category: String, tags: List<String>) {
        post("$api/forum/posts", JSONObject().put("title", title).put("body", body).put("category", category).put("tags", JSONArray(forumTags(tags))))
    }

    fun updateForumPost(post: ForumPost, title: String, body: String, tags: List<String>): ForumPost {
        val payload = JSONObject()
            .put("title", title)
            .put("body", body)
            .put("category", post.category)
            .put("tags", JSONArray(forumTags(tags)))
            .put("baseUpdatedAt", post.updatedAt)
        val saved = patch("$api/forum/posts/${post.id}", payload).optJSONObject("post") ?: throw IOException("帖子没有保存")
        return forumFrom(saved)
    }

    private fun cardTags(tags: List<String>): List<String> {
        val clean = tags.map { it.trim() }.filter { it.isNotEmpty() }.distinct()
        if (clean.size > 100 || clean.any { it.length > 40 }) throw IOException("最多 100 个标签，每个不超过 40 个字符")
        return clean.ifEmpty { listOf("自定义") }
    }

    private fun forumTags(tags: List<String>): List<String> {
        val clean = tags.map { it.trim() }.filter { it.isNotEmpty() }.distinct()
        if (clean.size > 10 || clean.any { it.length > 40 }) throw IOException("最多添加 10 个标签，每个标签不超过 40 个字符")
        return clean
    }

    fun deleteForumPost(id: String) {
        val result = delete("$api/forum/posts/$id", JSONObject())
        if (!result.optBoolean("deleted")) throw IOException("帖子没有删除")
    }

    fun deleteForumReply(id: String) {
        val result = delete("$api/forum/replies/$id", JSONObject())
        if (!result.optBoolean("deleted")) throw IOException("回复没有删除")
    }

    private fun replyList(array: JSONArray?): List<ForumReply> {
        if (array == null) return emptyList()
        return buildList {
            for (index in 0 until array.length()) {
                val reply = array.optJSONObject(index) ?: continue
                val author = reply.optJSONObject("author")
                add(ForumReply(reply.optString("id"), author?.optString("nickname").orEmpty(), reply.optString("body"), author?.optString("id").orEmpty()))
            }
        }
    }

    private fun forumList(array: JSONArray?): List<ForumPost> {
        if (array == null) return emptyList()
        return buildList { for (index in 0 until array.length()) array.optJSONObject(index)?.let { add(forumFrom(it)) } }
    }

    private fun forumFrom(item: JSONObject) = ForumPost(
        id = item.optString("id"),
        title = item.optString("title"),
        body = item.optString("body"),
        category = item.optString("category"),
        author = item.optJSONObject("author")?.optString("nickname").orEmpty(),
        authorId = item.optJSONObject("author")?.optString("id").orEmpty(),
        replies = item.optInt("replyCount"),
        up = item.optInt("upvotes"),
        down = item.optInt("downvotes"),
        mine = item.optInt("myVote"),
        updatedAt = item.optLong("updatedAt"),
        tags = buildList {
            val tags = item.optJSONArray("tags") ?: return@buildList
            for (index in 0 until tags.length()) add(tags.optString(index))
        },
    )

    fun referral(): Referral {
        val root = get("$api/referral")
        return Referral(
            guest = root.optBoolean("isGuest"),
            code = root.optString("inviteCode").takeIf { !root.isNull("inviteCode") && it.isNotBlank() },
            url = root.optString("inviteUrl").takeIf { !root.isNull("inviteUrl") && it.isNotBlank() },
            invited = root.optInt("invitedCount"),
            earned = if (root.has("earnedCredits")) root.optInt("earnedCredits") else root.optInt("earnedPoints"),
            reward = if (root.has("rewardCredits")) root.optInt("rewardCredits") else root.optInt("rewardPoints"),
            opens = root.optInt("opens"),
            registrations = root.optInt("registrations"),
            chats = root.optInt("startedChats"),
            rebate = root.optInt("rebatePercent"),
        )
    }

    private fun peopleJson(people: List<NovelPerson>) = JSONArray().apply {
        people.forEach { person ->
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
    }

    private fun peopleFrom(array: JSONArray?): List<NovelPerson> {
        if (array == null) return emptyList()
        return buildList {
            for (index in 0 until array.length()) {
                val item = array.optJSONObject(index) ?: continue
                val id = item.optString("id")
                if (id.isBlank()) continue
                add(NovelPerson(id, item.optString("name"), item.optString("avatar"), item.optString("description"), item.optString("personality"), item.optString("scenario"), item.optString("dialogue"), item.optString("liveVoice").ifBlank { "zh_female_liuchangnv_uranus_bigtts" }, item.optString("speechVoice").ifBlank { "cRL5y2g9Apu45tuoclY0" }))
            }
        }
    }

    fun accountId(): String = ensureSession().user.id

    fun novelList(accountId: String): List<NovelWork> {
        val root = get("$api/novels")
        if (root.optString("accountId") != accountId) throw IOException("账号已改变，请重新加载作品")
        val array = root.optJSONArray("works") ?: return emptyList()
        return buildList {
            for (index in 0 until array.length()) {
                val item = array.optJSONObject(index) ?: continue
                val id = item.optString("id")
                if (id.isBlank()) continue
                add(NovelWork(id, item.optString("title").ifBlank { "未命名作品" }, item.optString("type").ifBlank { "novel" }, item.optInt("chapterCount"), item.optInt("wordCount"), item.optString("synopsis"), item.optLong("updatedAt")))
            }
        }
    }

    fun novel(accountId: String, workId: String): NovelDraft {
        val root = get("$api/novels/$workId")
        if (root.optString("accountId") != accountId) throw IOException("账号已改变，请重新加载作品")
        return draftFrom(root)
    }

    fun saveNovel(accountId: String, draft: NovelDraft): NovelDraft {
        val work = JSONObject()
            .put("id", draft.id)
            .put("title", draft.title)
            .put("synopsis", draft.synopsis)
            .put("type", draft.type)
            .put("tags", JSONArray(draft.tags))
            .put("notes", draft.notes)
            .put("outline", draft.outline)
            .put("characters", peopleJson(draft.characters))
            .put("chapters", JSONArray().apply {
                draft.chapters.forEach { put(JSONObject().put("id", it.id).put("title", it.title).put("content", it.content)) }
            })
        val body = JSONObject().put("accountId", accountId).put("work", work)
        val saved = if (draft.version == null) post("$api/novels", body) else put("$api/novels/${draft.id}", body.put("version", draft.version))
        if (saved.optString("accountId") != accountId) throw IOException("账号已改变，稿件仍在编辑器里")
        return draftFrom(saved)
    }

    fun deleteNovel(accountId: String, workId: String, version: Int) {
        val result = delete("$api/novels/$workId", JSONObject().put("accountId", accountId).put("version", version))
        if (result.optString("accountId") != accountId || !result.optBoolean("deleted")) throw IOException("作品没有删除")
    }

    fun gameList(accountId: String): List<GameSummary> {
        if (accountId.isBlank()) throw IOException("请先登录，再保存私人游戏。")
        return GameRules.list(gameExchange { get(gamesUrl()) }, accountId)
    }

    fun game(accountId: String, gameId: String): GameDraft {
        if (accountId.isBlank()) throw IOException("请先登录，再保存私人游戏。")
        GameRules.id(gameId)
        val detail = GameRules.detail(gameExchange { get(gamesUrl(gameId)) }, accountId)
        if (detail.id != gameId) throw IOException("返回的游戏编号无效，未覆盖当前草稿。")
        return detail
    }

    fun saveGame(accountId: String, draft: GameDraft): GameDraft {
        if (accountId.isBlank()) throw IOException("请先登录，再保存私人游戏。")
        val checked = GameRules.fields(draft)
        val version = draft.version
        if (version != null && (version < 1L || version >= GameRules.MAX_SAFE)) throw IOException("游戏版本无效，当前源码已保留。")
        val game = JSONObject()
            .put("id", checked.id)
            .put("title", checked.title)
            .put("synopsis", checked.synopsis)
            .put("source", checked.source)
        val body = JSONObject().put("accountId", accountId).put("game", game)
        if (version != null) body.put("version", version)
        if (GameRules.utf8Bytes(body.toString()) > GameRules.MAX_BODY_BYTES) throw IOException("游戏请求过大，源码已保留。请导出备份后减少内容。")
        val saved = gameExchange { if (version == null) post(gamesUrl(), body) else put(gamesUrl(checked.id), body) }
        val detail = GameRules.detail(saved, accountId)
        if (detail.id != checked.id) throw IOException("保存结果的游戏编号无效，当前源码已保留。")
        if (detail.title != checked.title || detail.synopsis != checked.synopsis || detail.source != checked.source) {
            throw IOException("保存回执的源码与本次提交不一致，当前编辑器已保留。请刷新核对或导出备份。")
        }
        return detail
    }

    fun scenarioList(accountId: String): List<ScenarioSummary> {
        if (accountId.isBlank()) throw IOException("请先登录。")
        return ScenarioRules.list(scenarioOk(accountId, scenarioSend("GET", scenariosUrl())), accountId)
    }

    fun scenario(accountId: String, scenarioId: String): ScenarioDraft {
        if (accountId.isBlank()) throw IOException("请先登录。")
        val id = ScenarioRules.id(scenarioId)
        val detail = ScenarioRules.detail(scenarioOk(accountId, scenarioSend("GET", scenariosUrl(id))), accountId)
        if (detail.id != id) throw IOException("团本编号不一致。")
        return detail
    }

    fun saveScenario(accountId: String, draft: ScenarioDraft): ScenarioDraft {
        if (accountId.isBlank()) throw IOException("请先登录。")
        val checked = ScenarioRules.prepare(draft)
        val version = draft.version
        if (version != null && (version < 1L || version > ScenarioRules.MAX_SAFE)) throw IOException("请提供当前版本。")
        val payload = ScenarioRules.requestBody(accountId, checked, version)
        if (payload.toByteArray(Charsets.UTF_8).size > ScenarioRules.MAX_BYTES) throw IOException("内容过大，当前草稿已保留。")
        val response = scenarioSend(if (version == null) "POST" else "PUT", scenariosUrl(if (version == null) null else checked.id), payload)
        if (ScenarioRules.switched(response.body, accountId)) throw IOException("账号已切换，请重新打开当前账号的团本。")
        if (response.code == 409) {
            val current = response.body?.optJSONObject("current")
            val adopted = if (current == null) null else runCatching { ScenarioRules.detail(current, accountId) }.getOrNull()
            if (adopted != null && ScenarioRules.sameContent(adopted, checked)) {
                if (adopted.id != checked.id) throw IOException("保存结果编号不一致，输入仍保留。")
                return adopted
            }
            throw IOException(response.body?.optString("error")?.takeIf { it.isNotBlank() } ?: "内容或房间已被更新。你的输入仍保留，请刷新后重试。")
        }
        val detail = ScenarioRules.detail(scenarioOk(accountId, response), accountId)
        if (detail.id != checked.id) throw IOException("保存结果编号不一致，输入仍保留。")
        return detail
    }

    private fun gamesUrl(id: String? = null): String {
        val base = "$api/games".toHttpUrl()
        if (id.isNullOrEmpty()) return base.toString()
        return base.newBuilder().addPathSegment(id).build().toString()
    }

    private fun gameExchange(block: () -> JSONObject): JSONObject {
        try {
            return block()
        } catch (error: IOException) {
            throw GameRules.transport(error)
        } catch (_: org.json.JSONException) {
            throw IOException("无法连接游戏服务，源码已保留。请导出备份后重试。")
        }
    }

    private fun scenariosUrl(id: String? = null): String {
        val base = "$api/scenarios".toHttpUrl()
        if (id.isNullOrEmpty()) return base.toString()
        return base.newBuilder().addPathSegment(id).build().toString()
    }

    private fun scenarioSend(method: String, url: String, payload: String? = null): ScenarioHttp {
        val call = try {
            val builder = Request.Builder().url(url).header("Accept", "application/json").header("User-Agent", XumengHttp.userAgent)
            val request = when (method) {
                "POST" -> builder.post(payload.orEmpty().toRequestBody(jsonType))
                "PUT" -> builder.put(payload.orEmpty().toRequestBody(jsonType))
                else -> builder.get()
            }.build()
            http.newCall(request).execute()
        } catch (_: IOException) {
            throw IOException("团本服务无法连接，输入仍保留，请重试。")
        }
        call.use { response ->
            val text = try {
                response.body?.string().orEmpty()
            } catch (_: IOException) {
                throw IOException("团本服务无法连接，输入仍保留，请重试。")
            }
            val json = if (text.isBlank()) null else runCatching { JSONObject(text) }.getOrNull()
            return ScenarioHttp(response.code, json)
        }
    }

    private fun scenarioOk(accountId: String, response: ScenarioHttp): JSONObject {
        val body = response.body
        if (ScenarioRules.switched(body, accountId)) throw IOException("账号已切换，请重新打开当前账号的团本。")
        if (response.code !in 200..299) {
            throw IOException(body?.optString("error")?.takeIf { it.isNotBlank() } ?: "操作失败，输入仍保留，请刷新后重试。")
        }
        if (body == null || body.optString("accountId") != accountId) throw IOException("团本服务返回的账号无效。")
        return body
    }

    fun streamNovel(draft: NovelDraft, operation: String, chapterId: String?, model: String, onCall: (Call) -> Unit = {}, onDelta: (String) -> Unit) {
        val work = JSONObject()
            .put("title", draft.title)
            .put("synopsis", draft.synopsis)
            .put("type", draft.type)
            .put("tags", JSONArray(draft.tags))
            .put("notes", draft.notes)
            .put("outline", draft.outline)
            .put("characters", peopleJson(draft.characters))
        val body = JSONObject()
            .put("operation", operation)
            .put("work", work)
            .put("model", model.ifBlank { "gemma31" })
            .put("maxTokens", 2048)
        if (operation == "continue") {
            val index = draft.chapters.indexOfFirst { it.id == chapterId }
            val chapter = draft.chapters.getOrNull(index) ?: throw IOException("先选择要续写的章节")
            body.put("chapter", JSONObject().put("title", chapter.title).put("content", chapter.content.takeLast(12_000)))
            val recent = draft.chapters.take(index).takeLast(2).joinToString("\n\n") { "${it.title}\n${it.content.takeLast(3000)}" }
            if (recent.isNotBlank()) body.put("recentContext", recent.takeLast(6500))
        }
        val request = Request.Builder().url("$origin/api/novel-generation")
            .header("Accept", "text/plain")
            .header("Content-Type", "application/json")
            .header("X-Xumeng-Request-Id", java.util.UUID.randomUUID().toString())
            .header("User-Agent", XumengHttp.userAgent)
            .post(body.toString().toRequestBody(jsonType))
            .build()
        val call = http.newCall(request)
        onCall(call)
        call.execute().use { response ->
            val payload = response.body ?: throw IOException("创作结果是空的")
            if (response.code !in 200..299) throw IOException(errorText(payload.string(), response.code))
            if (!response.header("Content-Type").orEmpty().startsWith("text/plain")) throw IOException("创作服务返回的格式无效，原稿未改变")
            val source = payload.source()
            val chunk = StringBuilder()
            while (!source.exhausted()) {
                source.request(1)
                chunk.appendCodePoint(source.readUtf8CodePoint())
                if (chunk.length >= 24) {
                    onDelta(chunk.toString())
                    chunk.clear()
                }
            }
            if (chunk.isNotEmpty()) onDelta(chunk.toString())
        }
    }

    private fun draftFrom(root: JSONObject): NovelDraft {
        val work = root.optJSONObject("work") ?: throw IOException("作品格式无效")
        val chapters = root.optJSONArray("chapters")
        return NovelDraft(
            id = work.optString("id"),
            title = work.optString("title"),
            synopsis = work.optString("synopsis"),
            type = work.optString("type").ifBlank { "novel" },
            tags = buildList {
                val tags = work.optJSONArray("tags") ?: return@buildList
                for (index in 0 until tags.length()) add(tags.optString(index))
            },
            notes = work.optString("notes"),
            outline = work.optString("outline"),
            version = work.optInt("version").takeIf { it > 0 },
            characters = peopleFrom(work.optJSONArray("characters")),
            chapters = buildList {
                if (chapters == null) return@buildList
                for (index in 0 until chapters.length()) {
                    val chapter = chapters.optJSONObject(index) ?: continue
                    add(NovelChapter(chapter.optString("id"), chapter.optString("title"), chapter.optString("content")))
                }
            },
        )
    }

    fun authorDesk(): AuthorDesk {
        val session = ensureSession()
        val root = get("$api/state")
        val state = root.optJSONObject("state") ?: throw IOException("账号记录无效")
        val preferences = state.optJSONObject("preferences") ?: JSONObject()
        return AuthorDesk(
            version = root.optInt("version"),
            accountId = session.user.id,
            nickname = preferences.optString("nickname").ifBlank { session.user.nickname },
            persona = preferences.optString("persona"),
            preset = preferences.optString("preset"),
            model = preferences.optString("model").ifBlank { "gemma31" },
            maxTokens = preferences.optInt("maxTokens", 1024).coerceIn(128, 4096),
            presets = jsonPresets(preferences.optJSONArray("presets")),
            cards = jsonCards(state.optJSONArray("custom")),
            blockedTags = textList(preferences.optJSONArray("blockedTags"), 50),
            bio = preferences.optString("bio").take(500),
            gender = preferences.optString("gender").takeIf { it == "male" || it == "female" || it == "other" }.orEmpty(),
            homeLayout = preferences.optString("homeLayout").takeIf { it == "single" } ?: "double",
            chatFontSize = preferences.optString("chatFontSize").takeIf { it == "small" || it == "large" || it == "xlarge" } ?: "medium",
            chatFont = preferences.optString("chatFont").takeIf { it == "serif" || it == "kai" } ?: "system",
            userBubble = hexColor(preferences.optString("userBubbleColor")),
            assistantBubble = hexColor(preferences.optString("assistantBubbleColor")),
            bubbleOpacity = preferences.optInt("bubbleOpacity", 80).takeIf { it in 20..100 } ?: 80,
            chatBackground = preferences.optString("chatBackground").takeIf { it == "plain" || it == "site" } ?: "cover",
            enterKey = preferences.optString("enterKey").takeIf { it == "send" || it == "newline" } ?: "auto",
            theme = preferences.optString("theme").takeIf { it == "light" || it == "dark" || it == "system" } ?: if (preferences.has("dark") && !preferences.optBoolean("dark", true)) "light" else "dark",
            showFloatingChat = if (preferences.has("showFloatingChat")) preferences.optBoolean("showFloatingChat") else true,
            floatingSize = preferences.optString("floatingSize").takeIf { it == "small" || it == "large" } ?: "medium",
            floatingOpacity = preferences.optInt("floatingOpacity", 100).takeIf { it in 20..100 } ?: 100,
            personas = jsonPersonas(preferences.optJSONArray("personas")),
            conversationPersonas = jsonPersonaMap(preferences.optJSONObject("conversationPersonas"), jsonPersonas(preferences.optJSONArray("personas")).map { it.id }.toSet()),
            guest = session.user.guest,
        )
    }

    fun savePreferences(version: Int, accountId: String, preferences: JSONObject): AuthorDesk {
        patch("$api/preferences", JSONObject().put("accountId", accountId).put("version", version).put("preferences", preferences))
        return authorDesk()
    }

    fun importCard(raw: String): OwnCard {
        if (raw.toByteArray(Charsets.UTF_8).size > 5_000_000) throw IOException("角色卡文件不能超过 5 MB。")
        val root = try {
            JSONObject(raw.removePrefix("\uFEFF"))
        } catch (_: Exception) {
            throw IOException("无法读取角色卡，请选择有效的 JSON 文件。")
        }
        val spec = root.optString("spec")
        if (spec.isNotEmpty() && spec != "chara_card_v2" && spec != "chara_card_v3" && spec != "xumeng_authoring_draft_v1") {
            throw IOException("暂时仅支持普通 JSON 角色卡与 SillyTavern v2、v3 角色卡。")
        }
        val source = when (spec) {
            "chara_card_v2", "chara_card_v3" -> root.optJSONObject("data") ?: throw IOException("SillyTavern v2 / v3 角色卡缺少有效的 data 对象。")
            "xumeng_authoring_draft_v1" -> root.optJSONObject("data")?.optJSONObject("character") ?: throw IOException("私人创作草稿缺少角色卡。")
            else -> root
        }
        val card = normalizeImportedCard(source).put("id", "import")
        val parsed = jsonCards(JSONArray().put(card)).firstOrNull() ?: throw IOException("角色卡缺少 name。")
        if (parsed.name.isBlank()) throw IOException("角色卡缺少 name。")
        return parsed.copy(id = "")
    }

    fun exportCard(card: OwnCard): String {
        if (card.name.isBlank()) throw IOException("角色卡缺少 name。")
        val character = JSONObject()
            .put("name", card.name.trim().take(120))
            .put("author", card.author.ifBlank { "本地创作" })
            .put("description", card.description)
            .put("personality", card.personality)
            .put("scenario", card.scenario)
            .put("tags", JSONArray(cardTags(card.tags)))
            .put("systemPrompt", card.systemPrompt.take(15_000))
            .put("postHistoryInstructions", card.postHistory.take(15_000))
            .put("messageExamples", card.examples.take(15_000))
            .put("appearance", card.appearance.take(4_000))
            .put("interactionSettings", card.interactionSettings.take(8_000))
        if (card.cover.isNotBlank()) character.put("cover", card.cover)
        putOpenings(character, card)
        putReplies(character, card)
        putProfile(character, card)
        putBook(character, card)
        putPlayChrome(character, card, clearWhenEmpty = false)
        character.put("creator_notes", card.notes.ifBlank { "用户提供的本地角色卡。" })
        val text = character.toString(2)
        if (text.toByteArray(Charsets.UTF_8).size > 5_000_000) throw IOException("导出角色卡不能超过 5 MB，请减少设定内容。")
        return text
    }

    private fun normalizeImportedCard(source: JSONObject): JSONObject {
        val card = JSONObject(source.toString())
        alias(card, "firstMessage", "first_mes")
        alias(card, "systemPrompt", "system_prompt")
        alias(card, "postHistoryInstructions", "post_history_instructions")
        alias(card, "messageExamples", "mes_example")
        alias(card, "alternateGreetings", "alternate_greetings")
        alias(card, "characterBook", "character_book")
        alias(card, "creatorNotes", "creator_notes")
        alias(card, "openingMessages", "opening_messages")
        alias(card, "author", "creator")
        if (card.optString("name").isBlank()) alias(card, "name", "nickname")
        val book = card.optJSONObject("characterBook") ?: return card
        val entries = book.opt("entries")
        if (entries is JSONObject) {
            val array = JSONArray()
            val keys = entries.keys()
            while (keys.hasNext()) {
                val item = entries.optJSONObject(keys.next())
                if (item != null) array.put(item)
            }
            book.put("entries", array)
        }
        return card
    }

    private fun alias(card: JSONObject, canonical: String, alternate: String) {
        val current = if (card.has(canonical)) card.opt(canonical) else null
        val missing = current == null || current == JSONObject.NULL || (current is String && current.isBlank())
        if (missing && card.has(alternate)) card.put(canonical, card.get(alternate))
    }

    fun saveCard(version: Int, accountId: String, card: OwnCard): AuthorDesk {
        val character = JSONObject()
            .put("name", card.name.trim())
            .put("author", card.author.ifBlank { "本地创作" })
            .put("description", card.description)
            .put("personality", card.personality)
            .put("scenario", card.scenario)
            .put("tags", JSONArray(cardTags(card.tags)))
            .put("sourceUrl", "")
            .put("sourceKind", "original")
            .put("promptOrigin", "original")
            .put("speechVoice", card.voice.ifBlank { "cRL5y2g9Apu45tuoclY0" })
        if (card.cover.isNotBlank()) character.put("cover", card.cover)
        if (card.systemPrompt.isNotBlank()) character.put("systemPrompt", card.systemPrompt)
        character.put("postHistoryInstructions", card.postHistory.take(15_000))
        character.put("messageExamples", card.examples.take(15_000))
        character.put("appearance", card.appearance.take(4_000))
        character.put("interactionSettings", card.interactionSettings.take(8_000))
        putOpenings(character, card)
        putReplies(character, card)
        putProfile(character, card)
        putBook(character, card)
        putPlayChrome(character, card, clearWhenEmpty = true)
        val body = JSONObject().put("accountId", accountId).put("version", version).put("character", character)
        if (card.id.isBlank()) post("$api/characters", body) else patch("$api/characters/${card.id}", body)
        return authorDesk()
    }

    fun deleteCard(id: String, version: Int, accountId: String): AuthorDesk {
        delete("$api/characters/$id", JSONObject().put("accountId", accountId).put("version", version))
        return authorDesk()
    }

    fun setVoice(id: String, voice: String, version: Int, accountId: String): AuthorDesk {
        val character = JSONObject().put("speechVoice", voice)
        patch("$api/characters/$id", JSONObject().put("accountId", accountId).put("version", version).put("character", character))
        return authorDesk()
    }

    fun character(id: String): StoryCharacter {
        val listed = runCatching { get("$api/publishing/catalog/$id").optJSONObject("character") }.getOrNull()
        if (listed != null) {
            val prompt = runCatching { get("$api/publishing/catalog/$id/prompt") }.getOrNull()
            return storyFrom(id, listed, prompt)
        }
        val custom = get("$api/state").optJSONObject("state")?.optJSONArray("custom")
        val owned = (0 until (custom?.length() ?: 0)).firstNotNullOfOrNull { index ->
            custom?.optJSONObject(index)?.takeIf { it.optString("id") == id }
        } ?: throw IOException("角色不存在或不属于当前账户")
        return storyFrom(id, owned, owned)
    }

    private fun storyFrom(id: String, card: JSONObject, prompt: JSONObject?): StoryCharacter = StoryCharacter(
        id = card.optString("id", id),
        name = card.optString("name").ifBlank { "角色" },
        description = card.optString("description"),
        personality = card.optString("personality"),
        scenario = card.optString("scenario"),
        firstMessage = card.optString("firstMessage"),
        systemPrompt = prompt?.optString("systemPrompt").orEmpty(),
        postHistory = prompt?.optString("postHistoryInstructions").orEmpty(),
        examples = prompt?.optString("messageExamples").orEmpty(),
        book = (prompt?.optJSONObject("characterBook") ?: card.optJSONObject("characterBook"))?.toString().orEmpty(),
        openings = cardLines(card.optJSONArray("openingMessages")),
        greetings = textList(card.optJSONArray("alternateGreetings"), 20),
        replies = textList(card.optJSONArray("suggestedReplies"), 12),
        appearance = card.optString("appearance").ifBlank { prompt?.optString("appearance").orEmpty() },
        interactionSettings = card.optString("interactionSettings").ifBlank { prompt?.optString("interactionSettings").orEmpty() },
        statusBar = (prompt?.optJSONObject("statusBar") ?: card.optJSONObject("statusBar"))?.toString().orEmpty(),
        interaction = (prompt?.optJSONObject("interactionTemplate") ?: card.optJSONObject("interactionTemplate"))?.toString().orEmpty(),
        cover = AssetUrl.resolve(origin, card.optString("cover")).orEmpty(),
    )

    private fun putBook(character: JSONObject, card: OwnCard) {
        if (!card.book && card.lore.isEmpty()) return
        val entries = JSONArray()
        card.lore.forEach { entry ->
            val keys = splitKeys(entry.keys)
            val secondary = splitKeys(entry.secondary)
            val unused = entry.content.isBlank() && entry.keys.isBlank() && entry.secondary.isBlank() && entry.name.isBlank()
            if (unused) return@forEach
            if (entry.content.isBlank()) throw IOException("世界书正文不能为空")
            if (!entry.constant && keys.isEmpty()) throw IOException("「${entry.name.ifBlank { "世界书条目" }}」需要关键词，或打开常驻")
            val item = if (entry.source.isBlank()) JSONObject() else JSONObject(entry.source)
            item.put("id", entry.id)
            item.put("keys", JSONArray().apply { keys.forEach { put(it.take(120)) } })
            if (secondary.isEmpty()) item.remove("secondaryKeys") else item.put("secondaryKeys", JSONArray().apply { secondary.forEach { put(it.take(120)) } })
            item.put("content", entry.content.take(100_000))
            item.put("constant", entry.constant)
            item.put("enabled", entry.enabled)
            item.put("selective", entry.selective)
            item.put("caseSensitive", entry.caseSensitive)
            if (entry.name.isBlank()) item.remove("name") else item.put("name", entry.name.take(120))
            if (entry.order == null) item.remove("insertionOrder") else item.put("insertionOrder", entry.order.coerceIn(0, 100_000))
            if (entry.position == "before_char" || entry.position == "after_char") item.put("position", entry.position) else item.remove("position")
            entries.put(item)
        }
        val book = if (card.bookSource.isBlank()) JSONObject() else JSONObject(card.bookSource)
        book.remove("entries")
        book.put("entries", entries)
        if (card.bookName.isBlank()) book.remove("name") else book.put("name", card.bookName.take(120))
        if (card.bookDescription.isBlank()) book.remove("description") else book.put("description", card.bookDescription.take(2_000))
        val depth = card.bookScan
        if (depth == null) book.remove("scanDepth") else {
            if (depth !in 1..40) throw IOException("世界书扫描最近消息数需要是 1–40")
            book.put("scanDepth", depth)
        }
        character.put("characterBook", book)
    }

    private fun splitKeys(value: String): List<String> = value.split(',', '，', '\n').map { it.trim() }.filter { it.isNotEmpty() }.distinct().take(20)

    private fun putOpenings(character: JSONObject, card: OwnCard) {
        val lines = card.openings.filter { (it.role == "user" || it.role == "assistant") && it.content.isNotBlank() }.take(20)
        val greetings = card.greetings.map { it.trim() }.filter { it.isNotEmpty() }.distinct().take(20)
        if (lines.any { it.content.length > 15_000 || it.content.contains('\u0000') } || greetings.any { it.length > 15_000 || it.contains('\u0000') }) {
            throw IOException("开场消息过长")
        }
        character.put("firstMessage", lines.firstOrNull { it.role == "assistant" }?.content.orEmpty())
        character.put("openingMessages", JSONArray().apply { lines.forEach { put(JSONObject().put("role", it.role).put("content", it.content)) } })
        character.put("alternateGreetings", JSONArray().apply { greetings.forEach { put(it) } })
    }

    private fun putProfile(character: JSONObject, card: OwnCard) {
        character.put("introduction", card.introduction.take(15_000))
        character.put("creatorNotes", card.notes.take(15_000))
        val gallery = card.gallery.map { imageUrl(it) }.filter { it.isNotEmpty() }.distinct().take(20)
        character.put("gallery", JSONArray().apply { gallery.forEach { put(it) } })
    }

    private fun imageUrl(value: String): String {
        val url = value.trim()
        if (url.isEmpty()) return ""
        if (url.length > 2048 || url.contains('\u0000')) throw IOException("图片地址过长")
        if (url.startsWith("/") && !url.startsWith("//")) return url
        val parsed = runCatching { java.net.URI(url) }.getOrNull() ?: throw IOException("图片地址无效")
        val scheme = parsed.scheme?.lowercase()
        if (scheme != "http" && scheme != "https") throw IOException("图片地址仅支持本地路径或 HTTP / HTTPS")
        if (!parsed.rawUserInfo.isNullOrBlank()) throw IOException("图片地址不能包含账户凭据")
        return url
    }

    private fun putReplies(character: JSONObject, card: OwnCard) {
        val replies = card.replies.map { it.trim() }.filter { it.isNotEmpty() }.take(12)
        if (replies.any { it.length > 500 || it.contains('\u0000') }) throw IOException("建议回复最多 500 字")
        character.put("suggestedReplies", JSONArray().apply { replies.forEach { put(it) } })
    }

    private fun cardLines(array: JSONArray?): List<CardLine> {
        if (array == null) return emptyList()
        return buildList {
            for (index in 0 until array.length()) {
                val item = array.optJSONObject(index) ?: continue
                val role = item.optString("role")
                val content = item.optString("content")
                if ((role == "user" || role == "assistant") && content.isNotBlank()) add(CardLine(role, content))
            }
        }.take(20)
    }

    private fun textList(array: JSONArray?, limit: Int): List<String> {
        if (array == null) return emptyList()
        return buildList {
            for (index in 0 until array.length()) {
                val value = array.optString(index).trim()
                if (value.isNotEmpty()) add(value)
            }
        }.take(limit)
    }

    private fun putPlayChrome(character: JSONObject, card: OwnCard, clearWhenEmpty: Boolean) {
        val status = statusObject(card)
        if (status != null) character.put("statusBar", status)
        else if (clearWhenEmpty) character.put("statusBar", JSONObject.NULL)
        val panels = panelObject(card.panels)
        if (panels != null) character.put("interactionTemplate", panels)
        else if (clearWhenEmpty) character.put("interactionTemplate", JSONObject.NULL)
    }

    private fun statusObject(card: OwnCard): JSONObject? {
        val template = card.statusTemplate.take(4_000)
        val initial = card.statusInitial.take(4_000)
        val rules = card.statusRules.take(8_000)
        if (template.isBlank() && initial.isBlank() && rules.isBlank()) return null
        return JSONObject().put("template", template).put("initialState", initial).put("updateRules", rules)
    }

    private fun panelObject(panels: List<StudioPanel>): JSONObject? {
        if (panels.isEmpty()) return null
        if (panels.size > 6) throw IOException("互动面板最多 6 个")
        val ids = mutableSetOf<String>()
        val titles = mutableSetOf<String>()
        val array = JSONArray()
        panels.forEach { panel ->
            val id = panel.id.trim()
            val title = panel.title.trim()
            if (!id.matches(Regex("^[A-Za-z0-9_-]{1,40}$")) || !ids.add(id)) throw IOException("面板 ID 无效或重复")
            if (title.isBlank() || title.length > 12 || !titles.add(title)) throw IOException("面板名称无效或重复")
            if (panel.fields.isEmpty() || panel.fields.size > 8) throw IOException("「$title」需要 1–8 个字段")
            val names = mutableSetOf<String>()
            val fields = JSONArray()
            panel.fields.forEach { field ->
                val name = field.name.trim()
                if (name.isBlank() || name.length > 12 || !names.add(name)) throw IOException("「$title」里的字段名无效或重复")
                if (field.type !in setOf("text", "meter", "list")) throw IOException("字段「$name」的类型无效")
                val initial = field.initial.take(200)
                val rule = field.rule.take(200)
                if (hasTag(name) || hasTag(title) || hasTag(initial) || hasTag(rule)) throw IOException("面板文字不能包含标签")
                if (field.type == "meter" && !initial.matches(Regex("^(?:100|\\d{1,2})$"))) throw IOException("进度条「$name」的初始值需要是 0–100 的整数")
                val item = JSONObject().put("name", name).put("type", field.type).put("initial", initial.trim())
                if (rule.isNotBlank()) item.put("rule", rule.trim())
                fields.put(item)
            }
            array.put(JSONObject().put("id", id).put("title", title).put("fields", fields))
        }
        return JSONObject().put("panels", array)
    }

    private fun hasTag(value: String): Boolean = Regex("""<\s*/?\s*[A-Za-z]""").containsMatchIn(value)

    private fun panelsFrom(template: JSONObject?): List<StudioPanel> {
        val panels = template?.optJSONArray("panels") ?: return emptyList()
        return buildList {
            for (index in 0 until panels.length()) {
                val panel = panels.optJSONObject(index) ?: continue
                val fields = panel.optJSONArray("fields") ?: continue
                val parsed = buildList {
                    for (cursor in 0 until fields.length()) {
                        val field = fields.optJSONObject(cursor) ?: continue
                        val name = field.optString("name")
                        val type = field.optString("type")
                        if (name.isBlank() || type !in setOf("text", "meter", "list")) continue
                        add(StudioField(name, type, field.optString("initial"), field.optString("rule")))
                    }
                }
                val id = panel.optString("id")
                val title = panel.optString("title")
                if (id.isNotBlank() && title.isNotBlank() && parsed.isNotEmpty()) add(StudioPanel(id, title, parsed))
            }
        }
    }

    private fun loreFrom(book: JSONObject?): List<LoreEntry> {
        val entries = book?.optJSONArray("entries") ?: return emptyList()
        return buildList {
            for (index in 0 until entries.length()) {
                val entry = entries.optJSONObject(index) ?: continue
                val content = entry.optString("content")
                if (content.isBlank()) continue
                val place = entry.optString("position")
                add(LoreEntry(
                    entry.optString("id").ifBlank { "lore-$index" },
                    entry.optString("name"),
                    joinKeys(entry.optJSONArray("keys")),
                    content,
                    flag(entry, "constant", "constant", false),
                    entry.toString(),
                    secondary = joinKeys(entry.optJSONArray("secondaryKeys") ?: entry.optJSONArray("secondary_keys")),
                    selective = flag(entry, "selective", "selective", false),
                    enabled = flag(entry, "enabled", "enabled", true),
                    caseSensitive = flag(entry, "caseSensitive", "case_sensitive", false),
                    order = orderOf(entry),
                    position = if (place == "before_char" || place == "after_char") place else "",
                ))
            }
        }
    }

    private fun joinKeys(array: JSONArray?): String {
        if (array == null) return ""
        return buildList {
            for (index in 0 until array.length()) add(array.optString(index))
        }.filter { it.isNotBlank() }.joinToString(", ")
    }

    private fun flag(entry: JSONObject, name: String, snake: String, default: Boolean): Boolean {
        val key = when {
            entry.has(name) -> name
            entry.has(snake) -> snake
            else -> return default
        }
        return entry.optBoolean(key, default)
    }

    private fun orderOf(entry: JSONObject): Int? {
        val raw = when {
            entry.has("insertionOrder") && !entry.isNull("insertionOrder") -> entry.opt("insertionOrder")
            entry.has("insertion_order") && !entry.isNull("insertion_order") -> entry.opt("insertion_order")
            else -> return null
        }
        val number = when (raw) {
            is Number -> raw.toDouble()
            is String -> raw.toDoubleOrNull()
            else -> null
        } ?: return null
        if (!number.isFinite()) return null
        return kotlin.math.round(number).toInt().coerceIn(0, 100_000)
    }

    private fun scanOf(book: JSONObject?): Int? {
        if (book == null) return null
        val raw = when {
            book.has("scanDepth") && !book.isNull("scanDepth") -> book.opt("scanDepth")
            book.has("scan_depth") && !book.isNull("scan_depth") -> book.opt("scan_depth")
            else -> return null
        }
        return when (raw) {
            is Number -> raw.toInt()
            is String -> raw.toIntOrNull()
            else -> null
        }
    }

    private fun jsonPersonas(array: JSONArray?): List<SavedPersona> {
        if (array == null) return emptyList()
        val seen = mutableSetOf<String>()
        return buildList {
            for (index in 0 until array.length()) {
                if (size >= 30) break
                val item = array.optJSONObject(index) ?: continue
                val id = item.optString("id").trim()
                val name = item.optString("name")
                val content = item.optString("content")
                if (id.isBlank() || id.length > 120 || seen.contains(id) || name.isBlank() || name.length > 80 || content.length > 4000) continue
                if (id.contains('\u0000') || name.contains('\u0000') || content.contains('\u0000')) continue
                seen += id
                add(SavedPersona(id, name, content))
            }
        }
    }

    private fun jsonPersonaMap(raw: JSONObject?, known: Set<String>): Map<String, String> {
        if (raw == null) return emptyMap()
        val out = linkedMapOf<String, String>()
        val keys = raw.keys()
        while (keys.hasNext()) {
            if (out.size >= 500) break
            val rawKey = keys.next()
            val key = rawKey.trim()
            val value = raw.optString(rawKey)
            if (key.isBlank() || key.length > 120 || key.contains('\u0000') || !known.contains(value)) continue
            out[key] = value
        }
        return out
    }

    private fun jsonPresets(array: JSONArray?): List<SavedPreset> {
        if (array == null) return emptyList()
        return buildList {
            for (index in 0 until array.length()) {
                val item = array.optJSONObject(index) ?: continue
                val id = item.optString("id")
                if (id.isBlank()) continue
                add(SavedPreset(id, item.optString("name"), item.optString("content")))
            }
        }
    }

    private fun cardEpoch(item: JSONObject): Long {
        if (!item.has("createdAt") || item.isNull("createdAt")) return 0
        val raw = item.opt("createdAt") ?: return 0
        val epoch = when (raw) {
            is Number -> raw.toLong()
            is String -> runCatching { java.time.Instant.parse(raw).toEpochMilli() }.getOrDefault(0)
            else -> 0
        }
        return epoch.takeIf { it > 0 } ?: 0
    }

    private fun jsonCards(array: JSONArray?): List<OwnCard> {
        if (array == null) return emptyList()
        return buildList {
            for (index in 0 until array.length()) {
                val item = array.optJSONObject(index) ?: continue
                val id = item.optString("id")
                if (id.isBlank()) continue
                val tags = buildList {
                    val values = item.optJSONArray("tags") ?: return@buildList
                    for (cursor in 0 until values.length()) add(values.optString(cursor))
                }
                val bookObject = item.optJSONObject("characterBook")
                val status = item.optJSONObject("statusBar")
                add(OwnCard(id, item.optString("name"), item.optString("author"), item.optString("cover"), item.optString("description"), item.optString("personality"), item.optString("scenario"), item.optString("firstMessage"), item.optString("systemPrompt"), item.optString("speechVoice"), tags, book = bookObject != null, bookName = bookObject?.optString("name").orEmpty(), bookSource = bookObject?.toString().orEmpty(), bookDescription = bookObject?.optString("description").orEmpty(), bookScan = scanOf(bookObject), lore = loreFrom(bookObject), statusTemplate = status?.optString("template").orEmpty(), statusInitial = status?.optString("initialState").orEmpty(), statusRules = status?.optString("updateRules").orEmpty(), panels = panelsFrom(item.optJSONObject("interactionTemplate")), openings = cardLines(item.optJSONArray("openingMessages")).ifEmpty { val first = item.optString("firstMessage"); if (first.isBlank()) emptyList() else listOf(CardLine("assistant", first)) }, greetings = textList(item.optJSONArray("alternateGreetings"), 20), replies = textList(item.optJSONArray("suggestedReplies"), 12), introduction = item.optString("introduction"), notes = item.optString("creatorNotes"), gallery = textList(item.optJSONArray("gallery"), 20), postHistory = item.optString("postHistoryInstructions"), examples = item.optString("messageExamples"), appearance = item.optString("appearance"), interactionSettings = item.optString("interactionSettings"), unfinished = item.optJSONObject("authoringDraft") != null, createdAt = cardEpoch(item)))
            }
        }
    }

    fun reply(character: StoryCharacter, messages: List<Line>, model: String, maxTokens: Int, userName: String, preset: String = "", persona: String = "", memory: JSONObject? = null, world: JSONObject? = null, onCall: (Call) -> Unit = {}, onDelta: (String) -> Unit): JSONObject? {
        val payload = JSONObject()
            .put("model", model.ifBlank { "gemma31" })
            .put("maxTokens", maxTokens.coerceIn(128, 4096))
            .put("character", character.wire())
            .put("messages", JSONArray().apply { messages.forEach { put(JSONObject().put("role", it.role).put("content", it.text)) } })
        if (memory != null) payload.put("storyMemory", memory)
        if (world != null) payload.put("world", world)
        if (preset.isNotBlank()) payload.put("preset", preset.take(8000))
        if (persona.isNotBlank()) payload.put("userPersona", persona.take(4000))
        if (userName.isNotBlank() && userName != "游客") payload.put("userName", userName.take(30))
        val request = Request.Builder().url("$origin/api/chat")
            .header("Accept", "text/event-stream")
            .header("Content-Type", "application/json")
            .header("User-Agent", XumengHttp.userAgent)
            .post(payload.toString().toRequestBody(jsonType))
            .build()
        val call = http.newCall(request)
        onCall(call)
        call.execute().use { response ->
            val body = response.body ?: throw IOException("回复是空的")
            if (response.code !in 200..299) {
                val text = body.string()
                throw IOException(errorText(text, response.code))
            }
            val framed = response.header("Content-Type").orEmpty().contains("text/event-stream")
            val source = body.source()
            if (!framed) {
                val text = source.readUtf8()
                if (text.isNotEmpty()) onDelta(text)
                return null
            }
            val data = StringBuilder()
            var worldEvent: JSONObject? = null
            var received = false
            fun take(raw: String) {
                val trimmed = raw.trim()
                if (trimmed.isEmpty() || trimmed == "[DONE]") return
                val event = runCatching { JSONObject(trimmed) }.getOrNull()
                if (event == null) return
                if (event.has("choices")) {
                    emit(trimmed, onDelta)
                    received = true
                    return
                }
                when (event.optString("type")) {
                    "text" -> {
                        val text = event.optString("text")
                        if (text.isNotEmpty()) {
                            received = true
                            onDelta(text)
                        }
                    }
                    "world" -> worldEvent = event
                    "done" -> Unit
                    "error" -> if (!received) throw IOException(event.optString("message").ifBlank { "回复中断，请重试" })
                }
            }
            while (true) {
                val line = source.readUtf8Line() ?: break
                if (line.isEmpty()) {
                    take(data.toString())
                    data.setLength(0)
                } else if (line.startsWith("data:")) {
                    if (data.isNotEmpty()) data.append('\n')
                    data.append(line.removePrefix("data:").removePrefix(" "))
                }
            }
            if (data.isNotEmpty()) take(data.toString())
            return worldEvent
        }
    }

    private fun load(user: AccountUser): AccountRecord {
        val state = get("$api/state")
        val version = state.optInt("version", 0)
        val saved = state.optJSONObject("state")
        return accountFrom(user, version, talks(saved?.optJSONArray("conversations")), saved?.optJSONObject("preferences"))
    }

    private fun applyEnvelope(json: JSONObject): AccountRecord {
        val user = readUser(json.optJSONObject("user")) ?: throw IOException("账号记录无效")
        val state = json.optJSONObject("state")
        return accountFrom(user, json.optInt("version", 0), talks(state?.optJSONArray("conversations")), state?.optJSONObject("preferences"))
    }

    private fun hexColor(value: String): String {
        val color = value.trim().lowercase()
        return if (Regex("^#[0-9a-f]{6}$").matches(color)) color else ""
    }

    private fun accountFrom(user: AccountUser, version: Int, talks: List<Talk>, preferences: JSONObject?): AccountRecord {
        val nickname = preferences?.optString("nickname").orEmpty().ifBlank { user.nickname }
        val model = preferences?.optString("model").orEmpty().ifBlank { "gemma31" }
        val tokens = preferences?.optInt("maxTokens", 1024) ?: 1024
        val personas = jsonPersonas(preferences?.optJSONArray("personas"))
        val layout = preferences?.optString("homeLayout").orEmpty()
        val fontSize = preferences?.optString("chatFontSize").orEmpty()
        val font = preferences?.optString("chatFont").orEmpty()
        val opacity = preferences?.optInt("bubbleOpacity", 80) ?: 80
        val background = preferences?.optString("chatBackground").orEmpty()
        val enter = preferences?.optString("enterKey").orEmpty()
        val namedTheme = preferences?.optString("theme").orEmpty()
        val theme = when {
            namedTheme == "light" || namedTheme == "dark" || namedTheme == "system" -> namedTheme
            preferences?.has("dark") == true && !preferences.optBoolean("dark", true) -> "light"
            else -> "dark"
        }
        val showFloatingChat = if (preferences?.has("showFloatingChat") == true) preferences.optBoolean("showFloatingChat") else true
        val floatingSize = preferences?.optString("floatingSize").orEmpty().let { if (it == "small" || it == "large") it else "medium" }
        val floatingOpacity = preferences?.optInt("floatingOpacity", 100)?.takeIf { it in 20..100 } ?: 100
        return AccountRecord(user.copy(nickname = nickname), version, talks, model, preferences?.optString("preset").orEmpty(), preferences?.optString("persona").orEmpty(), tokens.coerceIn(128, 4096), personas, jsonPersonaMap(preferences?.optJSONObject("conversationPersonas"), personas.map { it.id }.toSet()), if (layout == "single") "single" else "double", if (fontSize == "small" || fontSize == "large" || fontSize == "xlarge") fontSize else "medium", if (font == "serif" || font == "kai") font else "system", hexColor(preferences?.optString("userBubbleColor").orEmpty()), hexColor(preferences?.optString("assistantBubbleColor").orEmpty()), if (opacity in 20..100) opacity else 80, if (background == "plain" || background == "site") background else "cover", if (enter == "send" || enter == "newline") enter else "auto", theme, showFloatingChat, floatingSize, floatingOpacity)
    }

    private fun talks(array: JSONArray?): List<Talk> {
        if (array == null) return emptyList()
        return buildList {
            for (index in 0 until array.length()) {
                val item = array.optJSONObject(index) ?: continue
                val id = item.optString("id")
                val characterId = item.optString("characterId")
                if (id.isBlank() || characterId.isBlank()) continue
                val messages = item.optJSONArray("messages")
                val lines = buildList {
                    if (messages == null) return@buildList
                    for (cursor in 0 until messages.length()) {
                        val message = messages.optJSONObject(cursor) ?: continue
                        val role = message.optString("role")
                        val text = message.optString("content")
                        if ((role == "user" || role == "assistant") && text.isNotBlank()) {
                            add(Line(message.optString("id").ifBlank { "$id-$cursor" }, role, text))
                        }
                    }
                }
                val clock = item.optString("worldClockMode")
                add(Talk(id, characterId, item.optString("title").ifBlank { "对话" }, item.optLong("updatedAt"), lines, if (clock == "realtime") "realtime" else "story", item.optJSONObject("storyMemory")?.toString().orEmpty(), item.optJSONObject("worldState")?.toString().orEmpty(), item.optJSONObject("opening")?.toString().orEmpty()))
            }
        }.sortedByDescending { it.updatedAt }
    }

    private fun emit(data: String, onDelta: (String) -> Unit) {
        val trimmed = data.trim()
        if (trimmed.isEmpty() || trimmed == "[DONE]") return
        val payload = JSONObject(trimmed)
        if (payload.has("error") && !payload.isNull("error")) throw IOException("模型生成失败，请稍后重试")
        val choice = payload.optJSONArray("choices")?.optJSONObject(0) ?: return
        val content = choice.optJSONObject("delta")?.opt("content")
        val text = when (content) {
            is String -> content
            is JSONArray -> buildString { for (i in 0 until content.length()) append(content.optJSONObject(i)?.optString("text").orEmpty()) }
            else -> ""
        }
        if (text.isNotEmpty()) onDelta(text)
    }

    fun suggestions(character: StoryCharacter, messages: List<Line>, model: String, userName: String, preset: String, persona: String): List<ReplyOption> {
        if (messages.lastOrNull()?.role != "assistant") throw IOException("请等待角色完整回复后，再生成下一步建议")
        val payload = JSONObject()
            .put("model", model.ifBlank { "gemma31" })
            .put("maxTokens", 512)
            .put("character", character.wire())
            .put("messages", JSONArray().apply {
                messages.takeLast(12).forEach { put(JSONObject().put("role", it.role).put("content", it.text)) }
                put(JSONObject().put("role", "user").put("content", "为这条角色回复提供三个不同方向的下一步建议。"))
            })
        if (preset.isNotBlank()) payload.put("preset", preset.take(8000))
        if (persona.isNotBlank()) payload.put("userPersona", persona.take(4000))
        if (userName.isNotBlank() && userName != "游客") payload.put("userName", userName.take(30))
        val root = exchange(
            Request.Builder().url("$origin/api/reply-suggestions")
                .header("Accept", "application/json")
                .header("Content-Type", "application/json")
                .post(payload.toString().toRequestBody(jsonType)),
        )
        val options = root.optJSONArray("options") ?: throw IOException("建议回复格式无效")
        if (options.length() != 4) throw IOException("建议回复需要四个不同的分支")
        return buildList {
            for (index in 0 until options.length()) {
                val item = options.optJSONObject(index) ?: throw IOException("建议回复格式无效")
                add(ReplyOption(item.optString("direction"), item.optString("title"), item.optString("reply")))
            }
        }
    }

    private fun readSession(json: JSONObject): AccountUser? {
        if (json.optBoolean("authenticated", true).not() && json.isNull("user")) return null
        return readUser(json.optJSONObject("user"))
    }

    private fun readUser(json: JSONObject?): AccountUser? {
        if (json == null) return null
        val id = json.optString("id")
        if (id.isBlank()) return null
        return AccountUser(
            id = id,
            nickname = json.optString("nickname").ifBlank { "游客" },
            email = json.optString("email").takeIf { it.isNotBlank() },
            guest = json.optBoolean("isGuest"),
        )
    }

    fun generationAsset(url: String): ByteArray {
        if (!url.startsWith("$origin/api/backend/v1/generation/assets/")) throw IOException("结果地址无效")
        val request = Request.Builder().url(url)
            .header("Accept", "image/*,video/*,*/*")
            .header("User-Agent", XumengHttp.userAgent)
            .get()
            .build()
        http.newCall(request).execute().use { response ->
            val bytes = response.body?.bytes() ?: throw IOException("结果是空的")
            if (response.code !in 200..299 || bytes.isEmpty()) throw IOException(errorText(bytes.toString(Charsets.UTF_8), response.code))
            return bytes
        }
    }

    fun publicMedia(path: String): ByteArray {
        if (!path.startsWith("/assets/xumeng/") || path.contains("..") || !path.endsWith(".mp4")) throw IOException("示范地址无效")
        val request = Request.Builder().url("$origin$path")
            .header("Accept", "video/mp4,video/*")
            .header("User-Agent", XumengHttp.userAgent)
            .get()
            .build()
        http.newCall(request).execute().use { response ->
            val bytes = response.body?.bytes() ?: throw IOException("示范是空的")
            if (response.code !in 200..299 || bytes.size < 12) throw IOException("动作示范没有载入")
            return bytes
        }
    }

    fun publicAsset(path: String): ByteArray {
        if (!path.startsWith("/assets/xumeng/") || path.contains("..")) throw IOException("海报地址无效")
        val request = Request.Builder().url("$origin$path")
            .header("Accept", "image/webp,image/*")
            .header("User-Agent", XumengHttp.userAgent)
            .get()
            .build()
        http.newCall(request).execute().use { response ->
            val bytes = response.body?.bytes() ?: throw IOException("海报是空的")
            if (response.code !in 200..299 || bytes.size < 12) throw IOException("海报没有载入")
            return bytes
        }
    }

    fun chatMedia(accountId: String, conversationId: String): ChatMediaBoard {
        val assets = mutableListOf<ChatMediaAsset>()
        val pending = mutableListOf<ChatMediaPending>()
        var cursor: String? = null
        var pendingKnown = true
        var audio = true
        var image = true
        repeat(20) {
            val query = buildString {
                append("$api/chat-media?conversationId=")
                append(URLEncoder.encode(conversationId, Charsets.UTF_8.name()))
                append("&pagination=1&limit=500")
                if (!cursor.isNullOrBlank()) {
                    append("&cursor=")
                    append(URLEncoder.encode(cursor, Charsets.UTF_8.name()))
                }
            }
            val root = get(query)
            if (root.optString("accountId") != accountId || root.optString("conversationId") != conversationId) {
                throw IOException("消息素材返回格式无效，请刷新后重试。")
            }
            val features = root.optJSONObject("features")
            if (features != null) {
                audio = features.optBoolean("audio")
                image = features.optBoolean("image")
            }
            val listed = root.optJSONArray("assets")
            if (listed != null) {
                for (index in 0 until listed.length()) parseChatAsset(listed.optJSONObject(index), conversationId)?.let { assets.add(it) }
            }
            when {
                !root.has("pending") || root.isNull("pending") -> pendingKnown = false
                else -> {
                    val jobs = root.optJSONArray("pending")
                    if (jobs != null) {
                        for (index in 0 until jobs.length()) {
                            val item = jobs.optJSONObject(index) ?: continue
                            val kind = item.optString("kind")
                            val hash = item.optString("sourceHash")
                            if ((kind == "audio" || kind == "image") && hash.length == 64) {
                                pending.add(ChatMediaPending(item.optString("messageId"), kind, hash))
                            }
                        }
                    }
                }
            }
            val directory = root.optJSONObject("directory")
            val next = if (directory == null || directory.isNull("nextCursor")) "" else directory.optString("nextCursor")
            if (next.isBlank()) return ChatMediaBoard(audio, image, assets.distinctBy { it.id }, if (pendingKnown) pending else emptyList(), pendingKnown)
            cursor = next
        }
        return ChatMediaBoard(audio, image, assets.distinctBy { it.id }, if (pendingKnown) pending else emptyList(), pendingKnown)
    }

    fun generateChatMedia(accountId: String, conversationId: String, messageId: String, kind: String, regenerate: Boolean): ChatMediaAsset {
        if (kind != "audio" && kind != "image") throw IOException("消息素材暂时不可用，请稍后重试。")
        val body = JSONObject().put("accountId", accountId).put("conversationId", conversationId).put("messageId", messageId).put("kind", kind)
        if (regenerate) body.put("regenerate", true)
        val root = post("$api/chat-media/generate", body)
        if (root.optString("accountId") != accountId) throw IOException("消息素材返回格式无效，请刷新后重试。")
        return parseChatAsset(root.optJSONObject("asset"), conversationId)?.takeIf { it.messageId == messageId && it.kind == kind }
            ?: throw IOException("消息素材返回格式无效，请刷新后重试。")
    }

    fun chatMediaBytes(path: String): ByteArray {
        if (!path.startsWith("/api/backend/v1/chat-media/assets/") || path.contains("..")) throw IOException("素材地址无效")
        val request = Request.Builder().url("$origin$path")
            .header("Accept", "image/*,audio/*,*/*")
            .header("User-Agent", XumengHttp.userAgent)
            .get()
            .build()
        http.newCall(request).execute().use { response ->
            val bytes = response.body?.bytes() ?: throw IOException("素材是空的")
            if (response.code !in 200..299 || bytes.isEmpty()) throw IOException(errorText(bytes.toString(Charsets.UTF_8), response.code))
            return bytes
        }
    }

    private fun parseChatAsset(item: JSONObject?, conversationId: String): ChatMediaAsset? {
        if (item == null || item.optString("conversationId") != conversationId) return null
        val id = item.optString("id")
        val kind = item.optString("kind")
        val hash = item.optString("sourceHash")
        val url = item.optString("url")
        if (!Regex("^[A-Za-z0-9_-]+$").matches(id) || (kind != "audio" && kind != "image") || !Regex("^[a-f0-9]{64}$").matches(hash)) return null
        if (url != "/api/backend/v1/chat-media/assets/$id") return null
        return ChatMediaAsset(id, item.optString("messageId"), kind, url, hash, item.optString("mimeType"), item.optInt("audioTextChars").takeIf { item.has("audioTextChars") && !item.isNull("audioTextChars") })
    }

    private fun get(url: String): JSONObject = exchange(Request.Builder().url(url).header("Accept", "application/json").get())

    private fun post(url: String, body: JSONObject): JSONObject = exchange(
        Request.Builder().url(url).header("Accept", "application/json").post(body.toString().toRequestBody(jsonType)),
    )

    private fun put(url: String, body: JSONObject): JSONObject = exchange(
        Request.Builder().url(url).header("Accept", "application/json").put(body.toString().toRequestBody(jsonType)),
    )

    private fun patch(url: String, body: JSONObject): JSONObject = exchange(
        Request.Builder().url(url).header("Accept", "application/json").patch(body.toString().toRequestBody(jsonType)),
    )

    private fun delete(url: String, body: JSONObject): JSONObject = exchange(
        Request.Builder().url(url).header("Accept", "application/json").delete(body.toString().toRequestBody(jsonType)),
    )

    private fun exchange(builder: Request.Builder): JSONObject {
        val request = builder.header("User-Agent", XumengHttp.userAgent).build()
        http.newCall(request).execute().use { response ->
            val text = response.body?.string().orEmpty()
            if (response.code !in 200..299) throw IOException(errorText(text, response.code))
            return if (text.isBlank()) JSONObject() else JSONObject(text)
        }
    }

    private fun errorText(text: String, code: Int): String {
        val message = runCatching { JSONObject(text).optString("error") }.getOrDefault("")
        return message.ifBlank { "请求失败（$code）" }
    }
}

private class MemoryCookies : CookieJar {
    private val cookies = mutableListOf<Cookie>()

    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        this.cookies.removeAll { old -> cookies.any { it.name == old.name && it.domain == old.domain } }
        this.cookies.addAll(cookies)
    }

    override fun loadForRequest(url: HttpUrl): List<Cookie> = cookies.filter { it.matches(url) }
}

private class ScenarioHttp(val code: Int, val body: JSONObject?)

data class AccountUser(val id: String, val nickname: String, val email: String?, val guest: Boolean)

data class Membership(
    val accountId: String = "",
    val label: String = "",
    val status: String = "",
    val expiresAt: Long = 0,
    val dailyCredits: Int = 0,
    val claims: Int = 0,
    val maxClaims: Int = 0,
    val subscriptionId: String = "",
    val claimable: Boolean = false,
    val claimed: Boolean = false,
    val reward: Int = 0,
)

data class FollowedAuthor(val id: String, val name: String)

data class CatalogBrief(val id: String, val name: String)

data class AccountRecord(
    val user: AccountUser,
    val version: Int,
    val talks: List<Talk>,
    val model: String,
    val preset: String = "",
    val persona: String = "",
    val maxTokens: Int = 1024,
    val personas: List<SavedPersona> = emptyList(),
    val conversationPersonas: Map<String, String> = emptyMap(),
    val homeLayout: String = "double",
    val chatFontSize: String = "medium",
    val chatFont: String = "system",
    val userBubble: String = "",
    val assistantBubble: String = "",
    val bubbleOpacity: Int = 80,
    val chatBackground: String = "cover",
    val enterKey: String = "auto",
    val theme: String = "dark",
    val showFloatingChat: Boolean = true,
    val floatingSize: String = "medium",
    val floatingOpacity: Int = 100,
)

data class AuthorDesk(
    val version: Int,
    val accountId: String,
    val nickname: String,
    val persona: String,
    val preset: String,
    val model: String,
    val maxTokens: Int,
    val presets: List<SavedPreset>,
    val cards: List<OwnCard>,
    val blockedTags: List<String> = emptyList(),
    val personas: List<SavedPersona> = emptyList(),
    val conversationPersonas: Map<String, String> = emptyMap(),
    val bio: String = "",
    val gender: String = "",
    val homeLayout: String = "double",
    val chatFontSize: String = "medium",
    val chatFont: String = "system",
    val userBubble: String = "",
    val assistantBubble: String = "",
    val bubbleOpacity: Int = 80,
    val chatBackground: String = "cover",
    val enterKey: String = "auto",
    val theme: String = "dark",
    val showFloatingChat: Boolean = true,
    val floatingSize: String = "medium",
    val floatingOpacity: Int = 100,
    val guest: Boolean = true,
)

data class SavedPreset(val id: String, val name: String, val content: String)

data class SavedPersona(val id: String, val name: String, val content: String)

data class OwnCard(
    val id: String,
    val name: String,
    val author: String,
    val cover: String,
    val description: String,
    val personality: String,
    val scenario: String,
    val firstMessage: String,
    val systemPrompt: String,
    val voice: String,
    val tags: List<String>,
    val book: Boolean = false,
    val bookName: String = "",
    val bookSource: String = "",
    val bookDescription: String = "",
    val bookScan: Int? = null,
    val lore: List<LoreEntry> = emptyList(),
    val statusTemplate: String = "",
    val statusInitial: String = "",
    val statusRules: String = "",
    val panels: List<StudioPanel> = emptyList(),
    val openings: List<CardLine> = emptyList(),
    val greetings: List<String> = emptyList(),
    val replies: List<String> = emptyList(),
    val introduction: String = "",
    val notes: String = "",
    val gallery: List<String> = emptyList(),
    val postHistory: String = "",
    val examples: String = "",
    val appearance: String = "",
    val interactionSettings: String = "",
    val unfinished: Boolean = false,
    val createdAt: Long = 0,
)

data class CardLine(val role: String, val content: String)

data class StudioField(val name: String, val type: String, val initial: String, val rule: String = "")

data class StudioPanel(val id: String, val title: String, val fields: List<StudioField>)

data class LoreEntry(
    val id: String,
    val name: String,
    val keys: String,
    val content: String,
    val constant: Boolean,
    val source: String = "",
    val secondary: String = "",
    val selective: Boolean = false,
    val enabled: Boolean = true,
    val caseSensitive: Boolean = false,
    val order: Int? = null,
    val position: String = "",
)

data class Talk(
    val id: String,
    val characterId: String,
    val title: String,
    val updatedAt: Long,
    val lines: List<Line>,
    val clock: String = "story",
    val memory: String = "",
    val world: String = "",
    val opening: String = "",
)

data class Line(val id: String, val role: String, val text: String)

data class ChatMediaAsset(
    val id: String,
    val messageId: String,
    val kind: String,
    val url: String,
    val sourceHash: String,
    val mimeType: String,
    val audioTextChars: Int? = null,
)

data class ChatMediaPending(val messageId: String, val kind: String, val sourceHash: String)

data class ChatMediaBoard(
    val audio: Boolean,
    val image: Boolean,
    val assets: List<ChatMediaAsset>,
    val pending: List<ChatMediaPending>,
    val pendingKnown: Boolean,
)

data class ReplyOption(val direction: String, val title: String, val reply: String)

data class ForumPost(
    val id: String,
    val title: String,
    val body: String,
    val category: String,
    val author: String,
    val replies: Int,
    val up: Int = 0,
    val down: Int = 0,
    val mine: Int = 0,
    val authorId: String = "",
    val updatedAt: Long = 0,
    val tags: List<String> = emptyList(),
)

data class ForumPage(val posts: List<ForumPost>, val total: Int, val hasMore: Boolean, val popularTags: List<String> = emptyList())

data class ForumReply(val id: String, val author: String, val body: String, val authorId: String = "")

data class ForumThread(
    val post: ForumPost,
    val replies: List<ForumReply>,
    val replyTotal: Int = replies.size,
    val repliesHaveMore: Boolean = false,
)

data class Wallet(val available: Int, val reserved: Int, val spent: Int, val lines: List<WalletLine>)

data class WalletLine(val model: String, val status: String, val charged: Int, val reserved: Int)

data class TaskDesk(val accountId: String, val guest: Boolean, val balance: Int, val tasks: List<TaskRow>)

data class TaskRow(val id: String, val title: String, val description: String, val progress: Int, val target: Int, val reward: Int, val claimable: Boolean, val claimed: Boolean)

data class GenerationModel(val id: String, val label: String, val kind: String, val ratios: List<String>, val durations: List<Int>)

data class GenerationJob(val id: String, val prompt: String, val status: String, val kind: String, val charged: Int, val reserved: Int, val asset: String?)

data class GenerationQuote(val estimated: Int, val max: Int)

data class GenerationDesk(val enabled: Boolean, val models: List<GenerationModel>, val jobs: List<GenerationJob>)

data class SubmissionRow(
    val publicationId: String,
    val version: Int,
    val listed: Boolean,
    val submissionId: String,
    val name: String,
    val status: String,
    val revision: Int,
    val reason: String,
    val cover: String?,
    val privateCharacterId: String = "",
    val createdAt: Long = 0,
    val approvedRevision: Number? = null,
)

data class SubmissionPage(val rows: List<SubmissionRow>, val total: Int, val hasMore: Boolean)

data class NovelWork(val id: String, val title: String, val type: String, val chapterCount: Int, val wordCount: Int, val synopsis: String, val updatedAt: Long = 0)

data class NovelChapter(val id: String, val title: String, val content: String)

data class NovelPerson(
    val id: String,
    val name: String,
    val avatar: String,
    val description: String,
    val personality: String,
    val scenario: String,
    val dialogue: String,
    val liveVoice: String,
    val speechVoice: String = "cRL5y2g9Apu45tuoclY0",
)

data class LikeMark(val count: Int, val liked: Boolean)

data class PublicCard(
    val id: String,
    val name: String,
    val author: String,
    val description: String,
    val personality: String,
    val scenario: String,
    val firstMessage: String,
    val tags: List<String>,
    val cover: String,
    val authorId: String = "",
    val openings: List<CardLine> = emptyList(),
    val greetings: List<String> = emptyList(),
    val replies: List<String> = emptyList(),
    val appearance: String = "",
    val interactionSettings: String = "",
    val introduction: String = "",
    val notes: String = "",
    val gallery: List<String> = emptyList(),
)

data class Referral(
    val guest: Boolean,
    val code: String?,
    val url: String?,
    val invited: Int,
    val earned: Int,
    val reward: Int,
    val opens: Int,
    val registrations: Int,
    val chats: Int,
    val rebate: Int,
)

data class NovelDraft(
    val id: String,
    val title: String,
    val synopsis: String,
    val type: String,
    val tags: List<String>,
    val notes: String,
    val outline: String,
    val version: Int?,
    val chapters: List<NovelChapter>,
    val characters: List<NovelPerson> = emptyList(),
)

data class StoryCharacter(
    val id: String,
    val name: String,
    val description: String,
    val personality: String,
    val scenario: String,
    val firstMessage: String,
    val systemPrompt: String,
    val postHistory: String,
    val examples: String,
    val book: String = "",
    val statusBar: String = "",
    val interaction: String = "",
    val openings: List<CardLine> = emptyList(),
    val greetings: List<String> = emptyList(),
    val replies: List<String> = emptyList(),
    val appearance: String = "",
    val interactionSettings: String = "",
    val cover: String = "",
) {
    fun wire(): JSONObject = JSONObject().put("name", name).apply {
        if (description.isNotBlank()) put("description", description)
        if (personality.isNotBlank()) put("personality", personality)
        if (scenario.isNotBlank()) put("scenario", scenario)
        if (firstMessage.isNotBlank()) put("firstMessage", firstMessage)
        if (systemPrompt.isNotBlank()) put("systemPrompt", systemPrompt)
        if (postHistory.isNotBlank()) put("postHistoryInstructions", postHistory)
        if (examples.isNotBlank()) put("messageExamples", examples)
        if (appearance.isNotBlank()) put("appearance", appearance)
        if (interactionSettings.isNotBlank()) put("interactionSettings", interactionSettings)
        if (openings.isNotEmpty()) put("openingMessages", JSONArray().apply { openings.forEach { put(JSONObject().put("role", it.role).put("content", it.content)) } })
        if (greetings.isNotEmpty()) put("alternateGreetings", JSONArray().apply { greetings.forEach { put(it) } })
        if (book.isNotBlank()) put("characterBook", JSONObject(book))
        if (statusBar.isNotBlank()) runCatching { put("statusBar", JSONObject(statusBar)) }
        if (interaction.isNotBlank()) runCatching { put("interactionTemplate", JSONObject(interaction)) }
    }
}
