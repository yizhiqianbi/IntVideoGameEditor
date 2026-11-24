package top.xumeng.app.feature.novel

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import android.content.ClipData
import android.content.Intent
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.charset.CharacterCodingException
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.Call
import org.json.JSONArray
import org.json.JSONObject
import top.xumeng.app.BuildConfig
import top.xumeng.app.core.network.NovelChapter
import top.xumeng.app.core.network.NovelDraft
import top.xumeng.app.core.network.NovelPerson
import top.xumeng.app.core.network.NovelWork
import top.xumeng.app.core.network.XumengApi
import top.xumeng.app.shell.Ink
import top.xumeng.app.shell.Mark
import java.util.UUID

data class NovelUi(
    val loading: Boolean = true,
    val saving: Boolean = false,
    val works: List<NovelWork> = emptyList(),
    val draft: NovelDraft? = null,
    val chapterId: String? = null,
    val preview: String = "",
    val previewKind: String = "",
    val error: String? = null,
    val notice: String? = null,
    val streaming: Boolean = false,
    val dirty: Boolean = false,
    val castSources: List<CastSource> = emptyList(),
    val recoveries: List<NovelRecoveryUi> = emptyList(),
)

data class NovelRecoveryUi(
    val key: String,
    val title: String,
    val updatedAt: Long,
)

data class CastSource(
    val id: String,
    val name: String,
    val cover: String,
    val description: String,
    val personality: String,
    val scenario: String,
    val opening: String,
    val voice: String = "",
)

class NovelViewModel(application: Application) : AndroidViewModel(application) {
    private val backend = XumengApi.get(BuildConfig.WEB_ORIGIN)
    private val recoveries = NovelRecoveryStore(File(application.filesDir, "xumeng-novel-recovery"))
    private val recoveryOwnerId = UUID.randomUUID().toString()
    private val recoveryLock = Mutex()
    private var accountId: String? = null
    private var novelCall: Call? = null
    private var stopNovel = false
    private var ownRecovery: NovelRecovery? = null
    private var stashJob: Job? = null
    private var stashGeneration = 0
    private val copySources = mutableMapOf<String, MutableList<NovelRecovery>>()
    private var recoveryCache: List<NovelRecovery> = emptyList()
    private val mutable = MutableStateFlow(NovelUi())
    val state: StateFlow<NovelUi> = mutable.asStateFlow()

    init { refresh() }

    fun refresh() {
        viewModelScope.launch {
            mutable.update { it.copy(loading = true, error = null) }
            val loaded = runCatching {
                withContext(Dispatchers.IO) {
                    val id = backend.accountId()
                    id to backend.novelList(id)
                }
            }
            loaded.fold(
                onSuccess = { (id, works) ->
                    accountId = id
                    mutable.update { it.copy(loading = false, works = works) }
                    val current = mutable.value
                    if (current.dirty && current.draft != null) stash(current.draft, current.chapterId)
                    syncRecoveries()
                },
                onFailure = { error -> mutable.update { it.copy(loading = false, error = error.message ?: "作品没有载入") } },
            )
        }
    }

    private fun stash(draft: NovelDraft, chapterId: String?) {
        val owner = accountId ?: return
        val generation = ++stashGeneration
        stashJob = viewModelScope.launch {
            recoveryLock.withLock {
                if (generation != stashGeneration || mutable.value.saving) return@withLock
                val written = runCatching { withContext(Dispatchers.IO) { recoveries.write(owner, recoveryOwnerId, draft, chapterId) } }
                written.fold(
                    onSuccess = { entry -> if (generation == stashGeneration) ownRecovery = entry },
                    onFailure = {
                        mutable.update { state ->
                            if (state.error == null) state.copy(error = "无法保存恢复副本，请及时导出 JSON 备份。") else state
                        }
                    },
                )
            }
        }
    }

    private fun syncRecoveries() {
        val owner = accountId ?: return
        viewModelScope.launch {
            val loaded = runCatching { withContext(Dispatchers.IO) { recoveries.read(owner) } }
            loaded.fold(
                onSuccess = { entries ->
                    if (accountId != owner) return@fold
                    recoveryCache = entries
                    mutable.update { state ->
                        state.copy(recoveries = entries.map { entry ->
                            NovelRecoveryUi(entry.storageKey, entry.draft.title.ifBlank { "未命名作品" }, entry.updatedAt)
                        })
                    }
                },
                onFailure = {
                    mutable.update { state ->
                        if (state.error == null) state.copy(error = "无法读取恢复副本。") else state
                    }
                },
            )
        }
    }

    private suspend fun forget(entry: NovelRecovery?) {
        if (entry == null) return
        withContext(Dispatchers.IO) {
            if (!recoveries.clear(entry, recoveryOwnerId)) recoveries.dismiss(entry)
        }
        if (ownRecovery?.storageKey == entry.storageKey && ownRecovery?.raw == entry.raw) ownRecovery = null
    }

    fun open(id: String) {
        val owner = accountId ?: return
        viewModelScope.launch {
            mutable.update { it.copy(saving = true, error = null) }
            val loaded = runCatching { withContext(Dispatchers.IO) { backend.novel(owner, id) } }
            loaded.fold(
                onSuccess = { draft ->
                    ownRecovery = null
                    mutable.update { it.copy(saving = false, draft = draft, chapterId = draft.chapters.firstOrNull()?.id, dirty = false, preview = "", previewKind = "") }
                },
                onFailure = { error -> mutable.update { it.copy(saving = false, error = error.message ?: "作品没有打开") } },
            )
        }
    }

    fun close() {
        viewModelScope.launch {
            recoveryLock.withLock { }
            mutable.update { it.copy(draft = null, chapterId = null, preview = "", previewKind = "", error = null, dirty = false) }
            syncRecoveries()
        }
    }

    fun discardUnsaved() {
        val draft = mutable.value.draft ?: return
        if (mutable.value.saving) return
        viewModelScope.launch {
            stashGeneration++
            recoveryLock.withLock {
                val owner = accountId
                val entry = if (owner == null) null else withContext(Dispatchers.IO) {
                    recoveries.read(owner).find { it.ownerId == recoveryOwnerId && it.workId == draft.id }
                }
                copySources.remove(draft.id)
                forget(entry)
            }
            mutable.update { it.copy(draft = null, chapterId = null, preview = "", previewKind = "", error = null, notice = null, dirty = false) }
            syncRecoveries()
        }
    }

    fun create(type: String) {
        if (mutable.value.saving) return
        val id = UUID.randomUUID().toString()
        val chapter = NovelChapter(UUID.randomUUID().toString(), "第一章", "")
        val draft = NovelDraft(id, "", "", type, emptyList(), "", "", null, listOf(chapter))
        mutable.update { it.copy(draft = draft, chapterId = chapter.id, dirty = true, error = null, preview = "", previewKind = "") }
        stash(draft, chapter.id)
    }

    fun edit(transform: (NovelDraft) -> NovelDraft) {
        if (mutable.value.saving) return
        val draft = mutable.value.draft ?: return
        val next = transform(draft)
        mutable.update { it.copy(draft = next, dirty = true) }
        stash(next, mutable.value.chapterId)
    }

    fun selectChapter(id: String) {
        if (mutable.value.saving) return
        mutable.update { it.copy(chapterId = id) }
        val draft = mutable.value.draft ?: return
        if (mutable.value.dirty) stash(draft, id)
    }

    fun addChapter() {
        val draft = mutable.value.draft ?: return
        val chapter = NovelChapter(UUID.randomUUID().toString(), "第${draft.chapters.size + 1}章", "")
        edit { it.copy(chapters = it.chapters + chapter) }
        selectChapter(chapter.id)
    }

    fun moveChapter(id: String, direction: Int) {
        if (mutable.value.saving) return
        val draft = mutable.value.draft ?: return
        val chapters = draft.chapters.toMutableList()
        val index = chapters.indexOfFirst { it.id == id }
        val target = index + direction
        if (index < 0 || target !in chapters.indices) return
        val item = chapters.removeAt(index)
        chapters.add(target, item)
        val next = draft.copy(chapters = chapters)
        mutable.update { it.copy(draft = next, dirty = true, error = null) }
        stash(next, mutable.value.chapterId)
    }

    fun removeChapter(id: String) {
        if (mutable.value.saving) return
        val draft = mutable.value.draft ?: return
        if (draft.chapters.size <= 1) {
            mutable.update { it.copy(error = "至少保留一章") }
            return
        }
        val chapters = draft.chapters.filterNot { it.id == id }
        val chapterId = if (mutable.value.chapterId == id) chapters.firstOrNull()?.id else mutable.value.chapterId
        val next = draft.copy(chapters = chapters)
        mutable.update { it.copy(draft = next, chapterId = chapterId, dirty = true, error = null) }
        stash(next, chapterId)
    }

    fun stopGenerate() {
        if (!mutable.value.streaming) return
        stopNovel = true
        novelCall?.cancel()
    }

    fun generate(operation: String) {
        val draft = mutable.value.draft ?: return
        if (draft.title.isBlank()) {
            mutable.update { it.copy(error = "先写作品标题") }
            return
        }
        if (operation == "continue" && draft.chapters.none { it.id == mutable.value.chapterId }) {
            mutable.update { it.copy(error = "先选择要续写的章节") }
            return
        }
        if (mutable.value.streaming) return
        stopNovel = false
        viewModelScope.launch {
            mutable.update { it.copy(saving = true, streaming = true, preview = "", previewKind = operation, error = null, notice = null) }
            val written = StringBuilder()
            val result = runCatching {
                val modelName = withContext(Dispatchers.IO) { backend.ensureSession().model }
                withContext(Dispatchers.IO) {
                    backend.streamNovel(draft, operation, mutable.value.chapterId, modelName, onCall = { novelCall = it }) { delta ->
                        written.append(delta)
                        mutable.update { state -> state.copy(preview = written.toString()) }
                    }
                }
            }
            novelCall = null
            val stopped = stopNovel
            stopNovel = false
            result.fold(
                onSuccess = {
                    if (written.isBlank()) mutable.update { it.copy(saving = false, streaming = false, error = "这次没有写出内容，原稿未改变") }
                    else mutable.update { it.copy(saving = false, streaming = false) }
                },
                onFailure = { error ->
                    if (stopped) mutable.update { it.copy(saving = false, streaming = false, error = null, notice = "已停止生成，收到的内容仍保留在预览中。", previewKind = if (written.isBlank()) "" else it.previewKind) }
                    else mutable.update { it.copy(saving = false, streaming = false, error = error.message ?: "创作生成失败，原稿未改变") }
                },
            )
        }
    }

    fun acceptPreview() {
        val state = mutable.value
        val text = state.preview.trim()
        val draft = state.draft ?: return
        if (text.isEmpty() || state.saving) return
        if (state.previewKind == "outline") {
            if (text.length > 20_000) {
                mutable.update { it.copy(error = "大纲超过 20000 字，请缩短后再采用") }
                return
            }
            val next = draft.copy(outline = text)
            mutable.update { it.copy(draft = next, preview = "", previewKind = "", dirty = true, error = null, notice = "已写入稿件。") }
            stash(next, state.chapterId)
            return
        }
        val chapter = draft.chapters.find { it.id == state.chapterId }
        if (chapter == null) {
            if (draft.chapters.size >= 100) {
                mutable.update { it.copy(error = "章节已满 100 章，预览还留着") }
                return
            }
            if (text.length > 50_000) {
                mutable.update { it.copy(error = "这段超过单章 50000 字，预览还留着") }
                return
            }
            val added = NovelChapter(UUID.randomUUID().toString(), "第${draft.chapters.size + 1}章", text)
            val next = draft.copy(chapters = draft.chapters + added)
            mutable.update { it.copy(draft = next, chapterId = added.id, preview = "", previewKind = "", dirty = true, error = null, notice = "已写入稿件。") }
            stash(next, added.id)
            return
        }
        val content = chapter.content + (if (chapter.content.isBlank()) "" else "\n\n") + text
        if (content.length > 50_000) {
            mutable.update { it.copy(error = "接上这段会超过单章 50000 字") }
            return
        }
        val next = draft.copy(chapters = draft.chapters.map { item -> if (item.id == chapter.id) item.copy(content = content) else item })
        mutable.update { it.copy(draft = next, preview = "", previewKind = "", error = null, dirty = true, notice = "已写入稿件。") }
        stash(next, state.chapterId)
    }

    fun discardPreview() { mutable.update { it.copy(preview = "", previewKind = "", error = null) } }

    fun report(message: String) { mutable.update { it.copy(error = message, notice = null) } }

    fun exportJson(): String {
        val draft = mutable.value.draft ?: return ""
        return backupJson(draft)
    }

    fun recoveryBackup(key: String): String {
        val entry = recoveryCache.find { it.storageKey == key } ?: run {
            mutable.update { it.copy(notice = "这份恢复副本已更新或被放弃，请选择当前显示的版本。") }
            return ""
        }
        return backupJson(entry.draft)
    }

    private fun backupJson(draft: NovelDraft): String {
        val chapters = JSONArray()
        draft.chapters.forEach { chapters.put(JSONObject().put("id", it.id).put("title", it.title).put("content", it.content)) }
        val people = JSONArray()
        draft.characters.forEach { person ->
            people.put(JSONObject().put("id", person.id).put("name", person.name).put("avatar", person.avatar).put("description", person.description).put("personality", person.personality).put("scenario", person.scenario).put("dialogue", person.dialogue).put("liveVoice", person.liveVoice).put("speechVoice", person.speechVoice.ifBlank { "cRL5y2g9Apu45tuoclY0" }))
        }
        val work = JSONObject()
            .put("id", draft.id)
            .put("title", draft.title)
            .put("synopsis", draft.synopsis)
            .put("type", draft.type)
            .put("tags", JSONArray(draft.tags))
            .put("notes", draft.notes)
            .put("outline", draft.outline)
            .put("characters", people)
            .put("chapters", chapters)
        return JSONObject().put("schema", "xumeng-novel").put("version", 1).put("work", work).toString(2)
    }

    fun exportText(): String {
        val draft = mutable.value.draft ?: return ""
        return listOf(draft.title.ifBlank { "未命名作品" }, draft.synopsis)
            .plus(draft.chapters.mapIndexed { index, chapter -> "${chapter.title.ifBlank { "第${index + 1}章" }}\n\n${chapter.content}" })
            .filter { it.isNotBlank() }
            .joinToString("\n\n")
    }

    fun saveAsNew() {
        if (mutable.value.saving) return
        viewModelScope.launch {
            recoveryLock.withLock { }
            val draft = mutable.value.draft ?: return@launch
            val previous = ownRecovery?.takeIf { it.workId == draft.id }
            val copy = draft.copy(
                id = UUID.randomUUID().toString(),
                title = (draft.title.take(116) + "（副本）").take(120),
                version = null,
                chapters = draft.chapters.map { it.copy(id = UUID.randomUUID().toString()) },
                characters = draft.characters.map { it.copy(id = UUID.randomUUID().toString()) },
            )
            if (previous != null) copySources.getOrPut(copy.id) { mutableListOf() }.add(previous)
            mutable.update { it.copy(draft = copy, chapterId = copy.chapters.firstOrNull()?.id, dirty = true, preview = "", previewKind = "", notice = null, error = null) }
            save()
        }
    }

    fun importDraft(raw: String, filename: String = "") {
        if (mutable.value.saving) return
        if (raw.toByteArray(Charsets.UTF_8).size > 1_500_000) {
            mutable.update { it.copy(error = "导入文件不能超过 1.5 MB。") }
            return
        }
        val content = raw.removePrefix("\uFEFF")
        val parsed = runCatching {
            if (content.trimStart().startsWith("{")) draftFromJson(content) else draftFromText(content, filename)
        }
        parsed.fold(
            onSuccess = { draft ->
                mutable.update { it.copy(draft = draft, chapterId = draft.chapters.firstOrNull()?.id, dirty = true, preview = "", previewKind = "", error = null, notice = "已载入编辑器。保存后成为新的私人作品。") }
                stash(draft, draft.chapters.firstOrNull()?.id)
            },
            onFailure = { error -> mutable.update { it.copy(error = error.message ?: "请导入叙梦导出的作品 JSON 文件。") } },
        )
    }

    private fun draftFromJson(raw: String): NovelDraft {
        val root = try {
            JSONObject(raw)
        } catch (_: Exception) {
            throw IllegalArgumentException("请导入叙梦导出的作品 JSON 文件。")
        }
        val wrapped = root.has("schema") || root.has("work")
        if (wrapped && (root.optString("schema") != "xumeng-novel" || root.optInt("version") != 1)) {
            throw IllegalArgumentException("作品备份格式或版本不受支持。")
        }
        val work = if (wrapped) root.optJSONObject("work") ?: throw IllegalArgumentException("请导入叙梦导出的作品 JSON 文件。") else root
        val chapters = work.optJSONArray("chapters")
        val people = work.optJSONArray("characters")
        val title = work.optString("title").trim().take(120)
        if (title.isEmpty()) throw IllegalArgumentException("导入的作品没有标题")
        return NovelDraft(
            id = UUID.randomUUID().toString(),
            title = title,
            synopsis = work.optString("synopsis").take(4000),
            type = if (work.optString("type") == "story") "story" else "novel",
            tags = buildList {
                val values = work.optJSONArray("tags") ?: return@buildList
                for (index in 0 until values.length().coerceAtMost(20)) {
                    val tag = values.optString(index).trim().take(40)
                    if (tag.isNotEmpty()) add(tag)
                }
            }.distinct(),
            notes = work.optString("notes").take(8000),
            outline = work.optString("outline").take(20_000),
            version = null,
            characters = buildList {
                if (people == null) return@buildList
                for (index in 0 until people.length().coerceAtMost(30)) {
                    val person = people.optJSONObject(index) ?: continue
                    val name = person.optString("name").trim().take(120)
                    if (name.isBlank()) continue
                    add(NovelPerson(UUID.randomUUID().toString(), name, person.optString("avatar").take(2048), person.optString("description").take(2000), person.optString("personality").take(2000), person.optString("scenario").take(2000), person.optString("dialogue").take(2000), person.optString("liveVoice").ifBlank { "zh_female_liuchangnv_uranus_bigtts" }, person.optString("speechVoice").ifBlank { "cRL5y2g9Apu45tuoclY0" }))
                }
            },
            chapters = buildList {
                if (chapters == null || chapters.length() == 0) {
                    add(NovelChapter(UUID.randomUUID().toString(), "第一章", ""))
                    return@buildList
                }
                for (index in 0 until chapters.length().coerceAtMost(100)) {
                    val chapter = chapters.optJSONObject(index) ?: continue
                    add(NovelChapter(UUID.randomUUID().toString(), chapter.optString("title").take(120), chapter.optString("content").take(50_000)))
                }
            }.ifEmpty { listOf(NovelChapter(UUID.randomUUID().toString(), "第一章", "")) },
        )
    }

    private fun draftFromText(raw: String, filename: String): NovelDraft {
        if (raw.isBlank()) throw IllegalArgumentException("故事文件没有正文。")
        val title = filename.substringAfterLast('/').substringBeforeLast('.').ifBlank { "导入故事" }.take(120)
        val chapters = buildList {
            var start = 0
            while (start < raw.length) {
                var end = minOf(start + 50_000, raw.length)
                if (end < raw.length && raw[end - 1].isHighSurrogate()) end--
                val label = if (isEmpty()) "导入正文" else "导入正文 ${size + 1}"
                add(NovelChapter(UUID.randomUUID().toString(), label, raw.substring(start, end)))
                start = end
            }
        }
        return NovelDraft(UUID.randomUUID().toString(), title, "", "story", emptyList(), "", "", null, chapters)
    }

    fun addPerson() {
        val draft = mutable.value.draft ?: return
        if (draft.characters.size >= 30) {
            mutable.update { it.copy(error = "一部作品最多 30 位人物") }
            return
        }
        val person = NovelPerson(UUID.randomUUID().toString(), "人物${draft.characters.size + 1}", "", "", "", "", "", "zh_female_liuchangnv_uranus_bigtts")
        edit { it.copy(characters = it.characters + person) }
    }

    fun loadCastSources() {
        viewModelScope.launch {
            val loaded = runCatching { withContext(Dispatchers.IO) { backend.authorDesk().cards } }
            loaded.fold(
                onSuccess = { cards ->
                    mutable.update {
                        it.copy(castSources = cards.map { card ->
                            CastSource(card.id, card.name, card.cover, card.description, card.personality, card.scenario, card.firstMessage, card.voice)
                        }, error = null)
                    }
                },
                onFailure = { error -> mutable.update { it.copy(error = error.message ?: "角色卡没有读到") } },
            )
        }
    }

    fun importCast(id: String) {
        val source = mutable.value.castSources.find { it.id == id } ?: return
        val draft = mutable.value.draft ?: return
        if (draft.characters.size >= 30) {
            mutable.update { it.copy(error = "一部作品最多 30 位人物") }
            return
        }
        val person = NovelPerson(
            UUID.randomUUID().toString(),
            source.name.trim().take(120).ifBlank { "导入人物" },
            source.cover.take(2048),
            source.description.take(2000),
            source.personality.take(2000),
            source.scenario.take(2000),
            source.opening.take(2000),
            "zh_female_liuchangnv_uranus_bigtts",
            source.voice.ifBlank { "cRL5y2g9Apu45tuoclY0" },
        )
        edit { it.copy(characters = it.characters + person) }
        mutable.update { it.copy(notice = "已复制角色卡的形象与人物设定。可在这部作品中独立修改。", error = null) }
    }

    fun updatePerson(id: String, transform: (NovelPerson) -> NovelPerson) {
        edit { current -> current.copy(characters = current.characters.map { if (it.id == id) transform(it) else it }) }
    }

    fun removePerson(id: String) {
        edit { current -> current.copy(characters = current.characters.filterNot { it.id == id }) }
    }

    fun remove() {
        val owner = accountId ?: return
        val draft = mutable.value.draft ?: return
        val version = draft.version
        if (version == null) {
            discardUnsaved()
            return
        }
        viewModelScope.launch {
            mutable.update { it.copy(saving = true, error = null) }
            val done = runCatching { withContext(Dispatchers.IO) { backend.deleteNovel(owner, draft.id, version) } }
            done.fold(
                onSuccess = {
                    stashGeneration++
                    recoveryLock.withLock {
                        val entry = withContext(Dispatchers.IO) {
                            recoveries.read(owner).find { it.ownerId == recoveryOwnerId && it.workId == draft.id }
                        }
                        forget(entry)
                    }
                    mutable.update { it.copy(saving = false, draft = null, chapterId = null, preview = "", previewKind = "", dirty = false, notice = "私人作品已删除。") }
                    refresh()
                },
                onFailure = { error -> mutable.update { it.copy(saving = false, error = error.message ?: "作品没有删除") } },
            )
        }
    }

    fun resumeRecovery(key: String) {
        val owner = accountId ?: return
        if (mutable.value.saving || mutable.value.draft != null) return
        viewModelScope.launch {
            val latest = runCatching { withContext(Dispatchers.IO) { recoveries.read(owner) } }.getOrNull()?.find { it.storageKey == key }
            if (latest == null || accountId != owner) {
                syncRecoveries()
                mutable.update { it.copy(notice = "这份恢复副本已更新或被放弃，请选择当前显示的版本。") }
                return@launch
            }
            copySources.remove(latest.draft.id)
            mutable.update {
                it.copy(
                    draft = latest.draft,
                    chapterId = latest.chapterId,
                    dirty = true,
                    preview = "",
                    previewKind = "",
                    error = null,
                    notice = "已载入恢复稿。原恢复副本仍保留，需要时可单独放弃。",
                )
            }
            stash(latest.draft, latest.chapterId)
        }
    }

    fun dropRecovery(key: String) {
        val owner = accountId ?: return
        if (mutable.value.saving) return
        viewModelScope.launch {
            val latest = runCatching { withContext(Dispatchers.IO) { recoveries.read(owner) } }.getOrNull()?.find { it.storageKey == key }
            if (latest == null || accountId != owner) {
                syncRecoveries()
                mutable.update { it.copy(notice = "这份恢复副本已更新或被放弃，请选择当前显示的版本。") }
                return@launch
            }
            val dropped = runCatching { withContext(Dispatchers.IO) { recoveries.dismiss(latest) } }
            dropped.fold(
                onSuccess = {
                    syncRecoveries()
                    mutable.update { it.copy(notice = "已放弃所选恢复版本。其他页面继续编辑后，新版本仍会显示。", error = null) }
                },
                onFailure = { mutable.update { it.copy(error = "无法放弃这份恢复副本，内容仍保留。请先导出备份后重试。") } },
            )
        }
    }

    fun save(andLeave: Boolean = false) {
        val owner = accountId ?: return
        val draft = mutable.value.draft ?: return
        if (draft.title.isBlank()) {
            mutable.update { it.copy(error = "先写作品标题") }
            return
        }
        if (draft.characters.any { it.name.isBlank() }) {
            mutable.update { it.copy(error = "请填写人物姓名") }
            return
        }
        if (draft.characters.any { it.liveVoice !in liveVoices.map { voice -> voice.first } }) {
            mutable.update { it.copy(error = "人物通话音色无效。") }
            return
        }
        if (draft.characters.any { it.avatar.isNotBlank() && !validPortrait(it.avatar) }) {
            mutable.update { it.copy(error = "人物形象需为本站路径或 HTTPS 图片地址。") }
            return
        }
        if (mutable.value.saving) return
        viewModelScope.launch {
            mutable.update { it.copy(saving = true, error = null) }
            stashGeneration++
            val stashed = recoveryLock.withLock {
                val snapshot = mutable.value.draft ?: draft
                val chapterId = mutable.value.chapterId
                val written = runCatching { withContext(Dispatchers.IO) { recoveries.write(owner, recoveryOwnerId, snapshot, chapterId) } }.getOrNull()
                if (written != null) ownRecovery = written
                snapshot to written
            }
            val saved = runCatching { withContext(Dispatchers.IO) { backend.saveNovel(owner, stashed.first) } }
            saved.fold(
                onSuccess = { next ->
                    val migrated = copySources.remove(stashed.first.id).orEmpty()
                    forget(stashed.second)
                    migrated.forEach { forget(it) }
                    if (andLeave) {
                        mutable.update { it.copy(saving = false, draft = null, chapterId = null, preview = "", previewKind = "", dirty = false, notice = "私人作品已保存。") }
                    } else {
                        ownRecovery = null
                        mutable.update { it.copy(saving = false, draft = next, chapterId = it.chapterId ?: next.chapters.firstOrNull()?.id, dirty = false, notice = "私人作品已保存。") }
                    }
                    refresh()
                },
                onFailure = { error -> mutable.update { it.copy(saving = false, error = error.message ?: "保存失败，正文还在") } },
            )
        }
    }
}

@Composable
fun NovelScreen() {
    val model = viewModel<NovelViewModel>()
    val state by model.state.collectAsState()
    val context = LocalContext.current
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        val loaded = runCatching {
            var filename = "导入故事.txt"
            context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) filename = cursor.getString(0) ?: filename
            }
            if (!filename.endsWith(".json", true) && !filename.endsWith(".txt", true)) throw IllegalArgumentException("请选择 TXT 故事或叙梦导出的 JSON 作品。")
            val text = context.contentResolver.openInputStream(uri)?.use { input ->
                val buffer = ByteArrayOutputStream()
                val chunk = ByteArray(8192)
                var total = 0
                while (true) {
                    val count = input.read(chunk)
                    if (count < 0) break
                    total += count
                    if (total > 1_500_000) throw IllegalArgumentException("导入文件不能超过 1.5 MB。")
                    buffer.write(chunk, 0, count)
                }
                val decoder = Charsets.UTF_8.newDecoder()
                    .onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
                    .onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT)
                try {
                    decoder.decode(java.nio.ByteBuffer.wrap(buffer.toByteArray())).toString()
                } catch (_: CharacterCodingException) {
                    throw IllegalArgumentException("文件不是有效的 UTF-8 文本，请先另存为 UTF-8，再导入。")
                }
            } ?: throw IllegalArgumentException("导入失败。")
            filename to text
        }
        loaded.fold(
            onSuccess = { (filename, text) -> model.importDraft(text, filename) },
            onFailure = { model.report(it.message ?: "导入失败。") },
        )
    }
    if (state.draft == null) NovelList(state, model::refresh, model::open, model::create, model::resumeRecovery, model::dropRecovery, { key ->
        val body = model.recoveryBackup(key)
        if (body.isNotBlank()) {
            val title = state.recoveries.find { it.key == key }?.title?.ifBlank { "未命名作品" } ?: "未命名作品"
            val filename = title.replace(Regex("""[\\/:*?"<>|\s]+"""), "_").take(40).ifBlank { "未命名作品" }
            runCatching { shareNovel(context, "$filename.json", body, "application/json") }.onFailure { model.report(it.message ?: "导出失败。") }
        }
    }) { picker.launch("*/*") }
    else NovelEditor(state, model, { name, body, mime ->
        runCatching { shareNovel(context, name, body, mime) }.onFailure { model.report(it.message ?: "导出失败。") }
    }) { picker.launch("*/*") }
}

@Composable
private fun NovelList(
    state: NovelUi,
    refresh: () -> Unit,
    open: (String) -> Unit,
    create: (String) -> Unit,
    resume: (String) -> Unit,
    drop: (String) -> Unit,
    exportRecovery: (String) -> Unit,
    import: () -> Unit,
) {
    var dropping by remember { mutableStateOf<NovelRecoveryUi?>(null) }
    Box(Modifier.fillMaxSize().background(Ink.background)) {
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Mark("book", size = 22.dp, color = Ink.accent)
            Text("小说创作", color = Ink.text, fontSize = 22.sp, modifier = Modifier.padding(start = 10.dp).weight(1f))
        }
        Row(Modifier.padding(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Text("新小说", color = Ink.text, modifier = Modifier.clickable { create("novel") }.padding(vertical = 8.dp))
            Text("新故事", color = Ink.text, modifier = Modifier.clickable { create("story") }.padding(vertical = 8.dp))
            Text("导入新作品", color = Ink.accent, modifier = Modifier.clickable(onClick = import).padding(vertical = 8.dp))
        }
        state.notice?.let { Text(it, color = Ink.accent, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp)) }
        if (state.saving) Text("正在读取作品", color = Ink.muted, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp))
        if (state.error != null && (state.works.isNotEmpty() || state.recoveries.isNotEmpty())) Text(state.error, color = Color(0xFFFF8AA3), fontSize = 13.sp, modifier = Modifier.padding(horizontal = 20.dp))
        LazyColumn(Modifier.weight(1f)) {
            if (state.recoveries.isNotEmpty()) {
                item {
                    Text("小说恢复副本", color = Ink.text, fontSize = 16.sp, modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp))
                    Text("恢复副本分别保留。继续编辑会载入一份独立稿件；原副本可单独导出或放弃。", color = Ink.muted, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp))
                }
                items(state.recoveries, key = { it.key }) { entry ->
                    Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 10.dp)) {
                        Text(entry.title, color = Ink.text, fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text("${recoveryStamp(entry.updatedAt)} · 恢复副本", color = Ink.muted, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                            Text("继续编辑", color = Ink.accent, modifier = Modifier.clickable(enabled = !state.saving) { resume(entry.key) }.padding(vertical = 8.dp))
                            Text("导出备份", color = Ink.muted, modifier = Modifier.clickable(enabled = !state.saving) { exportRecovery(entry.key) }.padding(vertical = 8.dp))
                            Text("放弃此恢复版本", color = Color(0xFFFF8AA3), modifier = Modifier.clickable(enabled = !state.saving) { dropping = entry }.padding(vertical = 8.dp))
                        }
                    }
                }
            }
            when {
                state.loading && state.works.isEmpty() -> item { Text("正在读取作品", color = Ink.muted, modifier = Modifier.padding(20.dp)) }
                state.error != null && state.works.isEmpty() && state.recoveries.isEmpty() -> item {
                    Text(state.error, color = Ink.muted, modifier = Modifier.clickable(onClick = refresh).padding(20.dp))
                }
                state.works.isEmpty() -> item { Text("还没有作品", color = Ink.muted, modifier = Modifier.padding(20.dp)) }
                else -> items(state.works, key = { it.id }) { work ->
                    Column(Modifier.fillMaxWidth().clickable { open(work.id) }.padding(horizontal = 20.dp, vertical = 14.dp)) {
                        Text(work.title, color = Ink.text, fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text("${if (work.type == "story") "故事" else "小说"} · ${work.chapterCount} 章 · ${work.wordCount} 字", color = Ink.muted, fontSize = 13.sp)
                    }
                }
            }
        }
    }
    dropping?.let { entry ->
        Box(Modifier.fillMaxSize().background(Color(0xAA000000)).clickable { dropping = null })
        Column(Modifier.align(Alignment.Center).padding(28.dp).background(Ink.surface, RoundedCornerShape(12.dp)).padding(20.dp)) {
            Text("放弃这份恢复副本？", color = Ink.text, fontSize = 18.sp)
            Text("只放弃所选恢复版本。其他作品和其他页面的修改会保留；来源继续编辑后，新版本仍可恢复。", color = Ink.muted, fontSize = 14.sp, modifier = Modifier.padding(top = 10.dp))
            Row(Modifier.padding(top = 16.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                Text("取消", color = Ink.muted, modifier = Modifier.clickable { dropping = null }.padding(vertical = 8.dp))
                Text("确认放弃恢复版本", color = Color(0xFFFF8AA3), modifier = Modifier.clickable(enabled = !state.saving) {
                    dropping = null
                    drop(entry.key)
                }.padding(vertical = 8.dp))
            }
        }
    }
    }
}

private fun recoveryStamp(epochMillis: Long): String =
    java.time.format.DateTimeFormatter.ofPattern("M月d日 HH:mm", java.util.Locale.CHINA)
        .withZone(java.time.ZoneId.of("Asia/Shanghai"))
        .format(java.time.Instant.ofEpochMilli(epochMillis))

@Composable
private fun NovelEditor(state: NovelUi, model: NovelViewModel, share: (String, String, String) -> Unit, importFile: () -> Unit) {
    val draft = state.draft ?: return
    val chapter = draft.chapters.find { it.id == state.chapterId } ?: draft.chapters.firstOrNull()
    var confirm by remember { mutableStateOf<String?>(null) }
    Box(Modifier.fillMaxSize().background(Ink.background)) {
    Column(Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp)) {
        var importing by rememberSaveable { mutableStateOf(false) }
        var reading by rememberSaveable(draft.id) { mutableStateOf(false) }
        var importText by rememberSaveable { mutableStateOf("") }
        val filename = draft.title.ifBlank { "未命名作品" }.replace(Regex("""[\\/:*?"<>|\s]+"""), "_").take(40)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("作品", color = Ink.muted, modifier = Modifier.clickable(enabled = !state.saving) {
                if (state.dirty || state.preview.isNotBlank()) confirm = "leave" else model.close()
            }.padding(vertical = 8.dp, horizontal = 4.dp))
            Text(if (state.saving) "正在保存" else "保存", color = Ink.text, modifier = Modifier.clickable(enabled = !state.saving) { model.save() }.padding(8.dp))
            Text("另存为新作品", color = Ink.muted, modifier = Modifier.clickable(enabled = !state.saving) { model.saveAsNew() }.padding(8.dp))
            Text("加一章", color = Ink.muted, modifier = Modifier.clickable { model.addChapter() }.padding(8.dp))
            Text(if (draft.version == null) "放弃" else "删除", color = Color(0xFFFF8AA3), modifier = Modifier.clickable(enabled = !state.saving) { confirm = "work" }.padding(8.dp))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("导出 TXT", color = Ink.accent, modifier = Modifier.clickable { share("$filename.txt", model.exportText(), "text/plain") }.padding(vertical = 6.dp))
            Text("导出 JSON", color = Ink.accent, modifier = Modifier.clickable { share("$filename.json", model.exportJson(), "application/json") }.padding(vertical = 6.dp))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("生成大纲", color = Ink.accent, modifier = Modifier.clickable(enabled = !state.saving) { model.generate("outline") }.padding(vertical = 6.dp))
            Text("续写本章", color = Ink.accent, modifier = Modifier.clickable(enabled = !state.saving) { model.generate("continue") }.padding(vertical = 6.dp))
            if (state.streaming) Text("停止", color = Ink.accent, modifier = Modifier.clickable { model.stopGenerate() }.padding(vertical = 6.dp))
            Text(if (importing) "收起导入" else "导入", color = Ink.muted, modifier = Modifier.clickable { importing = !importing }.padding(vertical = 6.dp))
            Text(if (reading) "返回编辑" else "阅读作品", color = Ink.accent, modifier = Modifier.clickable { reading = !reading }.padding(vertical = 6.dp))
        }
        if (reading) NovelReading(draft, state.dirty)
        if (!reading) {
        Field("标题", draft.title) { value -> model.edit { it.copy(title = value.take(120)) } }
        Text("作品类型", color = Ink.muted, fontSize = 12.sp, modifier = Modifier.padding(top = 10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Text("小说", color = if (draft.type != "story") Ink.accent else Ink.text, modifier = Modifier.clickable { model.edit { it.copy(type = "novel") } }.padding(vertical = 6.dp))
            Text("故事", color = if (draft.type == "story") Ink.accent else Ink.text, modifier = Modifier.clickable { model.edit { it.copy(type = "story") } }.padding(vertical = 6.dp))
        }
        Field("简介", draft.synopsis) { value -> model.edit { it.copy(synopsis = value.take(4000)) } }
        var tags by rememberSaveable(draft.id) { mutableStateOf(draft.tags.joinToString("，")) }
        Field("标签", tags) { value ->
            tags = value.take(900)
            val parsed = tags.split(',', '，').map { it.trim() }.filter { it.isNotEmpty() }.distinct().take(20).map { it.take(40) }
            model.edit { it.copy(tags = parsed) }
        }
        Field("创作指令", draft.notes, lines = 3) { value -> model.edit { it.copy(notes = value.take(8000)) } }
        Field("大纲", draft.outline, lines = 6) { value -> model.edit { it.copy(outline = value.take(20_000)) } }
        Text("人物", color = Ink.text, fontSize = 16.sp, modifier = Modifier.padding(top = 14.dp))
        var pickingCast by rememberSaveable { mutableStateOf(false) }
        Text(if (pickingCast) "收起角色卡" else "从角色卡导入", color = Ink.accent, modifier = Modifier.clickable {
            pickingCast = !pickingCast
            if (pickingCast) model.loadCastSources()
        }.padding(vertical = 6.dp))
        if (pickingCast) {
            if (state.castSources.isEmpty()) Text("还没有可导入的角色卡", color = Ink.muted, fontSize = 13.sp)
            state.castSources.forEach { card ->
                Text(card.name.ifBlank { "未命名角色" }, color = Ink.text, modifier = Modifier.clickable {
                    model.importCast(card.id)
                    pickingCast = false
                }.padding(vertical = 4.dp))
            }
        }
        draft.characters.forEach { person ->
            Field("姓名", person.name) { value -> model.updatePerson(person.id) { it.copy(name = value.take(120)) } }
            Field("背景", person.description, lines = 2) { value -> model.updatePerson(person.id) { it.copy(description = value.take(2000)) } }
            Field("性格", person.personality, lines = 2) { value -> model.updatePerson(person.id) { it.copy(personality = value.take(2000)) } }
            Field("初始场景", person.scenario, lines = 2) { value -> model.updatePerson(person.id) { it.copy(scenario = value.take(2000)) } }
            Field("台词示例", person.dialogue, lines = 2) { value -> model.updatePerson(person.id) { it.copy(dialogue = value.take(2000)) } }
            Field("形象图片", person.avatar) { value -> model.updatePerson(person.id) { it.copy(avatar = value.take(2048)) } }
            Text("导入角色卡会带入封面，也可以填写自己的图片地址。", color = Ink.muted, fontSize = 12.sp)
            Text("通话音色", color = Ink.muted, fontSize = 12.sp, modifier = Modifier.padding(top = 8.dp))
            liveVoices.forEach { (id, label) ->
                Text(label, color = if (person.liveVoice == id) Ink.accent else Ink.text, fontSize = 14.sp, modifier = Modifier.clickable { model.updatePerson(person.id) { it.copy(liveVoice = id) } }.padding(vertical = 3.dp))
            }
            Text("朗读音色", color = Ink.muted, fontSize = 12.sp, modifier = Modifier.padding(top = 8.dp))
            if (speechVoices.none { it.first == person.speechVoice }) {
                Text(person.speechVoice.ifBlank { "晚灯 · 默认" }, color = Ink.accent, fontSize = 14.sp, modifier = Modifier.padding(vertical = 3.dp))
            }
            speechVoices.forEach { (id, label) ->
                Text(label, color = if (person.speechVoice == id) Ink.accent else Ink.text, fontSize = 14.sp, modifier = Modifier.clickable { model.updatePerson(person.id) { it.copy(speechVoice = id) } }.padding(vertical = 3.dp))
            }
            Text("移除 ${person.name.ifBlank { "人物" }}", color = Color(0xFFFF8AA3), fontSize = 13.sp, modifier = Modifier.clickable { model.removePerson(person.id) }.padding(vertical = 6.dp))
        }
        Text("加一位人物", color = Ink.accent, modifier = Modifier.clickable { model.addPerson() }.padding(vertical = 8.dp))
        if (importing) {
            Text("导入支持 UTF-8 编码的 TXT 或叙梦 JSON，每个文件不超过 1.5 MB。", color = Ink.muted, fontSize = 13.sp, modifier = Modifier.padding(top = 8.dp))
            Text("从文件导入", color = Ink.accent, modifier = Modifier.clickable(onClick = importFile).padding(vertical = 8.dp))
            Field("或粘贴 TXT / JSON", importText, lines = 6) { importText = it.take(1_500_000) }
            Text("导入为新作品", color = Ink.text, modifier = Modifier.clickable { model.importDraft(importText); importing = false }.padding(vertical = 8.dp))
        }
        state.notice?.let { Text(it, color = Ink.muted, fontSize = 13.sp, modifier = Modifier.padding(vertical = 6.dp)) }
        if (state.previewKind.isNotEmpty()) {
            val acceptLabel = when {
                state.previewKind == "outline" && draft.outline.isNotBlank() -> "替换当前大纲"
                state.previewKind == "outline" -> "插入大纲"
                chapter == null -> "插入新章节"
                else -> "追加到原章节"
            }
            Text(if (state.previewKind == "outline") "大纲预览" else "续写预览", color = Ink.text, fontSize = 16.sp, modifier = Modifier.padding(top = 12.dp))
            Text("原稿不会自动改动。", color = Ink.muted, fontSize = 12.sp)
            Text(state.preview.ifBlank { "正在写" }, color = Ink.text, fontSize = 14.sp, modifier = Modifier.padding(top = 6.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                Text(acceptLabel, color = Ink.accent, modifier = Modifier.clickable(enabled = !state.saving && state.preview.isNotBlank()) { model.acceptPreview() }.padding(vertical = 8.dp))
                Text("导出预览", color = Ink.accent, modifier = Modifier.clickable(enabled = state.preview.isNotBlank()) {
                    share("$filename-preview.txt", state.preview, "text/plain")
                }.padding(vertical = 8.dp))
                Text("丢弃", color = Ink.muted, modifier = Modifier.clickable(enabled = !state.saving) { model.discardPreview() }.padding(vertical = 8.dp))
            }
        }
        draft.chapters.forEachIndexed { index, item ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    item.title.ifBlank { "未命名章节" },
                    color = if (item.id == chapter?.id) Ink.accent else Ink.muted,
                    modifier = Modifier.weight(1f).clickable { model.selectChapter(item.id) }.padding(vertical = 6.dp),
                )
                if (index > 0) Text("上移", color = Ink.accent, fontSize = 13.sp, modifier = Modifier.clickable { model.moveChapter(item.id, -1) }.padding(8.dp))
                if (index < draft.chapters.lastIndex) Text("下移", color = Ink.accent, fontSize = 13.sp, modifier = Modifier.clickable { model.moveChapter(item.id, 1) }.padding(8.dp))
                if (draft.chapters.size > 1) Text("删除", color = Color(0xFFFF8AA3), fontSize = 13.sp, modifier = Modifier.clickable { confirm = item.id }.padding(8.dp))
            }
        }
        if (chapter != null) {
            val words = chapter.content.count { !it.isWhitespace() }
            Text("$words 字 · ${chapter.content.length} / 50000", color = Ink.muted, fontSize = 12.sp, modifier = Modifier.padding(top = 8.dp))
            Field("章节标题", chapter.title) { value ->
                model.edit { current -> current.copy(chapters = current.chapters.map { if (it.id == chapter.id) it.copy(title = value.take(120)) else it }) }
            }
            Field("正文", chapter.content, lines = 12) { value ->
                model.edit { current -> current.copy(chapters = current.chapters.map { if (it.id == chapter.id) it.copy(content = value.take(50_000)) else it }) }
            }
        }
        }
        state.error?.let { Text(it, color = Color(0xFFFF8AA3), fontSize = 13.sp, modifier = Modifier.padding(vertical = 8.dp)) }
    }
    confirm?.let { pending ->
        val leave = pending == "leave"
        val work = pending == "work"
        val chapterTitle = draft.chapters.find { it.id == pending }?.title?.ifBlank { "未命名章节" }
        Box(Modifier.fillMaxSize().background(Color(0xAA000000)).clickable(enabled = !state.saving) { confirm = null })
        Column(Modifier.align(Alignment.Center).padding(28.dp).background(Ink.surface, RoundedCornerShape(12.dp)).padding(20.dp)) {
            Text(
                when {
                    leave -> "有未保存的内容"
                    work && draft.version == null -> "放弃当前草稿？"
                    work -> "删除这部私人作品？"
                    else -> "删除这个章节？"
                },
                color = Ink.text,
                fontSize = 18.sp,
            )
            Text(
                when {
                    leave -> "保存作品后再返回作品列表，或放弃本次未保存的内容。" + if (state.preview.isNotBlank()) "AI 预览尚未插入，继续操作会放弃预览。" else ""
                    work && draft.version == null -> "还没保存的内容会丢掉。"
                    work -> "作品及所有章节将一并删除，请先导出需要保留的内容。"
                    else -> "「${chapterTitle ?: "这一章"}」会从当前草稿移除，保存后生效。未插入的预览会保留。"
                },
                color = Ink.muted,
                fontSize = 14.sp,
                modifier = Modifier.padding(top = 10.dp),
            )
            Row(Modifier.padding(top = 16.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                Text(if (leave) "继续编辑" else "取消", color = Ink.muted, modifier = Modifier.clickable(enabled = !state.saving) { confirm = null }.padding(vertical = 8.dp))
                if (leave) {
                    Text(if (state.saving) "正在保存" else if (state.preview.isNotBlank()) "保存原稿并继续" else "保存并继续", color = Ink.text, modifier = Modifier.clickable(enabled = !state.saving) {
                        confirm = null
                        model.save(andLeave = true)
                    }.padding(vertical = 8.dp))
                    Text("放弃未保存内容", color = Color(0xFFFF8AA3), modifier = Modifier.clickable(enabled = !state.saving) {
                        confirm = null
                        model.discardUnsaved()
                    }.padding(vertical = 8.dp))
                } else {
                    Text(if (work && draft.version == null) "放弃" else "确认删除", color = Color(0xFFFF8AA3), modifier = Modifier.clickable(enabled = !state.saving) {
                        if (work) model.remove() else model.removeChapter(pending)
                        confirm = null
                    }.padding(vertical = 8.dp))
                }
            }
        }
    }
    }
}

@Composable
private fun NovelReading(draft: NovelDraft, dirty: Boolean) {
    Text("阅读作品 · 当前稿件", color = Ink.muted, fontSize = 12.sp, modifier = Modifier.padding(top = 12.dp))
    Text(draft.title.ifBlank { "未命名作品" }, color = Ink.text, fontSize = 22.sp, modifier = Modifier.padding(top = 6.dp))
    if (dirty) Text("包含尚未保存的修改。", color = Ink.muted, fontSize = 13.sp, modifier = Modifier.padding(top = 6.dp))
    if (draft.synopsis.isNotBlank()) Text(draft.synopsis, color = Ink.text, fontSize = 15.sp, modifier = Modifier.padding(top = 10.dp))
    if (draft.chapters.isEmpty()) {
        Text("尚未添加章节。", color = Ink.muted, modifier = Modifier.padding(top = 12.dp))
    }
    draft.chapters.forEachIndexed { index, item ->
        Text(item.title.ifBlank { "第${index + 1}章" }, color = Ink.text, fontSize = 18.sp, modifier = Modifier.padding(top = 18.dp))
        Text(item.content.ifBlank { "这一章还没有正文。" }, color = Ink.text, fontSize = 15.sp, lineHeight = 24.sp, modifier = Modifier.padding(top = 8.dp))
    }
}

private val liveVoices = listOf(
    "zh_female_liuchangnv_uranus_bigtts" to "自然中文 · 流畅",
    "Tina" to "Tina · 自然女声",
    "Katerina" to "御姐",
    "Momo" to "软萌 · 撒娇",
    "Sunnybobi" to "邻家 · 元气",
    "Liora Mira" to "温柔",
    "Harvey" to "低沉 · 温和",
    "Ethan" to "阳光 · 活力",
    "Evan" to "清爽青年",
    "Raymond" to "清亮男声",
)

private val speechVoices = listOf(
    "cRL5y2g9Apu45tuoclY0" to "晚灯 · 默认",
    "melotts" to "自然中文 · 默认",
    "HE2pJq42vZv55x9j9gOh" to "清川 · 女声",
    "dGyruSqrNQLp4m4NQbHz" to "微澜 · 女声",
    "BT0SH7Hb8NRPpT5xbCgg" to "Lulu · 女声",
    "female-yujie" to "御姐 · 女声",
    "female-shaonv" to "软萌少女 · 女声",
    "female-tianmei" to "甜美 · 女声",
    "female-chengshu" to "成熟 · 女声",
    "male-qn-qingse" to "青涩青年 · 男声",
    "male-qn-daxuesheng" to "清爽青年 · 男声",
    "male-qn-badao" to "霸道男声 · 男声",
    "male-qn-jingying" to "沉稳男声 · 男声",
    "breeze-whisper" to "贴耳 · 魅魔",
    "breeze-pact" to "夜契 · 魅魔",
    "breeze-cling" to "黏人 · 魅魔",
    "breeze-bite" to "咬笑 · 魅魔",
)

private fun validPortrait(value: String): Boolean {
    if (value.startsWith("/") && !value.startsWith("//")) return true
    val url = runCatching { java.net.URI(value) }.getOrNull() ?: return false
    return url.scheme == "https" && url.rawUserInfo == null && url.host != null
}

private fun shareNovel(context: android.content.Context, name: String, body: String, mime: String) {
    val safe = name.replace(Regex("""[\\/:*?"<>|\s]+"""), "_").take(80).ifBlank { "作品.txt" }
    val directory = File(context.cacheDir, "exports").apply { mkdirs() }
    val file = File(directory, safe)
    file.writeText(body)
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
    val send = Intent(Intent.ACTION_SEND).apply {
        type = mime
        putExtra(Intent.EXTRA_STREAM, uri)
        putExtra(Intent.EXTRA_SUBJECT, safe)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        clipData = ClipData.newRawUri(safe, uri)
    }
    context.startActivity(Intent.createChooser(send, "导出作品").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}

@Composable
private fun Field(label: String, value: String, lines: Int = 1, onChange: (String) -> Unit) {
    Text(label, color = Ink.muted, fontSize = 12.sp, modifier = Modifier.padding(top = 10.dp, bottom = 4.dp))
    TextField(
        value = value,
        onValueChange = onChange,
        modifier = Modifier.fillMaxWidth(),
        minLines = lines,
        colors = TextFieldDefaults.colors(
            focusedContainerColor = Ink.surface,
            unfocusedContainerColor = Ink.surface,
            focusedTextColor = Ink.text,
            unfocusedTextColor = Ink.text,
            focusedIndicatorColor = Color.Transparent,
            unfocusedIndicatorColor = Color.Transparent,
            cursorColor = Ink.accent,
        ),
    )
}
